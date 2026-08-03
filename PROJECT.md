# EU AI Act Annex IV Generator — project state

Python 3.10 CLI product (the rmad-init template's guessed node/react/postgres
stack was wrong and is replaced by this file). Domain: healthcare. Built
2026-08-04 under RMAD governance.

## The correction this build had to make first

The story plan's pitch was *"Your high-risk AI system must carry Annex IV
technical documentation as of August 2026."* **That is no longer true**, and
day one of the plan's own build schedule — verify against the Official Journal
rather than recall — is what caught it.

**Regulation (EU) 2026/1744** (the Digital Omnibus on AI, published 24 July
2026, in force 27 July 2026) rewrote Article 113 and deferred Chapter III
Sections 1–3, which contain Article 11 and therefore the entire Annex IV duty:

| Classification route | Annex IV applies from |
|---|---|
| Annex III / Art. 6(2) — standalone high-risk use case | 2 December 2027 |
| Annex I / Art. 6(1) — MDR/IVDR product route | 2 August 2028 |

Marketing copy claiming the obligation is live today would be exactly the
"claim drift" the plan's own §10 names as the top risk. The correction is
encoded as data in `mapping/annex-iv.yaml`, pinned by tests, and printed in
every generated pack — so the tool states the right date for the declared
route instead of a slogan.

Other corrections the verification produced:

- Annex IV has 9 top-level points; **only points 1 and 2 carry lettered
  sub-points** (a)–(h). Points 3, 7 and 9 are unlettered blocks — any
  sub-structure is ours and is disclosed as ours in the pack.
- **Articles 10 and 15 are not cited anywhere in Annex IV**, despite the
  common assumption. The tool does not synthesise anchors the annex lacks.
- The SME simplified-form provision is **Article 11(1) second subparagraph**,
  not Article 11(2). Article 11(2) requires a *single* technical documentation
  set for Annex I products — relevant for MDR/IVDR clients, who should get a
  merged pack rather than two parallel ones.
- **Annex III contains no entry for medical diagnosis or clinical decision
  support.** Those reach high-risk only via Article 6(1) + Annex I. Annex III
  touches healthcare at 5(a) benefits eligibility, 5(c) health insurance
  pricing and 5(d) emergency triage.
- Point 1 duplicates "a basic description of the user-interface provided to
  the deployer" across 1(g) and 1(h) in the published text. Rendered as
  published, not silently deduplicated.

## Delivered

- `annexiv generate | audit | gaps` over any repository, read-only
- `mapping/annex-iv.yaml` + published `mapping/MAPPING.md` — the spine, every
  requirement verbatim with its provenance
- Evidence-or-gap invariant enforced by the type system (`Claim` has no
  constructor for an unsupported assertion) **and** re-checked independently
  by the auditor on the serialised pack
- 10 extractors; capability keys so a present-but-incomplete file cannot
  satisfy a requirement it does not cover
- 68 tests green; **auditor mutation adequacy 22/22**
- Empty-repo exhibit: 9/9 sections addressed, 29 gaps, zero prose

## Measured results (toy repo, route annex_i, 2026-08-04)

Subject: `examples/toy-deterioration-model` (vendored into this repo).

| Metric | Target | Measured |
|---|---|---|
| Section coverage | 9/9 | **9/9** |
| Evidence-backed claim ratio | ≥70% | **79.3%** (23/29) |
| MEASURED share | ≥33.3% | **58.5%** (24/17) |
| Zero silent assertions | 0 | **0** (independent audit) |
| Citation resolution | 100% | **41/41** |
| Gaps named | ≥3 | **6** (1 permanent) |
| Determinism | identical | **byte-identical** |

The example was developed as a standalone repository and is vendored here as
plain files with its history preserved in `git-history.bundle`. Without a live
`.git` it yields three fewer MEASURED citations (58.5% vs 63.8% with history
restored); no gap register entry changes, because the git evidence was
redundant with the CHANGELOG and manifests.

All six targets met. One defect the measurement caught: every `attested_docs`
source matched every requirement of its section, so 1(a) "intended purpose and
provider name" cited the cybersecurity and standards documents. Gating the
sources by document type took citations from 150 to 47 and raised the MEASURED
share from 20.0% to 63.8% — the earlier figure was spurious attested citations
crowding out machine-derived ones.

## Completion predicate (rmad task ANNEX-1) — honest residual

```
NOT DONE (6/6 evaluated)  R = 58   commit d35ab60f
O1 FAIL  10 criteria have no passing test at this commit   +30
O2 FAIL  66/94 blast-radius symbols covered; 28 uncovered  +28
O3 ok    baseline holds (68 passing)
O4 ok    no structural debt vs snapshot
O5 ok    scope respected
O6 ok    observed running (smoke at this commit)
```

`rmad doctor`: **HEALTHY, 73 passed / 0 failed**.

- **O1** — RMAD's own BENCHMARK.md records this join as open: pytest node-ids
  and graph test symbols do not join, so no criterion can be "realised" from a
  pytest oracle today. Compensating evidence: all five criteria have dedicated
  passing tests. The count is 10 rather than 5 because a retried
  `task criterion` batch duplicated each statement; the duplicates are
  accidental and left in place rather than hand-edited out of the evidence
  store.
- **O2** — the graph's own `index untested` reports a single untested symbol
  in the package (`render_markdown`), which the end-to-end tests do exercise
  in-process; the discrepancy is the same test-symbol join gap as O1.
- **O5** — fixed during the build. The predicate correctly caught that
  `.planning/evidence/build.jsonl`, which RMAD writes when observations are
  recorded, sat outside the declared scope. Scope corrected rather than
  waived.

## Known deviations from the story plan

- **Python 3.10**, not 3.12 as the plan specified — the build host's
  interpreter. Nothing uses a 3.11+ feature.
- **PDF rendering not implemented.** The plan left the weasyprint/pandoc
  choice to day 6 and neither is installed on this host. Markdown is the
  source of truth by design; PDF is a rendering, and its absence is recorded
  here rather than claimed as done.
- The plan's "≥70% evidence-backed claims" target is a property of the demo
  subject, not of the tool; see the README for the measured number.

## Follow-ups

- PDF rendering once a renderer is available on the host
- Upwork entry (fields ready in story-plan §8; posting is the user's) — with
  the **date claim corrected**: the deadline is Dec 2027 / Aug 2028, not
  August 2026. The corrected timeline is a stronger pitch, not a weaker one:
  there is now runway to build evidence before the obligation bites, which is
  precisely what a readiness scan sells.
- The plan's day 1–2 Upwork demand search remains unrun.
