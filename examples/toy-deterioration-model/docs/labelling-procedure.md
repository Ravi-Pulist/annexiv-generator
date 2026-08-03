---
document_type: labelling_procedure
attested_by: "M. Ferreira"
role: "Machine Learning Lead"
date: "2026-08-04"
covers_annex_iv: ["2(d)"]
---

# Data provenance, labelling and cleaning procedure

## Provenance

There is no data collection to describe. Every row was written by
`data/generate.py` from seed `20260804`. No real patient record, extract, de-identified
release or derivative of one was consulted at any point, by any person, in constructing
either the generator or its parameters. The parameters are textbook central values for
adult vital signs and common laboratory tests, chosen so that the synthetic cohort looks
plausible to a clinician; they were not fitted to any real dataset.

`data/manifest.json` carries `"synthetic_only": true` and the SHA-256 of the generator
itself, so the claim above is checkable: regenerate from source and the digests match, or
the claim is false. The test suite asserts both.

## Labelling procedure

Labels are **not** human-annotated, and no annotator, guideline, or adjudication process
exists to describe. The label is produced by the generator according to a published rule,
reproduced verbatim in `data/manifest.json` under `label_definition`.

**Step 1 — latent severity.** Each synthetic encounter receives an unobservable severity
`s ~ Normal(0, 1)` and an age drawn from `Normal(68, 16)` clipped to 18–98.

**Step 2 — true physiology.** The nine physiological values are drawn conditional on `s`:
vitals Gaussian, labs log-normal. SpO2 is capped at 100% in the generative model, because
a pulse oximeter cannot report above 100 and putting that ceiling in the cleaner instead
would have "corrected" a fifth of the cohort and made the cleaning count meaningless.

**Step 3 — the risk score.** A NEWS2-inspired ordinal score is computed **on the true
physiology**. Respiratory rate, SpO2, systolic pressure, heart rate and temperature each
contribute 0–3 points on the published NEWS2 cut-points. Four laboratory points are added:
2 for lactate ≥ 2.0 mmol/L, 1 further for lactate ≥ 4.0 mmol/L, 1 for creatinine ≥
150 µmol/L, and 1 for a white cell count outside 4.0–12.0 ×10⁹/L. This is a
label-generating device inside a synthetic-data script. It is not, and must not be read
as, a clinical implementation of NEWS2.

**Step 4 — the noisy link.** The label is *sampled*, not thresholded:

```
p     = sigmoid(0.55 * (risk_points - 6.8) + 0.012 * (age_years - 65))
label = Bernoulli(p)
```

Sampling matters. A hard threshold on `risk_points` would make the label a deterministic
function of nine columns, and the model's job would be to rediscover a step function.
Real deterioration is not a step function of a vitals chart, and a documentation exhibit
built on one would have no genuine sensitivity/specificity trade-off to reason about.

**Step 5 — measurement error.** Only now is the physiology handed to the recording layer,
with noise added: Gaussian for vitals, multiplicative log-normal for labs. **The model
sees the recorded values; the label came from the true ones.** This gap is the single most
important fact about this dataset. It is why achievable AUROC sits around 0.78–0.80 rather
than near 1.0, and it is intentional — see `docs/design-rationale.md`.

Resulting prevalence: **13.7%** across 4016 retained encounters (train 2409, val 802,
test 805), stratified so each split carries the same positive rate to within a fraction of
a point.

## Selection

**Rule.** Exclude any encounter with fewer than 6 hours of recorded observation.
**Excluded: 384 of 4400 raw encounters (8.7%).**

**Why.** Such an encounter cannot express a deterioration trajectory; its chart is
dominated by admission-time values and the label is close to noise. Including them would
depress measured performance for a reason that has nothing to do with the model.

**When.** Before splitting, deliberately. If selection ran after the split, an excluded
encounter would already have influenced which split its neighbours landed in. The
criterion is applied to the whole cohort while it is still one cohort.

**What it costs.** The deployed intended population is narrowed to match: the model card
restricts use to encounters with at least six hours of observation. The first six hours of
an admission — a period when patients do deteriorate — are outside the intended purpose
and the screen must not be used there.

## Cleaning

Two steps, in this order, applied after the split.

**Step 1 — implausible-range rejection.** Every physiological cell is tested against a
fixed clinical plausibility interval declared in `config/training.yaml` under
`data.cleaning.bounds` (for example heart rate 20–220 bpm, SpO2 50–100%, temperature
30–43 °C). A cell outside its interval is treated as a device or charting artefact — a
disconnected probe, a zeroed monitor, a mis-scaled result — and **discarded**, not
winsorised. **153 cells were rejected.**

Discarding rather than clipping is a considered choice. Winsorising a disconnected SpO2
probe reading 5% to the lower bound of 50% would replace an obvious artefact with a
convincing severe hypoxia, and the model would learn from it. An artefact should become
missing, not become a plausible extreme value.

The intervals are constants, not percentiles of the observed data. Nothing about the
distribution of one split leaks into the treatment of another, which is why this step can
safely be applied to all three.

**Step 2 — median imputation.** Rejected cells, and cells that were already blank (188 of
them, from the generator's simulated missing labs and unrecorded temperatures), are filled
with the median of that column computed **on the training split only**. Those constants
are then applied unchanged to validation and test. Medians are computed *after* rejection
so that an artefact cannot drag the constant it will itself be replaced by.

**341 cells imputed in total**, which is what `cleaning.modified` reports in the manifest.
The count is in cells, not rows.

**The limitation this creates.** Median imputation makes a missing observation look
average, and in a deterioration screen a missing observation is not average — an
unrecorded respiratory rate is more likely on a busy ward with a sick patient. The model
is therefore trained on data where missingness has been made benign. This is why
`input_schema.py` refuses to impute at inference time and requires all ten values: the
training-time fill was a decision made with the training distribution visible, and
reapplying it silently to a live encounter would hide a gap from the person who needs to
see it. Tracked as R-05.

## Splitting

Stratified 60/20/20 on the label, seeded from `config/training.yaml` (`seed + 1`),
implemented by hand in `stratified_split` rather than delegated, so the assignment rule is
auditable from one file. Rows are written in their original generation order within each
split, so the CSV byte layout is a function of the generator rather than of the shuffle.

## Verification

`python data/generate.py` twice from a clean tree produces byte-identical CSVs and an
identical `data/manifest.json`. `tests/test_repo.py` regenerates the dataset into a
temporary directory and compares digests against the committed manifest, so a change to
the generator that alters the data cannot pass CI without the manifest being regenerated
alongside it.
