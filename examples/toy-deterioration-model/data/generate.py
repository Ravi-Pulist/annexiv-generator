"""Synthetic inpatient encounter generator for the toy deterioration screen.

NOTHING IN HERE IS REAL. No real patient record, extract, or derivative of one
was consulted to build this generator. Every value is drawn from a parametric
model seeded with a fixed constant, so the entire dataset is a deterministic
function of `config/training.yaml` and this file.

Generative story (documented because Annex IV 2(d) asks for the provenance and
the labelling method, not just the final table):

  1. Each synthetic encounter gets a latent severity `s ~ Normal(0, 1)` and an
     age. `s` is the unobservable "how unwell is this person really" axis.
  2. TRUE physiology is drawn conditional on `s`: heart rate, systolic and
     diastolic pressure, respiratory rate, SpO2, temperature, and three labs
     (white cell count, lactate, creatinine). Labs are log-normal, vitals are
     Gaussian.
  3. The LABEL is derived from the *true* physiology by a documented rule -- a
     NEWS2-inspired point score plus three laboratory points -- pushed through
     a logistic link with an age term. The label is then sampled, so the rule
     is noisy rather than deterministic. See `LABEL_DEFINITION`.
  4. RECORDED physiology is the true physiology plus measurement error
     (charting error, cuff placement, probe drift). The model only ever sees
     the recorded values. This gap between what generated the label and what
     the model observes is the reason the achievable AUROC is modest, and it
     is intentional: an early-warning screen that scored 0.98 on its own
     synthetic data would be a worse demonstration subject, not a better one.
  5. Device artefacts are injected into a small fraction of recorded cells
     (a zeroed heart rate, a probe reading 5% SpO2), and a small fraction of
     lab and temperature cells are blanked, so that the cleaning step below
     has real work to do.

Pipeline order after generation -- this order is deliberate:

  select  ->  split  ->  clip  ->  impute  ->  round  ->  write

Selection happens before splitting so an excluded encounter cannot leak into
any split. Clipping uses fixed physiological constants from the config, so it
carries no information between splits and may be applied to all three. Median
imputation is fitted on the TRAIN split only and those constants are then
applied to val and test, which is why it happens after the split rather than
before it.

Run from the repository root:

    python data/generate.py
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
CONFIG_PATH = ROOT / "config" / "training.yaml"
MANIFEST_PATH = DATA_DIR / "manifest.json"

MANIFEST_VERSION = "1.0"

#: Human-readable statement of the labelling rule. Copied verbatim into the
#: manifest and expanded in docs/labelling-procedure.md.
LABEL_DEFINITION = (
    "label = 1 ('deteriorated') is sampled from Bernoulli(p) where "
    "p = sigmoid(0.55 * (risk_points - 6.8) + 0.012 * (age_years - 65)). "
    "risk_points is a NEWS2-inspired ordinal score computed from the TRUE "
    "(pre-measurement-error) physiology: respiratory rate, SpO2, systolic "
    "blood pressure, heart rate and temperature each contribute 0-3 points on "
    "the published NEWS2 cut-points, plus 2 points for lactate >= 2.0 mmol/L, "
    "1 further point for lactate >= 4.0 mmol/L, 1 point for creatinine >= "
    "150 umol/L and 1 point for a white cell count outside 4.0-12.0 x10^9/L. "
    "The label is therefore a noisy function of physiology the model cannot "
    "observe directly, not a deterministic threshold on the recorded columns."
)

SELECTION_RULE_TEMPLATE = (
    "Exclude any synthetic encounter with fewer than {hours:g} hours of "
    "recorded observation. Such encounters cannot express a deterioration "
    "trajectory and their vitals are dominated by admission-time values. "
    "Applied before splitting so that an excluded encounter cannot appear in "
    "any split."
)

CLEANING_METHOD_TEMPLATE = (
    "Implausible-range rejection followed by median imputation. "
    "(1) Every physiological cell is tested against a fixed clinical "
    "plausibility interval declared in config/training.yaml "
    "(data.cleaning.bounds). The intervals are constants, not percentiles, so "
    "no information crosses a split boundary. A cell outside its interval is "
    "treated as a device or charting artefact -- a disconnected probe, a "
    "zeroed monitor, a mis-scaled result -- and is discarded rather than "
    "winsorised, because clipping a disconnected SpO2 probe to the lower "
    "bound would manufacture a plausible-looking severe hypoxia. "
    "{flagged} cells were rejected this way. "
    "(2) Discarded cells and cells that were already blank are filled with "
    "the median of that column computed on the TRAIN split only; those "
    "constants are then applied unchanged to val and test. "
    "{blank} cells were already blank, so {imputed} cells were imputed in "
    "total. 'modified' counts cells, not rows."
)

#: Columns the model is allowed to consume at inference time.
FEATURE_SPEC = [
    {"name": "heart_rate", "unit": "bpm", "dtype": "float"},
    {"name": "systolic_bp", "unit": "mmHg", "dtype": "float"},
    {"name": "diastolic_bp", "unit": "mmHg", "dtype": "float"},
    {"name": "respiratory_rate", "unit": "breaths/min", "dtype": "float"},
    {"name": "spo2", "unit": "%", "dtype": "float"},
    {"name": "temperature", "unit": "degC", "dtype": "float"},
    {"name": "wbc", "unit": "10^9/L", "dtype": "float"},
    {"name": "lactate", "unit": "mmol/L", "dtype": "float"},
    {"name": "creatinine", "unit": "umol/L", "dtype": "float"},
    {"name": "age_years", "unit": "years", "dtype": "float"},
]

FEATURE_NAMES = [f["name"] for f in FEATURE_SPEC]

#: Recorded but NOT passed to the model. Retained so that a subgroup accuracy
#: breakdown is *possible* -- that it has not been computed is a decision, and
#: docs/KNOWN-GAPS.md records it as such.
NON_FEATURE_COLUMNS = ["encounter_id", "sex", "observation_hours"]

COLUMN_ORDER = (
    ["encounter_id", "age_years", "sex", "observation_hours"]
    + [
        "heart_rate",
        "systolic_bp",
        "diastolic_bp",
        "respiratory_rate",
        "spo2",
        "temperature",
        "wbc",
        "lactate",
        "creatinine",
    ]
    + ["label"]
)

#: Decimal places each column is rounded to before writing. Rounding is what
#: makes the CSV bytes stable across platforms -- without it, float repr
#: differences would break the byte-identity guarantee.
ROUNDING = {
    "age_years": 0,
    "observation_hours": 1,
    "heart_rate": 0,
    "systolic_bp": 0,
    "diastolic_bp": 0,
    "respiratory_rate": 0,
    "spo2": 0,
    "temperature": 1,
    "wbc": 1,
    "lactate": 2,
    "creatinine": 0,
}

CLEANED_COLUMNS = [
    "heart_rate",
    "systolic_bp",
    "diastolic_bp",
    "respiratory_rate",
    "spo2",
    "temperature",
    "wbc",
    "lactate",
    "creatinine",
]


def sha256_file(path: Path) -> str:
    """SHA-256 of a file's bytes, read in binary so line endings cannot vary."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def _news_points(rr, spo2, sbp, hr, temp):
    """NEWS2-inspired ordinal risk points, vectorised over the cohort.

    Cut-points follow the published National Early Warning Score 2 chart for
    the five vital-sign parameters. This is a *label-generating* device inside
    a synthetic-data script, not a clinical implementation of NEWS2.
    """
    points = np.zeros(rr.shape[0], dtype=np.float64)

    points += np.select(
        [rr <= 8, rr <= 11, rr <= 20, rr <= 24],
        [3.0, 1.0, 0.0, 2.0],
        default=3.0,
    )
    points += np.select(
        [spo2 <= 91, spo2 <= 93, spo2 <= 95],
        [3.0, 2.0, 1.0],
        default=0.0,
    )
    points += np.select(
        [sbp <= 90, sbp <= 100, sbp <= 110, sbp <= 219],
        [3.0, 2.0, 1.0, 0.0],
        default=3.0,
    )
    points += np.select(
        [hr <= 40, hr <= 50, hr <= 90, hr <= 110, hr <= 130],
        [3.0, 1.0, 0.0, 1.0, 2.0],
        default=3.0,
    )
    points += np.select(
        [temp <= 35.0, temp <= 36.0, temp <= 38.0, temp <= 39.0],
        [3.0, 1.0, 0.0, 1.0],
        default=2.0,
    )
    return points


