// audit.js — RMAD-R1. Measure the corpus, then let it choose its own retrieval tier.
//
// WHY THIS EXISTS. Every retrieval decision in the spec is conditional on corpus size, and
// RMAD was making those decisions by assumption. "Is this codebase huge, a few repos, or
// short?" was the first question asked of the framework and it had no way to answer it.
//
// THE SIGNAL THAT MATTERS MOST is not symbol count — it is `linesOutsideSymbols`. On RMAD
// itself roughly half of all lines sit inside no symbol span: module-level constants, regex
// tables, config objects, top-level wiring. A symbol-card-only index is structurally blind
// to them, and no amount of reranking recovers a chunk that was never indexed. That single
// percentage sizes the chunking work (RMAD-R2) more honestly than any recall number.
//
// EVERY THRESHOLD BELOW IS A STARTING POINT, NOT A FINDING. They are exported so the first
// real corpora can move them, and `audit` reports which tier it chose AND why, so a wrong
// threshold is visible rather than silent.

'use strict';

const fs = require('fs');
const path = require('path');

// Tier boundaries, in symbols. Deliberately exported and deliberately labelled a guess.
const TIERS = [
  { id: 'T0', name: 'small',  maxSymbols: 2000,   store: 'brute-force in JS',      chunking: 'symbol cards',                  rerank: 'graph-aware',              query: 'none' },
  { id: 'T1', name: 'medium', maxSymbols: 15000,  store: 'brute-force, int8',      chunking: 'symbol + span chunks',          rerank: 'graph-aware',              query: 'class-routed' },
  { id: 'T2', name: 'large',  maxSymbols: 150000, store: 'ANN index',              chunking: 'hierarchical parent-child',     rerank: 'cross-encoder',            query: 'multi-query on prose' },
  { id: 'T3', name: 'huge',   maxSymbols: Infinity, store: 'ANN + metadata routing', chunking: 'hierarchical + late chunking', rerank: 'cross-encoder, two-pass', query: 'routing + multi-query' }
];

const THRESHOLD_PROVENANCE =
  'Every tier boundary is a defensible starting point, not a measured finding. The T1/T2 ' +
  'crossing is the one that must be benchmarked on the real kernel before it is trusted.';

// A repo whose lines mostly sit outside symbol spans needs span chunking regardless of how
// small it is, so this overrides tier-by-size for the chunking recommendation only.
const SPAN_CHUNK_TRIGGER = 0.25;

function isTestPath(rel) {
  const p = String(rel).replace(/\\/g, '/');
  return /(^|\/)(tests?|__tests__|spec)\//i.test(p) || /\.(test|spec)\.[a-z]+$/i.test(p);
}

/**
 * Shannon entropy over identifier tokens, in bits.
 *
 * Proxy for how much lexical signal the corpus carries. A codebase of `a`, `b`, `tmp` has
 * low entropy and little for a lexical tier to grip; one with long distinct domain names
 * has high entropy and rewards exact matching. Reported so the vector-tier decision is not
 * made purely on size.
 */
function identifierEntropy(names) {
  const freq = new Map();
  let total = 0;
  for (const n of names) {
    for (const tok of String(n).split(/[^A-Za-z0-9]+|(?=[A-Z][a-z])/).filter(Boolean)) {
      const t = tok.toLowerCase();
      if (t.length < 2) continue;
      freq.set(t, (freq.get(t) || 0) + 1);
      total++;
    }
  }
  if (!total) return { bits: 0, vocabulary: 0, tokens: 0 };
  let h = 0;
  for (const c of freq.values()) { const p = c / total; h -= p * Math.log2(p); }
  return { bits: +h.toFixed(2), vocabulary: freq.size, tokens: total };
}

