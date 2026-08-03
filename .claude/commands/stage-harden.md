---
description: "Stage 4 — iterative hardening: full verification passes over the whole build until an iteration comes back CLEAN"
---

You are running Stage 4 of the RMAD pipeline: hardening by iteration. The whole project is put through repeated full verification passes — each pass a fresh look at everything — fixing what's found, until an iteration produces zero blocking findings. The record lives in `.planning/quality/HARDENING-LOG.md` (from the hardening-log template).

**You are the orchestrator, not the reviewer.** Quinn, Kai, Vera and Tara are **subagents you spawn with the Task tool**, and the fixes are dispatched to engineer subagents. You run the loop, own the Hardening Log, and decide the verdict. You never review the build yourself and you never write a finding on a reviewer's behalf.

This is the whole point of the stage. "Adversarial review with fresh eyes" is only real if the reviewing context is genuinely new — you cannot instruct a context window to forget the code it just wrote, and a review that inherits the builder's assumptions inherits the builder's blind spots. Spawning the subagent IS the fresh eyes. Narrating one is a costume change.

## The iteration (each one, in order)
0. **Static gate** — lint + typecheck across the tree. A build that doesn't lint doesn't get an iteration number.
1. **Test suite** — run everything (`/test-loop` if failures need fixing). Record totals.
2. **Goal-backward verification** — `/verify-work` per story (or per epic for large projects). SUMMARY claims don't count; only codebase evidence.
3. **Adversarial review pass with fresh eyes** — **spawn NEW reviewer subagents this iteration** (see *Dispatching the review pass* below). Quinn (code quality) + Kai (security) review AS IF SEEING THE CODE FIRST TIME — they hunt for what the build agents missed, not confirm what they did. Vera joins whenever regulated data is in play. Sample breadth over depth: every module gets looked at, the riskiest (per spec §10) get depth.
4. **Fix** — apply Deviation Rules. Severity triage: CRITICAL/HIGH fixed this iteration; MEDIUM/LOW fixed or explicitly deferred with CTO sign-off. Architectural findings go to `/refine tech-spec`, never patched around. Dispatch each fix to the engineer subagent who owns that surface — `soren-backend`, `milo-frontend`, `lena-integration`, `anya-data`, `ravi-devops` — serially per file (two agents editing one file is a lost afternoon), concurrently across independent files. **Reviewers never fix their own findings**: they have no Write tool, and a reviewer who fixes is a reviewer invested in the fix.
5. **Regression check** — anything that passed last iteration and fails now is a regression: automatic DIRTY, root-cause it.
6. **Verdict** — CLEAN requires: all tests pass, all verify-work PASS, zero unfixed CRITICAL/HIGH, zero regressions, per the bar defined in Tech Spec §8.

## Dispatching the review pass (step 3)

**Spawn the reviewers in ONE message (multiple Task calls in a single block) so they run concurrently.** Their lenses are independent — nothing Quinn finds changes what Kai should look for.

| Reviewer | `subagent_type` | Lens | When |
|----------|-----------------|------|------|
| Quinn — QA Lead (white box) | `quinn-qa` | Correctness, maintainability, coverage, complexity, dead branches | Every iteration |
| Kai — Security Engineer | `kai-security` | OWASP Top 10, authz gaps, secrets, data exposure, dependency CVEs | Every iteration |
| Vera — Compliance Analyst | `vera-compliance` | Unlogged sensitive-data access, retention/consent, PHI/PCI in logs, audit trail | Whenever regulated data is in play |

**Fresh eyes are a mechanism, not an instruction.** Each iteration spawns NEW subagents, and their prompts are built from the build's current state only:

- **Never pass a reviewer the previous iteration's findings**, the Hardening Log, the fix list, what was already deferred, or any form of "we already looked at this / this was fixed in iteration 2". A reviewer who inherits last iteration's conclusions is running confirmation, not review — and confirmation is exactly what a hardening loop cannot detect from the inside.
- The Hardening Log is **yours**. It is the stage artifact and the dedupe ledger; reviewers never see it.
- Each reviewer gets: the scope (every module, with the spec §10 risk rank so depth lands on the riskiest), the stack fingerprint, the repo's conventions, and this brief verbatim: *"Iteration N of a fresh-eyes hardening review. Assume the build is broken in a way previous reviewers missed. Report only what you can prove with `file:line` evidence and a concrete failure scenario — inputs → wrong behavior."*
- If the same finding comes back in iteration N+1, that is **signal, not noise** — it means the fix didn't take or the reviewers keep hitting the same structural edge. Dedupe against the log yourself (step 4/step 5), never by warning the reviewer off.

**Quinn and Kai have no Write tool** (`tools: [Read, Bash, Grep, Glob]`) — deliberately. They return structured findings as text; **you** record them in the Hardening Log. Never ask a reviewer to write a file.

You own severity normalization: the reviewers propose, you decide. Downgrade anything whose failure scenario is hypothetical — a finding with no reachable caller is LOW at most. This matters here more than anywhere else in the pipeline: inflated severities make an iteration look DIRTY forever and the CLEAN gate never opens.

## Iteration discipline
- Log every iteration in the Hardening Log (index row + full section) — the log IS the stage artifact.
- Fixes found in iteration N are only "proven" by iteration N+1 seeing them hold — that's why the gate needs a CLEAN iteration, not a fixed-up dirty one.
- Targeted re-runs (just the fixed area) are allowed mid-iteration but never count as CLEAN.
- **Stall rule:** if the same finding class survives 3 iterations, or iteration N finds MORE criticals than N-1, stop and escalate to the CTO with the pattern — grinding isn't converging. Hard cap: `max_iterations` (default 10), then it's a CTO decision, not another loop.
- **Stubborn blocker option:** for a defect that survives two fix attempts, generate 2-3 independent fix candidates (worktree-isolated), select by reproduction + regression tests — cheaper than serial retry.
- Default gate: 2 consecutive CLEAN iterations (`clean_iterations_required` in the log frontmatter; 1 is acceptable for low-stakes work, raise for regulated releases).

## Full-ceremony additions (pipeline.flow: full, or regulated domains)
Produce the deep audit artifacts alongside: quality-report (Quinn), e2e-test-report (Tara), security-audit (Kai), compliance-audit (Vera). Each comes from a real subagent — `quinn-qa`, `tara-blackbox`, `kai-security`, `vera-compliance` — spawned for that audit; **you write the artifacts from what they return**, because Quinn and Kai cannot write files at all. Tara (`subagent_type: tara-blackbox`) works with NO source access by design: she is the only reviewer not anchored by having read the implementation, so give her the docs, contracts, and the running app — never the source or the other reviewers' findings.

## Report per iteration
```
## Hardening iteration {N}: {CLEAN | DIRTY}
Tests: {pass}/{total} | Verify: {pass}/{stories} | Findings: {C}/{H}/{M}/{L} | Regressions: {n}
{DIRTY → what's being fixed and by whom; CLEAN → gate status}
Next: {another iteration | /approve hardening-log → Stage 5 (ship)}
```

A reviewer subagent that failed or returned nothing makes the iteration **incomplete, not CLEAN** — record it as NOT RUN with the reason and re-dispatch. An iteration is never CLEAN because a review didn't happen.

$ARGUMENTS
