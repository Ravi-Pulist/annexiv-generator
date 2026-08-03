// vector.js — building and searching the semantic tier.
//
// Separate from embed.js (which owns cards and providers) because this owns the STORE
// interaction: what gets re-embedded, what is reused, and how a query becomes a ranked
// list. The split matters for the incremental path — re-embedding is the only genuinely
// expensive step in the whole index, so a card whose text has not changed must never be
// paid for twice.

'use strict';

const store = require('../store/db.js');
const codeGraph = require('../code-graph.js');
const G = require('../code-graph.js');
const embed = require('./embed.js');

function open(root, create = false) {
  const conn = store.open(codeGraph.indexPath(root), { create });
  if (!conn) throw new Error('cannot open the index store');
  return conn;
}

/**
 * Embed every symbol whose card changed.
 *
 * @param {object} opts { provider, batch, onProgress, force }
 */
function build(root, g, opts = {}) {
  const providerName = opts.provider || 'hashing';
  const provider = embed.getProvider(providerName);
  if (!provider) {
    throw new Error(`unknown embedding provider "${providerName}" — registered: ${[...embed.providers.keys()].join(', ')}`);
  }

  const conn = open(root, true);
  const t0 = Date.now();
  let embedded = 0, reused = 0, skipped = 0;

  try {
    const existing = new Map();
    for (const r of conn.prepare('SELECT node_id, card_hash FROM symbol_cards').all()) {
      existing.set(r.node_id, r.card_hash);
    }

    const symbols = G.allNodes(g).filter((n) => n.kind !== 'file' && n.kind !== 'constant' && n.file);
    const pending = [];
    for (const n of symbols) {
      const text = embed.buildCard(g, n);
      if (!text || text.length < 8) { skipped++; continue; }
      const hash = embed.cardHash(text, providerName);
      // The whole point of hashing the card: a formatting-only edit changes the file hash
      // and the graph, but not the card, so it must not trigger a re-embed.
      if (!opts.force && existing.get(n.id) === hash) { reused++; continue; }
      pending.push({ id: n.id, text, hash });
    }

    const insCard = conn.prepare(`INSERT INTO symbol_cards (node_id, card_text, card_hash, model, dims, embedded_at)
                                  VALUES (?, ?, ?, ?, ?, ?)
                                  ON CONFLICT(node_id) DO UPDATE SET
                                    card_text=excluded.card_text, card_hash=excluded.card_hash,
                                    model=excluded.model, dims=excluded.dims, embedded_at=excluded.embedded_at`);
    const insVec = conn.prepare(`INSERT INTO symbol_vec (node_id, vec, dims) VALUES (?, ?, ?)
                                  ON CONFLICT(node_id) DO UPDATE SET vec=excluded.vec, dims=excluded.dims`);

    const batchSize = opts.batch || 128;
    for (let i = 0; i < pending.length; i += batchSize) {
      const chunk = pending.slice(i, i + batchSize);
      const vectors = provider.embed(chunk.map((c) => c.text));
      if (!Array.isArray(vectors) || vectors.length !== chunk.length) {
        throw new Error(`provider "${providerName}" returned ${vectors && vectors.length} vectors for ${chunk.length} inputs`);
      }
      conn.exec('BEGIN IMMEDIATE');
      try {
        for (let j = 0; j < chunk.length; j++) {
          const vec = embed.normalise(vectors[j]);
          const { blob } = embed.quantiseInt8(vec);
          insCard.run(chunk[j].id, chunk[j].text, chunk[j].hash, providerName, vec.length, Date.now());
          insVec.run(chunk[j].id, blob, vec.length);
          embedded++;
        }
        conn.exec('COMMIT');
      } catch (err) {
        try { conn.exec('ROLLBACK'); } catch { /* already unwound */ }
        throw err;
      }
      if (opts.onProgress) opts.onProgress(Math.min(i + batchSize, pending.length), pending.length);
    }

    // Symbols that no longer exist must lose their vectors, or a deleted function stays
    // answerable — the same deletion-propagation bug that makes stale RAG dangerous.
    const live = new Set(symbols.map((n) => n.id));
    let pruned = 0;
    for (const r of conn.prepare('SELECT node_id FROM symbol_cards').all()) {
      if (!live.has(r.node_id)) {
        conn.prepare('DELETE FROM symbol_cards WHERE node_id = ?').run(r.node_id);
        conn.prepare('DELETE FROM symbol_vec WHERE node_id = ?').run(r.node_id);
        pruned++;
      }
    }

    store.setMeta(conn, { vector_provider: providerName, vector_dims: provider.dims, vector_built: Date.now() });
    return { embedded, reused, skipped, pruned, provider: providerName, dims: provider.dims,
      semantic: provider.semantic !== false, tookMs: Date.now() - t0 };
  } finally {
    store.close(conn);
  }
}

/** Is there a usable semantic tier, and what built it? */
function status(root) {
  let conn;
  try { conn = open(root, false); } catch { return { available: false, reason: 'no index' }; }
  try {
    const row = conn.prepare('SELECT COUNT(*) n FROM symbol_vec').get();
    const meta = store.getMeta(conn);
    const provider = meta.vector_provider || null;
    const impl = provider ? embed.getProvider(provider) : null;
    return {
      available: row.n > 0,
      count: row.n,
      provider,
      dims: meta.vector_dims ? Number(meta.vector_dims) : null,
      // Carried through to every consumer: a pipeline verified with a non-semantic
      // provider is a working pipeline, not a working semantic search.
      semantic: impl ? impl.semantic !== false : null,
      built: meta.vector_built ? Number(meta.vector_built) : null
    };
  } catch {
    return { available: false, reason: 'vector tables missing' };
  } finally {
    store.close(conn);
  }
}

/**
 * Nearest cards to a query.
 *
 * Brute force, deliberately. At the ~50k symbols a single repository produces this is a
 * few milliseconds of arithmetic over int8, and an ANN index would add a dependency, a
 * build step and a recall approximation to save time nobody is currently spending.
 */
function search(root, query, opts = {}) {
  const limit = opts.limit || 50;
  const st = status(root);
  if (!st.available) return [];
  const provider = embed.getProvider(st.provider);
  if (!provider) return [];

  const [qv] = provider.embed([String(query)]);
  const q = embed.normalise(qv);

  const conn = open(root, false);
  try {
    const rows = conn.prepare('SELECT node_id, vec FROM symbol_vec').all();
    const scored = [];
    for (const r of rows) {
      const v = embed.dequantiseInt8(r.vec);
      scored.push({ node_id: r.node_id, score: embed.cosine(q, v) });
    }
    scored.sort((a, b) => b.score - a.score);
    // A floor, so a query with no real neighbour returns nothing rather than the least
    // bad of 50k. Cosine over normalised vectors makes ~0.25 a weak-but-real signal.
    const floor = opts.floor ?? 0.25;
    return scored.filter((s) => s.score >= floor).slice(0, limit);
  } finally {
    store.close(conn);
  }
}

function drop(root) {
  const conn = open(root, false);
  try {
    conn.exec('DELETE FROM symbol_cards; DELETE FROM symbol_vec;');
    store.setMeta(conn, { vector_provider: null, vector_dims: null, vector_built: null });
  } finally {
    store.close(conn);
  }
}

module.exports = { build, search, status, drop };
