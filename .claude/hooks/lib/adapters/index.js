// adapters/index.js — the runtime boundary. RMAD-22.
//
// RMAD's differentiated core is already runtime-independent, and that was measured rather
// than assumed: of 31 files under lib/ and bin/, 27 carry no Claude Code coupling, and
// residual.js, code-graph.js, impact.js, store/db.js, evidence/record.js and erd/extract.js
// carry ZERO. External npm dependencies: none.
//
// This makes that property EXPLICIT AND TESTABLE rather than incidental. The core decides
// completion; an adapter only reports what a runtime did. Four methods, deliberately — a
// larger surface would pull orchestration into adapters, which is where framework churn
// lives.
//
// CAPABILITIES ARE LOAD-BEARING, NOT METADATA. A runtime that cannot block completion
// cannot enforce the predicate, and RMAD must SAY SO rather than silently degrade to
// advisory. A deployment that believes it is governed when it is not is the exact failure
// this framework exists to prevent.

'use strict';

/**
 * @typedef {object} Capabilities
 * @property {boolean} canBlockCompletion  can the runtime refuse an agent's attempt to stop?
 * @property {boolean} canBlockTool        can it refuse an individual tool call?
 * @property {boolean} hasTranscript       is a conversation transcript reachable?
 * @property {boolean} hasUsage            are token counts exposed?
 */

const REQUIRED_CAPABILITIES = ['canBlockCompletion', 'canBlockTool', 'hasTranscript', 'hasUsage'];
const REQUIRED_METHODS = ['onSessionStart', 'onToolUse', 'onCompletionAttempt', 'onShutdown'];

/** What each missing capability costs, so degradation is stated rather than discovered. */
const DEGRADATION = {
  canBlockCompletion: 'ADVISORY MODE — the verdict is recorded but cannot stop an agent finishing',
  canBlockTool: 'path and data guards are unenforced; they report without blocking',
  hasTranscript: 'no transcript-derived attribution; prompt_digest is omitted rather than faked',
  hasUsage: 'cost rows carry source=toolcount and usd NULL — never rendered as 0'
};

function validate(adapter) {
  const problems = [];
  if (!adapter || typeof adapter !== 'object') return ['adapter is not an object'];
  if (!adapter.id) problems.push('missing id');
  for (const m of REQUIRED_METHODS) {
    if (typeof adapter[m] !== 'function') problems.push(`missing method ${m}()`);
  }
  const caps = adapter.capabilities;
  if (!caps || typeof caps !== 'object') problems.push('missing capabilities');
  else {
    for (const c of REQUIRED_CAPABILITIES) {
      if (typeof caps[c] !== 'boolean') {
        // Undeclared is not the same as false, and must not be silently read as either:
        // an adapter that omits a capability has not been asked the question.
        problems.push(`capability ${c} must be declared true or false, got ${typeof caps[c]}`);
      }
    }
  }
  return problems;
}

/** Human-readable consequences of whatever this adapter cannot do. */
function degradations(adapter) {
  const caps = (adapter && adapter.capabilities) || {};
  return REQUIRED_CAPABILITIES.filter((c) => caps[c] === false)
    .map((c) => ({ capability: c, consequence: DEGRADATION[c] }));
}

const registry = new Map();

function register(adapter) {
  const problems = validate(adapter);
  if (problems.length) {
    throw new Error(`adapter "${(adapter && adapter.id) || '?'}" is not conformant: ${problems.join('; ')}`);
  }
  registry.set(adapter.id, adapter);
  return adapter;
}

function get(id) { return registry.get(id) || null; }
function list() { return [...registry.values()]; }

/**
 * Which adapter is running. Defaults to claude-code because that is what ships; the
 * variable exists so a conformance run can drive the same core through another one.
 */
function active() {
  const id = process.env.RMAD_ADAPTER || 'claude-code';
  const a = registry.get(id);
  if (a) return a;
  throw new Error(`no adapter registered as "${id}" — registered: ${[...registry.keys()].join(', ') || 'none'}`);
}

module.exports = {
  REQUIRED_CAPABILITIES, REQUIRED_METHODS, DEGRADATION,
  validate, degradations, register, get, list, active, registry
};
