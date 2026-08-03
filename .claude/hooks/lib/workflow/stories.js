// stories.js — the story DAG, parsed rather than described. RMAD-03.
//
// THE DEFECT THIS CLOSES: `/stage-build` emits story frontmatter carrying `depends_on`,
// `parallel` and `conflicts_with`. `/sprint-deps` told the model to parse a
// "## Dependencies" markdown section instead — a section no template defines and no
// command writes. Two schemas for the same fact, one of them fictional, and the wave
// planner therefore ran on nothing. It was the root cause of BOTH traceability (D8) and
// parallel execution (D9) scoring badly, and it survived because the contract lived in
// prose on both sides: nothing could fail when they disagreed.
//
// So the contract moves into code. A prompt cannot be unit-tested; this can.

'use strict';

const fs = require('fs');
const path = require('path');

/** Minimal YAML frontmatter reader — scalars, inline lists, and quoted strings. */
function frontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    let [, k, v] = kv;
    v = v.replace(/\s+#.*$/, '').trim();          // strip trailing comment
    if (/^\[.*\]$/.test(v)) {
      out[k] = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else if (v === 'true' || v === 'false') {
      out[k] = v === 'true';
    } else {
      out[k] = v.replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

/**
 * Read every story in a sprint directory.
 *
 * Accepts BOTH shapes for one release: `depends_on` frontmatter (what /stage-build
 * actually emits, and the canonical form) and a "## Dependencies" section (what
 * /sprint-deps used to look for). Files using the old shape are reported so a migration
 * is visible instead of silent.
 */
function readStories(dir) {
  const stories = [];
  const legacy = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && !/^(README|INDEX)/i.test(f));
  } catch { return { stories, legacy, dir }; }

  for (const f of files) {
    let raw;
    try { raw = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    const fm = frontmatter(raw) || {};
    const id = fm.story || fm.id || path.basename(f, '.md');

    let dependsOn = Array.isArray(fm.depends_on) ? fm.depends_on.slice() : [];

    // Legacy shape: "## Dependencies" followed by "- {story-id}: {reason}".
    const sec = raw.match(/^##\s+Dependencies\s*$([\s\S]*?)(?=^##\s|\Z)/m);
    if (sec) {
      const fromSection = [];
      for (const line of sec[1].split(/\r?\n/)) {
        const item = line.match(/^\s*-\s*([A-Za-z0-9._-]+)\s*(?::|$)/);
        if (item) fromSection.push(item[1]);
      }
      if (fromSection.length) {
        legacy.push({ file: f, found: fromSection });
        for (const d of fromSection) if (!dependsOn.includes(d)) dependsOn.push(d);
      }
    }

    stories.push({
      id: String(id),
      file: f,
      epic: fm.epic || null,
      owner: fm.owner || null,
      status: String(fm.status || 'TODO').toUpperCase(),
      complexity: fm.complexity != null ? Number(fm.complexity) : null,
      implements: Array.isArray(fm.implements) ? fm.implements : [],
      dependsOn,
      conflictsWith: Array.isArray(fm.conflicts_with) ? fm.conflicts_with : [],
      parallel: fm.parallel !== false
    });
  }
  return { stories, legacy, dir };
}

/** Cycles in the dependency graph, by iterative DFS — a recursive one blows the stack. */
function cycles(stories) {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map(stories.map((s) => [s.id, WHITE]));
  const found = [];

  for (const start of stories) {
    if (colour.get(start.id) !== WHITE) continue;
    const stack = [{ id: start.id, path: [start.id], i: 0 }];
    colour.set(start.id, GREY);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const node = byId.get(frame.id);
      const deps = node ? node.dependsOn : [];
      if (frame.i >= deps.length) {
        colour.set(frame.id, BLACK);
        stack.pop();
        continue;
      }
      const next = deps[frame.i++];
      if (!byId.has(next)) continue;                       // unknown dep, reported elsewhere
      if (colour.get(next) === GREY) {
        const at = frame.path.indexOf(next);
        found.push(frame.path.slice(at === -1 ? 0 : at).concat(next));
        continue;
      }
      if (colour.get(next) === BLACK) continue;
      colour.set(next, GREY);
      stack.push({ id: next, path: frame.path.concat(next), i: 0 });
    }
  }
  return found;
}

/**
 * Group stories into waves. A story joins a wave when every dependency is already in an
 * EARLIER wave, and it never shares a wave with a story it conflicts with.
 *
 * `conflicts_with` was declared by /stage-build and read by nothing, so two stories
 * touching the same files could be scheduled into the same wave — which is the failure
 * mode parallel execution exists to avoid.
 */
function waves(stories) {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const placed = new Map();
  const out = [];
  let remaining = stories.filter((s) => s.status !== 'DONE');

  const conflict = (a, b) =>
    (a.conflictsWith || []).includes(b.id) || (b.conflictsWith || []).includes(a.id);

  while (remaining.length) {
    const ready = remaining.filter((s) =>
      (s.dependsOn || []).every((d) => !byId.has(d) || placed.has(d) ||
        (byId.get(d) && byId.get(d).status === 'DONE')));
    if (!ready.length) break;                              // cycle or unmet dep: caller reports

    const wave = [];
    for (const s of ready) {
      if (!s.parallel && wave.length) continue;            // serial story runs alone
      if (wave.some((w) => conflict(w, s))) continue;
      if (wave.length && wave.some((w) => !w.parallel)) continue;
      wave.push(s);
    }
    if (!wave.length) wave.push(ready[0]);
    for (const s of wave) placed.set(s.id, out.length);
    out.push(wave.map((s) => s.id));
    remaining = remaining.filter((s) => !placed.has(s.id));
  }
  return { waves: out, unplaced: remaining.map((s) => s.id) };
}

/** Longest dependency chain — the floor on how fast the sprint can finish. */
function criticalPath(stories) {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const memo = new Map();
  const visiting = new Set();
  function depth(id) {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) return 0;                        // cycle: reported separately
    visiting.add(id);
    const s = byId.get(id);
    const deps = (s && s.dependsOn) || [];
    let best = [];
    for (const d of deps) {
      if (!byId.has(d)) continue;
      const sub = depth(d);
      if (sub.length > best.length) best = sub;
    }
    visiting.delete(id);
    const chain = best.concat(id);
    memo.set(id, chain);
    return chain;
  }
  let longest = [];
  for (const s of stories) {
    const c = depth(s.id);
    if (c.length > longest.length) longest = c;
  }
  return longest;
}

/** Everything /sprint-deps needs, computed rather than inferred by a model. */
function analyse(dir) {
  const { stories, legacy } = readStories(dir);
  const byId = new Set(stories.map((s) => s.id));
  const unknownDeps = [];
  for (const s of stories) {
    for (const d of s.dependsOn) if (!byId.has(d)) unknownDeps.push({ story: s.id, missing: d });
  }
  const cyc = cycles(stories);
  const w = waves(stories);
  const blocked = stories.filter((s) =>
    s.status !== 'DONE' &&
    s.dependsOn.some((d) => byId.has(d) && stories.find((x) => x.id === d).status !== 'DONE'));

  return {
    dir,
    count: stories.length,
    stories,
    legacySchema: legacy,
    unknownDeps,
    cycles: cyc,
    waves: w.waves,
    unplaced: w.unplaced,
    blocked: blocked.map((s) => s.id),
    criticalPath: criticalPath(stories)
  };
}

module.exports = { frontmatter, readStories, cycles, waves, criticalPath, analyse };
