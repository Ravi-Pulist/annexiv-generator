---
document_type: metric_rationale
attested_by: "M. Ferreira"
role: "Machine Learning Lead"
date: "2026-08-04"
covers_annex_iv: ["4"]
---

# Metric rationale

Which numbers `eval/evaluate.py` computes, why those, and why they are weighted the way
they are. Every figure quoted here is read from `eval/report.json`, which is regenerated
from a real run on the held-out test split.

## The metrics that are computed

| Metric | Denominator | Why it is here |
| --- | --- | --- |
| AUROC | all 805 test encounters | Threshold-free ranking quality; a sanity check on whether there is any signal to operate on |
| Sensitivity | the 111 true positives | The constrained quantity — see below |
| Specificity | the 694 true negatives | The currency sensitivity is bought with |
| PPV | encounters the screen flagged | What a flag is worth to the clinician who receives it |
| NPV | encounters the screen did not flag | What *silence* is worth — the number that governs automation bias |

All four proportions carry Wilson 95% intervals. AUROC does not, and that is deliberate:
AUROC is not a binomial proportion, so a Wilson interval on it would be arithmetic applied
to the wrong object. A defensible AUROC interval needs DeLong or a bootstrap, neither of
which is in scope here. The point estimate is reported bare rather than dressed in an
interval that does not mean what it appears to mean.

## Why sensitivity is prioritised over specificity

The two errors are not commensurable, and averaging them into accuracy or F1 would pretend
they were.

**A false negative is unrecoverable within the observation window.** The screen runs once
per round. If it misses an encounter, nothing else in the pathway is looking at that
patient with a risk model until the next round, hours later. Physiological deterioration
does not wait for the next round.

**A false positive costs a bedside look.** A clinician walks to the patient, spends two
minutes, and finds nothing. That is a real cost — it is time taken from other patients,
and repeated often enough it becomes R-01, alarm fatigue, which is a genuine patient-safety
risk rather than a nuisance. But it is bounded, it is immediate, and it is absorbed by a
trained human who can recognise a well patient.

The asymmetry is not unlimited. There is a flag rate above which the ward stops reading
flags, and past that point additional sensitivity is nominal — the screen is producing
markers nobody acts on. So the operating point is chosen as *the highest threshold that
still reaches the sensitivity target*, not the lowest threshold that maximises
sensitivity. Sensitivity is a constraint to satisfy, and specificity is then preserved as
far as the constraint allows.

**Accuracy is not reported at all.** At a 13.8% positive rate, a model that flags nothing
scores 86.2% accurate. Any metric that rewards that is worse than no metric.

## Why NPV gets equal billing

The most likely harm from this system is not a false alarm. It is a clinician who was
going to escalate, sees no flag, and doesn't. That behaviour is governed by NPV, and NPV
is the number `docs/human-oversight.md` requires the deployer to put in front of users.
Reporting sensitivity without NPV would describe the screen's performance while omitting
the quantity that governs its most dangerous failure mode.

## Why Wilson

The denominators are small — 111 positives in the test split, and only 39 flagged
encounters at the v0.1.0 operating point. The textbook Wald interval, `p ± z·sqrt(p(1−p)/n)`, misbehaves badly at those
sizes: it produces bounds outside [0, 1] near an endpoint, and at p exactly 0 or 1 it
produces an interval of zero width. A specificity reported as "1.000 (1.000–1.000)" on 694
observations would be a false claim of certainty produced by arithmetic, not by evidence.
Wilson inverts the score test instead of assuming p-hat is normal, keeps its bounds inside
[0, 1] by construction, and stays sensible at the endpoints. It is fifteen lines and it is
implemented in `eval/evaluate.py` rather than imported, so a reader can check it.

## Why the target is 0.70 and not higher

The sensitivity target is the one genuinely discretionary number in this repository, so
here is the curve it was chosen from. Thresholds selected on validation, evaluated on
test:

| Target | Threshold | Val alert rate | Test sens. | Test spec. | Test PPV |
| --- | --- | --- | --- | --- | --- |
| 0.60 | 0.5641 | 25.1% | 0.676 | 0.836 | 0.397 |
| 0.65 | 0.5234 | 28.6% | 0.703 | 0.791 | 0.350 |
| **0.70** | **0.4176** | **42.6%** | **0.784** | **0.650** | **0.264** |
| 0.75 | 0.2859 | 60.6% | 0.883 | 0.409 | 0.193 |
| 0.80 | 0.2361 | 69.5% | 0.910 | 0.300 | 0.172 |

The curve turns sharply between 0.70 and 0.75. Below the turn, sensitivity is bought at a
price a ward can pay; above it, the alert rate goes from four encounters in ten to six and
then seven, and a marker that is lit on most of the ward is not information. Sensitivity
bought that way is nominal: it appears in the report and disappears at the bedside,
because nobody acts on a flag that is always on. 0.70 is the last target on the affordable
side of the turn.

This is a judgement, not an optimum. A different ward with different staffing would
defensibly land on 0.65, which costs eight points of sensitivity and returns fifteen of
specificity. What is not defensible is picking a target without looking at this table,
which is what v0.1.0's 0.50 default amounted to.

## What the intervals are saying, at v0.2.0

Measured at threshold 0.4176 on n = 805 (positive rate 0.138). 87 true positives, 243
false positives, 451 true negatives, 24 false negatives:

- AUROC **0.797**
- Sensitivity **0.784** (0.698 – 0.850), n = 111
- Specificity **0.650** (0.614 – 0.684), n = 694
- PPV **0.264** (0.219 – 0.314), n = 330
- NPV **0.949** (0.926 – 0.966), n = 475

Read together: the screen catches about four deteriorations in five, flags about two
encounters in five, and is wrong about three times in four when it flags. The sensitivity
interval runs down to 0.698, so "misses one in three" is consistent with this evidence and
the model card says so.

**NPV of 0.949 is the number most likely to be misread.** It is high mostly because the
base rate is 13.8% — a screen that flagged nothing at all would score 0.862. The honest
reading is that one in twenty unflagged encounters still deteriorates, which is exactly
why `docs/human-oversight.md` forbids treating a blank as an all-clear.

The width of these intervals is itself the finding. On a test split this size, differences
of a few percentage points between configurations are not distinguishable, and this
document will not claim them. During development, five-fold cross-validated AUROC on the
training split ranged from 0.704 to 0.821 across folds. The v0.1.0 to v0.2.0 change moved
AUROC from 0.799 to 0.797 — i.e. nowhere. **The release is justified entirely by moving
the operating point, not by any improvement in discrimination**, and describing it as a
model improvement would be a false claim that the numbers here do not support.

One more honest wrinkle: the threshold that achieved 0.706 sensitivity on validation
achieved 0.784 on test. The operating point does not transfer exactly, because a split of
800 encounters with ~110 positives is small enough that the two differ by more than the
target's precision. The published sensitivity is the test-split measurement; the target is
a design intent, and they are not the same number.

## What is not measured

Calibration is not assessed — no reliability curve, no Brier score, no calibration slope.
The probability is therefore ordinal only, and `docs/human-oversight.md` says so where
clinicians will read it.

Per-subgroup accuracy is not computed. `subgroup_breakdown` in `eval/report.json` is
`null`. It is a decision, it is recorded in `docs/KNOWN-GAPS.md`, and this document does
not pretend the aggregate figures above stand in for it.
