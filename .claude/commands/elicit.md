---
description: "Advanced elicitation — pressure-test any artifact or decision with structured critique methods before it gets approved"
---

You are running advanced elicitation on an artifact or decision. The goal is to surface weaknesses, blind spots, and unstated assumptions BEFORE the CTO approves it — praise is noise; only findings that change the artifact matter.

## Arguments
$ARGUMENTS names an artifact file (e.g., `.planning/architecture/adr/001-event-bus.md`), an artifact type (`prd`, `architecture`, `sprint-plan`, `threat-model`, ...), or a free-form decision to pressure-test. If empty, use the most recently modified draft artifact in `.planning/`.

## Step 1: Select Methods
Read the target. Pick the 4–5 most relevant methods for THIS content:

| # | Method | Best for |
|---|--------|----------|
| 1 | Pre-mortem | Plans, sprints — "it's 6 months later and this failed; why?" |
| 2 | Red team | Security/compliance — attack the design as a motivated adversary |
| 3 | Inversion | Requirements — "what would guarantee this fails?" then check we prevent each |
| 4 | Steelman the alternative | ADRs — argue the rejected option as its best advocate |
| 5 | Six Thinking Hats | Broad review — facts, feelings, risks, benefits, creativity, process |
| 6 | Five Whys | Root-cause a stated constraint or requirement |
| 7 | Boundary analysis | Data models, APIs — probe extremes, empty states, concurrency, scale |
| 8 | Stakeholder round | PRDs — re-read as end user, ops on-call, auditor, new hire |
| 9 | Subtraction | Scope — which section, if deleted, would nobody miss? Cut it |
| 10 | Compliance lens | Anything touching regulated data — Vera/Kai joint pass (Rule 5) |

## Step 2: Offer the Menu
Present the selected methods to the CTO:

```
Elicitation for: {artifact}
1-5. {selected methods + one-line why}
[a] apply all  [r] reshuffle  [x] proceed without elicitation
```

In manual mode, wait for selection. If the CTO already gave instructions in $ARGUMENTS (e.g., "red team it"), skip the menu and run.

## Step 3: Apply
For each chosen method, produce concrete findings — quote the artifact line you're challenging, state the failure scenario, and propose the fix. Route persona-flavored critiques to the right agent voice (Kai for red team, Vera for compliance lens, Winston for steelman, Maya for stakeholder round).

## Step 4: Disposition Table
End with an actionable table the CTO can approve line-by-line:

```
| # | Finding | Severity | Proposed change | Accept? |
|---|---------|----------|-----------------|---------|
```

After CTO disposition, apply accepted changes to the artifact and bump its frontmatter status back to `review` if it was `approved`. Re-offer the menu (methods compound — a pre-mortem often exposes what to red-team next); stop when the CTO says proceed.

$ARGUMENTS
