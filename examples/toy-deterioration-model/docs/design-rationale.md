---
document_type: design_rationale
attested_by: "M. Ferreira"
role: "Machine Learning Lead"
date: "2026-08-04"
covers_annex_iv: ["2(b)"]
---

# Design rationale

## General logic

Ten routinely recorded values in, one probability out, one threshold applied, one boolean
flag rendered. There is no feature engineering, no temporal window, no ensembling and no
calibration layer. The estimator is an L2-penalised logistic regression: a weighted sum of
ten standardised inputs pushed through a sigmoid.

```
p(deterioration) = sigmoid( b0 + sum_i b_i * x_i )
flag             = p >= threshold
```

The threshold is not part of the model. It is a separate, separately justified decision,
published in `eval/report.json` and reasoned about in `docs/metric-rationale.md`. Keeping
the two apart matters: a deployer can be told "the model is unchanged, the operating point
moved" and that statement means something.

## Key design choices

**Logistic regression over gradient boosting.** A small gradient-boosting model scored
marginally better in early probing. It was rejected. The screen's output has to be
defensible at the bedside — a nurse who asks "why is this patient flagged?" deserves an
answer, and with ten coefficients the answer is arithmetic anyone can check. The same
question against a tree ensemble is answerable only with post-hoc attribution machinery
that would itself need documenting, validating and attesting. The accuracy gained did not
survive contact with that cost.

**Ten features, all already collected.** Every input is a value the ward writes down
anyway on the observation round. The screen adds no data-collection burden, which is the
only reason a ward would tolerate it. Anything requiring a new measurement was excluded on
principle, not on performance.

**No trend features.** This is the largest deliberate sacrifice and it costs real
accuracy. Deterioration is a trajectory; a single snapshot cannot see one. Trend features
were left out because they would require the artefact to carry state, define a lookback
window, decide what to do when the previous observation is missing or six hours stale, and
handle the resulting explosion of missingness patterns. For a demonstration subject that
complexity buys nothing. In anything real it would be the first thing to add — and it
would change the intended purpose from "screen a snapshot" to "monitor a trajectory",
which is a different system needing different documentation.

**Labels derived from physiology the model cannot see.** The generator computes the label
from *true* physiology and then hands the model the same physiology plus measurement
error. This caps achievable performance around AUROC 0.78–0.80 and it is deliberate. A
model trained to recover a deterministic function of its own inputs would score near 1.0
and the resulting documentation would be a fiction — there would be no genuine
sensitivity/specificity trade-off to reason about, no interesting confidence intervals,
and nothing honest to say in the limitations section. The exhibit needs a mediocre model.

**Selection before splitting; imputation constants from train only.** Both are
leakage-avoidance choices. Encounters under six hours of observation are removed from the
whole cohort before any split exists, so an excluded encounter cannot influence a split it
was excluded from. Median imputation constants are computed on train and applied unchanged
to val and test; computing them over the pooled data would let the test split inform its
own preprocessing.

**Threshold chosen on validation, never on test.** The test split is read once, at the end
of `eval/evaluate.py`, after the operating point is fixed. Selecting a threshold on the
same data you then report sensitivity against is the ordinary way a screen acquires a
published sensitivity it cannot reproduce in service.

**Determinism as a design constraint, not a nicety.** One seed in `config/training.yaml`,
no wall-clock value written into any generated artefact, `joblib.dump` uncompressed
because the compressed container is gzip-framed and carries a timestamp, CSV rounding
fixed and line terminators pinned. The consequence is that every published SHA-256 is
reproducible by a third party from the source, which is what makes `custody/register.json`
worth more than an assertion.

## What it optimises for

Sensitivity at an acceptable alarm burden, subject to being explainable at the bedside and
reproducible from source. Not AUROC — AUROC is reported because it summarises ranking
across all thresholds and is a useful sanity check, but nobody deploys a ranking; they
deploy an operating point.

## Trade-offs accepted

| Given up | Bought | Judgement |
| --- | --- | --- |
| A few points of AUROC (boosting) | Bedside explainability, no attribution stack to validate | Worth it |
| Trend information | A stateless artefact, no lookback semantics to define | Worth it *for a demo*; the first thing to revisit otherwise |
| Specificity | Sensitivity, at the v0.2.0 operating point | Worth it — the asymmetry is argued in `docs/metric-rationale.md` |
| Inference-time imputation | Missing observations stay visible to the clinician | Worth it; a silently imputed value is worse than a refused call |
| Subgroup accuracy evidence | Nothing — this one is not a trade, it is an omission | Not defensible; recorded in `docs/KNOWN-GAPS.md` and R-02 |

The last row is in the same table as the others on purpose. Three of these are choices
with something on both sides. One is a gap. Presenting them together, with the gap named
as a gap, is more useful than a rationale document that quietly lists only the
defensible decisions.
