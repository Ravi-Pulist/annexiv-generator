# Artifact Registry

> Defines the gate artifacts required for pipeline transitions.
> Each artifact must reach "approved" status before its gate opens.
> Status flow: `draft` → `review` → `approved` → `superseded`

## Staged Flow (default — `pipeline.flow: staged`)

One core artifact per stage. The CTO iterates on it with `/refine` and `/elicit`
until it accounts for everything, then `/approve` advances the stage. The deep
per-phase artifacts below remain available as optional depth — full-ceremony mode
(`pipeline.flow: full`) requires them too.

| Stage | Core Artifact | Location | Lead | Approve advances to |
|-------|--------------|----------|------|---------------------|
| 1-knowledge | Knowledge Base | .planning/knowledge/KNOWLEDGE-BASE.md | Maya | 2-spec |
| 2-spec | Tech Spec | .planning/spec/TECH-SPEC.md | Winston | 3-build |
| 3-build | Implementation Summary | .planning/artifacts/implementation-summary.md | Derek | 4-harden |
| 4-harden | Hardening Log | .planning/quality/HARDENING-LOG.md | Quinn | 5-ship |
| 5-ship | Release Docs + Deployment Verification | .planning/delivery/ | Sage + Ravi | done |

## Full-Ceremony Artifacts (per phase)

## Phase 0 → Phase 1 Gate

| Artifact | Producer | Reviewer | Template | Status |
|----------|----------|----------|----------|--------|
| Domain Configuration | Atlas | CTO | atlas-domain-config.md | pending |
| Skill Assignments | Atlas | CTO | atlas-skill-assignments.md | pending |

## Phase 1 → Phase 2 Gate

| Artifact | Producer | Reviewer | Template | Status |
|----------|----------|----------|----------|--------|
| Research Summary | Rex | CTO | research-summary.md | pending |
| Requirements Spec | Maya | CTO + Winston | requirements-spec.md | pending |
| Architecture Decision | Winston | CTO | architecture-decision.md | pending |
| Compliance Assessment | Vera | CTO | compliance-assessment.md | pending |
| Threat Model | Kai | CTO + Winston | threat-model.md | pending |

## Phase 2 → Phase 3 Gate

| Artifact | Producer | Reviewer | Template | Status |
|----------|----------|----------|----------|--------|
| Product Requirements Doc | Nadia | CTO | prd.md | pending |
| Data Model Spec | Anya | Winston + CTO | data-model-spec.md | pending |
| Sprint Plan | Derek | CTO | sprint-plan.md | pending |

## Phase 3 → Phase 4 Gate

| Artifact | Producer | Reviewer | Template | Status |
|----------|----------|----------|----------|--------|
| Implementation Summary | Derek | CTO | implementation-summary.md | pending |
| Code Complete Checklist | Soren | Quinn | code-complete-checklist.md | pending |

## Phase 4 → Phase 5 Gate

| Artifact | Producer | Reviewer | Template | Status |
|----------|----------|----------|----------|--------|
| Quality Report | Quinn | CTO | quality-report.md | pending |
| E2E Test Report | Tara | CTO + Quinn | e2e-test-report.md | pending |
| Compliance Audit | Vera | CTO | compliance-audit.md | pending |
| Security Audit | Kai | CTO | security-audit.md | pending |

## Phase 5 → Done Gate

| Artifact | Producer | Reviewer | Template | Status |
|----------|----------|----------|----------|--------|
| Release Documentation | Sage | CTO | release-docs.md | pending |
| Deployment Verification | Ravi | CTO | deployment-verification.md | pending |
