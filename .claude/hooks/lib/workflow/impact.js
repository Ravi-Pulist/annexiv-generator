// impact.js — which tests must run for this change, computed BEFORE the change.
//
// THIS IS THE HIGHEST-MEASURED-VALUE PIECE IN THE WHOLE DESIGN, and the reason is
// counter-intuitive enough to write down. On SWE-bench Verified, handing an agent an
// AST-derived code-to-test map before it edits cut regressions from 6.08% to 1.82% and
// lifted issue resolution from 24% to 32%. Handing it TDD *instructions* without that map
// pushed regressions to 9.94% — worse than saying nothing at all.
//
// So the lesson is not "tell the agent to test more". It is that CONTEXT BEATS PROCEDURE:
// an agent that knows which four tests guard the code it is about to touch behaves better
// than one told to follow a discipline in the abstract. That is what this module produces.
//
// HOW THE TEST LINK IS DERIVED, and its honest limits: a `covers` relation here is a real,
// evidenced call path from a test symbol into the changed code, read off the same graph
// everything else uses. It needs no coverage run and no instrumentation, which is why it
// works on a repo the framework has never seen. What it cannot see is coverage that
// happens without a call the resolver could evidence — fixtures, parametrised harnesses,
// DI, reflection. Fan-in under-reports, so this list is a FLOOR: run it first for fast
// feedback, and never let it replace the full suite before declaring anything done.

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const G = require('../code-graph.js');

// Defined in code-graph.js and re-exported here. ONE classification rule, one copy:
// code-graph needs it for the layer metric, and two regexes that drift would let a file
// count as a test in one obligation and as production in another.
const { TEST_PATH, isTestFile } = G;

// ─── git ────────────────────────────────────────────────────────────────────

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function defaultBranch(root) {
  const head = git(root, ['rev-parse', '--abbrev-ref', 'origin/HEAD']);
  if (head) return head.trim().replace(/^origin\//, '');
  for (const b of ['main', 'master']) {
    if (git(root, ['rev-parse', '--verify', b])) return b;
  }
  return null;
}

/**
 * Changed line ranges per file, from a unified diff with zero context.
 *
 * Line ranges rather than file names on purpose: treating every symbol in a touched file
 * as changed makes the blast radius of a one-line fix the whole module, which is the
 * failure mode that makes impact analysis useless — it selects everything, so nobody
 * trusts it and everybody runs the full suite anyway.
 */
function changedRanges(root, { base, staged, ref } = {}) {
  const args = ['diff', '--unified=0', '--no-color'];
  if (staged) args.push('--cached');
  else if (ref) args.push(`${ref}^`, ref);
  else if (base) args.push(`${base}...HEAD`);
  const out = git(root, args);
  if (!out) return null;

  const files = new Map();
  let current = null;
  for (const line of out.split('\n')) {
    const f = line.match(/^\+\+\+ b\/(.+)$/);
    if (f) { current = f[1]; files.set(current, []); continue; }
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h && current) {
      const start = parseInt(h[1], 10);
      const count = h[2] === undefined ? 1 : parseInt(h[2], 10);
      if (count > 0) files.get(current).push([start, start + count - 1]);
    }
  }
  return files;
}

// ─── changed symbols ────────────────────────────────────────────────────────

/** Symbols whose line span intersects a changed range. */
function symbolsInRanges(g, fileRanges) {
  const out = [];
  for (const [file, ranges] of fileRanges) {
    const rel = file.split(path.sep).join('/');
    const syms = G.nodesInFile(g, rel);
    if (!syms.length) {
      // The file is not indexed (new file, or a language with no extractor). Record it —
      // a change we cannot analyse must be visible, not silently contribute nothing.
      out.push({ id: `file:${rel}`, file: rel, unindexed: true });
      continue;
    }
    for (const s of syms) {
      if (s.kind === 'file') continue;
      const a = s.line, b = s.end_line || s.line;
      if (ranges.some(([x, y]) => x <= b && y >= a)) out.push(s);
    }
  }
  return out;
}

