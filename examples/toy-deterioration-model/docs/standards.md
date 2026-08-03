---
document_type: standards
attested_by: "H. Bauer"
role: "Quality and Regulatory Manager"
date: "2026-08-04"
covers_annex_iv: ["7"]
---

# Declared standards and alternative solutions

Annex IV point 7 asks for a list of the harmonised standards applied in full or in part,
and — where none have been applied — a description of the solutions adopted instead to
meet the requirements of Chapter III, Section 2.

## Harmonised standards applied

**None.**

No harmonised standard is applied, in full or in part. The provider makes no claim to the
presumption of conformity that Article 40 attaches to harmonised standards, and nothing in
this repository should be read as such a claim.

The reason is stated plainly rather than dressed up: this is a demonstration artefact that
will never be placed on the market or put into service. Pursuing conformity to a
harmonised standard for a system that is never deployed would produce a paper exercise,
and a paper exercise in a documentation exhibit is worse than an honest blank. A provider
of a real high-risk system would be expected to work from the harmonised standards
available at the time of its conformity assessment, and to record here which ones and to
what extent.

## Alternative solutions adopted

What was done instead, and against which Chapter III, Section 2 requirement. Several of
these draw on published standards without claiming conformity to them; where that is the
case it is said so explicitly.

| Requirement | Solution adopted | Evidence |
| --- | --- | --- |
| Art. 9 — risk management | A structured, machine-checkable risk register: nine entries, six mandatory fields each, status confined to open / mitigated / accepted, with `accepted` meaning owned-and-uncontrolled rather than closed. Informed by the hazard-and-control structure of ISO 14971 for medical devices; **no conformity to ISO 14971 is claimed** and no clinical risk-management file exists. | `risk-log.yaml`, `tests/test_repo.py::test_risk_log_entries_are_complete` |
| Art. 10 — data governance | Documented provenance, a documented selection criterion applied before splitting, a documented cleaning procedure with per-cell counts, and imputation constants fitted on the training split alone. Every split pinned by SHA-256 and reproducible from seed. Structurally aligned with the data-quality vocabulary of ISO/IEC 5259; **no conformity claimed**. | `data/manifest.json`, `docs/labelling-procedure.md` |
| Art. 11 / Annex IV — technical documentation | This document set: seven attested Markdown documents carrying machine-readable front-matter that names an attestor, a role, a date and the Annex IV points covered. Anonymous prose is treated as missing evidence, and the test suite enforces that. | `docs/*.md`, `tests/test_repo.py::test_attested_doc_front_matter_is_complete` |
| Art. 12 — record-keeping | Not addressed at system level. Git history, annotated release tags and content digests provide traceability for the *development* record. There is no runtime logging capability, because there is no runtime. | git history, `custody/register.json` |
| Art. 13 — transparency to deployers | A model card following the Mitchell et al. (2019) structure — intended purpose, users, population, capabilities, limitations, foreseeable misuse — with measured performance and confidence intervals stated in the body rather than an appendix. Limitations are enumerated before capabilities are elaborated. | `docs/model-card.md` |
| Art. 14 — human oversight | Oversight measures specified as constraints on the deployer's interface and local policy: the probability and threshold are always shown with the flag, the measured sensitivity is displayed alongside every result, a flag is never a precondition for escalation, and no record is made of an unactioned flag. Stop conditions are enumerated, and the document states that all of them depend on a human noticing. | `docs/human-oversight.md` |
| Art. 15 — accuracy | Measured on a held-out split read exactly once, after the operating point was fixed on validation. Wilson score intervals (Wilson, 1927) on every proportion, implemented in-repo rather than imported so a reader can check the fifteen lines. No AUROC interval, because AUROC is not a binomial proportion and a Wilson interval on it would be wrong. | `eval/report.json`, `docs/metric-rationale.md` |
| Art. 15 — robustness | Full determinism as a stated design constraint: one seed, no wall-clock call anywhere in the pipeline, uncompressed serialisation, pinned line terminators and rounding. Two rebuilds from scratch produce byte-identical data and reports, and the test suite verifies it by rebuilding twice in isolated trees. | `tests/test_repo.py::test_dataset_rebuilds_byte_identically` |
| Art. 15 — cybersecurity | Content addressing throughout, cross-checked at three pipeline stages with hard failure on mismatch; exact dependency pinning; no network, credentials or data at rest. Reproducibility from source is treated as the primary integrity control, since it does not require trusting the provider. | `docs/cybersecurity-measures.md`, `custody/` |

## Other published specifications followed

Not standards in the Article 40 sense, but named so a reader knows what shapes these files
took:

- **CycloneDX 1.6** — `custody/ml-bom.json` is a conforming ML-BOM document with a
  `machine-learning-model` component carrying a SHA-256 hash, a `modelCard` block with
  `modelParameters`, `quantitativeAnalysis` and `considerations`. This one *is* followed
  as specified, and the test suite checks the format markers.
- **Keep a Changelog 1.1.0** and **Semantic Versioning 2.0.0** — `CHANGELOG.md`, release
  tags.
- **NEWS2** (Royal College of Physicians) — the cut-points used by the synthetic label
  generator. Used as a source of plausible thresholds for generating synthetic data. This
  is emphatically **not** an implementation of NEWS2 and must not be read as one.
- **Wilson (1927)**, *Probable inference, the law of succession, and statistical
  inference* — the interval method in `eval/evaluate.py`.
- **Mitchell et al. (2019)**, *Model Cards for Model Reporting* — the structure of
  `docs/model-card.md`.

## Gaps against Chapter III, Section 2

Two requirements are knowingly unmet, and neither is hidden behind a partial claim above:

1. **Art. 15 accuracy, per-group.** Annex IV point 3 requires accuracy for specific
   persons or groups. No subgroup breakdown has been computed; `subgroup_breakdown` is
   `null` in the evaluation report. See `docs/KNOWN-GAPS.md` and R-02.
2. **Art. 72 post-market monitoring.** No plan exists, and several risk-log mitigations
   name monitoring as the control they would otherwise rely on. See `docs/KNOWN-GAPS.md`
   and R-07.

A conformity assessment of this system would fail on both. That is the intended state of
the exhibit.
