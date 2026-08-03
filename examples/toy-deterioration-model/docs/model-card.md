---
document_type: model_card
attested_by: "Dr. A. Nowak"
role: "Clinical Lead"
date: "2026-08-04"
covers_annex_iv: ["1(a)", "1(b)", "1(d)", "1(g)", "1(h)", "3"]
---

# Model card — deterioration early-warning screen (toy)

**Everything below describes a demonstration artefact.** The provider is fictional, the
data is synthetic, and the system has never been deployed. It is not a medical device,
carries no CE mark, and has undergone no clinical investigation. It exists so that an
Annex IV documentation generator has a real repository to read instead of a mock-up.

## 1(a) Intended purpose and provider

**Provider.** Northgate Clinical Informatics — a fictional entity used throughout this
repository as the notional provider. No real organisation is described.

**Intended purpose.** To score an adult inpatient encounter, once per observation round,
on ten routinely recorded values and raise a *flag for clinician review* when the
estimated probability of deterioration in the next observation window crosses a published
threshold. The output is a prompt to look at a patient. It is not a diagnosis, not a
triage category, not an escalation instruction, and not a substitute for the ward's
existing early-warning score.

**Intended users.** Registered nursing and medical staff on general adult inpatient wards,
and critical-care outreach teams. Not intended for patients, relatives, or administrative
staff.

**Intended population.** Adults aged 18 and over admitted to a general ward, with at least
six hours of recorded observation. Explicitly out of scope: paediatrics, obstetrics,
emergency-department triage before admission, intensive care (where the monitoring density
makes a six-hourly screen pointless), and end-of-life care where escalation is not the
goal.

## 1(b) Interaction with other systems

The model is a single `models/model.joblib` artefact, loaded in-process. It has no network
dependency, no external service call, and no database. In a notional deployment it would
sit behind the electronic patient record's observations module: the EPR assembles the ten
values, calls the scorer, and renders the result on the ward list. Nothing in this
repository implements that integration — `input_schema.py` is the contract it would have
to satisfy.

## 1(d) Deployment forms

Source distribution only. There is no container image, no packaged installer, and no
hosted endpoint. A deployer takes the repository at a tagged release, installs the pinned
requirements, and loads `models/model.joblib`. The artefact is pinned by SHA-256 in
`custody/register.json` and in the CycloneDX ML-BOM at `custody/ml-bom.json`; a deployer
who does not verify that digest before loading is running an unknown model.

## 1(g) User interface for the deployer

No graphical interface ships with the system. What the deployer receives is:

- `input_schema.py` — a pydantic model of the ten inputs with units and acceptance
  ranges. Out-of-range values raise rather than scoring.
- a returned `ScreenResult` carrying the probability, the threshold in force, the boolean
  flag, and the digest of the model that produced the score.

The probability and the threshold are returned deliberately, not just the boolean. A
clinician who can see that an encounter scored 0.43 against a threshold of 0.42 is in a
different position from one shown a red dot. Any deployer-built interface that discards
the probability, or that renders the flag without the accompanying uncertainty, is outside
the intended purpose described here.

## 1(h) Instructions for use

1. Verify the SHA-256 of `models/model.joblib` against `custody/register.json`.
2. Construct an `EncounterFeatures` from the ten values. Do not impute at inference
   time — the training-time median fill was a decision made with the training
   distribution visible, and reapplying it live would hide a missing observation from
   the person who needs to know it is missing. If a value is unavailable, do not call
   the model; escalate through the ward's normal route.
3. Score. Flag when `probability >= threshold`, where the threshold is the one published
   in `eval/report.json` under `operating_point`.
4. Present the flag alongside the probability, the threshold, and the statement that the
   screen misses roughly one deterioration in five and that most flags are false. See
   `docs/human-oversight.md` for the Article 14 measures the deployer is expected to keep
   in place.
5. Do not re-tune the threshold locally without re-running `eval/evaluate.py` and
   re-attesting the report. The published sensitivity is only valid at the published
   threshold.

## 3 Capabilities, limitations, and measured performance

Measured on the held-out test split (n = 805, positive rate 0.138) at threshold 0.4176,
selected on validation. Full numbers, with Wilson 95% intervals, in `eval/report.json`.

