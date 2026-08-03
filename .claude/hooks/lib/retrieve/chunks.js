// chunks.js — RMAD-R2. Index the lines no symbol covers.
//
// THE MEASUREMENT THAT JUSTIFIES THIS. `rmad index audit` reports that **62.8% of lines in
// this repository sit inside no symbol span**, and 5 files contain no symbols at all. A
// symbol-card index is structurally blind to every one of them: module-level constants,
// regex tables, config objects, the `const DEFAULT_ALLOW = [...]` that answers "what hosts
// are allowed", top-level wiring, and — in this codebase especially — the long WHY comments
// that carry most of the domain vocabulary.
//
// No reranker recovers a chunk that was never indexed. That is why the spec puts candidate
// generation at 24pp and reranking at 12pp, and why this lands before RMAD-R4.
//
// FOUR DECISIONS, and the reasoning matters more than the code:
//
// 1. AST-FIRST, NOT FIXED-WINDOW. Spans are the gaps *between* symbols, taken from the
//    graph's own line spans. So a chunk boundary is always a real structural boundary, and
//    the chunker cannot disagree with the index about where a function ends.
//
// 2. NO OVERLAP. Overlap exists for prose, where meaning straddles an arbitrary cut. These
//    cuts are not arbitrary. Overlap would duplicate storage and — the real objection —
//    inflate apparent recall by letting the same content be returned twice.
//
// 3. PARENT-CHILD (small-to-big). A span is matched at its own granularity and then
//    RETURNED as its enclosing file. Precision comes from the small unit, context from the
//    large one. Returning raw line ranges to an agent would be precise and unusable.
//
// 4. COMMENTS ARE KEPT. Tempting to strip them as noise. They are the opposite: the
//    vocab-gap query class is the worst-performing in the golden set (recall@1 = 0% over 14
//    queries), and those queries use domain words that appear in prose rather than in
//    identifiers. Stripping comments would remove exactly the text that closes the gap.

'use strict';

// Cap from the spec. Long enough to hold a real config block, short enough that a match
// points somewhere specific.
const MAX_CHUNK_LINES = 40;

// A span needs at least this many non-blank lines to earn an index entry. One-line gaps
// between functions are almost always a brace or a blank, and indexing them adds noise
// without adding an answer.
const MIN_CHUNK_LINES = 2;

/**
 * Merge a file's symbol spans into disjoint, sorted [start, end] ranges (1-based, inclusive).
 * Adjacent ranges are merged too: a gap of zero lines is not a gap.
 */
function mergeSpans(spans) {
  const clean = spans
    .filter((s) => Number.isFinite(s[0]))
    .map((s) => [s[0], Number.isFinite(s[1]) && s[1] >= s[0] ? s[1] : s[0]])
    .sort((a, b) => a[0] - b[0]);
  if (!clean.length) return [];
  const out = [clean[0].slice()];
  for (let i = 1; i < clean.length; i++) {
    const last = out[out.length - 1];
    if (clean[i][0] <= last[1] + 1) last[1] = Math.max(last[1], clean[i][1]);
    else out.push(clean[i].slice());
  }
  return out;
}

/** The complement of the covered ranges, within 1..totalLines. */
function gaps(covered, totalLines) {
  const out = [];
  let cursor = 1;
  for (const [s, e] of covered) {
    if (s > cursor) out.push([cursor, Math.min(s - 1, totalLines)]);
    cursor = Math.max(cursor, e + 1);
  }
  if (cursor <= totalLines) out.push([cursor, totalLines]);
  return out.filter(([s, e]) => e >= s);
}

/**
 * Split one gap into chunks at blank-line boundaries, capped at MAX_CHUNK_LINES.
 *
 * Blank lines are preferred cut points because in every language this indexer supports they
 * separate top-level statements. When a run of code has no blank line inside the cap, the
 * cut is forced at the cap — a hard cut is better than an unbounded chunk, and the line
 * numbers on the chunk make the truncation visible.
 */
