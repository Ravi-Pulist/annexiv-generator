// residual.js — "is it done?" as a query, and "how far off?" as a number.
//
// A loop counter cannot tell "the job is finished" from "we ran out of attempts": both
// produce the same terminal state and a human has to read the log to find out which. So
// the target is a PREDICATE over six obligations, progress is a RESIDUAL, and the budget
// is a safety net rather than the criterion.
//
// FOUR STATES, NOT TWO. Every obligation reports satisfied / unsatisfied / not-applicable
// / inconclusive, and the fourth one is the whole point. A check that cannot run — no
// baseline recorded, no criteria mapped, coverage the graph cannot evidence — must say so
// and keep saying so all the way into the report. Rounding "I could not check" up to
// "fine" converts an unknown risk into a false assurance, which is worse than not having
// run the check at all.
//
// WHAT DONE DOES NOT MEAN, stated here because the name oversells it: it means every
// promise that was written down and could be checked, was checked. It does not mean the
// right promises were written down, and O2 inherits the graph's deliberate
// under-reporting — a dependent reached only by reflection or DI will not appear.

'use strict';

const G = require('../code-graph.js');
const record = require('../evidence/record.js');
const impactMod = require('./impact.js');

// A regression outranks everything because it is the one class of failure that leaves the
// codebase worse than not having run at all. Reasoned, not tuned — calibrate on real tasks
// before treating the ordering as more than a starting point.
// O6 sits between O3 (a regression, the worst outcome) and O1 (a promise with no test).
// Conformance without function is the failure mode it exists to catch: a change that
// satisfies every declared criterion and does not work.
const DEFAULT_WEIGHTS = { O1: 3, O2: 1, O3: 10, O4: 2, O5: 2, O6: 5 };

// Which obligations a KIND of work can be held to. This is the only legitimate source of
// NOT-APPLICABLE: a document task has no blast radius and no regression surface, so
// holding it to O2/O3/O4 would block every documentation task forever once the completion
// gate is wired. Found by running the predicate against this framework's own spec task.
const KIND_OBLIGATIONS = {
  code:     new Set(['O1', 'O2', 'O3', 'O4', 'O5', 'O6']),
  document: new Set(['O1', 'O5']),
  analysis: new Set(['O1', 'O5'])
};

const SATISFIED = 'satisfied';
const UNSATISFIED = 'unsatisfied';
const NA = 'not-applicable';
const INCONCLUSIVE = 'inconclusive';

function ob(id, name, state, count, detail, extra = {}) {
  return { id, name, state, count: count || 0, detail, ...extra };
}

// ─── O1 — every testable promise has a passing test at HEAD ─────────────────

function checkO1(root, g, task, commit, waived) {
  if (!task || !task.criteria || !task.criteria.length) {
    return ob('O1', 'Criteria realised', NA, 0,
      'no acceptance criteria are mapped for this task — nothing to verify against',
      { absentInput: true });
  }
  const testable = task.criteria.filter((c) => c.testable);
  const untestable = task.criteria.length - testable.length;
  if (!testable.length) {
    return ob('O1', 'Criteria realised', NA, 0,
      `all ${task.criteria.length} criteria are marked untestable — human sign-off required`,
      { absentInput: true });
  }

  const passing = passingSubjects(root, commit);
  const unmet = [];
  let unknown = 0;

  for (const c of testable) {
    if (!c.symbols || !c.symbols.length) {
      // An unmapped criterion cannot be machine-verified. It is NOT satisfied and it is
      // NOT a failure of the code — it is a gap in the plan, and it has to be visible.
      unknown++;
      continue;
    }
    const tests = testsReaching(g, c.symbols);
    const covered = tests.some((t) => testPasses(t, passing));
    if (!covered) unmet.push({ criterion: c.id, statement: c.statement, symbols: c.symbols });
  }

  if (unknown) {
    return ob('O1', 'Criteria realised', INCONCLUSIVE, unmet.length + unknown,
      `${unknown} criterion(s) have no symbol mapping and cannot be verified by machine; ${unmet.length} mapped criterion(s) have no passing test`,
      { unmet, unmapped: unknown, untestable });
  }
  return unmet.length
    ? ob('O1', 'Criteria realised', UNSATISFIED, unmet.length,
      `${unmet.length} criterion(s) have no passing test at this commit`, { unmet, untestable })
    : ob('O1', 'Criteria realised', SATISFIED, 0, `${testable.length} criterion(s) backed by passing tests`, { untestable });
}

