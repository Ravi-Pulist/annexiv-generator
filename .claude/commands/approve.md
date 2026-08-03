---
description: "CTO sign-off — approve an artifact, and when the stage's core artifact is approved, advance the pipeline stage"
---

You are recording a CTO approval. Approval is the only way an artifact reaches `approved` status and the only way the pipeline advances a stage — agents never self-approve.

## Arguments
`$ARGUMENTS` = artifact path/name (defaults to the current stage's core artifact per `.planning/STATE.md`).

## Step 1: Pre-approval check (protect the CTO from a hollow sign-off)
Before recording anything, verify the artifact is actually approvable:
- Zero `[NEEDS-CLARIFICATION: ...]` markers remain in the artifact — each one is a question the CTO hasn't answered yet; surface them as the blocking list.
- Its self-checks pass (tech-spec §11 Coverage Check all green; KB gate conditions met; hardening log shows the required clean iterations).
- No open question tagged `Blocks:` the next stage.
- Frontmatter `status:` is `review` or `draft` (approving a `superseded` artifact is an error).

If a check fails: DO NOT approve. Report exactly what's unmet and suggest the `/refine` prompt that would fix it. The CTO can override with "approve anyway" — record the override note in the sign-off table.

## Step 2: Record the approval
- Frontmatter: `status: approved`, `approved_by: cto`, `approved_date: {now}`.
- Sign-off table: add the row.
- `.planning/artifacts/ARTIFACT-REGISTRY.md`: flip this artifact's status.

## Step 3: Advance the stage (when this was the stage's core artifact)
Stage → core artifact map (staged flow, `.planning/config.yaml#pipeline`):
| Stage | Core artifact | Next stage |
|-------|--------------|------------|
| 1-knowledge | .planning/knowledge/KNOWLEDGE-BASE.md | 2-spec |
| 2-spec | .planning/spec/TECH-SPEC.md | 3-build |
| 3-build | all stories DONE + /verify-work PASS (implementation-summary) | 4-harden |
| 4-harden | .planning/quality/HARDENING-LOG.md (clean iterations met) | 5-ship |
| 5-ship | release docs + deployment verification | done |

If advancing:
1. Update `.planning/STATE.md`: `- Stage:` to the next stage, log the transition in the Decisions Log.
2. Snapshot: note the approved artifact's revision — downstream work builds against THIS revision (tech-spec records `knowledge_base_rev`).
3. Announce the stage entry: what the next stage produces, which agents lead it, and the command that starts it (`/stage-spec`, `/stage-build`, `/stage-harden`, `/stage-ship`).

In full-ceremony mode (`pipeline.flow: full`), also require the stage's deep artifacts per ARTIFACT-REGISTRY.md before advancing — run /gate-check to enumerate.

$ARGUMENTS
