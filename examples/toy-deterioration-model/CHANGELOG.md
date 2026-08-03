# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Dates are release dates and are hardcoded. Nothing in this repository calls the
wall clock — generated artifacts must be byte-identical between runs, so a
timestamp anywhere in the pipeline would be a defect.

## [Unreleased]

## [0.2.0] - 2026-08-04

An operating-point release. Discrimination did not improve and this changelog does not
claim it did.

### Changed

- `config/training.yaml` — features are standardised before fitting, `C` is 0.35, and
  `class_weight` is `balanced`. The features span 0.2 mmol/L to 900 µmol/L, so an
  unscaled L2 penalty was regularising creatinine into irrelevance while leaving lactate
  almost untouched. The class weighting is the change that actually mattered.
- **Operating point is now derived, not defaulted.** The threshold is the highest one
  whose *validation* sensitivity reaches a 0.70 target — 0.4176 — chosen from a documented
  trade-off curve rather than left at the library default of 0.50. The test split is still
  read exactly once, after the threshold is fixed.
- `custody/register.json`, `custody/ml-bom.json` regenerated for the new artefact
  (`6e9c8d7f…`); ML-BOM version bumped to 0.2.0.
- `docs/model-card.md`, `docs/metric-rationale.md`, `docs/human-oversight.md` and
  `risk-log.yaml` R-01/R-03 updated to the measured v0.2.0 figures.

### Measured performance

Held-out test split, n = 805, positive rate 0.138, threshold 0.4176:

| Metric | v0.1.0 | v0.2.0 | 95% CI (Wilson) |
| --- | --- | --- | --- |
| AUROC | 0.799 | 0.797 | — |
| Sensitivity | 0.279 | **0.784** | 0.698 – 0.850 |
| Specificity | 0.989 | 0.650 | 0.614 – 0.684 |
| PPV | 0.795 | 0.264 | 0.219 – 0.314 |
| NPV | 0.896 | 0.949 | 0.926 – 0.966 |

AUROC moved from 0.799 to 0.797 — that is, nowhere. Five-fold cross-validated AUROC on
train spans 0.704–0.821, so a two-point difference is not a difference. **The entire
release is the threshold.** Sensitivity nearly tripled and specificity was spent to buy
it, which is the trade this system is supposed to make.

### Known issues

- The screen now flags 330 of 805 test encounters and roughly three in four of those flags
  are false. Alarm fatigue moves from theoretical to the most likely practical failure
  mode. R-01 stays **open** and nothing in this repository measures the realised alert
  rate in service.
- Still misses about one deterioration in five; the interval allows one in three.
- Both deliberate absences are unchanged: no subgroup breakdown, no post-market monitoring
  plan.

## [0.1.0] - 2026-08-03

First evidence-complete release. The model is bad and the documentation says so;
that combination is the point of the exhibit.

### Added

- `data/generate.py` — synthetic encounter generator, seed 20260804. 4400 raw
  encounters, a documented selection rule (under 6h of observation excluded,
  384 removed) and a documented cleaning step (153 implausible cells rejected,
  188 already blank, 341 imputed from TRAIN medians).
- `data/manifest.json` — dataset provenance pinning each split by SHA-256,
  carrying the generator's own digest, the label definition and
  `synthetic_only: true`.
- `input_schema.py` — pydantic specification of the ten inference inputs with
  units and acceptance ranges, sharing the cleaner's plausibility intervals.
- `train.py`, `config/training.yaml` — L2 logistic regression, unscaled,
  default `C`, no class weighting. Verifies every CSV against the manifest
  before fitting and refuses to train on a mismatch.
- `eval/evaluate.py`, `eval/report.json` — held-out evaluation with Wilson 95%
  intervals implemented in-repo. Threshold selected before the test split is
  read.
- `docs/model-card.md`, `docs/design-rationale.md`, `docs/human-oversight.md`,
  `docs/metric-rationale.md`, `docs/labelling-procedure.md` — attested, with
  YAML front-matter naming an attestor, a role, a date and the Annex IV points
  covered.
- `risk-log.yaml` — nine risks, six mandatory fields each, machine-checkable.
- `custody/register.json`, `custody/ml-bom.json`, `custody/pin.py` — the model
  pinned by SHA-256 in a plain register and in a CycloneDX 1.6 ML-BOM, both
  derived from the artifact on disk rather than hand-maintained.

### Known issues

- **Sensitivity 0.279 (95% CI 0.204–0.369) at the 0.50 operating point.** AUROC
  is 0.799, so the ranking is usable; the default threshold then discards it,
  flagging 39 of 805 test encounters and missing seven deteriorations in ten.
  Released as-is because the baseline is what the next version has to beat, and
  a number this bad is more useful in the record than absent from it. Tracked
  as R-06.
- No subgroup accuracy breakdown (`subgroup_breakdown: null`). Deliberate; see
  `docs/KNOWN-GAPS.md` and R-02.
- No post-market monitoring plan. Deliberate; see `docs/KNOWN-GAPS.md` and R-07.
