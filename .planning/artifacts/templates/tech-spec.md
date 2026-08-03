---
artifact: tech-spec
stage_gate: "2-spec → 3-build"
producer: winston-architect
contributors: [nadia-pm, anya-data, derek-sm, kai-security]
reviewers: [cto]
status: draft
revision: 1
knowledge_base_rev: ""
created: ""
last_updated: ""
approved_by: ""
approved_date: ""
---

# Tech Spec

> The single implementation contract. Derived from the approved Knowledge Base —
> every module traces to an FR-N, and every FR-N lands in a module (the Coverage
> Check proves it). Refined with `/refine` until the CTO can say "this accounts
> for everything I need", then locked with `/approve`. After approval, changes
> require a new revision with a Refinement Log entry — build agents implement
> the spec as written, never silently around it.
> Mark ambiguities inline as `[NEEDS-CLARIFICATION: question]` — approval is blocked
> while any marker remains. IDs (AD-N, MOD-N) are append-only: never renumber.

## 1. Architecture Overview
> One diagram-in-text + one paragraph. What talks to what, where state lives.

## 2. Architecture Decisions
| ID | Decision | Alternatives rejected & why | Consequence |
|----|----------|----------------------------|-------------|
| AD-1 | | | |

## 3. Tech Stack
| Layer | Choice | Rationale (constraint or AD ref) |
|-------|--------|----------------------------------|

## 4. Data Model
> Entities, fields, relationships, sensitivity class per field, migrations approach.

## 5. API Contracts
> Every externally visible interface: route/message, request/response shape,
> auth, error semantics, versioning. Integration details per KB §4.

## 6. Module Breakdown
> The build map. Owner = which engineer implements it in Stage 3.

| ID | Module | Responsibility | Implements | Owner | Depends on |
|----|--------|----------------|------------|-------|------------|
| MOD-1 | | | FR-1, FR-3 | soren-backend | — |

## 7. Security & Compliance Controls
> Each KB §5 obligation → a concrete control in a concrete module. Kai/Vera co-sign.

| Obligation (KB ref) | Control | Module | Verified how |
|---------------------|---------|--------|--------------|

## 8. Testing Strategy
> Test pyramid for THIS project: what unit/integration/e2e cover, coverage floor,
> what Stage 4 hardening iterations will exercise, definition of a CLEAN iteration.

## 9. Delivery Plan
> Epic seeds for Derek — sprint slicing happens in Stage 3, not here.

| Epic | Modules | FRs covered | Rough order |
|------|---------|-------------|-------------|

## 10. Risks & Mitigations
| Risk | Likelihood | Impact | Mitigation | Trigger to revisit |
|------|-----------|--------|------------|--------------------|

## 11. Coverage Check ("accounts for everything")
> Run at every revision; must be all-green before approval.

- [ ] Every KB FR-N (must/should) maps to >= 1 module in §6
- [ ] Every KB §4 integration has a contract in §5
- [ ] Every KB §5 obligation has a control in §7
- [ ] Every module has an owner and appears in an epic
- [ ] No open KB question marked `Blocks: spec` remains unanswered
- [ ] Testing strategy defines the Stage 4 CLEAN-iteration bar

## 12. Open Questions
| # | Question | Blocks | Owner | Answer |
|---|----------|--------|-------|--------|

## 13. Refinement Log
| Rev | Date | Prompt/trigger | What changed |
|-----|------|----------------|--------------|

## 14. Sign-off
| Reviewer | Status | Date | Notes |
|----------|--------|------|-------|
