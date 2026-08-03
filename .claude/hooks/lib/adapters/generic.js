// adapters/generic.js — a runtime that cannot block. RMAD-22.
//
// This is not a toy. It is the shape of every runtime that has no completion hook: a CI
// job, a plain OpenAI-compatible agent loop, a batch harness. RMAD still computes the same
// verdict there — that is the whole runtime-independence claim — but it CANNOT ENFORCE it,
// and the difference has to be visible rather than inferred.
//
// It also makes the conformance suite mean something. One adapter passing its own suite
// proves nothing; two adapters that must return an identical verdict prove the core does
// not depend on either.

'use strict';

const G = require('../code-graph.js');
const { residual } = require('../workflow/residual.js');

module.exports = {
  id: 'generic',

  capabilities: {
    canBlockCompletion: false,  // no completion hook: the verdict is advice
    canBlockTool: false,        // no pre-tool interception
    hasTranscript: false,
    hasUsage: false
  },

  onSessionStart() {
    // Nothing to inject: a runtime with no session hook has no cue to inject on. Returning
    // an empty list is honest; pretending to inject would be worse than not injecting.
    return { obligations: [] };
  },

  onToolUse() {
    return { recorded: false, reason: 'this runtime does not surface tool calls' };
  },

  onCompletionAttempt(ctx) {
    const { root, taskId } = ctx || {};
    if (!root || !taskId) return { allow: true, reason: 'no governed task in scope' };
    let r;
    try {
      const g = G.load(root);
      if (!g) return { allow: true, reason: 'no index' };
      r = residual(root, g, { taskId });
    } catch (err) {
      return { allow: true, reason: `predicate errored: ${err && err.message}` };
    }
    // The verdict is IDENTICAL to the Claude Code adapter's — same core, same inputs. What
    // differs is only that `allow` is always true here, because this runtime has no way to
    // act on it. Reporting allow:false would claim an enforcement that does not exist.
    return {
      allow: true,
      advisory: true,
      verdict: r.verdict,
      reason: r.verdict === 'DONE'
        ? 'DONE'
        : `${r.verdict} (${r.evaluated}/${r.applicable} evaluated, R=${r.R}) — ADVISORY, this runtime cannot block`,
      residual: r
    };
  },

  onShutdown() {
    try { G.closeAll(); } catch { /* nothing open */ }
    return { closed: true };
  }
};
