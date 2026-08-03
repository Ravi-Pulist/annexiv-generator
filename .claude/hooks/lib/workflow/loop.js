// loop.js — FDE-01. The driver that turns the predicate from a REPORT into an ENGINE.
//
// `residual()` has always returned `nextAction` — "the heaviest unsatisfied obligation,
// which is what a loop should dispatch against rather than retrying whatever failed most
// recently" — and until now NOTHING CONSUMED IT. This is its first consumer.
//
// WHAT THIS DELIBERATELY DOES NOT DO: it does not call a model. RMAD's core decides
// completion; an adapter reports what a runtime did (RMAD-22). A driver that invoked an
// inference endpoint would drag a runtime dependency into the one part of the framework
// whose value is that it has none — and the same loop has to work whether the attempt was
// made by Claude Code, a local 8B behind Ollama, or a human typing.
//
// So this is a STATE MACHINE THAT A RUNTIME STEPS. It answers one question — "what now?" —
// and records what came back:
//
//     start  →  ATTEMPT(tier 0, focus O2)
//     step(outcome)  →  ATTEMPT(tier 0, focus O2)   still failing, attempts remain
//     step(outcome)  →  ESCALATE(tier 1)            tier cap reached
//     step(outcome)  →  DONE                        predicate satisfied
//                    or ABSTAIN                     ladder or budget exhausted
//
// THE ECONOMICS THIS EXISTS FOR. Autonomous workflows multiply token consumption 3-10x
// over a single pass, and 20-40x when a job needs several rounds. On metered inference
// that is an unbounded and unpredictable bill. On owned hardware the marginal token is
// free — which removes the MONEY failure but not the failure: an uncapped loop there
// consumes AVAILABILITY instead. Hence caps on all three of attempts, wall-clock and
// tokens, and hence they are recorded rather than assumed.

'use strict';

const crypto = require('crypto');
const store = require('../store/db.js');
const codeGraph = require('../code-graph.js');

/**
 * The default ladder.
 *
 * It is written to disk on first use rather than held only in code. A default that stays
 * implicit is a cap nobody chose; materialising it makes the policy explicit, reviewable
 * and diffable — which is the whole point of declaring escalation in advance instead of
 * deciding it mid-run.
 */
const DEFAULT_LADDER = {
  tiers: [
    { id: 'tier-1-small', maxAttempts: 3, note: 'smallest model that might pass' },
    { id: 'tier-2-large', maxAttempts: 2, note: 'larger open-weight model' },
    { id: 'tier-3-frontier', maxAttempts: 1, note: 'last resort; costs the most per attempt' }
  ],
  caps: {
    maxTokens: 200000,
    maxSeconds: 1800
  }
};

const DECISIONS = ['ATTEMPT', 'ESCALATE', 'DONE', 'ABSTAIN'];

function newId(prefix) { return `${prefix}_${crypto.randomBytes(6).toString('hex')}`; }

/** Reject a ladder that cannot bound a loop, rather than repairing it into something silent. */
function validateLadder(ladder) {
  const problems = [];
  if (!ladder || typeof ladder !== 'object') return ['ladder is not an object'];
  if (!Array.isArray(ladder.tiers) || ladder.tiers.length === 0) problems.push('ladder.tiers must be a non-empty array');
  else {
    ladder.tiers.forEach((t, i) => {
      if (!t || !t.id) problems.push(`tier ${i} has no id`);
      if (!Number.isInteger(t.maxAttempts) || t.maxAttempts < 1) {
        problems.push(`tier ${t && t.id ? t.id : i}: maxAttempts must be a positive integer`);
      }
    });
  }
  const caps = ladder.caps || {};
  for (const k of ['maxTokens', 'maxSeconds']) {
    if (!Number.isInteger(caps[k]) || caps[k] < 1) problems.push(`caps.${k} must be a positive integer`);
  }
  return problems;
}

/**
 * THE PURE CORE. Given the predicate's verdict and where the loop has got to, what now?
 *
 * Kept free of storage and clock so it can be tested exhaustively — the decision table is
 * the part that must not be wrong, and a decision function that reads a database is a
 * decision function nobody tests at its edges.
 *
 * @param {object} res      residual() output
 * @param {object} state    { tierIndex, attemptsInTier, tokensUsed, secondsElapsed }
 * @param {object} ladder   validated ladder
 */
