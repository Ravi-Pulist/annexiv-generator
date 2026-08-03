---
description: "Stage 1 — build the Knowledge Base: everything the team must know, consolidated into one reviewable artifact"
---

You are running Stage 1 of the RMAD pipeline. The output is ONE artifact — `.planning/knowledge/KNOWLEDGE-BASE.md` — that captures everything the project needs to know before anything gets designed. The CTO will iterate on it with `/refine` and `/elicit` until it's complete, then `/approve` it to unlock Stage 2.

## Arguments
$ARGUMENTS may seed the effort (project description, links, docs to ingest). If a knowledge base already exists, UPDATE it (this command is re-runnable; bump revision, log in the Refinement Log).

## Step 0: Prerequisites
- If Atlas hasn't configured the domain (`.planning/skill-config.yaml` says pending), run domain discovery first — the KB's Domain Snapshot depends on it.
- Read `PROJECT.md`, `.planning/config.yaml`, and any docs the CTO points at.

## Step 1: Gather (parallel agent perspectives)
Work through these lenses, each in its owning agent's voice:
- **Maya (lead):** problem, users, stakeholders, functional scope → FR-N table with priorities
- **Rex:** research the domain ecosystem — protocols, vendor specifics, prior art. Tag every claim `[VERIFIED]`/`[CITED]`/`[ASSUMED]`; distill only decision-changing findings into §9, link full research docs in `.planning/research/`
- **Atlas:** domain snapshot from skill-config (pack, confidence, protocols)
- **Vera:** regulatory obligations table — concrete obligations, not regulation names (Rule 5)
- **Kai:** data sensitivity classification + threat surface notes for §6
- **Brownfield:** if `src/` has code, run `/atlas-repomap` and summarize conventions + no-touch zones into §8

## Step 2: Consolidate
Instantiate `.planning/artifacts/templates/knowledge-base.md` at `.planning/knowledge/KNOWLEDGE-BASE.md`. Fill every section — an honestly empty section says "None identified (checked {date})", never just blank. Populate the Assumptions Register with EVERY `[ASSUMED]` tag, each with a validation plan.

## Step 3: Self-critique before showing the CTO
One pass of inversion ("what would make this KB fatally incomplete?") — add anything it surfaces to Open Questions rather than silently fixing.

## Step 4: Present for the refinement loop
```
## Knowledge Base ready for review (rev {n})

**Coverage:** {n} FRs | {n} integrations | {n} regulations | {n} assumptions ({n} unvalidated) | {n} open questions ({n} blocking)

### Weakest sections (be honest)
- §{x}: {why it's thin and what would strengthen it}

### Suggested next moves
- /refine knowledge-base "{the refinement you'd do first}"
- /elicit knowledge-base — structured critique (pre-mortem, stakeholder round)
- /approve knowledge-base — when it accounts for everything
```

Update `.planning/STATE.md`: Stage `1-knowledge`, note the KB revision.

$ARGUMENTS