/** git remotes + submodules, to distinguish one repo from a federation. */
function repoCount(root) {
  let remotes = 0;
  let submodules = 0;
  try {
    const cfg = path.join(root, '.git', 'config');
    if (fs.existsSync(cfg)) {
      const t = fs.readFileSync(cfg, 'utf8');
      remotes = (t.match(/^\[remote /gm) || []).length;
    }
  } catch { /* not a git repo, or unreadable — reported as unknown below */ }
  try {
    const sm = path.join(root, '.gitmodules');
    if (fs.existsSync(sm)) {
      submodules = (fs.readFileSync(sm, 'utf8').match(/^\[submodule /gm) || []).length;
    }
  } catch { /* no submodules */ }
  return { remotes, submodules, repos: 1 + submodules };
}

/**
 * Lines that sit inside no symbol span.
 *
 * Computed from the graph's own line spans, so it reflects exactly what the index can see
 * rather than what a separate parse would find. Files with no symbols at all are counted
 * whole, because they are the worst case: entirely invisible to a symbol-card index.
 */
function spanCoverage(g) {
  const byFile = new Map();
  for (const n of Object.values(g.nodes || {})) {
    if (!n || !n.file || n.kind === 'file') continue;
    const start = Number(n.line);
    const end = Number(n.endLine ?? n.end_line ?? n.line);
    if (!Number.isFinite(start)) continue;
    if (!byFile.has(n.file)) byFile.set(n.file, []);
    byFile.get(n.file).push([start, Number.isFinite(end) && end >= start ? end : start]);
  }

  let totalLines = 0;
  let covered = 0;
  let filesWithNoSymbols = 0;
  const fileNodes = Object.values(g.nodes || {}).filter((n) => n && n.kind === 'file');

  for (const f of fileNodes) {
    const loc = Number(f.loc ?? f.lines ?? 0);
    if (!loc) continue;
    totalLines += loc;
    const spans = byFile.get(f.file || f.path);
    if (!spans || !spans.length) { filesWithNoSymbols++; continue; }
    // Merge overlapping spans so a method inside a class is not counted twice.
    spans.sort((a, b) => a[0] - b[0]);
    let cur = spans[0].slice();
    let sum = 0;
    for (let i = 1; i < spans.length; i++) {
      if (spans[i][0] <= cur[1] + 1) cur[1] = Math.max(cur[1], spans[i][1]);
      else { sum += cur[1] - cur[0] + 1; cur = spans[i].slice(); }
    }
    sum += cur[1] - cur[0] + 1;
    covered += Math.min(sum, loc);
  }

  const outside = Math.max(0, totalLines - covered);
  return {
    totalLines,
    covered,
    outside,
    outsideRatio: totalLines ? +(outside / totalLines).toFixed(4) : null,
    filesWithNoSymbols
  };
}

function selectTier(symbols, repos) {
  // Multi-repo forces T3 regardless of size: metadata routing is about provenance, not
  // volume, and a federation without routing returns the right answer from the wrong repo.
  if (repos > 1) {
    return { ...TIERS[3], reason: `${repos} repositories — metadata routing is required regardless of size` };
  }
  for (const t of TIERS) {
    if (symbols <= t.maxSymbols) {
      return { ...t, reason: `${symbols} symbols <= ${t.maxSymbols === Infinity ? 'unbounded' : t.maxSymbols}` };
    }
  }
  return { ...TIERS[3], reason: 'above every bounded tier' };
}

/** The whole audit. Pure function of the loaded graph plus a couple of on-disk facts. */
function audit(root, g) {
  const nodes = Object.values(g.nodes || {}).filter(Boolean);
  const symbolNodes = nodes.filter((n) => n.kind && n.kind !== 'file');
  const fileNodes = nodes.filter((n) => n.kind === 'file');
  const edges = g.edges || [];

  const langs = {};
  const fidelities = {};
  let testFiles = 0;
  for (const f of fileNodes) {
    // File nodes carry `path` and `language`; symbol nodes carry `file` and `lang`-free
    // shapes. Reading the wrong one is silent — it reported `unknown:113` for a corpus
    // whose language was recorded on every node.
    const rel = f.path || f.file || '';
    const lang = f.language || 'unknown';
    langs[lang] = (langs[lang] || 0) + 1;
    const fid = f.fidelity || 'unknown';
    fidelities[fid] = (fidelities[fid] || 0) + 1;
    if (isTestPath(rel)) testFiles++;
  }

  const spans = spanCoverage(g);
  const ent = identifierEntropy(symbolNodes.map((n) => n.name || ''));
  const repos = repoCount(root);
  const tier = selectTier(symbolNodes.length, repos.repos);

  // One recommendation per ITEM, with every reason attached. Emitting the same item twice
  // reads as two problems and makes the list look longer than the work.
  const recommendations = [];
  const spanReasons = [];
  if (spans.outsideRatio != null && spans.outsideRatio > SPAN_CHUNK_TRIGGER) {
    spanReasons.push(
      `${(100 * spans.outsideRatio).toFixed(1)}% of lines sit inside no symbol span — a ` +
      'symbol-card-only index cannot see them, and no reranker recovers an unindexed chunk');
  }
  if (spans.filesWithNoSymbols > 0) {
    spanReasons.push(`${spans.filesWithNoSymbols} file(s) contain no symbols at all and are wholly invisible`);
  }
  if (spanReasons.length) {
    recommendations.push({ item: 'RMAD-R2 span chunks', why: spanReasons, priority: 'highest' });
  }
  if (symbolNodes.length > TIERS[1].maxSymbols) {
    recommendations.push({
      item: 'ANN index',
      why: `${symbolNodes.length} symbols is past the brute-force comfort zone (${TIERS[1].maxSymbols})`,
      priority: 'medium'
    });
  }
  if (repos.repos > 1) {
    recommendations.push({ item: 'metadata routing', why: `${repos.repos} repositories in scope`, priority: 'high' });
  }

  return {
    corpus: {
      files: fileNodes.length,
      symbols: symbolNodes.length,
      edges: edges.length,
      loc: spans.totalLines,
      edgeDensity: symbolNodes.length ? +(edges.length / symbolNodes.length).toFixed(1) : null,
      languages: langs,
      testFileRatio: fileNodes.length ? +(testFiles / fileNodes.length).toFixed(3) : null,
      fidelity: fidelities
    },
    spans,
    identifiers: ent,
    repos,
    tier,
    recommendations,
    thresholdProvenance: THRESHOLD_PROVENANCE
  };
}

module.exports = { audit, selectTier, spanCoverage, identifierEntropy, repoCount, isTestPath, TIERS, SPAN_CHUNK_TRIGGER, THRESHOLD_PROVENANCE };
