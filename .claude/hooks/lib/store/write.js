// write.js — persist an assembled graph into SQLite.
//
// The build pipeline is unchanged: buildGraph() still assembles the whole graph in memory
// (it is incremental at the EXTRACTION level, which is where the cost is), and this module
// replaces the stored copy in one transaction. A full replace rather than a diff is
// deliberate — the assembled graph is already complete, and a diffing writer is a second
// place for the index to disagree with itself.
//
// ROUND-TRIP FIDELITY IS THE CONTRACT. `props` holds the node/edge object VERBATIM as
// JSON; the columns beside it exist only so the query layer can use an index. That costs
// some duplicated bytes and buys a guarantee: what comes out of read.js is byte-identical
// to what went in, so the parity suite can compare the SQL implementation against the old
// JSON one without allowing for "close enough". Normalising the columns out of props is a
// later optimisation that the parity test will keep honest.

'use strict';

const db = require('./db.js');
const secrets = require('../security/secrets.js');

function jsonOf(v) {
  return JSON.stringify(v === undefined ? null : v);
}

/**
 * Split an identifier the way a searcher thinks about it, keeping the whole form too.
 * `TokenStore.getUserId` -> "TokenStore.getUserId TokenStore getUserId get User Id"
 * Without the parts, searching "user" misses it; without the whole, searching the exact
 * symbol name misses it.
 */
function searchTerms(qualname, name) {
  const out = new Set();
  for (const src of [qualname, name]) {
    if (!src) continue;
    out.add(src);
    for (const seg of String(src).split(/[.#/]/)) {
      if (!seg) continue;
      out.add(seg);
      for (const part of seg.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9$]+/)) {
        if (part.length > 1) out.add(part);
      }
    }
  }
  return [...out].join(' ');
}

/** Render a signature for search and display: `name(a: T = 1, ...rest) -> R`. */
function renderSignature(n) {
  if (!n.args) return null;
  const args = n.args.map((a) => {
    const pre = a.kind === 'rest' ? '...' : a.kind === 'keyword-only' ? '*' : '';
    return pre + a.name +
      (a.annotation ? `: ${a.annotation}` : '') +
      (a.default ? ` = ${a.default}` : '');
  }).join(', ');
  return `${n.is_async ? 'async ' : ''}${n.name}(${args})${n.returns ? ` -> ${n.returns}` : ''}`;
}

/**
 * Write a complete graph object to `file`, replacing whatever was there.
 * Returns true on success, false if SQLite is unavailable (caller falls back to JSON).
 */
