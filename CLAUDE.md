# EU AI Act Annex IV Generator

## Framework
RMAD v2.2.0
Config: .planning/config.yaml | Models: .planning/models.yaml
Skills: .planning/skill-config.yaml | State: .planning/STATE.md

## Universal Rules
- Security: Follow OWASP Top 10. Never commit secrets to source control.
- Privacy: Classify data before processing. Log access to sensitive data.
- Mode: Follow current mode per .planning/config.yaml (default: manual).
- Permissions: Respect tool restrictions and path boundaries (hook-enforced).
- Skills: Static skills are preloaded via each agent's `skills:` frontmatter. Dynamic domain skills are assigned in .planning/skill-config.yaml — read any assigned skill you haven't loaded before starting work.
- Charters: Each agent has a charter at .claude/charters/{agent-id}.charter.md (see `charter_ref:` in its agent file) defining how the seat is held: judgement, craft bar, red lines, binding project standards, failure modes. Read your own charter before your first substantive action in a session. The agent file wins where the two appear to differ.
- Standards: Project standards live in Standards.txt at the repo root and are carried into each charter's `<standards>` section for the seat they bind. Index the workspace before starting any task; no unapproved libraries or frameworks; no dead code; no data model change without recorded consent; no em dash and no section symbol in anything you write.
- State: Check .planning/STATE.md for current project context before any task.
- Memory: Durable project facts live in .planning/memory/ (MEMORY.md index + topic files). Consult topics relevant to your task; verify a memory's evidence pointer before acting on it. Save a fact only when it is durable, not derivable from the repo in under a minute, and cost real time to learn. Never save session narrative; never contradict an existing entry — update or supersede it.
- Compliance: Domain compliance requirements are NEVER deferred as tech debt (Rule 5).
- Git: Commit format: `{type}({agent}): {description} [{story-id}]`. Types: feat|fix|refactor|test|docs|chore.
- Branches: Story branches: `story/{story-id}`. Feature branches: `feature/{description}`.
- Lint: Run project linter after editing source code. Fix issues before proceeding.
- Artifacts: Check .planning/artifacts/ARTIFACT-REGISTRY.md for phase gate requirements.
- Repo Map: Load relevant sections from .planning/repo-map.md before starting work (if available).

## Deviation Rules (during story execution)
When you discover work the current story didn't plan for:
- Rule 1 — Bug blocking your task: fix it, note it in the story's Dev Notes. No permission needed.
- Rule 2 — Missing critical functionality (security/correctness gap directly in scope): add it, note it. No permission needed.
- Rule 3 — Blocking technical issue (broken import, missing dep, failing build): fix it. Never auto-substitute a different package than planned — new dependencies need CTO approval.
- Rule 4 — Architectural change (new service, schema redesign, API contract change): STOP and ask the CTO. Always.
- Scope boundary: only fix issues caused by or blocking the CURRENT story. Log everything else to .planning/sprints/{sprint}/deferred-items.md and keep moving.
- Attempt cap: 3 attempts per fix, then stop and report honestly what failed.

## Pipeline (staged flow)
| # | Stage | Command | Core artifact |
|---|-------|---------|---------------|
| 1 | knowledge | /stage-knowledge | .planning/knowledge/KNOWLEDGE-BASE.md |
| 2 | spec | /stage-spec | .planning/spec/TECH-SPEC.md |
| 3 | build | /stage-build | stories + implementation summary |
| 4 | harden | /stage-harden | .planning/quality/HARDENING-LOG.md (iterate until CLEAN) |
| 5 | ship | /stage-ship | release docs + deployment verification |

Each stage's core artifact is refined with /refine and /elicit until the CTO
approves it with /approve, which advances the stage. Stages read APPROVED
upstream artifacts — any stage can start in a fresh session from artifacts +
STATE.md + memory alone. Agents never self-approve. /gate-check shows position.

## Domain Rules (Atlas-Generated)
> Domain: healthcare (detected during init)
> Run /ask atlas "Configure skills for this project" to generate domain rules.

## Agent Roster

| Agent | ID | Division | Model | Tools |
|-------|----|----------|-------|-------|
| Atlas | atlas-orchestrator | Project Intelligence | opus | R,W,Gr,Gl,WS,WF |
| Maya | maya-analyst | Product & Strategy | opus | R,W,Gr,Gl,WS,WF |
| Winston | winston-architect | Product & Strategy | opus | R,W,E,B,Gr,Gl,WS,WF |
| Nadia | nadia-pm | Product & Strategy | sonnet | R,W,Gr,Gl |
| Derek | derek-sm | Product & Strategy | sonnet | R,W,Gr,Gl |
| Soren | soren-backend | Engineering | opus | R,W,E,B,Gr,Gl |
| Milo | milo-frontend | Engineering | sonnet | R,W,E,B,Gr,Gl |
| Lena | lena-integration | Engineering | opus | R,W,E,B,Gr,Gl |
| Anya | anya-data | Engineering | opus | R,W,E,B,Gr,Gl |
| Ravi | ravi-devops | Engineering | sonnet | R,W,E,B,Gr,Gl |
| Quinn | quinn-qa | Quality & Governance | sonnet | R,B,Gr,Gl |
| Tara | tara-blackbox | Quality & Governance | sonnet | R,W,B |
| Vera | vera-compliance | Quality & Governance | opus | R,W,Gr,Gl |
| Kai | kai-security | Quality & Governance | opus | R,B,Gr,Gl |
| Rex | rex-researcher | Support | sonnet | R,W,WS,WF,Gr,Gl |
| Sage | sage-techwriter | Support | sonnet | R,W,Gr,Gl |
