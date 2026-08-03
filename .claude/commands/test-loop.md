---
description: "Residual-driven change loop — impact-first, evidence-recorded, converges on a computed predicate instead of a retry counter"
argument-hint: "[scope] [--task <id>] [--diff <base>] [--max-iterations N] [--no-fix]"
---

You are running the change loop. It is **not** "run tests until green or five tries are up".
It converges on a **residual** — a number computed from evidence in the code graph — and it
stops when that number reaches zero, when it stops falling, or when it rises.

**Why the difference matters:** a retry counter cannot distinguish *"the job is finished"*
from *"we ran out of attempts"*. Both leave the same terminal state and a human has to read
the log to find out which. The residual makes that distinction machine-readable, and it
makes "done" something you can point at rather than assert.

## Ground rules — these outrank everything below

1. **Impact before edit.** Compute which tests guard the code *before* changing it. This is
   the single highest-measured intervention available here: graph-derived test context cut
   agent regressions by ~70%, while TDD *instructions* without that context made them
   **worse than doing nothing**. Context beats procedure — so fetch the context.
2. **Measure the baseline, never assume it.** A red baseline changes the mission: report it
   and ask whether to fix it first or record the failures as pre-existing. Never attribute
   a pre-existing failure to your own change, or vice versa.
3. **Never suppress.** Deleting a test, skipping a test, weakening an assertion, widening a
   type or silencing a linter to make the residual fall is forbidden. The residual may only
   fall because *evidence appeared*, never because an *obligation disappeared*.
4. **3 attempts per fix**, then revert that fix and record it unresolved. Grinding is not
   converging.
5. **A new test must be observed failing before the change.** A test that has never failed
   is not a test.

## Setup

```bash
rmad index build --root .              # incremental; seconds
```

If `rmad` is not on PATH, say so plainly and fall back to running the whole suite by hand —
the loop still works, it is just blind about which tests matter, and the report must say so.

## Step 1 — Impact, before you touch anything

```bash
rmad index impact --diff main          # or --staged, or a symbol name
```

Record: the changed symbols, the impacted test files, and the **ambiguous edge count**.

> That last number is not decoration. Fan-in under-reports by design — calls the resolver
> could not evidence are excluded rather than guessed — so the impacted set is a **floor**.
> Run it first for fast feedback; run the full suite before declaring anything done.

## Step 2 — Baseline, executed

```bash
npm test 2>&1 | rmad task baseline $TASK --oracle test --tap
```

Use the repo's own test command. `--tap` reads TAP, which is what `node --test` emits; for
other runners pass `--json '[{"subject":"...","value":"pass"}]'`.

## Step 3 — Test first

For each acceptance criterion in scope, write the failing test **and prove it fails** against
the current code. Record that observation. A criterion with no symbol mapping cannot be
machine-verified — map it with `rmad task criterion` or mark it explicitly untestable and
route it to a human. Do not let it pass silently.

## Step 4 — Implement

Minimal diff that fixes the root cause, inside the declared scope. Match the repo's existing
style, test framework and idiom — you are a guest.

## Step 5 — Observe

```bash
npm test 2>&1 | rmad task observe --kind test --task $TASK --tap
npm run lint 2>&1 | rmad task observe --kind lint --task $TASK --tap   # if the repo has one
```

## Step 6 — Measure

```bash
rmad task residual --task $TASK --diff main
```

Read the verdict, then act on the **six obligations**:

| | Obligation | If unsatisfied |
|---|---|---|
| **O1** | Criteria realised | Write the missing test, or map the criterion to symbols |
| **O2** | Blast radius covered | Cover the uncovered symbols, or waive with evidence |
| **O3** | No regression | **Highest weight.** Fix or revert — never rationalise |
| **O4** | No structural debt | You added a cycle or an orphan; undo it |
| **O5** | Scope respected | Widen scope at a gate, or revert the stray edit |
| **O6** | Observed running | `rmad task observe --kind smoke -- <the project's own run command>` |

### Termination — in priority order

| Condition | Action |
|---|---|
| `DONE` (R = 0, nothing inconclusive) | Exit. Report the evidence. |
| **R rose** since last iteration | **Revert the last change set** and escalate with the delta. Fixes are making it worse. |
| R unchanged twice | Escalate. It is structural, not a bug — re-plan rather than retry. |
| Same obligation unsatisfied 3× | Escalate as a design problem. |
| Iterations exhausted (default **4**) | Exit NOT DONE and report the residual honestly. |

The cap is 4 because self-correction saturates at 3–4 rounds. It is a safety net, not the
criterion — **the residual decides, the budget only stops runaway loops.**

### INCONCLUSIVE is not success

If `rmad task residual` reports obligations it could not check, the verdict is
`INCONCLUSIVE` and you have **not** finished. Supply the missing evidence — a baseline, a
symbol mapping, a snapshot — or record a waiver with a human approver. Never report an
unchecked obligation as a passed one; that converts an unknown risk into a false assurance,
which is worse than not having run the check.

## Report

```
## Change Loop — {scope}
**Verdict:** DONE | NOT DONE | INCONCLUSIVE | ESCALATED
**Task:** {id}   **Commit:** {sha}

| Iter | R | O1 | O2 | O3 | O4 | O5 | Action taken |
|------|---|----|----|----|----|----|--------------|

**Trend:** {falling / flat / rising — say which, plainly}

### Evidence
- Impacted tests selected: {n}  (ambiguous edges excluded: {n})
- Baseline: {n passing, n failing} at {sha}
- Tests added: {list, each with the commit where it was seen to fail first}

### Still open
{obligation, why, what would close it}

### Waivers
{what, why, who approved — or "none"}
```

A flat or rising trend across three iterations is **more valuable than any individual fix**
in the report. Say it in the first line.

$ARGUMENTS