function writeGraph(file, graph) {
  const conn = db.open(file, { create: true });
  if (!conn) return false;

  try {
    conn.exec('BEGIN IMMEDIATE');

    // `meta` is SHARED — retrieve/vector.js keeps vector_provider / vector_dims /
    // vector_built there. Wiping the whole table on a structural rebuild left every row
    // in symbol_vec intact while the metadata describing them vanished, so status()
    // reported the tier available with a null provider and search() silently returned
    // nothing. Tier 3 disappeared from the funnel after any `index build`, with no error.
    const preserved = {};
    for (const [k, v] of Object.entries(db.getMeta(conn))) {
      if (k.startsWith('vector_')) preserved[k] = v;
    }

    conn.exec('DELETE FROM nodes; DELETE FROM edges; DELETE FROM files; DELETE FROM semantic; DELETE FROM features; DELETE FROM meta; DELETE FROM symbols_fts;');

    if (Object.keys(preserved).length) db.setMeta(conn, preserved);

    db.setMeta(conn, {
      schema: db.SCHEMA_VERSION,
      graph_schema: graph.schema,
      root: graph.root,
      generated: graph.generated,
      durationMs: graph.durationMs,
      stats: JSON.stringify(graph.stats || {})
    });

    // ── files ──
    const insFile = conn.prepare('INSERT INTO files (path, seq, hash, doc_json) VALUES (?, ?, ?, ?)');
    let seq = 0;
    for (const [p, rec] of Object.entries(graph.files || {})) {
      insFile.run(p, seq++, String(rec.hash || ''), jsonOf(rec.doc));
    }

    // ── nodes ──
    const insNode = conn.prepare(`INSERT INTO nodes
      (id, seq, kind, name, qualname, qualname_lc, file, path, line, end_line, loc,
       fidelity, language, complexity, has_route, has_decorators, props)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    seq = 0;
    for (const n of Object.values(graph.nodes || {})) {
      insNode.run(
        n.id,
        seq++,
        n.kind,
        n.name ?? null,
        n.qualname ?? null,
        n.qualname ? String(n.qualname).toLowerCase() : null,
        n.file ?? null,
        n.path ?? null,
        Number.isInteger(n.line) ? n.line : null,
        Number.isInteger(n.end_line) ? n.end_line : null,
        Number.isInteger(n.loc) ? n.loc : null,
        n.fidelity ?? null,
        n.language ?? null,
        Number.isInteger(n.complexity) ? n.complexity : null,
        n.route ? 1 : 0,
        (n.decorators || []).length ? 1 : 0,
        jsonOf(n)
      );
    }

    // ── tier 2: the lexical index ──
    //
    // Nodes arrive already redacted — code-graph.js scrubs credentials at node assembly,
    // so there is no unredacted node anywhere in the process. The redactCard() call below
    // is defence in depth over the RENDERED signature, which is composed here from several
    // fields at once.
    const insFts = conn.prepare(
      'INSERT INTO symbols_fts (node_id, qualname, terms, signature, doc) VALUES (?, ?, ?, ?, ?)'
    );
    for (const n of Object.values(graph.nodes || {})) {
      if (n.kind === 'file') continue;
      const sig = renderSignature(n);
      // Belt and braces: the node is already clean, so this normally finds nothing. It
      // stays because a signature is rendered here from several fields at once, and a
      // second pass over the rendered form costs nothing.
      const clean = secrets.redactCard({ signature: sig, doc: n.doc || null });
      insFts.run(
        n.id,
        n.qualname || n.name || '',
        searchTerms(n.qualname, n.name),
        clean.signature || '',
        clean.doc || ''
      );
    }

    // ── edges ──
    // seq is the rowid alias and is assigned explicitly so insertion order survives a
    // VACUUM. cycles() is a DFS over adjacency in this order; losing it changes results.
    const insEdge = conn.prepare(`INSERT INTO edges
      (seq, from_id, to_id, type, resolved, resolution, line, unresolved, props)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    seq = 0;
    for (const e of graph.edges || []) {
      insEdge.run(
        seq++,
        e.from,
        e.to,
        e.type,
        e.resolved === false ? 0 : 1,
        e.resolution ?? null,
        Number.isInteger(e.line) ? e.line : null,
        e.unresolved ?? null,
        jsonOf(e)
      );
    }

    // ── layer 2 / layer 3 ──
    const insSem = conn.prepare('INSERT INTO semantic (node_id, seq, json) VALUES (?, ?, ?)');
    seq = 0;
    for (const [id, rec] of Object.entries(graph.semantic || {})) insSem.run(id, seq++, jsonOf(rec));

    const insFeat = conn.prepare('INSERT INTO features (key, seq, json) VALUES (?, ?, ?)');
    seq = 0;
    for (const [k, rec] of Object.entries(graph.features || {})) insFeat.run(k, seq++, jsonOf(rec));

    conn.exec('COMMIT');
    return true;
  } catch (err) {
    try { conn.exec('ROLLBACK'); } catch { /* transaction already unwound */ }
    throw err;
  } finally {
    db.close(conn);
  }
}

/**
 * Rewrite only the layers a human edits: semantic (Layer 2) and features (Layer 3).
 * `rmad index annotate` records one rationale and re-saves; rewriting 350k nodes to store
 * one string is the kind of waste that makes people stop annotating, and Layer 2 is the
 * one layer no parser can regenerate.
 *
 * Structure is deliberately NOT touched here — it comes from buildGraph, and letting an
 * annotate path rewrite it is how a graph starts disagreeing with the code it describes.
 */
function writeMutableLayers(file, { semantic, features }) {
  const conn = db.open(file, { create: false });
  if (!conn) return false;
  try {
    conn.exec('BEGIN IMMEDIATE');
    conn.exec('DELETE FROM semantic; DELETE FROM features;');
    const insSem = conn.prepare('INSERT INTO semantic (node_id, seq, json) VALUES (?, ?, ?)');
    let seq = 0;
    for (const [id, rec] of Object.entries(semantic || {})) insSem.run(id, seq++, jsonOf(rec));
    const insFeat = conn.prepare('INSERT INTO features (key, seq, json) VALUES (?, ?, ?)');
    seq = 0;
    for (const [k, rec] of Object.entries(features || {})) insFeat.run(k, seq++, jsonOf(rec));
    conn.exec('COMMIT');
    return true;
  } catch (err) {
    try { conn.exec('ROLLBACK'); } catch { /* transaction already unwound */ }
    throw err;
  } finally {
    db.close(conn);
  }
}

/**
 * Replace the span-chunk tier (RMAD-R2).
 *
 * Written as a whole-tier replace rather than an incremental merge, for the same reason
 * writeGraph replaces the structure: spans are DERIVED from source, so a partial update
 * cannot be more correct than a rebuild, and a stale span pointing at a line that has moved
 * is worse than no span at all.
 *
 * Kept separate from writeGraph so a caller that cannot read the working tree — a hook
 * operating on a loaded graph, say — still writes a valid index, just without the span tier.
 */
function writeSpans(file, chunks) {
  const conn = db.open(file, { create: false });
  if (!conn) return false;
  try {
    conn.exec('BEGIN IMMEDIATE');
    conn.exec('DELETE FROM span_chunks; DELETE FROM spans_fts;');
    const ins = conn.prepare(`INSERT INTO span_chunks
      (id, file, parent_id, line, end_line, seq, language, fidelity, is_test, text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insFts = conn.prepare('INSERT INTO spans_fts (chunk_id, text) VALUES (?, ?)');
    let n = 0;
    for (const c of chunks || []) {
      ins.run(c.id, c.file, c.parent, c.line, c.end_line, c.seq ?? n,
        c.language || null, c.fidelity || null, c.isTest ? 1 : 0, c.text);
      insFts.run(c.id, c.text);
      n++;
    }
    conn.exec('COMMIT');
    return true;
  } catch (err) {
    try { conn.exec('ROLLBACK'); } catch { /* transaction already unwound */ }
    throw err;
  } finally {
    db.close(conn);
  }
}

module.exports = { writeGraph, writeMutableLayers, writeSpans };