function decide(res, state, ladder) {
  const tier = ladder.tiers[state.tierIndex] || null;
  const caps = ladder.caps;

  const base = {
    verdict: res.verdict,
    R: res.R,
    evaluated: res.evaluated,
    applicable: res.applicable,
    tier: tier ? tier.id : null,
    tierIndex: state.tierIndex,
    attempt: state.attemptsInTier + 1,
    budget: {
      tokensUsed: state.tokensUsed,
      tokensRemaining: Math.max(0, caps.maxTokens - state.tokensUsed),
      secondsElapsed: state.secondsElapsed,
      secondsRemaining: Math.max(0, caps.maxSeconds - state.secondsElapsed)
    }
  };

  // 1. Finished. Checked first so a satisfied predicate is never overridden by a cap —
  //    running out of budget on the attempt that succeeded is still success.
  if (res.verdict === 'DONE') {
    return { ...base, decision: 'DONE', focus: null, reason: 'the predicate is satisfied' };
  }

  // 2. Budget. Tokens and wall-clock are hard walls; crossing one ends the run.
  if (state.tokensUsed >= caps.maxTokens) {
    return { ...base, decision: 'ABSTAIN', focus: null, reason: `token cap reached (${state.tokensUsed}/${caps.maxTokens})` };
  }
  if (state.secondsElapsed >= caps.maxSeconds) {
    return { ...base, decision: 'ABSTAIN', focus: null, reason: `time cap reached (${state.secondsElapsed}s/${caps.maxSeconds}s)` };
  }

  // 3. Ladder exhausted — abstain WITH the residual, never a confident guess. Same
  //    discipline as INCONCLUSIVE in the predicate: "I could not determine this" is an
  //    answer, and it is the one that is actionable.
  if (!tier) {
    return {
      ...base,
      decision: 'ABSTAIN',
      focus: null,
      reason: 'tier ladder exhausted',
      residualDetail: { unsatisfied: res.unsatisfied, inconclusive: res.inconclusive }
    };
  }

  // 4. This tier is spent — move up. Escalation is a declared policy, not a judgement
  //    call made in the moment, which is what makes a run reproducible and costable.
  if (state.attemptsInTier >= tier.maxAttempts) {
    const next = ladder.tiers[state.tierIndex + 1];
    if (!next) {
      return {
        ...base,
        decision: 'ABSTAIN',
        focus: null,
        reason: `tier ${tier.id} exhausted and no higher tier is declared`,
        residualDetail: { unsatisfied: res.unsatisfied, inconclusive: res.inconclusive }
      };
    }
    return {
      ...base,
      decision: 'ESCALATE',
      tier: next.id,
      tierIndex: state.tierIndex + 1,
      attempt: 1,
      focus: focusFor(res),
      reason: `tier ${tier.id} reached its ${tier.maxAttempts}-attempt cap`
    };
  }

  // 5. Attempt, pointed at something specific.
  //
  // The reason tracks the VERDICT, not the decision. An INCONCLUSIVE run has nothing
  // unsatisfied — saying so would contradict the directive printed directly beneath it,
  // and a driver whose explanation disagrees with its own instruction teaches operators
  // to stop reading either.
  const reason = res.verdict === 'INCONCLUSIVE'
    ? 'the predicate could not be evaluated — evidence is missing'
    : 'obligations remain unsatisfied';
  return { ...base, decision: 'ATTEMPT', focus: focusFor(res), reason };
}

/**
 * What the next attempt should aim at.
 *
 * THE CASE THAT MATTERS, and it is easy to get wrong: `nextAction` is chosen from the
 * UNSATISFIED obligations only, so an INCONCLUSIVE verdict yields null. Those are two
 * different problems and they need two different instructions. An unsatisfied obligation
 * means the work is wrong — do it again, differently. An inconclusive one means nothing
 * could be measured — the fix is EVIDENCE, and telling an agent to "try again" when the
 * real gap is a missing baseline burns a whole tier achieving nothing.
 */
function focusFor(res) {
  if (res.nextAction) {
    return {
      kind: 'repair',
      obligation: res.nextAction.id,
      count: res.nextAction.count,
      reason: res.nextAction.reason || null,
      instruction: `Obligation ${res.nextAction.id} is unsatisfied (${res.nextAction.count} outstanding). Address that specifically — do not repeat the previous attempt unchanged.`
    };
  }
  if (res.inconclusive && res.inconclusive.length) {
    return {
      kind: 'evidence',
      obligations: res.inconclusive,
      instruction: `No verdict is possible for ${res.inconclusive.join(', ')} — evidence is missing, not wrong. Record the missing evidence (baseline, coverage, smoke) rather than redoing the work.`
    };
  }
  return { kind: 'unknown', instruction: 'The predicate is not satisfied and named nothing actionable. Inspect `rmad task residual` directly.' };
}

// ─── storage ────────────────────────────────────────────────────────────────

/**
 * Open the store for this root.
 *
 * Mirrors evidence/record.js deliberately, including its refusal: the root must ALREADY
 * exist. `store.open({create:true})` mkdirs recursively, so a mistyped --root would
 * conjure a whole directory tree and write loop attempts into a project that was never
 * there — the phantom-root failure that once put cost rows at the root of a drive and
 * reported success. A loop record about a repository that does not exist is not a record.
 */
function open(root) {
  if (!codeGraph.rootExists(root)) {
    throw new Error(`cannot record a loop: ${root} does not exist (or is not a directory)`);
  }
  const conn = store.open(codeGraph.indexPath(root), { create: true });
  if (!conn) throw new Error('cannot open the index store — is node:sqlite available?');
  return conn;
}

function activeRun(conn, taskId) {
  return conn.prepare(
    "SELECT * FROM loop_runs WHERE task_id = ? AND status = 'open' ORDER BY started_at DESC LIMIT 1"
  ).get(taskId) || null;
}