function splitGap(lines, start, end) {
  const pieces = [];
  let from = start;
  let lastBlank = -1;

  for (let i = start; i <= end; i++) {
    const isBlank = !String(lines[i - 1] ?? '').trim();
    if (isBlank) lastBlank = i;
    const len = i - from + 1;
    if (len >= MAX_CHUNK_LINES) {
      // Cut at the last blank inside this window if there is one, otherwise force it here.
      const cut = lastBlank > from ? lastBlank : i;
      pieces.push([from, cut]);
      from = cut + 1;
      lastBlank = -1;
    }
  }
  if (from <= end) pieces.push([from, end]);
  return pieces;
}

const nonBlank = (lines, s, e) => {
  let n = 0;
  for (let i = s; i <= e; i++) if (String(lines[i - 1] ?? '').trim()) n++;
  return n;
};

/**
 * Chunk one file.
 *
 * @param {string} rel        repo-relative path
 * @param {string} source     file contents
 * @param {Array}  symbolSpans  [[startLine, endLine], ...] from the graph
 * @param {object} meta       { language, fidelity, isTest }
 * @returns {Array} chunks with metadata (decision 4 of the spec)
 */
function chunkFile(rel, source, symbolSpans, meta = {}) {
  const lines = String(source).split(/\r?\n/);
  const total = lines.length;
  if (!total) return [];

  const covered = mergeSpans(symbolSpans || []);
  const out = [];
  let seq = 0;

  for (const [gs, ge] of gaps(covered, total)) {
    for (const [s, e] of splitGap(lines, gs, ge)) {
      if (nonBlank(lines, s, e) < MIN_CHUNK_LINES) continue;
      const text = lines.slice(s - 1, e).join('\n').trim();
      if (!text) continue;
      out.push({
        // Deterministic id: same file at the same lines yields the same chunk id, so a
        // rebuild is idempotent and an incremental update can replace in place.
        id: `span:${rel}:${s}-${e}`,
        kind: 'span',
        file: rel,
        line: s,
        end_line: e,
        seq: seq++,
        text,
        // ── metadata, per spec decision 4 — this is what makes R5 filtering reachable ──
        language: meta.language || null,
        fidelity: meta.fidelity || null,
        isTest: Boolean(meta.isTest),
        // Parent-child: what a match on this chunk should RETURN. A raw line range is
        // precise and unusable, so retrieval hands back the enclosing file.
        parent: `file:${rel}`
      });
    }
  }
  return out;
}

/**
 * Chunk a whole graph's worth of files.
 * `readFile` is injected so this stays a pure function of its inputs and testable without
 * a filesystem.
 */
function chunkGraph(g, readFile, isTestPath = () => false) {
  const byFile = new Map();
  for (const n of Object.values(g.nodes || {})) {
    if (!n || !n.file || n.kind === 'file') continue;
    if (!byFile.has(n.file)) byFile.set(n.file, []);
    byFile.get(n.file).push([Number(n.line), Number(n.end_line ?? n.endLine ?? n.line)]);
  }

  const chunks = [];
  for (const f of Object.values(g.nodes || {})) {
    if (!f || f.kind !== 'file') continue;
    const rel = f.path || f.file;
    if (!rel) continue;
    let src;
    try { src = readFile(rel); } catch { continue; }
    if (src == null) continue;
    chunks.push(...chunkFile(rel, src, byFile.get(rel) || [], {
      language: f.language,
      fidelity: f.fidelity,
      isTest: isTestPath(rel)
    }));
  }
  return chunks;
}

/** Coverage achieved by a chunk set — the number that proves R2 did something. */
function chunkCoverage(chunks, totalLines) {
  const lines = chunks.reduce((a, c) => a + (c.end_line - c.line + 1), 0);
  return {
    chunks: chunks.length,
    lines,
    ratio: totalLines ? +(lines / totalLines).toFixed(4) : null
  };
}

module.exports = {
  chunkFile, chunkGraph, chunkCoverage,
  mergeSpans, gaps, splitGap,
  MAX_CHUNK_LINES, MIN_CHUNK_LINES
};
