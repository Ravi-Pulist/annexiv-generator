// adapters/claude-code.js — the runtime RMAD ships on. RMAD-22.
//
// Everything Claude-Code-specific belongs behind this boundary. The core decides
// completion; this only translates between the harness and the evidence store.

'use strict';

const record = require('../evidence/record.js');
const G = require('../code-graph.js');
const { residual } = require('../workflow/residual.js');

module.exports = {
  id: 'claude-code',

  // Declared honestly, including the one that is false.
  //
  // hasUsage is FALSE: token counts are not exposed to a hook. There is an older hook in
  // this framework that multiplies per-tool constants (Read: 1500, Write: 800) to produce
  // a token number, and declaring hasUsage true on that basis would make an estimate
  // indistinguishable from a measurement in the cost ledger.
  capabilities: {
    canBlockCompletion: true,   // TaskCompleted blocks on exit 2, stderr fed back
    canBlockTool: true,         // PreToolUse blocks on exit 2
    hasTranscript: false,       // no hook in this framework reads a transcript path
    hasUsage: false
  },

  /** Obligations to inject at session start — memory the harness supplies, not the agent. */
  onSessionStart(ctx) {
    const { root, taskId } = ctx || {};
    if (!root || !taskId) return { obligations: [] };
    try {
      const g = G.load(root);
      if (!g) return { obligations: [] };
      const r = residual(root, g, { taskId });
      return {
        obligations: (r.obligations || [])
          .filter((o) => o.state === 'unsatisfied' || o.state === 'inconclusive')
          .map((o) => ({ id: o.id, state: o.state, detail: o.detail }))
      };
    } catch {
      return { obligations: [] };
    }
  },

  /** One tool call becomes one evidence/cost row. Never throws into the harness. */
  onToolUse(evt) {
    const { root, tool, payloadBytes, wallMs, taskId, sessionId, agent } = evt || {};
    if (!root || !tool) return { recorded: false };
    try {
      record.recordCost(root, {
        taskId: taskId || null, sessionId: sessionId || null, agent: agent || null,
        tool, payloadBytes: payloadBytes || 0, toolCalls: 1, wallMs: wallMs || 0,
        source: 'toolcount'   // hasUsage is false, so nothing here claims a token count
      });
      return { recorded: true };
    } catch {
      return { recorded: false };
    }
  },

  /**
   * The product. Returns whether the runtime should allow the agent to finish.
   * The core computes the verdict; this only shapes it for the harness.
   */
  onCompletionAttempt(ctx) {
    const { root, taskId } = ctx || {};
    if (!root || !taskId) return { allow: true, reason: 'no governed task in scope' };
    let r;
    try {
      const g = G.load(root);
      if (!g) return { allow: true, reason: 'no index' };
      r = residual(root, g, { taskId });
    } catch (err) {
      // Allowing on error is deliberate: a gate that blocks when it crashes strands the
      // agent with no path forward, because it cannot satisfy a predicate that will not
      // run. doctor is responsible for catching a persistently broken gate.
      return { allow: true, reason: `predicate errored: ${err && err.message}` };
    }
    if (r.verdict === 'DONE') return { allow: true, reason: 'DONE', residual: r };
    const next = r.nextAction ? `  Next: ${r.nextAction.id} — ${r.nextAction.detail}` : '';
    return {
      allow: false,
      reason: `${r.verdict} (${r.evaluated}/${r.applicable} obligations evaluated, R=${r.R})${next}`,
      residual: r
    };
  },

  onShutdown() {
    try { G.closeAll(); } catch { /* nothing open */ }
    return { closed: true };
  }
};
