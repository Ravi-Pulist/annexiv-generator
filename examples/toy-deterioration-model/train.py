"""Fit the deterioration screen and write `models/model.joblib`.

Run from the repository root:

    python train.py

Before fitting, this script re-hashes every CSV named in `data/manifest.json`
and refuses to train if a digest does not match. Training against data that has
drifted from its manifest would make every number downstream unattributable, so
it is a hard failure rather than a warning.

The artifact is a dict, not a bare estimator. It carries the feature order and
the manifest digest the model was fitted against, so `eval/evaluate.py` can
assemble the feature matrix in the right order and prove it evaluated the model
on the dataset the model was trained from.

Determinism: the estimator is `LogisticRegression` with `lbfgs`, which is
deterministic given fixed data and a fixed `random_state`. `joblib.dump` is
called without compression -- the gzip container joblib uses at compress>0
embeds a timestamp, which would break byte-identity between runs.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
import yaml
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from input_schema import FEATURE_ORDER

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config" / "training.yaml"
MANIFEST_PATH = ROOT / "data" / "manifest.json"
MODEL_PATH = ROOT / "models" / "model.joblib"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


def load_manifest() -> dict:
    with open(MANIFEST_PATH, "r", encoding="utf-8") as handle:
        return json.load(handle)


def verify_manifest(manifest: dict) -> None:
    """Hard-fail if any split on disk no longer matches its pinned digest."""
    for relative_path, expected in manifest["files"].items():
        actual = sha256_file(ROOT / relative_path)
        if actual != expected:
            raise SystemExit(
                f"refusing to train: {relative_path} does not match its manifest "
                f"digest\n  manifest: {expected}\n  on disk : {actual}\n"
                "Re-run `python data/generate.py`."
            )


def build_estimator(cfg: dict):
    model_cfg = cfg["model"]
    if model_cfg["type"] != "logistic_regression":
        raise SystemExit(f"unsupported model type: {model_cfg['type']!r}")

    classifier = LogisticRegression(
        penalty=model_cfg["penalty"],
        C=float(model_cfg["C"]),
        solver=model_cfg["solver"],
        max_iter=int(model_cfg["max_iter"]),
        class_weight=model_cfg["class_weight"],
        random_state=int(cfg["seed"]),
    )

    steps = []
    if bool(model_cfg["standardize"]):
        steps.append(("scaler", StandardScaler()))
    steps.append(("classifier", classifier))
    return Pipeline(steps)


def main() -> int:
    cfg = load_config()
    manifest = load_manifest()
    verify_manifest(manifest)

    train = pd.read_csv(ROOT / "data" / "train.csv")
    x_train = train[FEATURE_ORDER].to_numpy(dtype=np.float64)
    y_train = train["label"].to_numpy(dtype=np.int64)

    estimator = build_estimator(cfg)
    estimator.fit(x_train, y_train)

    artifact = {
        "artifact_version": "1.0",
        "pipeline": estimator,
        "feature_order": list(FEATURE_ORDER),
        "seed": int(cfg["seed"]),
        "sklearn_version": sklearn.__version__,
        "model_config": cfg["model"],
        "trained_on": "data/train.csv",
        "dataset_manifest_sha256": sha256_file(MANIFEST_PATH),
    }

    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    # compress=0: joblib's compressed container is gzip-framed and carries a
    # timestamp, which would defeat byte-identical rebuilds.
    joblib.dump(artifact, MODEL_PATH, compress=0)

    digest = sha256_file(MODEL_PATH)
    print(f"rows (train)             : {x_train.shape[0]}")
    print(f"features                 : {len(FEATURE_ORDER)}")
    print(f"positive rate (train)    : {y_train.mean():.4f}")
    print(f"estimator                : {estimator}")
    print(f"model written            : {MODEL_PATH.relative_to(ROOT).as_posix()}")
    print(f"model_sha256             : {digest}")
    print(
        "\nRemember to update custody/register.json and custody/ml-bom.json "
        "if this digest changed."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
