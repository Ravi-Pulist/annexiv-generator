// embed.js — tier 3: symbol cards, quantisation, and a pluggable embedding provider.
//
// WHY THIS EXISTS AT ALL, and it is not because embeddings were assumed necessary: the
// 50-query golden set measured tiers 1+2 (graph + lexical) at 56% recall@5 against a 90%
// bar, and 14.3% on the `vocab-gap` class — queries whose words appear nowhere in the code
// they are about ("make terminal output look nice" -> formatTOON). Deterministic tiers are
// perfect on symbol-shaped queries (100%) and essentially blind on that class. That gap is
// what this tier is for, and nothing else.
//
// WHAT IS EMBEDDED IS A CARD, NOT A CHUNK. A symbol card is self-contained — signature,
// purpose, callers, feature — so a hit is directly graph-expandable and maps to exactly
// one file:line. Embedding raw file chunks would produce hits that need more retrieval to
// be useful, and would put arbitrary source text (including secrets) into vectors.
//
// EMBEDDINGS ARE RECOVERABLE SOURCE. Inversion research reconstructs ~92% of a short input
// from its vector alone, so a vector store is a lossy copy of the code, not an anonymised
// one. Consequences, enforced here rather than documented and forgotten: cards are
// secret-redacted before embedding, vectors never leave the machine, and the provider that
// generates them is explicit and off by default.

'use strict';

const crypto = require('crypto');
const secrets = require('../security/secrets.js');
const G = require('../code-graph.js');

// ─── the card ───────────────────────────────────────────────────────────────

/**
 * Build the text that represents a symbol for semantic search.
 *
 * This is Anthropic's contextual-retrieval technique applied to code: a situating prefix
 * around the thing being embedded measured 49% fewer failed retrievals (67% with
 * reranking). On a local model the prefix costs nothing to generate, because it is
 * assembled from the graph rather than written by an LLM.
 */
function buildCard(g, node) {
  const lines = [];
  const sig = renderSignature(node);
  lines.push(`${node.kind} ${node.qualname || node.name}`);
  if (sig) lines.push(sig);
  lines.push(PROVENANCE_MARK);
  if (node.doc) lines.push(String(node.doc).split('\n').slice(0, 3).join(' ').slice(0, 400));

  // Context from the graph. "Called by" is what turns an anonymous helper into
  // "the thing the auth routes use", which is how people actually describe code.
  const callers = G.callers(g, node.id).slice(0, 3)
    .map((c) => { const n = G.getNode(g, c.id); return n ? (n.qualname || n.name) : null; })
    .filter(Boolean);
  const callees = G.callees(g, node.id).slice(0, 3)
    .map((c) => { const n = G.getNode(g, c.id); return n ? (n.qualname || n.name) : null; })
    .filter(Boolean);
  if (callers.length) lines.push(`Called by: ${callers.join(', ')}`);
  if (callees.length) lines.push(`Calls: ${callees.join(', ')}`);
  if (node.route) lines.push(`Route: ${node.route.method} ${node.route.path}`);

  const raw = lines.join('\n');
  // Redact BEFORE the text becomes a vector. A credential that reaches an embedding is
  // recoverable from it, and unlike an index row it cannot be selectively deleted later.
  //
  // The provenance line is EXEMPT, and stands in as a short marker while the rest is
  // redacted. It is generated here from graph fields — a path, a line number, a language,
  // a fidelity — so it cannot carry a secret this function did not itself write. Passing
  // it through the sweep destroyed it: the entropy backstop reads a normal path as
  // high-entropy once it passes ~24 characters, and measured on RMAD's own index that hit
  // 572 of 647 cards (88.4%). Any repo with ordinary directory depth loses the same way,
  // and the path tokens it removes are the strongest lexical bridge a vocabulary-gap
  // query has.
  return secrets.redact(raw).text.replace(PROVENANCE_MARK, provenanceLine(node));
}

// Short and low-entropy on purpose: the marker has to survive the sweep that the line it
// stands for could not.
const PROVENANCE_MARK = '@@prov@@';

function provenanceLine(node) {
  // `language` is absent on symbol nodes, which rendered every card as "[ ast]" — a
  // wasted token and a missing filter key. Fall back to the file extension.
  const lang = node.language || extLang(node.file) || '?';
  const fid = node.fidelity || '?';
  return `${node.file}:${node.line}  [${lang} ${fid}]`;
}

function extLang(file) {
  const m = /\.([a-z0-9]+)$/i.exec(String(file || ''));
  if (!m) return null;
  const e = m[1].toLowerCase();
  return { js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
           ts: 'typescript', tsx: 'typescript', py: 'python', go: 'go', rs: 'rust',
           java: 'java', rb: 'ruby', php: 'php', cs: 'csharp' }[e] || e;
}

