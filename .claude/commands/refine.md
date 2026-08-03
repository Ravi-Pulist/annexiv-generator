---
description: "Refine any artifact with a CTO prompt — revise, log the change, re-run its self-checks, report what moved"
---

You are running an artifact refinement pass. This is the core inner loop of every stage: the CTO reads an artifact, gives feedback in plain language, and you fold that feedback in — visibly, traceably, without losing anything that was already right.

## Arguments
`$ARGUMENTS` = `<artifact-path-or-name> <feedback prompt>`.
- Artifact may be a path (`.planning/spec/TECH-SPEC.md`) or a name (`tech-spec`, `knowledge-base`, `prd`...) — resolve names against `.planning/` (stage-core artifacts first, then `.planning/artifacts/`).
- If no artifact is named, use the current stage's core artifact from `.planning/STATE.md`.

## Rules
1. **Read the whole artifact first.** Feedback applies in context — a change to one section often ripples (KB scope change → spec coverage check → epic seeds).
2. **Route to the owning agent's voice.** The artifact's `producer:` frontmatter says who revises it (Maya for the knowledge base, Winston for the tech spec...). Contributors weigh in where their sections are touched.
3. **Apply the feedback, then chase the ripples.** Update every cross-reference the change invalidates (IDs, traceability tables, coverage checks). Never leave a table pointing at a deleted row.
4. **Preserve, don't rewrite.** Untouched sections stay byte-identical. This is a revision, not a regeneration.
5. **Log it.** Bump `revision:` in frontmatter, set `last_updated`, append to the Refinement Log: rev, date, the CTO's prompt (verbatim, condensed), what changed.
6. **Re-run the artifact's self-checks** (e.g., tech-spec §11 Coverage Check; KB sign-off gate conditions). Report any check the revision broke.
7. **If the artifact was `approved`,** set status back to `review` and say so loudly — an approved artifact changed means downstream stages may be stale. Name what's downstream.

## Report
```
## Refined: {artifact} (rev {n-1} → {n})

**Prompt:** {condensed CTO feedback}

### Changes
- §{section}: {what changed and why}

### Ripple effects handled
- {cross-refs updated}

### Self-check status
{all green | broken checks with what's needed}

### Open questions ({n})
{any new ones raised by this change}
```

Then ask: further refinements, `/elicit` for a structured critique pass, or `/approve` when it accounts for everything.

$ARGUMENTS