function stateOf(conn, runId) {
  const row = conn.prepare(
    `SELECT COALESCE(MAX(tier_index), 0) AS tier_index,
            COALESCE(SUM(tokens_in), 0) + COALESCE(SUM(tokens_out), 0) AS tokens,
            COALESCE(SUM(wall_ms), 0) AS wall_ms
       FROM loop_attempts WHERE run_id = ?`
  ).get(runId) || {};
  const tierIndex = row.tier_index || 0;
  const inTier = conn.prepare(
    'SELECT COUNT(*) AS n FROM loop_attempts WHERE run_id = ? AND tier_index = ?'
  ).get(runId, tierIndex) || { n: 0 };
  return {
    tierIndex,
    attemptsInTier: inTier.n || 0,
    tokensUsed: row.tokens || 0,
    secondsElapsed: Math.floor((row.wall_ms || 0) / 1000)
  };
}

/** Begin a run. Returns the first directive. */
function start(root, { taskId, ladder, residualFn }) {
  const problems = validateLadder(ladder);
  if (problems.length) {
    const err = new Error(`ladder is not usable: ${problems.join('; ')}`);
    err.problems = problems;
    throw err;
  }
  const conn = open(root);
  const existing = activeRun(conn, taskId);
  if (existing) {
    const st = stateOf(conn, existing.id);
    return { runId: existing.id, resumed: true, ...decide(residualFn(), st, ladder) };
  }
  const id = newId('loop');
  conn.prepare(
    `INSERT INTO loop_runs (id, task_id, ladder_json, status, started_at, ended_at, outcome)
     VALUES (?, ?, ?, 'open', ?, NULL, NULL)`
  ).run(id, taskId, JSON.stringify(ladder), Date.now());

  const directive = decide(residualFn(), { tierIndex: 0, attemptsInTier: 0, tokensUsed: 0, secondsElapsed: 0 }, ladder);
  if (directive.decision === 'DONE' || directive.decision === 'ABSTAIN') closeRun(conn, id, directive.decision);
  return { runId: id, resumed: false, ...directive };
}

function closeRun(conn, runId, outcome) {
  conn.prepare("UPDATE loop_runs SET status = 'closed', ended_at = ?, outcome = ? WHERE id = ?")
    .run(Date.now(), outcome, runId);
}

/**
 * Record one attempt and decide what comes next.
 *
 * `tokensIn`/`tokensOut` are optional and default to 0 — NOT to an estimate. RMAD's cost
 * discipline is that an unknown is null and is never rendered as a number nobody measured;
 * a loop that guessed at token counts would produce a budget that reads authoritative and
 * is fiction. Self-hosted runtimes return exact counts, so on our own substrate this is
 * measured rather than inferred.
 */
function step(root, { taskId, tierIndex, outcome, tokensIn, tokensOut, wallMs, note, residualFn }) {
  const conn = open(root);
  const run = activeRun(conn, taskId);
  if (!run) throw new Error(`no open loop for task ${taskId} — run \`rmad loop start\` first`);
  const ladder = JSON.parse(run.ladder_json);

  const prior = stateOf(conn, run.id);
  const idx = Number.isInteger(tierIndex) ? tierIndex : prior.tierIndex;

  conn.prepare(
    `INSERT INTO loop_attempts (id, run_id, tier_index, attempt_no, outcome, tokens_in, tokens_out, wall_ms, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId('att'), run.id, idx,
    (idx === prior.tierIndex ? prior.attemptsInTier : 0) + 1,
    outcome || 'unknown',
    Number.isInteger(tokensIn) ? tokensIn : 0,
    Number.isInteger(tokensOut) ? tokensOut : 0,
    Number.isInteger(wallMs) ? wallMs : 0,
    note || null, Date.now()
  );

  const st = stateOf(conn, run.id);
  const directive = decide(residualFn(), st, ladder);
  if (directive.decision === 'DONE' || directive.decision === 'ABSTAIN') closeRun(conn, run.id, directive.decision);
  return { runId: run.id, ...directive };
}

/** Current state without recording anything. */
function status(root, { taskId, residualFn }) {
  const conn = open(root);
  const run = activeRun(conn, taskId);
  if (!run) {
    const last = conn.prepare(
      'SELECT * FROM loop_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT 1'
    ).get(taskId);
    return last
      ? { runId: last.id, open: false, outcome: last.outcome, attempts: attemptsOf(conn, last.id) }
      : { runId: null, open: false, outcome: null, attempts: [] };
  }
  const ladder = JSON.parse(run.ladder_json);
  const st = stateOf(conn, run.id);
  return { runId: run.id, open: true, attempts: attemptsOf(conn, run.id), ...decide(residualFn(), st, ladder) };
}

function attemptsOf(conn, runId) {
  return conn.prepare('SELECT * FROM loop_attempts WHERE run_id = ? ORDER BY created_at ASC').all(runId);
}

module.exports = { decide, focusFor, validateLadder, start, step, status, DEFAULT_LADDER, DECISIONS };
