// record.js — what we know, and when we knew it.
//
// The graph says what the code IS. This says what was OBSERVED about it: which suite ran
// at which commit, what a reviewer concluded, who approved an exemption. Keeping both in
// one store is the point — "which acceptance criterion has no passing test that touches
// the symbol it names" is a join, and a join you cannot write is a question nobody asks.
//
// EVERYTHING HERE IS APPEND-ONLY AND COMMIT-ANCHORED. An observation carries the commit it
// was taken against, and the residual ignores any observation whose commit is not HEAD.
// That one rule kills the most common agent lie — "the tests pass" — because it makes the
// claim expire automatically when the code moves underneath it, rather than relying on
// anyone to notice.

'use strict';

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const store = require('../store/db.js');
const codeGraph = require('../code-graph.js');

function nowMs() { return Date.now(); }
function newId(prefix) { return `${prefix}_${crypto.randomBytes(8).toString('hex')}`; }

/** The commit every observation is measured against. `worktree` when git is unavailable. */
function headCommit(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'worktree';
  }
}

/**
 * Open the evidence side of the store.
 * Uses `create: true` so a repo that has an index but predates the evidence tables gains
 * them rather than erroring — evidence is additive to the graph, never a reason to rebuild it.
 */
function open(root) {
  // The root must ALREADY exist. `store.open({create:true})` mkdirs recursively, so a
  // malformed root — a mistyped --root, or a hook handed a bad `cwd` — used to conjure the
  // whole path and record evidence into a project that was never there. That is exactly
  // how a phantom tree reached the root of a drive: six cost rows written by the
  // PostToolUse meter, under directories nothing had asked for, reported as success.
  //
  // Evidence about a repository that does not exist is not evidence. Refuse rather than
  // create. Everything BELOW an existing root is still created on demand, so a real repo
  // that has no index yet is unaffected.
  if (!codeGraph.rootExists(root)) {
    throw new Error(`cannot record evidence: ${root} does not exist (or is not a directory)`);
  }
  const file = codeGraph.indexPath(root);
  const conn = store.open(file, { create: true });
  if (!conn) throw new Error('cannot open the index store — is node:sqlite available?');
  return conn;
}

// ─── runs and actions ───────────────────────────────────────────────────────

