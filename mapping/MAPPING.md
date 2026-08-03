# The Annex IV mapping spec

**Every Annex IV requirement, and the machine-checkable evidence in a
repository that can support it.**

This document and its machine-readable twin, [`annex-iv.yaml`](annex-iv.yaml),
are the spine of the generator. They are published separately because the
mapping is useful on its own: it is the instrument for a readiness scan, and
publishing it means our reading of the regulation is findable and correctable
in public rather than buried in a tool.

> **Boundary.** This is documentation support and engineering evidence. It is
> not legal advice, not a conformity assessment, and it does not by itself
> make any system compliant. Classification of a system and submission to any
> authority remain with the provider's regulatory and legal owners.

---

## Provenance — what was verified, and how

Every quoted requirement below is **verbatim** from the Official Journal text
of Regulation (EU) 2024/1689, retrieved 4 August 2026 from:

| Source | Used for |
|---|---|
| [EUR-Lex, OJ L 2024/1689](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ:L_202401689) | The Annex IV text, Articles 6, 11, 113, Annexes I and III |
| [EUR-Lex, consolidated 02024R1689-20260727](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02024R1689-20260727) | Current text; Annex IV diffed against the original — **identical, never amended** |
| [EUR-Lex, OJ L 2026/1744](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ:L_202601744) | The Digital Omnibus on AI, which amended Article 113 |
| [AI Act Explorer, Annex IV](https://artificialintelligenceact.eu/annex/4/) | Independent cross-check of all 9 points |

**What is ours, not the regulation's.** Section titles are our short labels.
Where points 3, 7 and 9 are printed as single unlettered blocks, our
decomposition into "limbs" is flagged `limbs_are_our_decomposition: true` in
the YAML and is stated as ours in every generated pack. The regulation letters
sub-points only on points 1 and 2.

**An oddity in the published text.** Point 1 contains the phrase *"a basic
description of the user-interface provided to the deployer"* twice — as the
whole of 1(g) and again inside 1(h). This is present in the OJ, the
consolidated version and the AI Act Explorer. We render it as published and do
not silently deduplicate.

---

## When the obligation applies — read this before anything else

**As at 4 August 2026, the Annex IV documentation duty is not yet
applicable to anyone.**

Regulation (EU) 2026/1744 (the Digital Omnibus on AI, in force 27 July 2026)
rewrote Article 113. Chapter III Sections 1–3 — which contain Article 11 and
therefore Annex IV — were deferred:

| Classification route | Annex IV applies from |
|---|---|
| Annex III / Article 6(2) — standalone high-risk use case | **2 December 2027** |
| Annex I / Article 6(1) — product safety route (MDR/IVDR) | **2 August 2028** |

Systems already on the market before those dates are out of scope unless
significantly redesigned (Article 111(2) as amended), with a 2 August 2030
backstop for public-authority systems.

**Which route a healthcare system takes matters, and it is not obvious.**
Annex III contains **no entry** for medical diagnosis, clinical decision
support or treatment recommendation. Those become high-risk only via Article
6(1) — the system must be a medical device or a safety component of one under
MDR/IVDR **and** require third-party conformity assessment. Annex III does
touch healthcare at three separate points: 5(a) eligibility for benefits
including healthcare services, 5(c) life and health insurance pricing, and
5(d) emergency call triage and dispatch.

**This tool never determines the route.** It takes the provider's declared
classification as input, records it as an attested input, and states the
corresponding date. Determining classification is a regulatory decision.

*Noted as read, not as advice:* Chapter III Section 5 (including Article 47,
the EU declaration of conformity) and Chapter IX (Article 72, post-market
monitoring) became applicable on 2 August 2026, while the Section 2
requirements they certify are deferred. That is what the amended text says;
its consequences are a question for qualified advisers.

---

## The three evidence classes

| Class | Meaning | Test |
|---|---|---|
| **MEASURED** | Produced by running something — a hash, a test report, a dependency tree, a git history | Reproducible from the repository |
| **ATTESTED** | Prose a **named** human signed, with role and date | Front-matter carries `attested_by`, `role`, `date` — anonymous prose is **not** ATTESTED |
| **MISSING** | The repository cannot support it | Becomes a named gap with a stated reason and a remediation action |

Annex IV genuinely requires human judgement in places — design rationale,
metric appropriateness, oversight measures. Pretending that prose is derived
fact would be a lie; omitting it would make the pack useless. Labelling it is
the honest third option.

---

## The mapping

### 1 · General description of the AI system
> *A general description of the AI system including:* (a)–(h)

| Evidence source | Class | Supports | Looks for |
|---|---|---|---|
| `attested_docs` | ATTESTED | a, b, d, e, g, h | model card intended-use and deployment sections, signed and dated |
| `git` | MEASURED | a, c | tags and release history for the version and its relation to previous versions |
| `manifests` | MEASURED | c, e | pinned dependency versions, runtime version, declared hardware requirements |

### 2 · Elements of the AI system and its development process
> *A detailed description of the elements … and of the process for its
> development, including:* (a)–(h). The most MEASURED-rich section.

| Evidence source | Class | Supports | Looks for |
|---|---|---|---|
| `manifests` | MEASURED | a, c | third-party components, lockfile dependency tree, pinned environment |
| `custody` | MEASURED | a, d | model checkpoint hashes, licences, CycloneDX ML-BOM |
| `dataset_manifest` | MEASURED | d | per-file hashes, generation script + seed, selection and cleaning steps |
| `eval_report` | MEASURED | g | validation procedure, split description, metrics with intervals, dated signed report |
| `attested_docs` | ATTESTED | b, d, e, f, h | design rationale, labelling procedure, human-oversight assessment, cybersecurity measures |

Note 2(d) is where **data requirements** live — provenance, selection,
labelling, cleaning. There is no top-level data section in Annex IV.

### 3 · Monitoring, functioning and control
> One unlettered block. **Our** decomposition splits overall accuracy from
> subgroup accuracy deliberately.

| Evidence source | Class | Supports | Via capability key |
|---|---|---|---|
| `eval_report` | MEASURED | overall_accuracy | `eval.overall_accuracy` |
| `eval_report` | MEASURED | subgroup_accuracy | `eval.subgroup_accuracy` |
| `input_schema` | MEASURED | input_specifications | — |
| `attested_docs` | ATTESTED | overall_accuracy, unintended_outcomes, human_oversight | — |

**Why the split matters.** The text asks for "the degrees of accuracy for
specific persons or groups of persons" *and* "the overall expected level of
accuracy". A report carrying only the overall number satisfies one and not the
other. Capability keys are what stop a present-but-incomplete file from
satisfying a requirement it does not cover — the single most important
mechanic in this mapping.

### 4 · Appropriateness of the performance metrics
> *A description of the appropriateness of the performance metrics for the
> specific AI system;*

Complete only when an ATTESTED rationale exists **and** names at least one
metric the eval report actually computes. Prose about metrics nobody measured
is not a description of their appropriateness.

### 5 · Risk management system (Article 9)
Structure is machine-checked, content is attested. Every entry needs `id`,
`description`, `owner`, `status`, `mitigation`, `review_date`. A log missing
owners is `structurally_invalid`, not weak evidence: an unowned risk is not
managed, and a mitigation nobody revisits is a sentence, not a control.

### 6 · Lifecycle changes
Git history and CHANGELOG. Distinct from 2(f): point 6 is changes **actually
made**, 2(f) is **pre-determined** changes. Kept separate deliberately.

### 7 · Harmonised standards, or alternative solutions
An either/or in the text. A declared standards list, or an attested
description of the solutions adopted instead. Neither present is a named gap.

### 8 · EU declaration of conformity (Article 47) — **permanent gap**
> *A copy of the EU declaration of conformity referred to in Article 47;*

**This tool will never generate, draft or template this.** The declaration is
a legal act executed by the provider. It is flagged as a permanent by-design
gap in every pack, including packs that are otherwise complete — the clearest
demonstration available that the tool refuses to overreach. The spec loader
enforces it: a permanent-gap section that declares evidence sources is a
validation error.

### 9 · Post-market performance evaluation (Article 72, 72(3))
Two limbs, checked separately: the evaluation **system** (Article 72) and the
monitoring **plan** (Article 72(3)) as its own named artefact. A general
description of monitoring does not satisfy the plan requirement.

---

## Articles cross-referenced by the Annex IV text

Exhaustively: **Article 9, Article 11(1), Article 13(3)(d), Article 14,
Article 47, Article 72, Article 72(3)**, plus four references to Chapter III
Section 2.

**Article 10 and Article 15 are *not* cited anywhere in Annex IV**, despite
being commonly assumed to be. Data governance reaches the documentation duty
through the substantive wording of 2(d); accuracy, robustness and
cybersecurity through 2(g), 2(h), point 3 and the Chapter III Section 2
references. This tool does not synthesise article anchors the annex does not
contain.

---

## Versioning

Article 11(3) empowers the Commission to amend Annex IV by delegated act. The
spec is versioned (`spec_version`) and hashed; every generated pack records
the hash of the mapping that produced it, so a reader can tell which reading
of the regulation a document reflects. The test suite pins the verified
structure — if the annex changes, those tests fail, which is the intended
alarm.
