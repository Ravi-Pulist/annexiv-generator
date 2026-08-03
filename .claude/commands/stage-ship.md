---
description: "Stage 5 — ship: final traceability audit, release documentation, deployment verification, retrospective"
---

You are running Stage 5 of the RMAD pipeline: shipping. Input: a hardened build (approved Hardening Log). Output: released software with its paper trail, and a project that's ready for its next cycle.

## Step 0: Gate check
`.planning/quality/HARDENING-LOG.md` must be `status: approved` with the required clean iterations. No exceptions — shipping an unhardened build is a CTO override recorded in writing.

## Step 1: Final traceability audit (the "accounts for everything" close-out)
One fresh-context pass across all artifacts (Quinn leads):
- KB FR-N → Tech Spec module → stories → code → tests: every must-have FR traces end to end. Table with per-FR status.
- Every KB §5 compliance obligation → spec §7 control → verified evidence (test/audit ref). Vera co-signs. (Rule 5: zero deferrals.)
- Deferred items and known limitations consolidated into the release notes — shipped-but-known beats discovered-by-users.

Any broken trace → back to the responsible stage; do not paper over it in docs.

## Step 2: Release documentation (Sage)
From release-docs template: what shipped (FR-level, user language), known limitations, upgrade/rollback notes, runbook updates, API doc refresh.

## Step 3: Deployment verification (Ravi)
From deployment-verification template: environment checklist, deploy steps executed, smoke tests against the DEPLOYED instance (not localhost), monitoring/alerts live, rollback tested or consciously waived by CTO.

## Step 4: Retrospective (Derek, 15 minutes not 15 pages)
- What the pipeline got right/wrong this cycle — concrete, one line each.
- Feed forward: durable lessons → `.planning/memory/` (memory discipline applies — facts with evidence, not vibes); recurring behavioral patterns → note for `/learn-review`.
- Assumptions Register close-out: every KB AS-N marked validated/broken; broken ones get a memory entry.

## Step 5: Close the stage
```
## Shipped: {project} {version}

Traceability: {n}/{n} must-have FRs verified end-to-end
Compliance: {n}/{n} obligations evidenced (Vera signed)
Deployment: verified {env} @ {time} | Rollback: {tested/waived}
Known limitations: {n} (in release notes)
Retro lessons captured: {n} memory entries

Pipeline reset: /stage-knowledge to begin the next cycle (KB rev {n} carries forward — update, don't rebuild).
```

Update STATE.md: Stage `done`, log the release in the Decisions Log.

$ARGUMENTS