function startRun(root, { agent, model, taskId, parentRunId, prompt, promptDigest } = {}) {
  const conn = open(root);
  const id = newId('run');
  // Attribution is agent + model + which prompt. The prompt is DIGESTED here, never
  // stored — it carries whatever the operator was working on, and this table is outside
  // the redaction pass.
  const digest = promptDigest || (prompt != null ? digestText(prompt) : null);
  conn.prepare(`INSERT INTO runs (id, parent_run_id, agent, model, task_id, prompt_digest, started_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, parentRunId || null, agent || null, model || null, taskId || null, digest, nowMs());
  store.close(conn);
  return id;
}

/**
 * Attribution for an observation: which agent, which model, which prompt produced it.
 * Joined through the run rather than duplicated per row — one fact, one place.
 */
function attributionFor(root, { taskId, commit } = {}) {
  const conn = open(root);
  try {
    const where = [];
    const params = [];
    if (taskId) { where.push('r.task_id = ?'); params.push(taskId); }
    if (commit) { where.push('o.commit_sha = ?'); params.push(commit); }
    return conn.prepare(
      `SELECT o.id AS observation, o.kind, o.subject, o.value, o.commit_sha,
              r.id AS run_id, r.agent, r.model, r.prompt_digest, r.started_at
         FROM observations o LEFT JOIN runs r ON r.id = o.run_id` +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY o.created_at').all(...params);
  } finally {
    store.close(conn);
  }
}

function endRun(root, runId, { costUsd } = {}) {
  const conn = open(root);
  conn.prepare('UPDATE runs SET ended_at = ?, cost_usd = ? WHERE id = ?')
    .run(nowMs(), costUsd ?? null, runId);
  store.close(conn);
}

/**
 * Content-addressed digest for a unit of work.
 *
 * Deterministic work — a test run at a commit, a mutation score for a file hash, a lint
 * pass — is the same answer every time, so it should be paid for once. This is Bazel's
 * action key applied to a residual loop: iteration 3 re-runs the suite, not the pipeline.
 *
 * LLM calls are deliberately NOT cached by default. A cached model response is a
 * different kind of thing from a cached test result: the second is a fact, the first is
 * one sample from a distribution, and replaying it silently defeats the fresh-eyes
 * property that makes independent review worth anything.
 */
function digestOf({ tool, args, inputs, model, config }) {
  const h = crypto.createHash('sha256');
  h.update(String(tool || ''));
  h.update('\0');
  h.update(JSON.stringify(args ?? null));
  h.update('\0');
  h.update(JSON.stringify(inputs ?? null));
  h.update('\0');
  h.update(String(model || ''));
  h.update('\0');
  h.update(JSON.stringify(config ?? null));
  return h.digest('hex');
}

/**
 * Digest of a piece of TEXT — distinct from digestOf(), which keys an action from a
 * structured {tool, args, inputs, model, config}. Passing a bare string to that one
 * destructures to all-undefined and returns the SAME hash for every input, which is a
 * constant wearing a digest's clothes. Prompt attribution needs this one.
 */
function digestText(s) {
  return crypto.createHash('sha256').update(String(s ?? '')).digest('hex');
}

function recordAction(root, { runId, tool, digest, status, costUsd, resultRef, cacheHit }) {
  const conn = open(root);
  const id = newId('act');
  conn.prepare(`INSERT INTO actions (id, run_id, tool, digest, cache_hit, status, cost_usd, created_at, result_ref)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, runId || null, tool, digest, cacheHit ? 1 : 0, status || null, costUsd ?? null, nowMs(), resultRef || null);
  store.close(conn);
  return id;
}

/** Has this exact work been done before? Returns the prior action, or null. */
function lookupAction(root, digest) {
  const conn = open(root);
  const row = conn.prepare(`SELECT id, tool, status, result_ref, created_at FROM actions
                            WHERE digest = ? AND status = 'ok' ORDER BY created_at DESC LIMIT 1`).get(digest);
  store.close(conn);
  return row || null;
}

// ─── observations ───────────────────────────────────────────────────────────

const ORACLE_KINDS = new Set([
  'test', 'lint', 'typecheck', 'build', 'mutation', 'property', 'graph-invariant', 'llm-judgement',
  // RMAD-21. `coverage` is different in kind from the others: its subject is a SYMBOL that
  // executed, not a test that passed. It is the only oracle here that reports what the
  // runtime did rather than what a checker concluded.
  'coverage',
  // RMAD-12 (narrow). O6 asks whether the software was OBSERVED RUNNING. `smoke` is the
  // project's own run/health command; `build` already existed and counts for the same
  // purpose. RMAD does not own an execution environment — it requires that evidence of
  // one exist.
  'smoke'
]);

/**
 * @param {object[]} results [{ subject, value: 'pass'|'fail', detail? }]
 */