def _lab_points(wbc, lactate, creatinine):
    points = np.zeros(wbc.shape[0], dtype=np.float64)
    points += 2.0 * (lactate >= 2.0)
    points += 1.0 * (lactate >= 4.0)
    points += 1.0 * (creatinine >= 150.0)
    points += 1.0 * ((wbc >= 12.0) | (wbc <= 4.0))
    return points


def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def generate_raw(cfg: dict) -> pd.DataFrame:
    """Draw the raw synthetic cohort, before selection, splitting or cleaning."""
    seed = int(cfg["seed"])
    n = int(cfg["data"]["n_raw_encounters"])
    rng = np.random.default_rng(seed)

    # --- latent severity and demographics -------------------------------
    severity = rng.normal(0.0, 1.0, n)
    age = np.clip(rng.normal(68.0, 16.0, n), 18.0, 98.0)
    sex = rng.choice(np.array(["F", "M"]), size=n, p=[0.51, 0.49])

    # Length of observation. A long right tail plus a short-stay mode; the
    # short-stay mode is what the selection rule removes.
    long_stay = rng.gamma(shape=3.0, scale=14.0, size=n) + 4.0
    short_stay = rng.uniform(0.5, 6.0, n)
    is_short = rng.random(n) < 0.09
    observation_hours = np.where(is_short, short_stay, long_stay)

    # --- true physiology conditional on severity ------------------------
    hr_true = 78.0 + 14.0 * severity + rng.normal(0.0, 9.0, n)
    rr_true = 16.0 + 4.2 * severity + rng.normal(0.0, 2.2, n)
    # A pulse oximeter cannot report above 100%, so the ceiling belongs in the
    # generative model rather than in the cleaning step -- otherwise the
    # cleaner would "correct" a fifth of the cohort and the reported
    # cleaning count would be meaningless.
    spo2_true = np.minimum(100.0, 97.0 - 2.6 * severity + rng.normal(0.0, 1.4, n))
    sbp_true = 128.0 - 11.0 * severity + rng.normal(0.0, 13.0, n)
    dbp_true = 74.0 - 5.0 * severity + rng.normal(0.0, 8.0, n)
    temp_true = 36.9 + 0.45 * severity + rng.normal(0.0, 0.50, n)
    wbc_true = np.exp(2.20 + 0.22 * severity + rng.normal(0.0, 0.30, n))
    lactate_true = np.exp(0.15 + 0.32 * severity + rng.normal(0.0, 0.36, n))
    creat_true = np.exp(4.35 + 0.20 * severity + rng.normal(0.0, 0.33, n))

    # --- documented label rule ------------------------------------------
    risk_points = _news_points(rr_true, spo2_true, sbp_true, hr_true, temp_true)
    risk_points += _lab_points(wbc_true, lactate_true, creat_true)
    p_label = _sigmoid(0.55 * (risk_points - 6.8) + 0.012 * (age - 65.0))
    label = (rng.random(n) < p_label).astype(np.int64)

    # --- measurement error: what actually gets charted -------------------
    hr = hr_true + rng.normal(0.0, 6.0, n)
    rr = rr_true + rng.normal(0.0, 1.6, n)
    spo2 = np.minimum(100.0, spo2_true + rng.normal(0.0, 1.0, n))
    sbp = sbp_true + rng.normal(0.0, 7.0, n)
    dbp = dbp_true + rng.normal(0.0, 5.0, n)
    temp = temp_true + rng.normal(0.0, 0.28, n)
    wbc = wbc_true * np.exp(rng.normal(0.0, 0.12, n))
    lactate = lactate_true * np.exp(rng.normal(0.0, 0.18, n))
    creat = creat_true * np.exp(rng.normal(0.0, 0.12, n))

    frame = pd.DataFrame(
        {
            "encounter_id": [f"SYN-{i:06d}" for i in range(n)],
            "age_years": age,
            "sex": sex,
            "observation_hours": observation_hours,
            "heart_rate": hr,
            "systolic_bp": sbp,
            "diastolic_bp": dbp,
            "respiratory_rate": rr,
            "spo2": spo2,
            "temperature": temp,
            "wbc": wbc,
            "lactate": lactate,
            "creatinine": creat,
            "label": label,
        }
    )

    # --- device artefacts and blanks ------------------------------------
    # Implausible readings a real chart would contain: a disconnected probe,
    # a zeroed monitor, a mis-scaled lab result.
    artefacts = {
        "heart_rate": (0.006, 0.0, 320.0),
        "spo2": (0.006, 0.0, 5.0),
        "systolic_bp": (0.005, 0.0, 300.0),
        "temperature": (0.004, 0.0, 45.0),
        "respiratory_rate": (0.004, 0.0, 80.0),
        "creatinine": (0.003, 2.0, 1500.0),
    }
    for column, (rate, low_value, high_value) in artefacts.items():
        hit = rng.random(n) < rate
        pick_low = rng.random(n) < 0.5
        frame.loc[hit & pick_low, column] = low_value
        frame.loc[hit & ~pick_low, column] = high_value

    for column, rate in (("lactate", 0.030), ("wbc", 0.015), ("temperature", 0.010)):
        blank = rng.random(n) < rate
        frame.loc[blank, column] = np.nan

    return frame


