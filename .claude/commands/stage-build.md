---
description: "Stage 3 — slice the approved Tech Spec into stories and build them; every story traces to spec modules"
---

You are running Stage 3 of the RMAD pipeline. Input: the APPROVED Tech Spec. Output: working, verified code — built story by story, each story traceable to spec modules and FRs.

## Step 0: Gate check
`.planning/spec/TECH-SPEC.md` must be `status: approved`. If not: STOP and point at `/approve tech-spec`. Record which spec revision the build targets in STATE.md.

## Step 1: Slice (Derek, once per sprint)
From Tech Spec §9 epic seeds, produce `.planning/sprints/sprint-{N}/` stories. Every story file carries:

```markdown
---
story: S{N}-{seq}
epic: {epic}
implements: [MOD-2, FR-3]        # traceability — no orphan stories
owner: {engineering agent}
complexity: {1-10}               # score it; split anything > 7 before assignment
depends_on: []                   # story IDs
parallel: true|false             # can run alongside its wave peers
conflicts_with: []               # stories touching the same files — never same wave
status: TODO
---
## Story
## Acceptance Criteria          # concrete, testable, numbered
## Test Strategy                 # HOW this story will be verified — authored NOW, not at test time
## File List                     # files expected to change (deviation-detector enforces)
## Dev Notes
```

Group stories into dependency waves (wave = no unmet depends_on, no conflicts_with inside the wave). Present the sprint plan + wave map to the CTO before building.

## Step 2: Build (per story)
1. Set STATE.md Active Agent + Story.
2. Execute via `/sprint-dev {story-id}` — Winston plans against the spec, the owning engineer implements TDD-first.
3. **Spec is law:** implement the spec as written. Hitting a real spec problem is not a deviation to code around — apply Deviation Rule 4: stop, report, and if the CTO agrees run `/refine tech-spec "..."` (new revision) before continuing.
4. After each story: run its Test Strategy, then `/verify-work {story-id}` (goal-backward). Story reaches DONE only on PASS.

## Step 3: Stage completion
When all planned stories are DONE:
1. Produce the implementation summary (`.planning/artifacts/` from implementation-summary.md): what was built per module, traceability table MOD-N → stories → status, deferred items with reasons.
2. Coverage assertion: every Tech Spec §6 module has >= 1 DONE story or a CTO-acknowledged deferral.
3. Report and hand to the gate:

```
## Build complete (spec rev {n})
- Stories: {done}/{total} | Deferred: {n} (listed)
- Module coverage: {all covered | gaps}
- Verify-work: PASS on all DONE stories
Next: /approve implementation-summary → advances to Stage 4 (harden), or /refine tech-spec if reality disagreed with the spec.
```

$ARGUMENTS