function recordObservations(root, { runId, kind, results, commit }) {
  if (!ORACLE_KINDS.has(kind)) {
    throw new Error(`unknown oracle kind "${kind}" — expected one of ${[...ORACLE_KINDS].join(', ')}`);
  }
  const sha = commit || headCommit(root);
  const conn = open(root);
  const ins = conn.prepare(`INSERT INTO observations (id, run_id, kind, subject, value, commit_sha, detail, created_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  conn.exec('BEGIN IMMEDIATE');
  try {
    for (const r of results) {
      ins.run(newId('obs'), runId || null, kind, r.subject || null, r.value,
        sha, r.detail ? String(r.detail).slice(0, 4000) : null, nowMs());
    }
    conn.exec('COMMIT');
  } catch (err) {
    try { conn.exec('ROLLBACK'); } catch { /* already unwound */ }
    throw err;
  } finally {
    store.close(conn);
  }
  return { commit: sha, count: results.length };
}

/** Current observations only. Anything measured against another commit is stale. */
function observationsAt(root, commit, kind) {
  const conn = open(root);
  const rows = kind
    ? conn.prepare('SELECT * FROM observations WHERE commit_sha = ? AND kind = ?').all(commit, kind)
    : conn.prepare('SELECT * FROM observations WHERE commit_sha = ?').all(commit);
  store.close(conn);
  return rows;
}

// ─── baselines ──────────────────────────────────────────────────────────────

/**
 * A baseline is EXECUTED, never assumed.
 *
 * The single most common way a quality gate lies is by comparing against a baseline it
 * imagined. Storing the passing SET alongside the counts is what lets O3 catch the fix
 * that breaks one test and adds another — the count stays level and only the set moves.
 */
function recordBaseline(root, { taskId, oracle, passing, failing, commit }) {
  const sha = commit || headCommit(root);
  const conn = open(root);
  const id = newId('base');
  conn.prepare(`INSERT INTO baselines (id, task_id, commit_sha, oracle, pass_count, fail_count, pass_set, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, taskId || null, sha, oracle, passing.length, (failing || []).length,
      JSON.stringify([...passing].sort()), nowMs());
  store.close(conn);
  return { id, commit: sha, passing: passing.length, failing: (failing || []).length };
}

function latestBaseline(root, taskId, oracle) {
  const conn = open(root);
  const row = conn.prepare(`SELECT * FROM baselines WHERE (task_id IS ? OR task_id = ?) AND oracle = ?
                            ORDER BY created_at DESC LIMIT 1`).get(taskId || null, taskId || null, oracle);
  store.close(conn);
  if (!row) return null;
  return { ...row, pass_set: JSON.parse(row.pass_set) };
}

// ─── verdicts and waivers ───────────────────────────────────────────────────

function recordVerdict(root, { subjectId, value, confidence, producingRunId, refuterRunId, reason }) {
  if (!producingRunId || !refuterRunId) throw new Error('a verdict needs both the producing run and the refuting run');
  if (producingRunId === refuterRunId) {
    // Also enforced by a CHECK constraint; caught here so the message explains WHY.
    throw new Error('the run that produced a finding may not be the run that clears it — spawn a separate verifier');
  }
  const conn = open(root);
  const id = newId('vd');
  conn.prepare(`INSERT INTO verdicts (id, subject_id, value, confidence, producing_run_id, refuter_run_id, reason, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, subjectId, value, confidence ?? null, producingRunId, refuterRunId, reason || null, nowMs());
  store.close(conn);
  return id;
}

const AGENT_LIKE = /^(agent|rmad-|claude|assistant|bot|ai)\b/i;

function recordWaiver(root, { taskId, obligation, subjectId, reason, approver, approverKind, expiresCommit }) {
  if (!reason || !approver) throw new Error('a waiver needs a reason and an approver');
  const kind = approverKind || 'human';
  if (kind === 'human' && AGENT_LIKE.test(approver)) {
    throw new Error(`"${approver}" looks like an agent identity — a waiver removes an obligation and must be approved by a human or a named policy`);
  }
  const conn = open(root);
  const id = newId('wv');
  conn.prepare(`INSERT INTO waivers (id, task_id, obligation, subject_id, reason, approver, approver_kind, expires_commit, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, taskId, obligation, subjectId || null, reason, approver, kind, expiresCommit || null, nowMs());
  store.close(conn);
  return id;
}

function waiversFor(root, taskId) {
  const conn = open(root);
  const rows = conn.prepare('SELECT * FROM waivers WHERE task_id = ?').all(taskId);
  store.close(conn);
  return rows;
}

// ─── cost (RMAD-02) ─────────────────────────────────────────────────────────
//
// Records ONLY what was observed. Tool calls, wall-clock and payload bytes are directly
// measurable from the hook payload and are always written. Token counts are not available
// to hooks, so they are left NULL and `source` says 'toolcount' — never estimated, because
// an estimate that looks like a measurement is the thing this ledger exists to replace.

function recordCost(root, entry) {
  const conn = open(root);
  try {
    const seq = (conn.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM cost_ledger').get() || {}).n || 1;
    const id = newId('cost');
    conn.prepare(`INSERT INTO cost_ledger
        (id, task_id, session_id, workflow, agent, model, tool,
         input_tokens, output_tokens, cache_read, payload_bytes, tool_calls, wall_ms, usd, source, seq, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, entry.taskId || null, entry.sessionId || null, entry.workflow || null,
        entry.agent || null, entry.model || null, entry.tool || null,
        entry.inputTokens ?? null, entry.outputTokens ?? null, entry.cacheRead ?? null,
        entry.payloadBytes || 0, entry.toolCalls || 1, entry.wallMs || 0,
        entry.usd ?? null, entry.source || 'toolcount', seq, nowMs());
    return id;
  } finally {
    store.close(conn);
  }
}

function costRows(root, { taskId, sessionId, workflow } = {}) {
  const conn = open(root);
  try {
    const where = [];
    const params = [];
    if (taskId) { where.push('task_id = ?'); params.push(taskId); }
    if (sessionId) { where.push('session_id = ?'); params.push(sessionId); }
    if (workflow) { where.push('workflow = ?'); params.push(workflow); }
    const sql = 'SELECT * FROM cost_ledger' +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') + ' ORDER BY seq';
    return conn.prepare(sql).all(...params);
  } finally {
    store.close(conn);
  }
}


// ─── residual log + approvals (RMAD-07, RMAD-08) ────────────────────────────

function logResidual(root, res) {
  const conn = open(root);
  try {
    const seq = (conn.prepare('SELECT COALESCE(MAX(seq),0)+1 AS n FROM residual_log').get() || {}).n || 1;
    const id = newId('res');
    conn.prepare(`INSERT INTO residual_log
        (id, task_id, commit_sha, verdict, r, evaluated, applicable, obligations, seq, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, res.taskId || null, res.commit || null, res.verdict, res.R,
        res.evaluated ?? null, res.applicable ?? null,
        JSON.stringify((res.obligations || []).map((o) => [o.id, o.state, o.count])),
        seq, nowMs());
    return id;
  } finally { store.close(conn); }
}

function residualHistory(root, taskId) {
  const conn = open(root);
  try {
    return taskId
      ? conn.prepare('SELECT * FROM residual_log WHERE task_id = ? ORDER BY seq').all(taskId)
      : conn.prepare('SELECT * FROM residual_log ORDER BY seq').all();
  } finally { store.close(conn); }
}

function recordApproval(root, { artifact, decision, approver, latencyMs, revisions }) {
  if (!artifact) throw new Error('an approval must name the artifact it approves');
  const conn = open(root);
  try {
    const seq = (conn.prepare('SELECT COALESCE(MAX(seq),0)+1 AS n FROM approvals').get() || {}).n || 1;
    const id = newId('apr');
    conn.prepare(`INSERT INTO approvals (id, artifact, decision, approver, latency_ms, revisions, seq, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, artifact, decision || 'approved', approver || null,
        latencyMs ?? null, revisions ?? null, seq, nowMs());
    return id;
  } finally { store.close(conn); }
}

function approvalHistory(root) {
  const conn = open(root);
  try { return conn.prepare('SELECT * FROM approvals ORDER BY seq').all(); }
  finally { store.close(conn); }
}

// ─── gate overrides ─────────────────────────────────────────────────────────
//
// The prompt is DIGESTED, never stored. A prompt that forces a stage gate contains
// whatever the operator was working on — source, paths, sometimes secrets — and the
// redaction pass does not cover this table. A digest proves WHICH prompt without
// keeping it, and two runs of the same prompt still compare equal.

function recordOverride(root, { gate, reason, prompt, commit }) {
  if (!gate) throw new Error('an override must name the gate it opened');
  if (!reason) throw new Error('an override must carry a reason — --force-gate=<reason>');
  const conn = open(root);
  const id = newId('ov');
  conn.prepare(`INSERT INTO overrides (id, gate, reason, prompt_digest, commit_sha, created_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, gate, reason, digestText(prompt), commit || headCommit(root) || null, nowMs());
  store.close(conn);
  return id;
}

function overridesFor(root, gate) {
  const conn = open(root);
  const rows = gate
    ? conn.prepare('SELECT * FROM overrides WHERE gate = ? ORDER BY created_at').all(gate)
    : conn.prepare('SELECT * FROM overrides ORDER BY created_at').all();
  store.close(conn);
  return rows;
}

// ─── work items and criteria ────────────────────────────────────────────────

function upsertTask(root, { id, kind, title, status, ownerAgent, scope, parentId }) {
  const conn = open(root);
  const existing = conn.prepare('SELECT id FROM work_items WHERE id = ?').get(id);
  if (existing) {
    conn.prepare('UPDATE work_items SET kind=?, title=?, status=?, owner_agent=?, scope_json=?, parent_id=?, updated_at=? WHERE id=?')
      .run(kind || 'task', title || null, status || 'open', ownerAgent || null,
        scope ? JSON.stringify(scope) : null, parentId || null, nowMs(), id);
  } else {
    conn.prepare('INSERT INTO work_items (id, kind, parent_id, title, status, owner_agent, scope_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, kind || 'task', parentId || null, title || null, status || 'open', ownerAgent || null,
        scope ? JSON.stringify(scope) : null, nowMs(), nowMs());
  }
  store.close(conn);
  return id;
}

function getTask(root, id) {
  const conn = open(root);
  const row = conn.prepare('SELECT * FROM work_items WHERE id = ?').get(id);
  const acs = conn.prepare('SELECT * FROM acceptance_criteria WHERE task_id = ?').all(id);
  store.close(conn);
  if (!row) return null;
  return {
    ...row,
    scope: row.scope_json ? JSON.parse(row.scope_json) : null,
    criteria: acs.map((a) => ({ ...a, symbols: a.symbols_json ? JSON.parse(a.symbols_json) : [] }))
  };
}

function addCriterion(root, { taskId, id, statement, symbols, testable, gatedBy }) {
  const conn = open(root);
  const cid = id || newId('ac');
  const hash = crypto.createHash('sha1').update(statement).digest('hex');
  conn.prepare(`INSERT INTO acceptance_criteria (id, task_id, statement, statement_hash, testable, symbols_json, gated_by, gated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET statement=excluded.statement, statement_hash=excluded.statement_hash,
                  testable=excluded.testable, symbols_json=excluded.symbols_json, gated_by=excluded.gated_by`)
    .run(cid, taskId, statement, hash, testable === false ? 0 : 1,
      JSON.stringify(symbols || []), gatedBy || null, gatedBy ? nowMs() : null);
  store.close(conn);
  return cid;
}

function saveSnapshot(root, stats, commit) {
  const conn = open(root);
  const id = newId('snap');
  conn.prepare('INSERT INTO snapshots (id, commit_sha, stats_json, created_at) VALUES (?,?,?,?)')
    .run(id, commit || headCommit(root), JSON.stringify(stats), nowMs());
  // Bounded history: enough for a graph diff and a trend, not an unbounded log.
  conn.exec('DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY created_at DESC LIMIT 20)');
  store.close(conn);
  return id;
}

function snapshots(root, limit = 2) {
  const conn = open(root);
  const rows = conn.prepare('SELECT * FROM snapshots ORDER BY created_at DESC LIMIT ?').all(limit);
  store.close(conn);
  return rows.map((r) => ({ ...r, stats: JSON.parse(r.stats_json) }));
}

module.exports = {
  headCommit, digestOf,
  startRun, endRun, recordAction, lookupAction,
  recordObservations, observationsAt,
  recordBaseline, latestBaseline,
  recordVerdict, recordWaiver, waiversFor,
  recordOverride, overridesFor,
  recordCost, costRows, attributionFor, digestText,
  logResidual, residualHistory, recordApproval, approvalHistory,
  upsertTask, getTask, addCriterion,
  saveSnapshot, snapshots,
  ORACLE_KINDS
};
