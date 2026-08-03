# RMAD Charter Standard

A **charter** is the personality contract for one agent, the description of the ideal
employee holding that seat. It is fed to the agent alongside its role definition.

## Why charters exist

`.claude/agents/{id}.md` answers **what** an agent does: role, contracts, upstream and
downstream, success criteria, escalation rules. It is a job description.

A charter answers **how a good one behaves**: temperament, judgement, what they refuse,
how they disagree, how they know their own work is finished. It is the difference between
someone who satisfies the acceptance criteria and someone you want on the team.

Split the two and keep them split:

| Concern | Lives in | Example |
|---|---|---|
| Role, scope, boundaries | agent file `<role>` | "Soren builds the backend." |
| Contracts, hand-offs | agent file `<contracts>` | "Consumes: Winston's API design." |
| Hard escalation rules | agent file `<escalation>` | "Rule 4: STOP and ask the CTO." |
| Definition of done | agent file `success_criteria` | "Coverage >= 80%." |
| Character and judgement | **charter** | "You escalate before you build, not at review." |
| How excellence is recognised | **charter** `<craft_bar>` | "Your diff is boring to read." |
| Binding project standards | **charter** `<standards>` | "No dead code. No unapproved libraries." |
| How the role degrades | **charter** `<failure_modes>` | "Tests written after, to match the code." |

Rule of thumb: if a hook or a reviewer could mechanically check it, it belongs in the
agent file. If it only shows up in the quality of judgement, it belongs in the charter.

A charter never contradicts an agent file. Where a charter appears to loosen a rule, the
agent file wins. Charters sharpen behaviour, they never grant exceptions.

## Project standards

`<standards>` carries the rules from `Standards.txt` at the repo root that bind that
particular seat. Four groups exist there:

| Group | Binds | Notes |
|---|---|---|
| Pre-Task Indexing | every seat | Index the workspace and read existing conventions before starting anything. |
| Architecture and Simplicity | Winston, all engineers, and anyone who recommends or sizes work | No unapproved libraries, no over-engineering, no dead code, no data model change without recorded consent, simple features under ten files. |
| PR Review Workflow | Quinn, Kai, Vera, Tara | Plan-first review, categorize by type rather than tier, every listed item required before merge, concise comments. |
| Documentation Standards | Sage primarily, plus any seat producing written artefacts | Main README as table of contents, modular `docs/<topic>/README.md`, two to three minute reads, no orphan docs. |

Two scoping decisions are recorded here because they are judgement calls, not oversights:

1. **Review categories versus the framework severity scale.** The standard says do not use
   priority tiers and do not create a "nice to have" bucket. The framework's
   CRITICAL/MAJOR/MINOR and CRITICAL/HIGH/MEDIUM/LOW scales still exist because the quality
   and security gates are defined on them. Charters reconcile the two: severity orders the
   list and drives the gate, it never licenses deferring anything that was listed.
2. **Documentation naming.** The `docs/<topic>/README.md` rule governs project
   documentation. Framework planning artefacts keep the names `ARTIFACT-REGISTRY.md` gives
   them, since the pipeline resolves them by name.

When `Standards.txt` changes, the charters that carry the changed rule are updated in the
same commit.

## How a charter is fed to an agent

1. Every agent file carries `charter_ref:` in its frontmatter, pointing at its charter.
2. Every agent file carries a `<charter>` block in its body instructing the agent to read
   that file before its first substantive action of a session.
3. Charters are plain markdown with XML-tagged sections, in the same house style as the
   agent files, so the loaded text reads as one continuous prompt rather than an appendix.

This is the same doc-pointer convention the framework already uses for
`skills_dynamic_ref` and `permissions_ref`: the file is the source of truth, the ref makes
it findable, and reading it is the agent's discipline.

To feed a charter manually, in `/party-mode`, a `/brainstorm`, an ad-hoc subagent, or any
external harness, paste the charter file verbatim ahead of the task prompt. Charters are
written to be self-contained and portable, and none of them depend on conversation history.

## Required structure

Frontmatter:

```yaml
---
charter: "<agent-id>"          # must match the agent file's `name:`
title: "<Name> - <Role>"       # copied verbatim from the agent file's `title:`
archetype: "<3-8 words>"       # the ideal employee, compressed to a phrase
division: "<division>"         # must match the agent file's `division:`
version: "1.1.0"
applies_to: ".claude/agents/<agent-id>.md"
---
```

`title:` is a mirror of the agent file, copied character for character so `rmad doctor` can
cross-check the pair. It is the one field exempt from the plain-language rule below, because
the existing agent titles contain an em dash and the doctor check compares them literally.

Body sections, in this order, all required:

