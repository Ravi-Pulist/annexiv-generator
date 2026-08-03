#!/usr/bin/env node
// egress-guard.js — PreToolUse hook. RMAD-11, the non-architectural half.
//
// Answers one question about a tool call: WHERE is it allowed to talk to? path-enforcer
// owns which files an agent touches, data-guard owns whether a payload carries a secret.
// Neither looked at the destination on its own, so an agent could post anything it was
// legitimately holding to anywhere it liked.
//
// Ships in `warn` mode. It reports every destination it sees and marks the ones a policy
// would refuse, WITHOUT refusing them. Two reasons, and the second is the real one:
//   - A control that breaks `npm install` on day one is switched off on day one.
//   - The survey's top mark on enforcement requires a published denylist FAILURE RATE.
//     You get that by running in warn mode across real work and reading the ledger. Turning
//     on `enforce` before you have that list is how you end up with a policy nobody trusts.
//
// Flip `mode` to `enforce` in .egress-policy.json when the warn ledger has stopped
// surprising you. Exit 2 blocks; exit 0 with additionalContext advises.
//
// This is NOT a sandbox. See lib/security/egress.js for what that distinction costs.

const fs = require('fs');
const path = require('path');
const { formatTOON } = require('./lib/toon-formatter.js');
const { isHookDisabled, emitAdditionalContext, parseHookInput } = require('./lib/hook-input.js');
const egress = require('./lib/security/egress.js');

const POLICY_PATH = path.join(__dirname, '.egress-policy.json');

function loadPolicy() {
  if (!fs.existsSync(POLICY_PATH)) return { policy: egress.normalizePolicy({}), error: null };
  try {
    return { policy: egress.normalizePolicy(JSON.parse(fs.readFileSync(POLICY_PATH, 'utf8'))), error: null };
  } catch (err) {
    // A policy file that does not parse must not silently disable the control. Fall back to
    // the shipped default and say so — the same rule data-guard learned.
    return { policy: egress.normalizePolicy({}), error: err.message };
  }
}

function rows(findings) {
  return findings.map((f) => ({
    destination: f.host || '(unreadable)',
    via: f.via,
    verdict: f.verdict,
    reason: f.reason
  }));
}

async function main() {
  try {
    if (isHookDisabled('egress-guard')) process.exit(0);

    const { policy, error } = loadPolicy();
    if (policy.mode === 'off' && !error) process.exit(0);

    const { data, timedOut } = await parseHookInput(10000);
    // Unlike data-guard, a truncated payload here does NOT block. data-guard's job is to
    // stop a leak it cannot see; this one's job is to name a destination, and blocking
    // every tool call because stdin was slow would take the harness down. Say it, allow it.
    if (timedOut || !data) {
      if (timedOut) {
        emitAdditionalContext('PreToolUse',
          '[RMAD egress-guard] hook payload truncated — this call\'s destination was NOT checked.');
      }
      process.exit(0);
    }

    const result = egress.check(data.tool_name || '', data.tool_input || {}, policy);

    if (error) {
      emitAdditionalContext('PreToolUse',
        `[RMAD egress-guard] .egress-policy.json is unparseable (${error}) — running on the shipped default allowlist, not yours.`);
    }

    if (result.decision === 'allow') process.exit(0);

    if (result.decision === 'block') {
      process.stderr.write(formatTOON('EGRESS — BLOCKED', rows(result.offending)));
      process.stderr.write(
        '\nPolicy mode is `enforce`. To permit this destination, add it to `allow` in ' +
        '.claude/hooks/.egress-policy.json — deliberately, naming why in the commit.\n'
      );
      process.exit(2);
    }

    // warn — the ledger entry. stderr for the human trail, additionalContext for the model.
    process.stderr.write(formatTOON('EGRESS — WOULD DENY (mode: warn)', rows(result.offending)));
    const names = result.offending.map((f) => f.host || `(unreadable: ${f.via})`).join(', ');
    emitAdditionalContext('PreToolUse',
      `[RMAD egress-guard] This call reaches ${names}, which the egress policy does not allow. ` +
      'Mode is `warn`, so it proceeds. If the destination is legitimate, add it to ' +
      '.claude/hooks/.egress-policy.json; if it is not, stop and use an allowed source.');
    process.exit(0);
  } catch {
    // A guard that crashes must not strand the harness. Same stance as the completion gate.
    process.exit(0);
  }
}

if (require.main === module) main();

module.exports = { loadPolicy, POLICY_PATH };