def apply_selection(frame: pd.DataFrame, cfg: dict):
    """Documented selection step. Returns (retained_frame, excluded_count)."""
    min_hours = float(cfg["data"]["selection"]["min_observation_hours"])
    keep = frame["observation_hours"] >= min_hours
    excluded = int((~keep).sum())
    return frame.loc[keep].reset_index(drop=True), excluded


def stratified_split(frame: pd.DataFrame, cfg: dict):
    """Deterministic, label-stratified 3-way split.

    Implemented by hand rather than with `train_test_split` so the exact
    assignment rule is auditable from this file alone.
    """
    ratios = cfg["data"]["splits"]
    seed = int(cfg["seed"])
    rng = np.random.default_rng(seed + 1)

    parts = {"train": [], "val": [], "test": []}
    for label_value in (0, 1):
        index = np.flatnonzero(frame["label"].to_numpy() == label_value)
        index = index[rng.permutation(index.shape[0])]
        n = index.shape[0]
        n_train = int(np.floor(n * float(ratios["train"])))
        n_val = int(np.floor(n * float(ratios["val"])))
        parts["train"].append(index[:n_train])
        parts["val"].append(index[n_train : n_train + n_val])
        parts["test"].append(index[n_train + n_val :])

    splits = {}
    for name, chunks in parts.items():
        # Sort by original position so the written CSV order is a stable
        # function of the generator, not of the permutation order.
        rows = np.sort(np.concatenate(chunks))
        splits[name] = frame.iloc[rows].reset_index(drop=True)
    return splits