// ─── O2 — the blast radius is covered or explicitly waived ──────────────────

function checkO2(root, g, changed, commit, waived) {
  if (!changed || !changed.length) {
    return ob('O2', 'Blast radius covered', NA, 0, 'no changed symbols detected',
      { absentInput: true });
  }
  const passing = passingSubjects(root, commit);
  if (!passing.size) {
    return ob('O2', 'Blast radius covered', INCONCLUSIVE, 0,
      'no passing test observations recorded at this commit — run the suite and record it before trusting this');
  }

  // RMAD-17/21 — three tiers of evidence, reported separately and never merged.
  //
  // This obligation used to answer "is there a call path from a test?" by traversing
  // blastRadius, which injects the containing `file:` node at EVERY hop. So a test that
  // merely imported a module reached every symbol in it. Measured over 313 production
  // functions here: 21.1% reached by a real call path, 47.6% by file adjacency alone —
  // **69.3% of the coverage this obligation claimed was not a call path.**
  //
  //   executed   — the runtime says it ran (RMAD-21). Satisfies.
  //   call-path  — a passing test reaches it through resolved call edges. Satisfies when
  //                no coverage oracle is available for the language.
  //   adjacency  — a passing test imports its file. NEVER satisfies on its own. Not
  //                worthless (module-level side effects do run) but not evidence that
  //                this symbol was tested.
  const executed = executedSymbols(root, commit);
  const haveCoverage = executed.size > 0;

  const impacted = impactMod.impact(g, changed, { depth: 2 });
  const tiers = { executed: [], callPath: [], adjacency: [], uncovered: [] };

  for (const c of impacted.changed) {
    if (waived.has(c.id)) continue;
    if (executed.has(c.id)) { tiers.executed.push(c); continue; }
    if (reachedByCallPath(g, c.id, passing)) { tiers.callPath.push(c); continue; }
    if (testsReaching(g, [c.id]).some((t) => testPasses(t, passing))) { tiers.adjacency.push(c); continue; }
    tiers.uncovered.push(c);
  }

  const satisfied = tiers.executed.length + tiers.callPath.length;
  const total = impacted.changed.length;
  const detail = `${satisfied}/${total} covered by evidence ` +
    `(${tiers.executed.length} executed, ${tiers.callPath.length} call-path); ` +
    `${tiers.adjacency.length} adjacency-only, ${tiers.uncovered.length} uncovered`;
  const extra = { tiers, uncovered: tiers.uncovered.concat(tiers.adjacency),
    haveCoverage, ambiguousExcluded: impacted.ambiguousExcluded };

  if (tiers.uncovered.length) {
    return ob('O2', 'Blast radius covered', UNSATISFIED,
      tiers.uncovered.length + tiers.adjacency.length, detail, extra);
  }
  if (tiers.adjacency.length) {
    // With a coverage oracle we KNOW these did not execute, so it is a failure. Without
    // one we only know a test imported the file, which is not the same claim — and
    // rounding "I cannot tell" up to "covered" is exactly what this obligation is for.
    return haveCoverage
      ? ob('O2', 'Blast radius covered', UNSATISFIED, tiers.adjacency.length,
        `${detail} — coverage ran and these symbols did not execute`, extra)
      : ob('O2', 'Blast radius covered', INCONCLUSIVE, tiers.adjacency.length,
        `${detail} — adjacency alone is not evidence; record \`rmad task observe --kind coverage\``, extra);
  }
  return ob('O2', 'Blast radius covered', SATISFIED, 0, detail, extra);
}

