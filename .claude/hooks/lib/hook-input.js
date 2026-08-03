// hook-input.js
// Shared utilities for RMAD hooks: stdin parsing, agent resolution,
// runtime disable flags, JSON hook output, and the context bridge.
//
// Claude Code hook payloads do NOT carry a `session.agent_name` field.
// The real agent identity fields are top-level `agent_type` / `agent_id`,
// present only when the tool call runs inside a subagent. When absent,
// the acting agent is resolved from .planning/STATE.md (Active Agent),
// which RMAD commands keep up to date.

const fs = require('fs');
const path = require('path');

const DISABLE_ENV = 'RMAD_DISABLED_HOOKS';
const BRIDGE_REL = path.join('.planning', '.context-bridge.json');

// Resolves { raw, timedOut }. The timeout is NOT a normal completion path: hitting it
// means stdin was still open, so `raw` is whatever arrived so far — almost certainly a
// truncated JSON document. Callers must distinguish "no payload" (nothing to check) from
// "partial payload" (we were denied the chance to check). Previously both collapsed into
// data:null, so a payload that arrived slowly enough was silently approved by the
// security hooks — verified: the same call blocked at a 100ms stdin gap and passed at 6s.
function readStdin(timeoutMs = 3000) {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = (timedOut) => {
      if (!done) {
        done = true;
        resolve({ raw: data, timedOut: Boolean(timedOut) && data.length > 0 });
      }
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => finish(false));
    process.stdin.on('error', () => finish(false));
    setTimeout(() => finish(true), timeoutMs).unref();
  });
}

// Returns { raw, data, timedOut }.
//   data === null && !timedOut  -> no/unparseable payload; caller decides (usually allow)
//   timedOut === true           -> payload truncated mid-read; security hooks must NOT allow
async function parseHookInput(timeoutMs) {
  const { raw, timedOut } = await readStdin(timeoutMs);
  if (!raw) return { raw: '', data: null, timedOut: false };
  try {
    return { raw, data: JSON.parse(raw), timedOut: false };
  } catch {
    return { raw, data: null, timedOut };
  }
}

// Runtime hook gating without editing settings.json:
//   RMAD_DISABLED_HOOKS=data-guard,notifier node ...
function isHookDisabled(hookName) {
  const raw = process.env[DISABLE_ENV] || '';
  if (!raw) return false;
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(String(hookName).toLowerCase());
}

// Resolve the acting agent id. Order of trust:
//   1. `agent_type` — real Claude Code field (subagent tool calls)
//   2. `session.agent_name` — legacy payload shape (kept for back-compat)
//   3. Active Agent in .planning/STATE.md
// Returns '' when nothing resolves so callers can fail open.
function resolveAgent(data, cwd) {
  if (data && typeof data.agent_type === 'string' && data.agent_type.trim()) {
    return data.agent_type.trim();
  }
  if (data && data.session && typeof data.session.agent_name === 'string' && data.session.agent_name.trim()) {
    return data.session.agent_name.trim();
  }
  try {
    const statePath = path.join(cwd || process.cwd(), '.planning', 'STATE.md');
    if (fs.existsSync(statePath)) {
      const state = fs.readFileSync(statePath, 'utf8');
      const section = state.match(/## Active Agent\s*\n([\s\S]*?)(?=\n## |$)/);
      const scope = section ? section[1] : state;
      const m = scope.match(/- Name: (.+)/);
      if (m) {
        const name = m[1].trim();
        if (name && name.toLowerCase() !== 'none' && name !== '—') return name;
      }
    }
  } catch { /* fail open */ }
  return '';
}

function emitJson(obj) {
  try {
    process.stdout.write(JSON.stringify(obj));
  } catch { /* never crash a hook on output */ }
}

// Non-blocking message the MODEL actually sees.
// stderr on exit 0 is ignored by Claude Code; hookSpecificOutput.additionalContext is not.
function emitAdditionalContext(hookEventName, text) {
  if (!text) return;
  emitJson({
    hookSpecificOutput: {
      hookEventName,
      additionalContext: text,
    },
  });
}

// Context bridge — .planning/.context-bridge.json is written by statusline.js
// from real harness data (context_window.used_percentage, model, cost) and read
// by context-intelligence.js so advisories reflect actual context pressure
// instead of per-tool token guesses.
function readContextBridge(cwd, maxAgeMs = 10 * 60 * 1000) {
  try {
    const p = path.join(cwd || process.cwd(), BRIDGE_REL);
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (typeof data.updatedAt === 'string') {
      const age = Date.now() - Date.parse(data.updatedAt);
      if (!Number.isFinite(age) || age > maxAgeMs) return null;
    }
    return data;
  } catch {
    return null;
  }
}

function writeContextBridge(cwd, payload) {
  try {
    const p = path.join(cwd || process.cwd(), BRIDGE_REL);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ ...payload, updatedAt: new Date().toISOString() }, null, 2));
  } catch { /* bridge is best-effort */ }
}

module.exports = {
  DISABLE_ENV,
  readStdin,
  parseHookInput,
  isHookDisabled,
  resolveAgent,
  emitJson,
  emitAdditionalContext,
  readContextBridge,
  writeContextBridge,
};