function renderSignature(n) {
  if (!n.args) return null;
  const args = n.args.map((a) => {
    const pre = a.kind === 'rest' ? '...' : a.kind === 'keyword-only' ? '*' : '';
    return pre + a.name + (a.annotation ? `: ${a.annotation}` : '') + (a.default ? ` = ${a.default}` : '');
  }).join(', ');
  return `${n.is_async ? 'async ' : ''}${n.name}(${args})${n.returns ? ` -> ${n.returns}` : ''}`;
}

const cardHash = (text, model) => crypto.createHash('sha1').update(`${model}\0${text}`).digest('hex');

// ─── quantisation ───────────────────────────────────────────────────────────
//
// int8 rather than float32: 4x smaller for a recall cost measured in fractions of a
// percent. At 350k symbols that is 358 MB against 1.43 GB — the difference between an
// index you keep beside the repo and one you do not.

function quantiseInt8(vec) {
  let max = 0;
  for (const v of vec) { const a = Math.abs(v); if (a > max) max = a; }
  const scale = max > 0 ? 127 / max : 1;
  const out = Buffer.allocUnsafe(vec.length);
  for (let i = 0; i < vec.length; i++) {
    out[i] = Math.max(-127, Math.min(127, Math.round(vec[i] * scale))) & 0xff;
  }
  return { blob: out, scale };
}

function dequantiseInt8(blob) {
  const out = new Float32Array(blob.length);
  for (let i = 0; i < blob.length; i++) {
    const b = blob[i];
    out[i] = (b > 127 ? b - 256 : b);
  }
  return out;
}

/** Cosine on already-normalised vectors is a dot product; normalise once at write time. */
function normalise(vec) {
  let n = 0;
  for (const v of vec) n += v * v;
  n = Math.sqrt(n) || 1;
  return vec.map((v) => v / n);
}

function cosine(a, b) {
  // Truncating to the shorter vector was a silent corruption channel: cosine(256d, 128d)
  // returned a plausible 0.1040 instead of failing. Any provider swap that changes `dims`
  // would score new queries against old vectors and produce confident nonsense. A
  // dimension mismatch is a bug in the caller, so it raises rather than degrades.
  if (a.length !== b.length) {
    throw new Error(
      `vector dimension mismatch: ${a.length} vs ${b.length} — the index was probably ` +
      `built by a different embedding provider. Rebuild it with \`rmad index embed --force\`.`
    );
  }
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ─── providers ──────────────────────────────────────────────────────────────
//
// A provider turns text into a vector. It is pluggable because the model is a policy
// decision — cost, licence, whether weights may be downloaded, whether a local server may
// be contacted — and none of those should be baked into the retrieval layer.

const providers = new Map();

function registerProvider(name, impl) {
  if (typeof impl.embed !== 'function' || !impl.dims) {
    throw new Error(`provider "${name}" must expose { dims, embed(texts) -> number[][] }`);
  }
  providers.set(name, impl);
}

function getProvider(name) {
  return providers.get(name) || null;
}

/**
 * The built-in provider: deterministic, dependency-free, offline.
 *
 * IT IS NOT A SEMANTIC MODEL AND MUST NOT BE PRESENTED AS ONE. It hashes character
 * n-grams into a fixed space, which makes it excellent for verifying that the pipeline
 * stores, quantises, retrieves and ranks correctly, and useless for the vocabulary-gap
 * problem that justified building this tier — "terminal output look nice" shares no
 * n-grams with "formatTOON".
 *
 * It exists so the tier is testable and shippable while the model dependency is decided,
 * not as an answer to the measurement. `index embed --provider hashing` says so on the
 * way in, and `index status` says so afterwards.
 */
const hashingProvider = {
  name: 'hashing',
  dims: 256,
  semantic: false,
  embed(texts) {
    return texts.map((text) => {
      const vec = new Array(256).fill(0);
      const t = String(text).toLowerCase();
      const tokens = t.split(/[^a-z0-9_$]+/).filter(Boolean);
      for (const tok of tokens) {
        for (let n = 3; n <= 5; n++) {
          for (let i = 0; i + n <= tok.length; i++) {
            const gram = tok.slice(i, i + n);
            const h = crypto.createHash('md5').update(gram).digest();
            vec[h.readUInt16BE(0) % 256] += 1;
          }
        }
        const h = crypto.createHash('md5').update(tok).digest();
        vec[h.readUInt16BE(2) % 256] += 2;
      }
      return normalise(vec);
    });
  }
};
registerProvider('hashing', hashingProvider);

module.exports = {
  buildCard, renderSignature, cardHash,
  quantiseInt8, dequantiseInt8, normalise, cosine,
  registerProvider, getProvider, providers,
  hashingProvider
};
