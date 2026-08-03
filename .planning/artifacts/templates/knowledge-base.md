---
artifact: knowledge-base
stage_gate: "1-knowledge → 2-spec"
producer: maya-analyst
contributors: [rex-researcher, atlas-orchestrator, vera-compliance, kai-security]
reviewers: [cto]
status: draft
revision: 1
created: ""
last_updated: ""
approved_by: ""
approved_date: ""
---

# Knowledge Base

> Everything the team must know before designing anything. This artifact is refined
> with `/refine` until the CTO approves it with `/approve` — nothing in Stage 2
> may contradict it, and nothing needed by Stage 2 may be missing from it.
>
> Provenance tags are mandatory on claims: `[VERIFIED]` (tested / primary source),
> `[CITED]` (secondary source, link it), `[ASSUMED]` (needs validation before build).
> Mark every known ambiguity inline as `[NEEDS-CLARIFICATION: question]` — approval
> is mechanically blocked while any marker remains. IDs (FR-N, AS-N) are append-only:
> retire with ~~strikethrough~~, never renumber — downstream artifacts reference them.

## 1. Domain Snapshot
> Domain, confidence, selected skill pack, protocols in play (from Atlas discovery)

## 2. Problem & Users
> What problem, for whom, why now. Stakeholders and what each needs.

## 3. Functional Scope
> Stable IDs — Stage 2 traces every spec module back to these. Acceptance criteria
> are testable GIVEN/WHEN/THEN statements — if you can't phrase the criterion as a
> check, the capability isn't understood yet.

| ID | Capability | Acceptance criteria (GIVEN/WHEN/THEN) | Priority | Provenance |
|----|-----------|----------------------------------------|----------|------------|
| FR-1 | | | must/should/could | |

## 4. Integrations & External Systems
| System | Protocol/API | Direction | Auth | Constraints | Provenance |
|--------|-------------|-----------|------|-------------|------------|

## 5. Regulatory & Compliance Obligations
> Rule 5: nothing here may ever be deferred as tech debt.

| Regulation | Applies because | Concrete obligations | Provenance |
|------------|----------------|----------------------|------------|

## 6. Data Landscape
> Entities, sensitivity classification (PHI/PCI/PII), retention, residency.

## 7. Constraints
> Tech stack mandates, budget/timeline, team, hosting, performance floors.

## 8. Existing Codebase (brownfield only)
> Repo-map reference (.planning/repo-map.md), conventions to respect, no-touch zones.

## 9. Research Findings
> Distilled from Rex's research summaries — only what changes decisions. Link full docs.

## 10. Assumptions Register
| ID | Assumption | Risk if wrong | Validation plan | Status |
|----|-----------|---------------|-----------------|--------|
| AS-1 | | | | open/validated/broken |

## 11. Out of Scope
> Explicit non-goals. At least one — a scope with no boundary is not a scope.

## 12. Open Questions
| # | Question | Blocks | Owner | Answer |
|---|----------|--------|-------|--------|

## 13. Refinement Log
| Rev | Date | Prompt/trigger | What changed |
|-----|------|----------------|--------------|

## 14. Sign-off
> Gate check: no open questions marked `Blocks: spec`, no `[ASSUMED]` tag on a
> must-have FR, at least one explicit non-goal.

| Reviewer | Status | Date | Notes |
|----------|--------|------|-------|