/** Symbols the runtime reported executing at this commit (RMAD-21). */
function executedSymbols(root, commit) {
  const out = new Set();
  for (const row of record.observationsAt(root, commit, 'coverage')) {
    if (String(row.value) === 'executed' && row.subject) out.add(row.subject);
  }
  return out;
}

function testPasses(t, passing) {
  // Exact identity only. This used to be `String(p).includes(t.file)`, so any passing
  // subject whose string merely CONTAINED the test file's path counted as covering it.
  return passing.has(t.id) || passing.has(t.name) || (t.file && passing.has(t.file));
}

/**
 * Is this symbol reached from a passing test through RESOLVED CALL EDGES only?
 * No `file:` synthesis, no import edges — the question is whether a test calls it, however
 * indirectly, not whether a test lives near it.
 */
function reachedByCallPath(g, id, passing, maxDepth = 5) {
  const inbound = callPathIndex(g);
  let frontier = [id];
  const seen = new Set([id]);
  for (let d = 1; d <= maxDepth && frontier.length; d++) {
    const next = [];
    for (const cur of frontier) {
      for (const from of (inbound.get(cur) || [])) {
        if (seen.has(from)) continue;
        seen.add(from);
        const n = G.getNode(g, from);
        if (n && impactMod.isTestFile(n.file) &&
            testPasses({ id: from, name: n.qualname || n.name, file: n.file }, passing)) {
          return true;
        }
        next.push(from);
      }
    }
    frontier = next;
  }
  return false;
}

// Built once per graph object. Rebuilding it per symbol turned O2 into an O(n*e) scan.
const CALL_INDEX = new WeakMap();
function callPathIndex(g) {
  if (CALL_INDEX.has(g)) return CALL_INDEX.get(g);
  const inbound = new Map();
  for (const e of (g.edges || [])) {
    if (e.type !== 'calls' || e.resolved === false) continue;
    if (String(e.from).startsWith('file:') || String(e.to).startsWith('file:')) continue;
    if (!inbound.has(e.to)) inbound.set(e.to, []);
    inbound.get(e.to).push(e.from);
  }
  CALL_INDEX.set(g, inbound);
  return inbound;
}

// ─── O3 — nothing green went red ────────────────────────────────────────────

function checkO3(root, task, commit) {
  const oracles = ['test', 'lint', 'typecheck', 'build'];
  const regressed = [];
  let checked = 0;
  let missing = [];

  for (const oracle of oracles) {
    const base = record.latestBaseline(root, task ? task.id : null, oracle);
    if (!base) { missing.push(oracle); continue; }
    const now = observationSets(root, commit, oracle);
    if (!now.total) { missing.push(`${oracle} (no current run)`); continue; }
    checked++;
    // The SET comparison, not the count. Break test A, add test B, and the count is
    // unchanged — only the set shows it.
    for (const subject of base.pass_set) {
      if (!now.passing.has(subject)) regressed.push({ oracle, subject });
    }
  }

  if (!checked) {
    return ob('O3', 'No regression', INCONCLUSIVE, 0,
      `no baseline to compare against (${missing.join(', ') || 'none recorded'}) — a baseline must be executed, never assumed`,
      { missing });
  }
  return regressed.length
    ? ob('O3', 'No regression', UNSATISFIED, regressed.length,
      `${regressed.length} subject(s) passed at baseline and do not now`, { regressed, missing })
    : ob('O3', 'No regression', SATISFIED, 0, `${checked} oracle(s) hold against baseline`, { missing });
}

// ─── O4 — no new structural debt ────────────────────────────────────────────

