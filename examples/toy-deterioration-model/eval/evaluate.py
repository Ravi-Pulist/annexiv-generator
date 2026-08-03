"""Evaluate the deterioration screen on the held-out test split.

Run from the repository root:

    python eval/evaluate.py

Everything written to `eval/report.json` is measured here, in this run. There
are no carried-forward numbers and no hand-edited fields. The report is
regenerated from scratch each time and is byte-identical between runs from the
same model and dataset.

Discipline notes
----------------
* The test split is touched exactly once, at the end. The operating point is
  chosen on the VALIDATION split (see `select_threshold`). Choosing a threshold
  on the same data you then report sensitivity for is the most common way an
  early-warning screen ends up with a published sensitivity it cannot
  reproduce in service.
* Confidence intervals are Wilson score intervals, implemented in
  `wilson_interval` below rather than imported. Sensitivity, specificity, PPV
  and NPV are all proportions on small denominators here -- the positive class
  has around a hundred members in the test split -- and the normal-approximation
  interval degenerates badly at those sizes, running past 1.0 or collapsing to
  zero width when a proportion hits an endpoint.
* AUROC is reported as a point estimate with no interval. A defensible interval
  for AUROC needs DeLong or a bootstrap; neither is in scope for a toy, and
  quoting a Wilson interval for it would be wrong because AUROC is not a
  binomial proportion. `docs/metric-rationale.md` says so in prose too.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import yaml
from sklearn.metrics import roc_auc_score

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "training.yaml"
MANIFEST_PATH = ROOT / "data" / "manifest.json"
MODEL_PATH = ROOT / "models" / "model.joblib"
REPORT_PATH = ROOT / "eval" / "report.json"

REPORT_VERSION = "1.0"

#: Hardcoded, not date.today(). A wall-clock call here would make the report
#: differ between runs and destroy the byte-identity guarantee. This is the
#: date the v0.2.0 evidence was attested; it moves only when a human re-signs.
ATTESTATION_DATE = "2026-08-04"
SIGNED_BY = "Dr. A. Nowak"
SIGNED_ROLE = "Clinical Lead, deterioration screen demonstrator"

#: Two-sided 95% normal quantile. Hardcoded so the report does not depend on
#: scipy being importable.
Z_95 = 1.959963984540054


def wilson_interval(successes: int, n: int, z: float = Z_95) -> tuple[float, float]:
    """Wilson score interval for a binomial proportion.

    The Wald interval (p +/- z * sqrt(p(1-p)/n)) is the one everybody writes
    from memory and it is wrong here: at n ~ 110 with p near an endpoint it
    produces bounds outside [0, 1], and at p exactly 0 or 1 it produces an
    interval of zero width, which would let this report claim a specificity of
    "1.000 (1.000-1.000)". Wilson does not have either failure mode because it
    inverts the score test rather than assuming normality of p-hat.

    Returns (low, high), clamped to [0, 1]. n == 0 yields (0.0, 1.0) -- total
    ignorance, which is the honest answer for an empty denominator.
    """
    if n <= 0:
        return (0.0, 1.0)
    p = successes / n
    z2 = z * z
    denominator = 1.0 + z2 / n
    centre = (p + z2 / (2.0 * n)) / denominator
    half_width = (z / denominator) * math.sqrt(p * (1.0 - p) / n + z2 / (4.0 * n * n))
    return (max(0.0, centre - half_width), min(1.0, centre + half_width))


def proportion_metric(successes: int, n: int) -> dict:
    """A proportion plus its Wilson interval, in the report's metric shape."""
    low, high = wilson_interval(successes, n)
    value = (successes / n) if n > 0 else 0.0
    return {
        "value": round(value, 6),
        "ci_low": round(low, 6),
        "ci_high": round(high, 6),
        "n": int(n),
        "method": "wilson-95",
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def source_commit() -> str | None:
    """Commit the evidence was produced from, or None.

    Deliberately NOT `git rev-parse HEAD`. The report is a tracked file, so
    stamping it with the current HEAD makes every evaluation dirty the working
    tree with a digest of the commit before it -- a fixed point that does not
    exist. A build system that wants the provenance injects it:

        SOURCE_COMMIT=$(git rev-parse HEAD) python eval/evaluate.py

    In this repository it is left null, and the report is instead pinned to
    the artifacts it actually consumed: model_sha256 and
    dataset_manifest_sha256, both of which are real content digests.
    """
    value = os.environ.get("SOURCE_COMMIT", "").strip()
    return value or None


def select_threshold(cfg: dict, model, val: pd.DataFrame, feature_order: list) -> tuple:
    """Choose the operating point. Returns (threshold, rationale).

    Never looks at the test split.
    """
    operating = cfg["operating_point"]
    strategy = operating["strategy"]

    if strategy == "fixed":
        threshold = float(operating["threshold"])
        rationale = (
            f"Fixed at {threshold:.2f}, the default decision rule for a "
            "probabilistic classifier. This is a baseline placeholder, not a "
            "clinically reasoned choice: at the cohort's positive rate of "
            "roughly 14% a 0.50 cut-off puts almost the entire population on "
            "the negative side and buys specificity the ward does not need at "
            "the cost of sensitivity it does. Superseded in v0.2.0."
        )
        return threshold, rationale

    if strategy == "target_sensitivity":
        target = float(operating["target_sensitivity"])
        y_val = val["label"].to_numpy(dtype=np.int64)
        p_val = model.predict_proba(
            val[feature_order].to_numpy(dtype=np.float64)
        )[:, 1]

        positives = int(y_val.sum())
        # Candidate thresholds are the observed scores themselves; anything
        # between two adjacent scores gives an identical confusion matrix.
        candidates = np.unique(np.round(p_val, 6))
        chosen = float(candidates[0])
        achieved = 1.0
        for candidate in candidates:
            hits = int(((p_val >= candidate) & (y_val == 1)).sum())
            sensitivity = hits / positives if positives else 0.0
            if sensitivity >= target:
                chosen = float(candidate)
                achieved = sensitivity
            else:
                break

        alert_rate = float((p_val >= chosen).mean())
        rationale = (
            f"Chosen on the VALIDATION split only ({val.shape[0]} encounters, "
            f"{positives} positive), never on test. Selected the highest "
            f"threshold whose validation sensitivity still reaches the "
            f"{target:.0%} target; that is {chosen:.6f}, achieving "
            f"{achieved:.3f} sensitivity on validation and flagging "
            f"{alert_rate:.1%} of validation encounters. Sensitivity is the "
            "constrained quantity and specificity is what is spent to buy it, "
            "because a missed deterioration is not recoverable by the next "
            "observation round whereas a false flag costs a clinician a "
            f"bedside look. The {target:.0%} target and the resulting alert "
            "rate are a judgement call about alarm burden, not an optimum -- "
            "docs/metric-rationale.md sets out the reasoning and "
            "risk-log.yaml R-01 tracks the alarm-fatigue consequence."
        )
        return chosen, rationale

    raise SystemExit(f"unknown operating_point.strategy: {strategy!r}")


def main() -> int:
    cfg = load_config()

    artifact = joblib.load(MODEL_PATH)
    model = artifact["pipeline"]
    feature_order = list(artifact["feature_order"])

    manifest_digest = sha256_file(MANIFEST_PATH)
    if artifact.get("dataset_manifest_sha256") != manifest_digest:
        raise SystemExit(
            "refusing to evaluate: models/model.joblib was fitted against a "
            "different data/manifest.json\n"
            f"  model expects: {artifact.get('dataset_manifest_sha256')}\n"
            f"  on disk      : {manifest_digest}\n"
            "Re-run `python data/generate.py && python train.py`."
        )

    val = pd.read_csv(ROOT / "data" / "val.csv")
    test = pd.read_csv(ROOT / "data" / "test.csv")

    threshold, rationale = select_threshold(cfg, model, val, feature_order)

    # --- the test split is consumed exactly here, and only here -----------
    y_true = test["label"].to_numpy(dtype=np.int64)
    scores = model.predict_proba(
        test[feature_order].to_numpy(dtype=np.float64)
    )[:, 1]
    predicted = (scores >= threshold).astype(np.int64)

    true_positive = int(((predicted == 1) & (y_true == 1)).sum())
    false_positive = int(((predicted == 1) & (y_true == 0)).sum())
    true_negative = int(((predicted == 0) & (y_true == 0)).sum())
    false_negative = int(((predicted == 0) & (y_true == 1)).sum())

    auroc = float(roc_auc_score(y_true, scores))

    # ------------------------------------------------------------------
    # DELIBERATE ABSENCE -- READ BEFORE "FIXING" THIS.
    #
    # Annex IV point 3 requires the "degrees of accuracy for specific persons
    # or groups of persons on which the system is intended to be used". This
    # evaluator does NOT compute that breakdown, and `subgroup_breakdown` is
    # emitted as null on purpose.
    #
    # The data supports it: data/*.csv carry `sex` and `age_years`, and
    # stratifying the four proportions above by either is about fifteen lines.
    # It has not been done, and the reason is recorded rather than hidden --
    # see docs/KNOWN-GAPS.md. Publishing a null here is a visible, auditable
    # gap; quietly omitting the key, or filling it with an under-powered
    # breakdown over ~20 positives per stratum and presenting that as evidence
    # of subgroup parity, would both be worse.
    #
    # If you implement it, delete this comment, remove the entry from
    # docs/KNOWN-GAPS.md, and update the assertion in tests/test_repo.py that
    # currently pins this absence in place. All three, or none.
    # ------------------------------------------------------------------
    subgroup_breakdown = None

    report = {
        "report_version": REPORT_VERSION,
        "generated_from_commit": source_commit(),
        "model_sha256": sha256_file(MODEL_PATH),
        "dataset_manifest_sha256": manifest_digest,
        "seed": int(cfg["seed"]),
        "split": {
            "name": "test",
            "n": int(y_true.shape[0]),
            "positive_rate": round(float(y_true.mean()), 6),
        },
        "metrics": {
            "auroc": {"value": round(auroc, 6)},
            "sensitivity": proportion_metric(
                true_positive, true_positive + false_negative
            ),
            "specificity": proportion_metric(
                true_negative, true_negative + false_positive
            ),
            "ppv": proportion_metric(true_positive, true_positive + false_positive),
            "npv": proportion_metric(true_negative, true_negative + false_negative),
        },
        "confusion_matrix": {
            "true_positive": true_positive,
            "false_positive": false_positive,
            "true_negative": true_negative,
            "false_negative": false_negative,
        },
        "operating_point": {
            "threshold": round(float(threshold), 6),
            "rationale": rationale,
        },
        "subgroup_breakdown": subgroup_breakdown,
        "signed_by": SIGNED_BY,
        "role": SIGNED_ROLE,
        "date": ATTESTATION_DATE,
    }

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(REPORT_PATH, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(report, handle, indent=2, ensure_ascii=True)
        handle.write("\n")

    metrics = report["metrics"]
    print(f"split                    : test (n={report['split']['n']}, "
          f"positive_rate={report['split']['positive_rate']:.4f})")
    print(f"threshold                : {report['operating_point']['threshold']:.6f}")
    print(f"auroc                    : {metrics['auroc']['value']:.4f}")
    for name in ("sensitivity", "specificity", "ppv", "npv"):
        block = metrics[name]
        print(f"{name:<25}: {block['value']:.4f} "
              f"[{block['ci_low']:.4f}, {block['ci_high']:.4f}] "
              f"(n={block['n']}, {block['method']})")
    print(f"confusion (tp/fp/tn/fn)  : {true_positive}/{false_positive}/"
          f"{true_negative}/{false_negative}")
    print("subgroup_breakdown       : null (deliberate; see docs/KNOWN-GAPS.md)")
    print(f"report written           : {REPORT_PATH.relative_to(ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
