#!/usr/bin/env node
// cost-meter.js — PostToolUse hook. RMAD-02.
//
// Cost was the worst-scoring dimension in the audit — 1.0/5 — for the simple reason that
// no figure existed. HAL's headline is that agents "can be 100x more expensive while only
// being 1% better", Terminal-Bench 2.1 publishes dollars per run, and a framework that
// cannot state its own cost has no standing to claim efficiency.
//
// WHAT THIS RECORDS, AND WHAT IT REFUSES TO: tool name, wall-clock and payload bytes are
// directly observable here and are always written. TOKEN COUNTS ARE NOT AVAILABLE TO A
// HOOK, so they stay NULL and `source` is 'toolcount'. There is an existing hook in this
// framework that multiplies a per-tool constant (Read: 1500, Write: 800 …) to produce a
// token number; that is an estimate wearing a measurement's clothes, and this ledger will
// not do it. A NULL that reports as "unpriced" is worth more than a number nobody can
// defend.
//
// NEVER BLOCKS. This is instrumentation. A meter that can fail a tool call is a liability,
// so every path here exits 0.

'use strict';

function main() {
  let data = {};
  try {
    data = JSON.parse(require('fs').readFileSync(0, 'utf8') || '{}');
  } catch { process.exit(0); }

  if (process.env.RMAD_DISABLED_HOOKS && /cost-meter/.test(process.env.RMAD_DISABLED_HOOKS)) {
    process.exit(0);
  }

  const root = data.cwd || process.cwd();
  const tool = data.tool_name || data.tool || null;
  if (!tool) process.exit(0);

  // Payload size is a real, comparable quantity even when tokens are not: it is what the
  // model actually had to read and write. Measured in bytes and labelled as bytes.
  let payloadBytes = 0;
  try {
    payloadBytes = Buffer.byteLength(JSON.stringify(data.tool_input || {}), 'utf8') +
      Buffer.byteLength(String(data.tool_response || data.tool_output || ''), 'utf8');
  } catch { /* an unmeasurable payload is recorded as 0 bytes, not skipped */ }

  try {
    require('./lib/evidence/record.js').recordCost(root, {
      taskId: data.taskId || process.env.RMAD_TASK_ID || null,
      sessionId: data.session_id || data.sessionId || null,
      workflow: data.workflow || process.env.RMAD_WORKFLOW || null,
      agent: data.agent || null,
      tool,
      payloadBytes,
      toolCalls: 1,
      wallMs: Number(data.duration_ms || data.durationMs || 0) || 0,
      source: 'toolcount'
    });
  } catch (err) {
    // No evidence store in this repo — instrumentation is never load-bearing, so this
    // never blocks. It is not silent either: a meter that fails invisibly reports $0.
    if (process.env.RMAD_DEBUG) process.stderr.write(`[rmad] cost-meter: ${err && err.message}
`);
  }

  process.exit(0);
}

main();
