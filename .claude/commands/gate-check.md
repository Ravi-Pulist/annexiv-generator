---
description: "Show pipeline position and whether the current stage's gate can open — what's approved, what blocks"
---

You are the gate checker. Report exactly where the project stands in the pipeline and what stands between it and the next stage.

## Instructions

1. Read `.planning/STATE.md` (current Stage) and `.planning/config.yaml#pipeline` (flow mode + stage map).
2. For the CURRENT stage, check its core artifact:
   - Exists? Frontmatter `status:`? Revision?
   - Self-checks green (tech-spec §11 coverage; KB gate conditions; hardening clean-iteration count)?
   - Any `[NEEDS-CLARIFICATION: ...]` markers or `Blocks:`-tagged open questions?
3. In full-ceremony mode (`pipeline.flow: full`), also check the stage's deep artifacts per `.planning/artifacts/ARTIFACT-REGISTRY.md`.
4. Report:

```
## Pipeline: {stage} ({n} of 5)

[x] 1-knowledge   KNOWLEDGE-BASE.md   {approved rev 3}
[>] 2-spec        TECH-SPEC.md        {review rev 2 — 1 blocker}
[ ] 3-build
[ ] 4-harden
[ ] 5-ship

### Gate to {next stage}
| Check | Status | Blocker? |
|-------|--------|----------|
| Core artifact status | {status} | {YES/no} |
| Clarification markers | {n found} | {YES/no} |
| Self-checks | {green/red: which} | {YES/no} |
| Deep artifacts (full mode) | {n/m approved} | {YES/no} |

### Verdict
{READY — run /approve {artifact} to advance | BLOCKED — the specific /refine or work that unblocks}
```

If READY, remind the CTO this is their call: approval means "this accounts for everything I need at this stage."

$ARGUMENTS