| Metric | Value | 95% CI (Wilson) | n |
| --- | --- | --- | --- |
| AUROC | 0.797 | not computed — see `docs/metric-rationale.md` | 805 |
| Sensitivity | 0.784 | 0.698 – 0.850 | 111 |
| Specificity | 0.650 | 0.614 – 0.684 | 694 |
| PPV | 0.264 | 0.219 – 0.314 | 330 |
| NPV | 0.949 | 0.926 – 0.966 | 475 |

Confusion matrix on the test split: 87 true positives, 243 false positives, 451 true
negatives, 24 false negatives.

**Read the PPV column before the AUROC column.** The screen flags 330 of 805 encounters —
about two in five — and roughly three in four of those flags are wrong. That is the cost
of reaching 0.784 sensitivity on a model with this much discrimination, and it is the
central fact a deployer needs. It is not a defect to be fixed by moving the threshold:
moving it up trades sensitivity away one-for-one, and the trade-off curve is documented in
`docs/metric-rationale.md`.

The screen still misses roughly one deterioration in five (24 of 111), and the lower bound
of that interval allows one in three. Nothing about a missing flag should be read as
reassurance.

For comparison, the v0.1.0 configuration reported AUROC 0.799 with sensitivity 0.279
(0.204 – 0.369). Discrimination is unchanged — 0.797 against 0.799 is well inside the noise
of a test split this size. What changed is the operating point, which is now derived from
the quantity that matters instead of left at a library default.

**Capabilities.** Ranks encounters by deterioration risk better than chance, using only
values already recorded on every observation round, with no additional data collection and
no clinician workload at the point of capture. Cheap to run and fully inspectable — the
model is ten coefficients and an intercept, so any prediction can be decomposed by hand.

**Limitations.**

- Trained and evaluated entirely on synthetic data from one generator. Nothing here
  transfers to a real population. Every performance figure describes the model's ability
  to recover a rule the same script wrote.
- Single-timepoint. The model sees one snapshot; it cannot see a trend, and a patient
  whose heart rate has climbed thirty beats in four hours but is still in range looks
  identical to one who has sat there all day. Trend is the strongest signal in real
  deterioration detection and this model does not use it.
- No subgroup accuracy breakdown has been computed. `sex` and `age_years` are recorded and
  the analysis is straightforward; it has not been done. See `docs/KNOWN-GAPS.md`. The
  system therefore makes **no claim** that performance is comparable across sexes or age
  bands, and a deployer must not assume it.
- Training cohort ages 18–98. `input_schema.py` accepts up to 120; anything above 98 is
  out of distribution and unvalidated.
- Assumes all ten values are present and plausible. Performance where observations are
  patchy — which is where deterioration screens matter most — is uncharacterised.
- No post-market monitoring plan exists. Also in `docs/KNOWN-GAPS.md`.

## Foreseeable unintended outcomes and misuse

- **Alarm fatigue.** At the published operating point the screen flags about two in five
  encounters and is wrong about three times in four when it does. Wards that receive more
  flags than they can act on stop acting on them, and the screen becomes a liability at
  exactly the moment it starts working. This is the most likely way the system fails in
  practice. Tracked as R-01.
- **Automation bias in the negative direction.** The larger risk is not the false alarm;
  it is a clinician who was going to escalate, sees no flag, and doesn't. NPV is 0.949,
  which sounds reassuring until you notice it mostly reflects a 13.8% base rate: one in
  twenty unflagged encounters still deteriorates. The interface must not let a blank read
  as an all-clear. Tracked as R-03.
- **Use as an escalation gate.** If a ward begins requiring a flag before an outreach
  referral, the screen has silently become a rationing device operating well below the
  sensitivity that would justify it. This is the single misuse the provider considers
  most likely and most harmful.
- **Off-label populations.** Applying it to paediatric, obstetric, or ICU encounters. The
  model will return a confident-looking number for any input inside the acceptance
  ranges; nothing in the artefact stops it.
- **Threshold drift.** A local team lowering the threshold to "catch more" without
  re-evaluating, and then quoting this document's sensitivity. Tracked as R-06.