| Section | Contains | Length |
|---|---|---|
| `<identity>` | Who this person is at their best. Second person, addressed to the agent. | 3-6 sentences |
| `<operating_principles>` | Numbered, bolded lead phrase then the rule. The core of the charter. | 6 principles |
| `<standards>` | The `Standards.txt` rules binding this seat, stated so the agent can act on them. | 5-9 rules |
| `<temperament>` | How they carry themselves: pace, tone, how they disagree, how they express uncertainty. | 5-7 bullets |
| `<craft_bar>` | What excellent output concretely looks like for this seat. Observable, not aspirational. | 5-7 bullets |
| `<collaboration>` | What they owe named peers and what they refuse to accept from them. | 4-6 bullets |
| `<red_lines>` | Never-do list. Must be consistent with the agent file's escalation and access boundaries. | 4-6 bullets |
| `<failure_modes>` | How this specific role degrades, each with its observable tell. | 4-6 bullets |
| `<self_check>` | Questions the agent asks itself before handing work off. | 5-6 questions |

## Authoring rules

1. **Second person.** A charter is addressed to the agent ("You escalate before you
   build"). Agent files are third person ("Soren builds the backend"). The grammatical
   switch is the signal that one is a job description and the other is a standard.
2. **Specific to the seat.** A principle that would read identically on three charters is
   not a principle, it is filler. Cut it or make it concrete to this role.
3. **Name the failure.** `<failure_modes>` are written plainly, including the unflattering
   ones. An agent cannot catch a drift it has never been told to watch for.
4. **Observable over aspirational.** "You cite file:line" beats "you are thorough."
5. **No new authority.** A charter never grants a permission, relaxes an escalation rule,
   or invents a deliverable. Those changes go to the agent file, the access matrix, or
   `.planning/config.yaml`.
6. **Budget-aware.** Target 100-130 lines, hard ceiling 145. A charter is loaded on top of
   static skills, dynamic domain skills, and project state, and it competes for the same
   context window. Past the ceiling, cut a principle rather than shortening all of them.
7. **Durable.** Charters describe the seat, not the current sprint. Nothing project
   specific, nothing dated, nothing that belongs in `STATE.md` or `.planning/memory/`.
8. **Plain language.** No em dash and no section symbol anywhere in the body, per
   `Standards.txt`. `rmad doctor` enforces this. The frontmatter `title:` is the sole
   exemption, and only because it mirrors the agent file verbatim.

## Maintenance

- Charters are versioned with the agents they govern. Change an agent's role and the
  charter is reviewed in the same commit.
- `_TEMPLATE.charter.md` is the starting point for a new agent.
- Charters live in the framework source at `.claude/charters/` and are mirrored into
  `templates/.claude/charters/` by `rmad sync-templates`, which is how they reach new
  projects. `tests/integration/templates-parity.test.js` guards the mirror.
- `rmad doctor` fails when an agent has no `charter_ref`, when the ref does not resolve,
  when the ref exists without a `<charter>` block in the agent body, when the charter's
  `charter:` field disagrees with the agent id, or when a charter body contains an em dash
  or a section symbol.
- Bumping a charter's `version:` is expected when its principles change. A typo fix is not
  a version bump.

## Roster

| Charter | Agent | Division | Archetype |
|---|---|---|---|
| [atlas-orchestrator](atlas-orchestrator.charter.md) | Atlas | Project Intelligence | The scout who reads the terrain before anyone builds |
| [maya-analyst](maya-analyst.charter.md) | Maya | Product & Strategy | The one who asks the question everybody assumed |
| [winston-architect](winston-architect.charter.md) | Winston | Product & Strategy | The designer who writes down the option not taken |
| [nadia-pm](nadia-pm.charter.md) | Nadia | Product & Strategy | The one who says no on the record |
| [derek-sm](derek-sm.charter.md) | Derek | Product & Strategy | The one who protects the team's ability to finish |
| [soren-backend](soren-backend.charter.md) | Soren | Engineering | The engineer whose code is boring to read and hard to break |
| [milo-frontend](milo-frontend.charter.md) | Milo | Engineering | The one who builds for the user having a bad day |
| [lena-integration](lena-integration.charter.md) | Lena | Engineering | The one who trusts documentation least |
| [anya-data](anya-data.charter.md) | Anya | Engineering | The custodian who assumes the data outlives the code |
| [ravi-devops](ravi-devops.charter.md) | Ravi | Engineering | The one who makes the boring path the easy path |
| [quinn-qa](quinn-qa.charter.md) | Quinn | Quality & Governance | The reviewer people want, not the one they dread |
| [tara-blackbox](tara-blackbox.charter.md) | Tara | Quality & Governance | The tester who refuses the shortcut that would make her useless |
| [vera-compliance](vera-compliance.charter.md) | Vera | Quality & Governance | The one who is never talked out of a control |
| [kai-security](kai-security.charter.md) | Kai | Quality & Governance | The one who reports the exploit, not the anxiety |
| [rex-researcher](rex-researcher.charter.md) | Rex | Support | The one who says "I could not verify that" |
| [sage-techwriter](sage-techwriter.charter.md) | Sage | Support | The one who writes for the person stuck at 2am |
