// grep-baseline.js — BENCH-R1, Arm B. What retrieval looks like with no index at all.
//
// WHY THIS EXISTS. This is not a feature. It is the control arm of a decision experiment
// with a PRE-REGISTERED rule, and it is the only thing in this repository that can falsify
// the index thesis. Sourcegraph ships an agent with deliberately no index; Cursor
// foregrounds exact match. If an agent with `grep` and `read` matches RMAD's funnel, the
// funnel is expensive scaffolding and the honest move is to say so.
//
// WHAT THIS IS, PRECISELY — and the caveat is load-bearing, so it ships in the code rather
// than only in the write-up:
//
//   A real Arm B is "a model with grep + read, multi-step". A model cannot run inside a
//   deterministic test, so this is a MECHANICAL PROXY: extract terms, scan files, rank by
//   match density, map the best hit to its enclosing symbol — which is exactly the sequence
//   an agent performs when it greps, reads the hit, and names what it found.
//
//   The proxy is WEAKER than a model at term selection: it cannot rephrase
//   "where the risk concentrates" into `complexity`, and a model can. It is STRONGER at
//   budget discipline: it never wastes a turn or forgets a result.
//
//   So a proxy win is strong evidence FOR grep, and a proxy loss is only weak evidence
//   against it. That asymmetry is stated up front so the result cannot be over-read in the
//   direction the author would prefer.
//
// Zero dependencies: the scan is Node reading files, not a shell-out to ripgrep, so the arm
// runs identically on every platform the framework supports.

'use strict';

const fs = require('fs');
const path = require('path');

// Words that carry no retrieval signal. Deliberately short: over-pruning would hobble the
// baseline, and a hobbled control is a rigged experiment.
const STOP = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'not', 'but', 'its', 'from', 'into', 'when',
  'what', 'which', 'they', 'them', 'has', 'had', 'was', 'are', 'you', 'your', 'all', 'any',
  'one', 'two', 'per', 'via', 'own', 'out', 'now', 'how', 'does', 'where', 'why', 'who',
  'can', 'will', 'would', 'should', 'must', 'get', 'set', 'use', 'used', 'using', 'make',
  'made', 'have', 'been', 'being', 'here', 'there', 'then', 'than', 'some', 'each', 'both',
  'about', 'after', 'before', 'other', 'only', 'also', 'more', 'most', 'such', 'very'
]);

/**
 * Terms an agent would actually grep for.
 *
 * Includes the camelCase split of every token, because that is what a person does when a
 * bare grep misses: they try `blast`, then `radius`, then `blastRadius`.
 */
function terms(query) {
  const raw = String(query).split(/[^A-Za-z0-9_$]+/).filter(Boolean);
  const out = new Set();
  for (const w of raw) {
    const lw = w.toLowerCase();
    if (lw.length > 2 && !STOP.has(lw)) out.add(lw);
    for (const part of w.split(/(?=[A-Z][a-z])|_/)) {
      const lp = part.toLowerCase();
      if (lp.length > 2 && !STOP.has(lp)) out.add(lp);
    }
  }
  return [...out];
}

/** Line-level matches for a term set in one file's text. */
function scanFile(text, termList) {
  const lines = String(text).split(/\r?\n/);
  const perLine = new Map();
  const matchedTerms = new Set();
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    let hits = 0;
    for (const t of termList) {
      if (lower.includes(t)) { hits++; matchedTerms.add(t); }
    }
    if (hits) perLine.set(i + 1, hits);
  }
  return { perLine, distinct: matchedTerms.size };
}

/**
 * Rank candidates for one query, with no index.
 *
 * Scoring mirrors how a person reads grep output: a file matching MORE DISTINCT terms is
 * more interesting than one matching the same term many times, so distinct-term coverage
 * dominates and raw frequency only breaks ties. Weighting frequency first would make the
 * baseline worse for a reason that has nothing to do with having an index.
 *
 * @param {object} g        loaded graph — used ONLY to map a hit line to its enclosing
 *                          symbol and to enumerate files. Arm B does no graph traversal,
 *                          no expansion and no ranking from it.
 * @returns {Array} [{ id, name, kind, file, line, score }]
 */
function search(root, g, query, opts = {}) {
  const termList = terms(query);
  if (!termList.length) return [];
  const limit = opts.limit || 50;

  // Symbol spans per file, so a matched line can be named. An agent gets file:line from
  // grep, opens it, and reports the function it landed in — this is that step.
  const spansByFile = new Map();
  for (const n of Object.values(g.nodes || {})) {
    if (!n || n.kind === 'file' || !n.file || !Number.isFinite(Number(n.line))) continue;
    const f = String(n.file).replace(/\\/g, '/');
    if (!spansByFile.has(f)) spansByFile.set(f, []);
    spansByFile.get(f).push({
      id: n.id, name: n.name, kind: n.kind,
      start: Number(n.line),
      end: Number(n.end_line ?? n.endLine ?? n.line)
    });
  }

  const scored = [];
  for (const f of Object.values(g.nodes || {})) {
    if (!f || f.kind !== 'file') continue;
    const rel = String(f.path || f.file || '').replace(/\\/g, '/');
    if (!rel || rel.startsWith('templates/')) continue;   // byte-identical mirror
    let text;
    try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }

    const { perLine, distinct } = scanFile(text, termList);
    if (!perLine.size) continue;

    const total = [...perLine.values()].reduce((a, b) => a + b, 0);
    const spans = spansByFile.get(rel) || [];

    // Best matching line, then the symbol containing it.
    let bestLine = 0, bestHits = -1;
    for (const [ln, hits] of perLine) if (hits > bestHits) { bestHits = hits; bestLine = ln; }
    const owner = spans.find((s) => bestLine >= s.start && bestLine <= s.end);

    scored.push({
      id: owner ? owner.id : `file:${rel}`,
      name: owner ? owner.name : path.basename(rel),
      kind: owner ? owner.kind : 'file',
      file: rel,
      line: bestLine,
      // distinct-term coverage dominates; frequency is the tiebreak only
      score: distinct * 1000 + Math.min(total, 999),
      matchedTerms: distinct,
      totalMatches: total
    });
  }

  scored.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

  // One result per symbol id: an agent reading grep output does not report the same
  // function twice from two different lines.
  const seen = new Set();
  const out = [];
  for (const r of scored) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { search, terms, scanFile, STOP };
