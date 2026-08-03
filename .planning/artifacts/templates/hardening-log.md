---
artifact: hardening-log
stage_gate: "4-harden → 5-ship"
producer: quinn-qa
contributors: [tara-blackbox, kai-security, vera-compliance]
reviewers: [cto]
status: draft
clean_iterations_required: 2
max_iterations: 10
created: ""
last_updated: ""
approved_by: ""
approved_date: ""
---

# Hardening Log

> Stage 4 record: the project is put through full verification iterations —
> each one a fresh pass over the whole build — until an iteration comes back
> CLEAN. Fixes between iterations follow the Deviation Rules; architectural
> changes go back to the Tech Spec (new revision), not around it.
>
> CLEAN iteration = all tests pass + `/verify-work` PASS on every story +
> review pass yields zero CRITICAL/HIGH findings + no regression against the
> previous iteration. The bar is defined in Tech Spec §8.
>
> The gate needs CONSECUTIVE clean iterations (default 2 — one clean pass can be
> luck; two independent fresh-context passes is signal; drop to 1 for low-stakes
> work). Hard cap: max_iterations, then escalate to the CTO instead of grinding.

## Iteration Index
| # | Date | Scope | Tests | Verify | Review findings (C/H/M/L) | Regressions | Verdict |
|---|------|-------|-------|--------|---------------------------|-------------|---------|
| 1 | | full | 0/0 | — | 0/0/0/0 | — | CLEAN/DIRTY |

---

## Iteration N
### Scope
> full | targeted ({modules}) — targeted iterations never count toward the gate.

### 1. Test Suite
> Command, totals, failures with root cause.

### 2. Goal-Backward Verification (/verify-work)
> Story-by-story verdicts; blockers found.

### 3. Adversarial Review Pass
> Fresh-context review (Quinn + Kai; Vera when regulated data is in play).
> Findings with severity, file:line, and disposition (fixed now / deferred with CTO sign-off).

### 4. Fixes Applied
| Finding | Fix | Files | Deviation rule used |
|---------|-----|-------|---------------------|

### 5. Regression Check
> Anything that passed in iteration N-1 and fails now is a regression — automatic DIRTY.

### Verdict: {CLEAN | DIRTY — reasons}

---

## Gate Summary
- Consecutive clean iterations: {n} / {clean_iterations_required}
- Deferred findings accepted by CTO: {list or none}
- Quality/security/compliance audit artifacts (full-ceremony mode): {refs or n/a}

## Sign-off
| Reviewer | Status | Date | Notes |
|----------|--------|------|-------|