/** Resolve free-form refs (symbol names, file paths) to graph nodes. */
function resolveRefs(g, refs) {
  const out = [];
  for (const ref of refs) {
    const direct = G.getNode(g, ref);
    if (direct) { out.push(direct); continue; }
    const asFile = G.getNode(g, `file:${ref}`);
    if (asFile) { out.push(...G.nodesInFile(g, ref).filter((n) => n.kind !== 'file')); continue; }
    const hits = G.findSymbols(g, ref);
    const exact = hits.filter((h) => h.qualname === ref || h.name === ref);
    out.push(...(exact.length ? exact : hits));
  }
  return out;
}

// ─── the projection ─────────────────────────────────────────────────────────

/**
 * @returns {{changed, tests, unindexed, ambiguousExcluded, depth, coverage}}
 */
function impact(g, changed, opts = {}) {
  const depth = opts.depth || 3;
  const changedSyms = changed.filter((c) => !c.unindexed);
  const unindexed = changed.filter((c) => c.unindexed).map((c) => c.file);

  // Reverse reachability from the changed set. Test symbols that show up in the blast
  // radius are exactly the tests with an evidenced path into what moved.
  const reachedBy = new Map(); // testId -> [{ changed, depth }]
  let ambiguous = 0;

  for (const s of changedSyms) {
    for (const e of [...G.edgesTo(g, s.id), ...G.edgesFrom(g, s.id)]) {
      if (e.resolved === false) ambiguous++;
    }
    for (const hit of G.blastRadius(g, s.id, depth)) {
      const node = G.getNode(g, hit.id);
      if (!node) continue;
      const file = node.file || node.path;
      if (!isTestFile(file)) continue;
      if (!reachedBy.has(hit.id)) reachedBy.set(hit.id, []);
      reachedBy.get(hit.id).push({ changed: s.qualname || s.name, depth: hit.depth });
    }
  }

  // Weight: closer is heavier, and reaching several changed symbols is heavier still.
  // A hotspot multiplier because a complex symbol is where a change actually goes wrong —
  // fan-in only scales the consequence.
  const tests = [...reachedBy.entries()].map(([id, reaches]) => {
    const node = G.getNode(g, id);
    const weight = reaches.reduce((acc, r) => acc + 1 / (1 + r.depth), 0) *
      (node && node.complexity && node.complexity > 8 ? 2 : 1);
    return {
      id,
      // File nodes carry `path` and no name at all, and a whole test FILE showing up in
      // the blast radius is a legitimate result — the fallback chain has to end at
      // something printable rather than undefined.
      name: node ? (node.qualname || node.name || node.path || id) : id,
      file: node ? (node.file || node.path) : null,
      line: node ? node.line : null,
      weight: Math.round(weight * 1000) / 1000,
      nearest: Math.min(...reaches.map((r) => r.depth)),
      covers: [...new Set(reaches.map((r) => r.changed))]
    };
  }).sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));

  // Test FILES are what a runner actually takes as an argument.
  const files = [...new Set(tests.map((t) => t.file).filter(Boolean))];

  return {
    changed: changedSyms.map((s) => ({ id: s.id, name: s.qualname || s.name, file: s.file, line: s.line })),
    tests,
    files,
    unindexed,
    // Fan-in under-reports. The count of edges the graph declined to assert around the
    // changed set is the size of what this selection could be missing, and it travels
    // with the answer so nobody reads a short list as a complete one.
    ambiguousExcluded: ambiguous,
    depth,
    coverage: 'graph'
  };
}

/** Convenience: diff the working tree (or a base/ref) and project in one call. */
function fromDiff(g, root, opts = {}) {
  const ranges = changedRanges(root, opts);
  if (!ranges) return { error: 'not a git repository, or git is unavailable' };
  if (!ranges.size) return { error: 'no changes in that range' };
  return impact(g, symbolsInRanges(g, ranges), opts);
}

module.exports = { impact, fromDiff, changedRanges, symbolsInRanges, resolveRefs, isTestFile, defaultBranch };
