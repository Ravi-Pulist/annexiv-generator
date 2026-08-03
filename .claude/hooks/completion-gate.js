#!/usr/bin/env node
// completion-gate.js — TaskCompleted hook
//
// Turns the Done predicate from a REPORT into a GATE. `residual()` already decides whether
// the obligations hold; until now it printed that and the agent stopped anyway. This
// wires the decision to the moment completion is requested, so failing the predicate stops
// the stop.
//
// Exit 2 is the block; stderr is fed back to the model as the reason. `residual()` already
// computes `nextAction` — "the heaviest unsatisfied obligation, which is what a loop should
// dispatch against rather than retrying whatever failed most recently" — and nothing
// consumed it before this.
//
// WHY THIS IS THE WHOLE PRODUCT: across the 50-framework survey every completion signal is
// a model's opinion or a human's click, and both have been measured failing. This is the
// only one that is computed. O2 through O5 involve no grader at all.

'use strict';

const path = require('path');

function main() {
  let payload = {};
  try {
    payload = JSON.parse(require('fs').readFileSync(0, 'utf8') || '{}');
  } catch { /* a malformed payload is not a reason to strand the agent */ }

  if (process.env.RMAD_DISABLED_HOOKS && /completion-gate/.test(process.env.RMAD_DISABLED_HOOKS)) {
    process.exit(0);
  }

  const root = payload.cwd || process.cwd();
  const taskId = payload.taskId || payload.task_id || process.env.RMAD_TASK_ID || null;

  // No task in scope means nothing to gate. RMAD has to be usable as a toolkit inside
  // repositories that have never heard of it, and most work in those is not a governed
  // RMAD task. Gating untracked work would make the framework hostile to its own
  // portability requirement.
  if (!taskId) process.exit(0);

  let r;
  try {
    const G = require('./lib/code-graph.js');
    const { residual } = require('./lib/workflow/residual.js');
    const g = G.load(root);
    if (!g) process.exit(0);            // no index — nothing to compute against
    r = residual(root, g, { taskId });
  } catch (err) {
    // A gate that fails open is weak. A gate that blocks when it crashes is worse: it
    // strands the agent with no path forward, because it cannot satisfy a predicate that
    // will not run. Report and allow; `doctor` is responsible for catching a gate that is
    // persistently broken. This is the opposite of path-enforcer, where truncated input
    // fails CLOSED — there the safe default is denial, here it is not.
    process.stderr.write(`[rmad] completion gate errored, allowing stop: ${err && err.message}\n`);
    process.exit(0);
  }

  if (r.verdict === 'DONE') process.exit(0);

  const lines = [
    `RMAD completion gate: ${r.verdict} (${r.evaluated}/${r.applicable} obligations evaluated, residual R=${r.R})`
  ];

  const unsat = r.obligations.filter((o) => o.state === 'unsatisfied');
  if (unsat.length) {
    lines.push('', 'Unsatisfied:');
    for (const o of unsat) lines.push(`  ${o.id} ${o.name}: ${o.detail} (${o.count})`);
  }

  const incon = r.obligations.filter((o) => o.state === 'inconclusive');
  if (incon.length) {
    lines.push('', 'Inconclusive — evidence is missing, which is not the same as failure:');
    for (const o of incon) lines.push(`  ${o.id} ${o.name}: ${o.detail}`);
  }

  if (r.nextAction) {
    lines.push('', `Next: ${r.nextAction.id} ${r.nextAction.name} — ${r.nextAction.detail}`);
  }
  lines.push('', 'Record the missing evidence, or a waiver, then finish.');

  process.stderr.write(lines.join('\n') + '\n');
  process.exit(2);
}

main();
