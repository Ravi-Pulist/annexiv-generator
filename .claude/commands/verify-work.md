---
description: "Goal-backward verification — prove the built thing satisfies the story/phase goals from codebase evidence, not from summaries"
---

You are running goal-backward verification. Your stance is adversarial: assume "tasks completed, goal missed" until the codebase proves otherwise. Implementation summaries and checked-off tasks document what an agent SAID it did — they are claims, not evidence. Verify only against what exists and runs.

## Arguments
$ARGUMENTS is a story ID (e.g., `S1-001`), a sprint (e.g., `sprint-1`), or empty (verify the active story from `.planning/STATE.md`).

## Step 1: Derive Must-Haves (from the goal, not the plan)
Read the story's acceptance criteria (and the phase gate artifacts if verifying a sprint). Derive three levels:

1. **Truths** — observable behaviors that must hold ("a user with an expired token gets 401", "the EDI 850 parser rejects a missing ISA segment")
2. **Artifacts** — files that must exist and be substantive (not stubs): source, tests, migrations, docs
3. **Key Links** — wiring that must connect (route registered → handler → service → schema; frontend calls the real endpoint, not a mock)

## Step 2: Verify Each Level Against the Codebase
- **Artifacts:** existence is NOT enough. Open each one; a file with TODOs, empty functions, or hardcoded returns is a FAIL for the truth it supports.
- **Key Links:** trace the wiring by reading the code — imports resolve, routes are registered, the config is actually loaded.
- **Truths:** run things. Execute the test suite; where feasible, exercise the behavior directly (curl the endpoint, run the CLI, execute the migration against a scratch DB). Read a test before crediting it — a test that mocks away the behavior under verification proves nothing.

## Step 3: Classify Findings
- **BLOCKER** — a truth fails or a key link is missing. The goal is not met.
- **WARNING** — the goal is met but with debt (thin tests, unhandled edge case, doc gap).
- Never use "UNCERTAIN" as an escape hatch: if you could not verify something, say exactly what you would need to run to verify it, and mark it BLOCKER if it guards an acceptance criterion.

## Step 4: Report

```
## Verification: {story-id | sprint}

**Verdict:** {PASS | FAIL — N blockers}

### Truths
| # | Expected behavior | Evidence | Status |
|---|-------------------|----------|--------|
| 1 | {behavior} | {test run / trace / execution result} | PASS/FAIL |

### Artifacts
| File | Substantive? | Supports |
|------|--------------|----------|

### Key Links
| From → To | Verified how | Status |

### Blockers
1. {what is broken, file:line, and the minimal fix}

### Warnings
- {debt item} → log to deferred-items or fix now (CTO call)
```

Update the story status: PASS → `DONE` (or `REVIEW` if warnings need a CTO call), FAIL → back to `IN PROGRESS` with blockers listed in the story's Dev Notes. Update `.planning/STATE.md`.

$ARGUMENTS