function checkO4(root, g) {
  const prior = record.snapshots(root, 2);
  const current = {
    cycles: G.cycles(g).length,
    // PRODUCTION flows only. A test importing the code it tests is not structural debt,
    // and counting it meant every project carried a violation that could never be cleared
    // -- including a spurious `layers 0 -> 1` the moment imports first resolved.
    layers: G.productionLayers(g).length,
    orphans: G.orphans(g).length
  };
  if (!prior.length) {
    return ob('O4', 'No structural debt added', INCONCLUSIVE, 0,
      'no prior snapshot to compare against — run `rmad index snapshot` to establish one', { current });
  }
  const before = prior[0].stats;
  const worse = [];
  for (const k of ['cycles', 'layers', 'orphans']) {
    if (current[k] > (before[k] ?? 0)) worse.push({ signal: k, before: before[k] ?? 0, after: current[k] });
  }
  return worse.length
    ? ob('O4', 'No structural debt added', UNSATISFIED, worse.length,
      worse.map((w) => `${w.signal} ${w.before} -> ${w.after}`).join(', '), { worse, current, before })
    : ob('O4', 'No structural debt added', SATISFIED, 0, 'cycles, layering and orphans did not worsen', { current, before });
}

// ─── O5 — edits stayed inside the declared scope ────────────────────────────

function checkO5(g, task, changed) {
  if (!task || !task.scope) {
    return ob('O5', 'Scope respected', NA, 0, 'no scope declared for this task',
      { absentInput: true });
  }
  if (!changed || !changed.length) {
    return ob('O5', 'Scope respected', NA, 0, 'no changed symbols detected',
      { absentInput: true });
  }
  const files = new Set(task.scope.files || []);
  const symbols = new Set(task.scope.symbols || []);
  const outside = changed.filter((c) => {
    if (symbols.has(c.id)) return false;
    const f = c.file || (c.id || '').replace(/^file:/, '');
    if (!f) return true;
    // A bare startsWith has no path boundary, so scope `src` also matched `srcXX/evil.js`
    // and O5 reported an out-of-scope edit as in-scope. A prefix only counts when the next
    // character is a separator — that is what makes it a DIRECTORY prefix rather than a
    // string one.
    return !(files.has(f) || [...files].some((s) => {
      const base = s.replace(/\*+$/, '').replace(/\/+$/, '');
      return base && (f === base || f.startsWith(`${base}/`));
    }));
  });
  return outside.length
    ? ob('O5', 'Scope respected', UNSATISFIED, outside.length,
      `${outside.length} edit(s) outside the declared scope`, { outside })
    : ob('O5', 'Scope respected', SATISFIED, 0, 'all edits inside the declared scope');
}

// ─── O6 — the software was observed running (RMAD-12, narrow) ───────────────
//
// THE GAP THIS CLOSES, STATED HONESTLY: O1 through O5 establish that declared criteria
// were met, the blast radius was covered, nothing regressed IN THE GRAPH, no structural
// debt appeared, and scope held. None of them establish that the software WORKS. A
// perfectly spec-conformant change that fails on first run satisfies all five.
//
// Augment's Verifier exercises a change in a live environment; Replit tests a deployed
// app; Antigravity records the browser doing the thing. RMAD had none of that.
//
// THE NARROW VERSION: RMAD does not build an execution environment. It requires that
// evidence of one EXIST — a recorded, commit-anchored result from the PROJECT'S OWN smoke
// or build command. That keeps the distinctive property intact: the obligation is checked
// deterministically, and its absence is INCONCLUSIVE rather than a guess.
//
// It is still weaker than watching an application serve traffic. "The smoke command
// exited zero at this commit" is a real fact and a modest one, and it should be sold as
// exactly that.

