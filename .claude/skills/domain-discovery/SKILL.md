---
name: "domain-discovery"
description: "Atlas methodology — detect a project's domain from config, description, and codebase signals, and select the right Domain Skill Pack with a confidence score"
tier: orchestration
version: "1.0.0"
---

# Domain Discovery

## When to Activate
- First Atlas run on any project (Phase 0)
- When project signals change (new dependencies, new integration targets, PROJECT.md edits)
- When a reconfiguration trigger fires (see skill-orchestration)

## Signal Collection
Gather evidence from three sources, strongest first:

1. **Explicit configuration** — `.planning/config.yaml` (`project.domain_focus`, `project.regulatory`, `project.integration_targets`) and `PROJECT.md`. Explicit signals dominate: a stated domain is accepted unless the codebase contradicts it.
2. **Dependency manifest** — `package.json` / `pyproject.toml` / `pom.xml` / `go.mod`. Match against each pack's `detection.dependency_patterns`.
3. **Codebase scan** — Glob for each pack's `detection.file_patterns`; Grep source for `detection.keywords` (limit to src/, docs/, README to avoid vendored noise).

## Scoring
For each candidate pack in `domain-packs/*/manifest.yaml`:

```
score = 0.50 * config_match      # explicit domain_focus/regulatory overlap
      + 0.25 * dependency_match  # fraction of dependency_patterns hit
      + 0.15 * keyword_match     # high_signal=1.0, medium=0.5, low=0.2 weighted hits
      + 0.10 * file_pattern_match
```

- Normalize each component to [0,1] before weighting.
- **Confidence >= 0.75** → select the pack automatically.
- **0.40–0.75** → select provisionally and flag for CTO confirmation.
- **< 0.40 for all packs** → use `generic` and report which signals were missing.
- Record secondary domains scoring >= 0.40 — projects can straddle domains (e.g., healthcare + saas).

## Outputs
Write results to `.planning/skill-config.yaml` under `project.domain_analysis`:
`primary_domain`, `secondary_domains`, `domain_confidence`, `protocols`, `regulatory`, `integration_targets`, `data_classification` (from the pack's `sensitive_data.classification`).

Then:
1. Copy the pack's `sensitive_data.patterns` into `.claude/hooks/.data-guard-config.json` so data-guard enforces them.
2. Generate the **Domain Rules** section of CLAUDE.md — mandatory regulations, integration protocols, data classification rules.
3. Log the run in `skill-config.yaml#reconfigure_log` with trigger and changes.

## Red Flags
- Selecting a pack from keywords alone when config.yaml names a different domain — surface the conflict, never silently override.
- Confidence reported without listing the signals that produced it.
- Skipping the data-guard pattern sync — compliance enforcement depends on it (Rule 5).
