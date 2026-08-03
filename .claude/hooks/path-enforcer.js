#!/usr/bin/env node
// path-enforcer.js — PreToolUse hook
// Enforces agent path boundaries from access-matrix.js
// Exit 0 = allow, Exit 2 = block (stderr is shown to the model)
//
// Agent identity comes from the hook payload's `agent_type` (subagent tool calls) or,
// failing that, the Active Agent recorded in .planning/STATE.md. `agent_type` is set by
// the harness, not the model, so it cannot be forged from inside a prompt.
//
// FAIL-OPEN POLICY — deliberate, and narrower than it used to be:
//   * No agent resolved  -> allow. The CTO working directly in the main loop is not an
//     agent and is never boundary-restricted.
//   * Payload unreadable -> allow. We cannot attribute the call to anyone.
//   * Payload TRUNCATED  -> BLOCK. Previously readStdin() resolved partial data at its
//     5s timeout, JSON.parse threw, data became null, and the call sailed through: the
//     same payload blocked at a 100ms stdin gap and passed at 6s. "Too slow to check"
//     must never mean "approved".
//   * Error while matching a resolved agent -> BLOCK. If we know an agent is acting and
//     we cannot verify the boundary, the safe answer is no.

const matrix = require('./lib/access-matrix.js');
const { isAllowed, normalizeAgentId } = matrix;
const { checkBashCommand } = require('./lib/bash-guard.js');
const { formatTOON } = require('./lib/toon-formatter.js');
const { parseHookInput, resolveAgent, isHookDisabled } = require('./lib/hook-input.js');

function deny(fields) {
  process.stderr.write(formatTOON('ACCESS DENIED', fields));
  process.exit(2);
}

async function main() {
  let agentName = '';
  try {
    if (isHookDisabled('path-enforcer')) process.exit(0);

    const { data, timedOut } = await parseHookInput(10000);

    if (timedOut) {
      deny({
        Agent: 'unknown',
        Reason: 'hook payload could not be read in full (stdin timeout) — blocking rather than approving an unverified call'
      });
    }
    if (!data) process.exit(0);

    const projectRoot = data.cwd || process.cwd();
    const toolName = data.tool_name || '';
    agentName = resolveAgent(data, projectRoot);
    if (!agentName) process.exit(0);

    // Bash carries `command`, not `file_path` — this branch is why `cat src/app.js`
    // walked past a boundary that blocked `Read src/app.js`.
    if (toolName === 'Bash') {
      const command = (data.tool_input && data.tool_input.command) || '';
      const verdict = checkBashCommand(command, agentName, matrix, projectRoot);
      if (!verdict.allowed) {
        deny({
          Agent: normalizeAgentId(agentName),
          Command: command.length > 120 ? command.slice(0, 117) + '...' : command,
          Path: verdict.path,
          Operation: verdict.op,
          Reason: verdict.reason,
          Note: 'Bash is checked on a best-effort path scan, not sandboxed'
        });
      }
      process.exit(0);
    }

    // `notebook_path` is the field NotebookEdit actually sends. Omitting it meant every
    // notebook edit hit the `!filePath` early-exit below and was allowed unconditionally,
    // including outside the project root. data-guard.js already reads the correct field,
    // which is exactly why the omission here went unnoticed.
    const ti = data.tool_input || {};
    const filePath = ti.file_path || ti.path || ti.notebook_path || '';
    if (!filePath) process.exit(0);

    // MultiEdit MUST be in this list. The settings matcher substring-matches it, so the
    // hook DID run — and then classified a bulk write as a READ, checking it against the
    // readable allowlist instead of the writable one. Five agents are defined as
    // read-anywhere with a deliberately narrow writable scope; for them this was a
    // write-anywhere bypass reachable from a nominally read-only role, and it could be
    // used to rewrite the access matrix or settings.json and disable the guards for good.
    const operation = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(toolName) ? 'write' : 'read';
    const result = isAllowed(agentName, filePath, operation, projectRoot);

    if (!result.allowed) {
      deny({
        Agent: normalizeAgentId(agentName),
        File: filePath,
        Operation: operation,
        Reason: result.reason
      });
    }

    process.exit(0);
  } catch (err) {
    // An error AFTER we know an agent is acting means we could not verify a boundary
    // that applies. Fail closed — a bug in this hook must not silently disable it.
    if (agentName) {
      deny({
        Agent: normalizeAgentId(agentName),
        Reason: `boundary check failed (${err && err.message}) — blocking rather than approving an unverified call`
      });
    }
    process.exit(0);
  }
}

main();