function checkO6(root, commit) {
  const kinds = ['smoke', 'build'];
  const seen = [];
  for (const kind of kinds) {
    const rows = record.observationsAt(root, commit, kind);
    if (rows.length) seen.push({ kind, rows });
  }
  if (!seen.length) {
    return ob('O6', 'Observed running', INCONCLUSIVE, 0,
      'no smoke or build result recorded at this commit — record one with ' +
      '`rmad task observe --kind smoke -- <your run command>`',
      { absentInput: false });
  }
  const failures = [];
  let total = 0;
  for (const { kind, rows } of seen) {
    for (const r of rows) {
      total++;
      if (String(r.value) !== 'pass') failures.push({ kind, subject: r.subject, detail: r.detail });
    }
  }
  return failures.length
    ? ob('O6', 'Observed running', UNSATISFIED, failures.length,
      `${failures.length} of ${total} execution check(s) failed at this commit`, { failures })
    : ob('O6', 'Observed running', SATISFIED, 0,
      `${total} execution check(s) passed at this commit (${seen.map((s) => s.kind).join(', ')})`);
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Subjects with a passing observation AT THIS COMMIT. Stale evidence is not evidence. */
function passingSubjects(root, commit) {
  const set = new Set();
  for (const o of record.observationsAt(root, commit, 'test')) {
    if (o.value === 'pass' && o.subject) set.add(o.subject);
  }
  return set;
}

function observationSets(root, commit, kind) {
  const passing = new Set();
  const failing = new Set();
  const rows = record.observationsAt(root, commit, kind);
  for (const o of rows) {
    if (!o.subject) continue;
    (o.value === 'pass' ? passing : failing).add(o.subject);
  }
  return { passing, failing, total: rows.length };
}

/** Test symbols with an evidenced call path into any of these symbols. */
function testsReaching(g, symbolIds) {
  const out = new Map();
  for (const id of symbolIds) {
    const node = G.getNode(g, id) || G.findSymbols(g, id)[0];
    if (!node) continue;
    for (const hit of G.blastRadius(g, node.id, 3)) {
      const n = G.getNode(g, hit.id);
      if (!n) continue;
      const file = n.file || n.path;
      if (!impactMod.isTestFile(file)) continue;
      if (!out.has(hit.id)) out.set(hit.id, { id: hit.id, name: n.qualname || n.name, file, depth: hit.depth });
    }
  }
  return [...out.values()];
}

// ─── the residual ───────────────────────────────────────────────────────────

/**
 * @param {string} root
 * @param {object} g       loaded graph
 * @param {object} opts    { taskId, changed[], weights, commit }
 */
function residual(root, g, opts = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
  const commit = opts.commit || record.headCommit(root);
  const task = opts.taskId ? record.getTask(root, opts.taskId) : null;
  const waiverRows = opts.taskId ? record.waiversFor(root, opts.taskId) : [];

  // Waivers are scoped to the obligation they were approved FOR.
  //
  // This previously collapsed every waiver into one set keyed only on subject, so a
  // waiver recorded against O4 silently satisfied O2 for the same symbol — and the
  // detail string then claimed "all changed symbols reached by a passing test", which was
  // simply false. An exemption that leaks across obligations is the cheapest possible way
  // to drive the residual to zero without doing any work, which is exactly what the
  // anti-gaming rules exist to prevent.
  //
  // `expires_commit` is honoured here too. It was written by `task waive --expires` and
  // read nowhere, so every waiver was permanent regardless of what the approver intended.
  const waivedFor = (obligation) => new Set(
    waiverRows
      .filter((w) => w.obligation === obligation)
      .filter((w) => !w.expires_commit || w.expires_commit === commit)
      .map((w) => w.subject_id)
      .filter(Boolean)
  );
  const waived = waivedFor('O2');

  const changed = opts.changed || [];

  const raw = [
    checkO1(root, g, task, commit, waived),
    checkO2(root, g, changed, commit, waived),
    checkO3(root, task, commit),
    checkO4(root, g),
    checkO5(g, task, changed),
    checkO6(root, commit)
  ];

  // RMAD-16 — absent input is INCONCLUSIVE, never NOT-APPLICABLE.
  //
  // `done` required R === 0 and nothing inconclusive, and NA counted as neither. But NA
  // was being DERIVED FROM MISSING INPUT: O1 returns NA with no criteria, O2 with no
  // changed symbols, O5 with no scope — and `changedFor()` yields [] unless --diff or
  // --staged is passed. So `rmad task done`, with no diff flag and no criteria, evaluated
  // only O3 and O4 and printed DONE. Two obligations out of five, certifying the work.
  //
  // NA now means one thing only: this obligation does not apply to this KIND of task. A
  // document task cannot have a blast radius; a code task with no declared scope is
  // simply unmeasured, which is a different statement and must not certify.
  const kind = (task && task.kind) || 'code';
  const applies = KIND_OBLIGATIONS[kind] || KIND_OBLIGATIONS.code;
  const obligations = raw.map((o) => {
    // KIND IS DECIDED FIRST, for every obligation, however it reported.
    //
    // This used to be reachable only by obligations that returned NA *with absentInput*,
    // which made the rule an accident of how each check happened to signal. O6 reports
    // INCONCLUSIVE directly when there is no smoke result, so it slipped past entirely: a
    // `document` task was still held to "observed running" and still read 5 applicable
    // instead of 2. The kind mechanism looked present and did nothing — which is the same
    // shape as the defect it was written to fix.
    //
    // A document has nothing to run and no blast radius. That is true regardless of which
    // internal state the check chose, so it is applied before anything else is considered.
    if (!applies.has(o.id)) {
      return { ...o, state: NA, absentInput: false,
        detail: `${o.detail} (not applicable to a ${kind} task)` };
    }
    if (o.state !== NA || !o.absentInput) return o;
    return { ...o, state: INCONCLUSIVE,
      detail: `${o.detail} — supply the evidence or record a waiver` };
  });

  let R = 0;
  for (const o of obligations) {
    if (o.state === UNSATISFIED) R += weights[o.id] * o.count;
  }

  const unsatisfied = obligations.filter((o) => o.state === UNSATISFIED);
  const inconclusive = obligations.filter((o) => o.state === INCONCLUSIVE);

  // The denominator is part of the verdict. "DONE" alone hides how much was actually
  // checked; "DONE (5/5 evaluated)" cannot. A number without its denominator is the exact
  // failure mode this predicate exists to prevent.
  const applicable = obligations.filter((o) => o.state !== NA);
  const evaluated = applicable.filter((o) => o.state === SATISFIED || o.state === UNSATISFIED);

  // R = 0 is necessary but not sufficient. An obligation that could not be checked is not
  // a passed one, so `done` requires that nothing is inconclusive — otherwise the
  // predicate would quietly certify work on the strength of checks that never ran.
  const done = R === 0 && inconclusive.length === 0;

  return {
    commit,
    taskId: opts.taskId || null,
    R,
    done,
    verdict: done ? 'DONE'
      : inconclusive.length && !unsatisfied.length ? 'INCONCLUSIVE'
        : 'NOT DONE',
    weights,
    kind,
    // How much of the predicate actually ran. `evaluated < applicable` means obligations
    // were skipped for want of evidence, and the verdict must never be read without it.
    evaluated: evaluated.length,
    applicable: applicable.length,
    obligations,
    unsatisfied: unsatisfied.map((o) => o.id),
    inconclusive: inconclusive.map((o) => o.id),
    waivers: waiverRows.map((w) => ({ obligation: w.obligation, subject: w.subject_id, approver: w.approver, reason: w.reason })),
    // The next thing worth doing: the heaviest unsatisfied obligation, which is what a
    // loop should dispatch against rather than retrying whatever failed most recently.
    nextAction: unsatisfied.sort((a, b) => weights[b.id] * b.count - weights[a.id] * a.count)[0] || null
  };
}

module.exports = { residual, DEFAULT_WEIGHTS, KIND_OBLIGATIONS, testsReaching, passingSubjects, SATISFIED, UNSATISFIED, NA, INCONCLUSIVE };
