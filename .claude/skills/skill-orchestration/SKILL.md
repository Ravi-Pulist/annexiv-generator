---
name: "skill-orchestration"
description: "Atlas methodology — score domain skill relevance, assign per-agent skill loadouts within context budgets, detect gaps, and register reconfiguration triggers"
tier: orchestration
version: "1.0.0"
---

# Skill Orchestration

## When to Activate
- After domain-discovery selects a Domain Skill Pack
- When the CTO requests a loadout change or an override
- When a reconfiguration trigger fires

## Relevance Scoring
For every skill in the selected pack, score relevance to THIS project in [0,1]:

- **1.0–0.9** — skill's subject appears in `integration_targets`, `regulatory`, or stated core features
- **0.8–0.6** — skill supports the project's protocols/stack but isn't named explicitly
- **0.5–0.3** — plausibly useful later; do not assign yet
- **< 0.3** — irrelevant to current scope

Record every score with a one-line rationale in `skill-config.yaml#skill_relevance.scores`.

## Assignment Rules
0. **Atlas never receives domain skills.** Atlas is the configurator, not a practitioner — it reads pack manifests to assign expertise to others. Its own loadout is exactly: domain-discovery + skill-orchestration (plus the universal skills every agent gets).
1. Match skill → agent by each skill's `applies_to` roles in the pack manifest (fallback: backend/integration/data skills → Soren/Lena/Anya; compliance → Vera; security → Kai; testing → Quinn/Tara; requirements/PRD → Maya/Nadia).
2. **Budget: max 5 dynamic skills per agent** (`config.yaml#context.max_skills_per_agent`). Assign by descending relevance; leave headroom (target 3–4) on agents with heavy static loads.
3. Every enabled agent gets an explicit entry — even if empty — with a rationale ("no domain skills apply to Derek's sprint mechanics").
4. Install assigned skills by copying `domain-packs/{pack}/skills/{skill}/` into `.claude/skills/{skill}/` (flat — directory name is the skill's invocation name). Keep `tier: domain` in the skill frontmatter to mark provenance.
5. **Expand each installed skill before it ships to an agent — copying is only half the install.** A pack skill is a *scaffold*, not a finished skill: it carries the domain-invariant core (the principle that is true for every FHIR project, every PCI project) and leaves `## Patterns` marked `{To be expanded with domain-specific patterns}`. That marker is an instruction to you. It is deliberately empty because a pre-written generic essay on FHIR is exactly the filler the model already knows — the value is in what is true for THIS project.
   - Fill `## Patterns` from real project signals: `PROJECT.md`, `config.yaml#project` (integration targets, regulatory list, tech stack), the pack manifest's `integrations` / `regulations` / `sensitive_data` entries, and any approved artifact. Name the actual resources, transaction sets, endpoints, tables, and regulations this project uses — not the ones the domain *could* use.
   - Add a `## Red Flags` entry for each project-specific trap you can name (a partner with stricter validation than the spec, a field the vendor rejects when null).
   - **The expanded skill must contain something an agent could not have inferred from the skill's own title.** If everything you would write is generic, write nothing, leave the marker, and record a `degraded` gap — an honest empty slot beats invented specificity, and a skill that says only what the model already knows costs context and returns nothing.
   - **Never leave the raw `{To be expanded...}` marker in an INSTALLED skill.** It ships straight into the agent's context as its expertise. The marker belongs in `domain-packs/`; it must never survive into `.claude/skills/`.
   - Re-expand on every reconfiguration trigger below — an expansion is only as current as the signals it was derived from.
6. Make the loadout real: add each assigned skill to the agent's `skills:` list in `.claude/agents/{agent}.md` frontmatter — Claude Code preloads listed skills into the subagent at spawn. Remove entries you unassign; never let the list exceed the budget.
7. CTO `overrides` in skill-config.yaml always win; never remove an override during reconfiguration.

## Gap Detection
A gap exists when project signals demand expertise no pack skill covers (e.g., config names "SAP IDoc" but the pack has no IDoc skill). For each gap record: `capability`, `severity` (blocking | degraded | cosmetic), `recommendation` (author project skill via /pack-create | acquire | descope). Blocking gaps must be surfaced to the CTO before Phase 1.

## Reconfiguration Triggers
Register in skill-config.yaml and re-run orchestration when:
- `PROJECT.md` or `config.yaml#project` changes materially
- A new integration target or regulation appears in any approved artifact
- A sprint story references a domain concept with no assigned skill
- The CTO promotes a learned skill (via /learn-review) that overlaps an assignment

## Red Flags
- Any agent over budget — trim lowest relevance first, never trim overrides
- Assigning a skill scored < 0.5 without a written justification
- Loadouts changed without a `reconfigure_log` entry (breaks auditability)