def clean(splits: dict, cfg: dict):
    """Reject implausible cells, then impute every gap with TRAIN medians.

    Returns (splits, flagged_cells, already_blank_cells, imputed_cells).
    """
    bounds = cfg["data"]["cleaning"]["bounds"]

    blank = 0
    flagged = 0
    for frame in splits.values():
        for column in CLEANED_COLUMNS:
            low, high = (float(v) for v in bounds[column])
            values = frame[column].to_numpy(dtype=np.float64)
            blank += int(np.isnan(values).sum())
            out_of_range = np.isfinite(values) & ((values < low) | (values > high))
            flagged += int(out_of_range.sum())
            frame.loc[out_of_range, column] = np.nan

    # Medians are fitted on TRAIN only, AFTER rejection so that artefacts
    # cannot drag the imputation constant, and are reused verbatim elsewhere.
    medians = {c: float(splits["train"][c].median()) for c in CLEANED_COLUMNS}

    imputed = 0
    for frame in splits.values():
        for column in CLEANED_COLUMNS:
            imputed += int(frame[column].isna().sum())
            frame[column] = frame[column].fillna(medians[column])

    return splits, flagged, blank, imputed


def finalise(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame[COLUMN_ORDER].copy()
    for column, decimals in ROUNDING.items():
        frame[column] = frame[column].round(decimals)
    frame["label"] = frame["label"].astype(np.int64)
    return frame


def write_csv(frame: pd.DataFrame, path: Path) -> None:
    # lineterminator is pinned so the bytes are identical on Windows and Linux.
    frame.to_csv(path, index=False, lineterminator="\n")


def main() -> int:
    cfg = load_config()

    raw = generate_raw(cfg)
    retained, excluded = apply_selection(raw, cfg)
    splits = stratified_split(retained, cfg)
    splits, flagged, blank, imputed = clean(splits, cfg)

    paths = {}
    for name in ("train", "val", "test"):
        frame = finalise(splits[name])
        path = DATA_DIR / f"{name}.csv"
        write_csv(frame, path)
        paths[name] = path
        splits[name] = frame

    manifest = {
        "manifest_version": MANIFEST_VERSION,
        "seed": int(cfg["seed"]),
        "synthetic_only": True,
        "generator_sha256": sha256_file(Path(__file__).resolve()),
        "rows": {name: int(splits[name].shape[0]) for name in ("train", "val", "test")},
        "selection": {
            "rule": SELECTION_RULE_TEMPLATE.format(
                hours=float(cfg["data"]["selection"]["min_observation_hours"])
            ),
            "excluded": excluded,
        },
        "cleaning": {
            "method": CLEANING_METHOD_TEMPLATE.format(
                flagged=flagged, blank=blank, imputed=imputed
            ),
            "modified": imputed,
        },
        "label_definition": LABEL_DEFINITION,
        "features": FEATURE_SPEC,
        "files": {
            f"data/{name}.csv": sha256_file(paths[name])
            for name in ("train", "val", "test")
        },
    }

    with open(MANIFEST_PATH, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(manifest, handle, indent=2, ensure_ascii=True)
        handle.write("\n")

    positives = sum(int(splits[n]["label"].sum()) for n in ("train", "val", "test"))
    total = sum(int(splits[n].shape[0]) for n in ("train", "val", "test"))
    print(f"raw encounters generated : {raw.shape[0]}")
    print(f"excluded by selection    : {excluded}")
    print(f"retained                 : {total}")
    print(f"cells modified (clean)   : {imputed} "
          f"(out-of-range={flagged}, already blank={blank})")
    print(f"positive rate overall    : {positives / total:.4f}")
    for name in ("train", "val", "test"):
        frame = splits[name]
        print(f"  {name:<5} n={frame.shape[0]:<5} "
              f"positive_rate={frame['label'].mean():.4f}")
    print(f"manifest written         : {MANIFEST_PATH.relative_to(ROOT).as_posix()}")
    print(f"generator_sha256         : {manifest['generator_sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
