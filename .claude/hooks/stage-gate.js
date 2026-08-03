#!/usr/bin/env node
// stage-gate.js — UserPromptSubmit hook
// Makes the pipeline gate MECHANICAL: a stage command cannot run until the upstream
// stage's core artifact carries `status: approved` in its frontmatter.
//
// WHY: the 5-stage pipeline documented gates in prose and enforced none of them. Every
// stage command opened with a sentence asking the model to stop if the upstream artifact
// wasn't approved — but the model evaluating that gate is the same model that wants to
// pass through it. Auditing the hooks for `approve|gate|stage` returned four hits, all
// cosmetic (statusline display). That is not a gate; it is a suggestion with good posture.
//
// WHY UserPromptSubmit: PreToolUse fires on tool calls, and a slash command is not a tool
// call — no PreToolUse hook can ever see `/stage-spec`. UserPromptSubmit sees the raw
// prompt before the model does, and `decision: "block"` stops the turn with a reason the
// model reads. It is the only event in the harness that can gate a command.
//
// FAIL-OPEN, deliberately: if .planning/ is absent, config is unreadable, or the prompt
// isn't a stage command, this hook says nothing. It gates ONE thing and gates it hard.

const fs = require('fs');
const path = require('path');
const { parseHookInput, isHookDisabled, emitJson } = require('./lib/hook-input.js');

// stage command -> the upstream artifact that must be approved before it may run.
// Stage 1 has no upstream: knowledge is where the pipeline starts.
const GATES = {
  '/stage-spec': {
    upstream: '.planning/knowledge/KNOWLEDGE-BASE.md',
    upstreamName: 'Knowledge Base',
    approveWith: '/approve knowledge-base'
  },
  '/stage-build': {
    upstream: '.planning/spec/TECH-SPEC.md',
    upstreamName: 'Tech Spec',
    approveWith: '/approve tech-spec'
  },
  '/stage-harden': {
    upstream: '.planning/artifacts/implementation-summary.md',
    upstreamName: 'Implementation Summary',
    approveWith: '/approve implementation-summary'
  },
  '/stage-ship': {
    upstream: '.planning/quality/HARDENING-LOG.md',
    upstreamName: 'Hardening Log',
    approveWith: '/approve hardening-log'
  }
};

function frontmatterStatus(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const fm = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const m = fm[1].match(/^status:\s*["']?([a-z-]+)["']?\s*$/im);
  return m ? m[1].toLowerCase() : null;
}

function countClarifications(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return (raw.match(/\[NEEDS-CLARIFICATION/gi) || []).length;
}

function block(reason) {
  // decision:"block" is the only UserPromptSubmit channel that actually stops the turn.
  emitJson({
    decision: 'block',
    reason,
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: reason }
  });
  process.exit(0);
}

async function main() {
  try {
    if (isHookDisabled('stage-gate')) process.exit(0);

    const { data } = await parseHookInput(5000);
    if (!data) process.exit(0);

    const prompt = String(data.prompt || '').trim();
    const cwd = data.cwd || process.cwd();

    // Only ever look at a prompt that STARTS with a gated stage command.
    const cmd = Object.keys(GATES).find((c) => new RegExp(`^${c}(\\s|$)`).test(prompt));
    if (!cmd) process.exit(0);

    // Not an RMAD project — nothing to gate.
    if (!fs.existsSync(path.join(cwd, '.planning'))) process.exit(0);

    // An explicit, RECORDED override. The CTO owns the pipeline and can always force a
    // stage — but it has to be said out loud and written down.
    //
    // This used to be `/--force|approve anyway/i.test(prompt)`, which matched anywhere in
    // the prompt and recorded nothing. Four ways that opened the gate by accident:
    //   /stage-build the payments module — do not --force anything in git
    //   /stage-build — I would not approve anyway until we discuss
    //   /stage-harden <pasted CI log containing `git push --force`>
    //   /stage-ship --force-with-lease
    // The last two are the worst: pasted content and an unrelated git flag. Expressing
    // REFUSAL satisfied the old check. So the token is now distinct from anything that
    // appears in ordinary git talk, anchored to the END of the prompt so pasted content
    // cannot reach it, and it must carry a reason.
    const override = /(?:^|\s)--force-gate=(\S+)\s*$/.exec(prompt);
    if (override) {
      try {
        require('./lib/evidence/record.js')
          .recordOverride(cwd, { gate: cmd, reason: override[1], prompt });
      } catch {
        // The evidence store may be absent in a project that has never run `rmad index`.
        // An unrecordable override still proceeds — the operator asked explicitly — but
        // it must not be silent, so it goes to stderr where the transcript keeps it.
        process.stderr.write(
          `[rmad] gate override ${cmd} (${override[1]}) could not be recorded to the evidence store\n`
        );
      }
      process.exit(0);
    }

    const gate = GATES[cmd];
    const upstreamPath = path.join(cwd, gate.upstream);

    if (!fs.existsSync(upstreamPath)) {
      block(
        `GATE: ${cmd} is blocked — the ${gate.upstreamName} does not exist yet (${gate.upstream}).\n` +
        `Stages read APPROVED upstream artifacts, never a previous session's chat.\n` +
        `Produce it first, then ${gate.approveWith}. Override with --force-gate=<reason> if you mean to skip the gate.`
      );
    }

    const status = frontmatterStatus(upstreamPath);
    if (status !== 'approved') {
      const clarifications = countClarifications(upstreamPath);
      block(
        `GATE: ${cmd} is blocked — ${gate.upstream} has status: ${status || '(none)'}, not approved.\n` +
        (clarifications > 0
          ? `It still carries ${clarifications} [NEEDS-CLARIFICATION] marker(s) — each is a question the CTO has not answered.\n`
          : '') +
        `Agents never self-approve. Refine it (/refine, /elicit), then ${gate.approveWith}.\n` +
        `Run /gate-check to see what blocks. Override with --force-gate=<reason> if you mean to skip the gate.`
      );
    }

    // Approved but still ambiguous: a marker that survives approval is a hole in the
    // contract the whole downstream stage is about to be built on.
    const clarifications = countClarifications(upstreamPath);
    if (clarifications > 0) {
      block(
        `GATE: ${cmd} is blocked — ${gate.upstream} is approved but still contains ` +
        `${clarifications} [NEEDS-CLARIFICATION] marker(s). Ambiguity cannot pass a gate.\n` +
        `Resolve them with /refine, or override with --force-gate=<reason>.`
      );
    }

    process.exit(0);
  } catch {
    // A broken gate must never brick the session — a stage command is not a security
    // boundary, it is a workflow step. Fail open and stay quiet.
    process.exit(0);
  }
}

main();
