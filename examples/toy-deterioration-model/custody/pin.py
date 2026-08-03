"""Regenerate the custody records from the artifacts actually on disk.

    python custody/pin.py

Writes `custody/register.json` and `custody/ml-bom.json`. Both are derived --
the model digest is read from `models/model.joblib` and the performance figures
from `eval/report.json`, never typed in. Hand-maintaining a hash in two JSON
files across a re-train is a guaranteed way to publish a digest that pins
nothing, and `tests/test_repo.py` fails if it ever happens.

Determinism: no timestamp is written. CycloneDX makes `metadata.timestamp`
optional, and a wall-clock value there would make the BOM differ between runs
for no informational gain -- the BOM is pinned to content digests, which are
better provenance than a build clock. The `serialNumber` is a fixed UUID for
the same reason: it identifies this BOM lineage, not this invocation.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = ROOT / "models" / "model.joblib"
REPORT_PATH = ROOT / "eval" / "report.json"
REGISTER_PATH = ROOT / "custody" / "register.json"
BOM_PATH = ROOT / "custody" / "ml-bom.json"

#: Bumped by hand at release, alongside CHANGELOG.md.
RELEASE_VERSION = "0.2.0"

MODEL_ID = "deterioration-clf"
MODEL_NAME = "Deterioration early-warning screen (synthetic-data demonstrator)"

#: Fixed for this BOM lineage. Not regenerated per run -- see module docstring.
BOM_SERIAL = "urn:uuid:6f2a1d34-9c7e-4b58-a1f0-2d5c8e3b7a10"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json(path: Path, payload: dict) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=True)
        handle.write("\n")


def performance_metrics(report: dict) -> list[dict]:
    """CycloneDX performanceMetrics, carried straight from the eval report."""
    metrics = report["metrics"]
    entries = [
        {
            "type": "AUROC",
            "value": f"{metrics['auroc']['value']:.6f}",
            "slice": "held-out test split",
        }
    ]
    for name in ("sensitivity", "specificity", "ppv", "npv"):
        block = metrics[name]
        entries.append(
            {
                "type": name,
                "value": f"{block['value']:.6f}",
                "slice": f"held-out test split (n={block['n']})",
                "confidenceInterval": {
                    "lowerBound": f"{block['ci_low']:.6f}",
                    "upperBound": f"{block['ci_high']:.6f}",
                },
            }
        )
    return entries


def main() -> int:
    model_digest = sha256_file(MODEL_PATH)
    with open(REPORT_PATH, "r", encoding="utf-8") as handle:
        report = json.load(handle)

    if report["model_sha256"] != model_digest:
        raise SystemExit(
            "refusing to pin: eval/report.json describes a different model\n"
            f"  report : {report['model_sha256']}\n"
            f"  on disk: {model_digest}\n"
            "Re-run `python eval/evaluate.py`."
        )

    register = {
        "models": [
            {
                "id": MODEL_ID,
                "name": MODEL_NAME,
                "sha256": model_digest,
                "licence": "MIT",
                "source": "trained in-repo from data/train.csv",
                "pinned_at_commit": None,
            }
        ]
    }
    write_json(REGISTER_PATH, register)

    bom = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.6",
        "serialNumber": BOM_SERIAL,
        "version": 1,
        "metadata": {
            "component": {
                "type": "application",
                "bom-ref": "toy-deterioration-model",
                "name": "toy-deterioration-model",
                "version": RELEASE_VERSION,
                "description": (
                    "Synthetic-data deterioration early-warning screen, built as a "
                    "demonstration subject for EU AI Act Annex IV documentation."
                ),
                "licenses": [{"license": {"id": "MIT"}}],
            },
            "authors": [{"name": "Northgate Clinical Informatics (fictional)"}],
        },
        "components": [
            {
                "type": "machine-learning-model",
                "bom-ref": MODEL_ID,
                "name": MODEL_ID,
                "version": RELEASE_VERSION,
                "description": MODEL_NAME,
                "licenses": [{"license": {"id": "MIT"}}],
                "hashes": [{"alg": "SHA-256", "content": model_digest}],
                "modelCard": {
                    "bom-ref": f"{MODEL_ID}-card",
                    "modelParameters": {
                        "approach": {"type": "supervised"},
                        "task": "binary classification",
                        "architectureFamily": "generalized-linear",
                        "modelArchitecture": "L2-penalised logistic regression",
                        "datasets": [
                            {
                                "type": "synthetic",
                                "name": "data/train.csv",
                                "contents": {
                                    "attachment": {
                                        "contentType": "text/csv",
                                        "content": (
                                            "Fully synthetic; generated by "
                                            "data/generate.py from seed 20260804. "
                                            "No real patient data. Provenance and "
                                            "digests in data/manifest.json."
                                        ),
                                    }
                                },
                            }
                        ],
                        "inputs": [{"format": "10 numeric features; see input_schema.py"}],
                        "outputs": [
                            {"format": "probability in [0,1] plus a boolean review flag"}
                        ],
                    },
                    "quantitativeAnalysis": {
                        "performanceMetrics": performance_metrics(report)
                    },
                    "considerations": {
                        "useCases": [
                            "Flagging adult inpatient encounters for clinician review."
                        ],
                        "technicalLimitations": [
                            "Synthetic training and evaluation data only; no evidence "
                            "about any real population.",
                            "Single-timepoint; no trend features.",
                            "No subgroup accuracy breakdown has been computed.",
                            "No post-market monitoring plan exists.",
                        ],
                        "ethicalConsiderations": [
                            {
                                "name": "Automation bias on a negative result",
                                "mitigationStrategy": (
                                    "Measured sensitivity and its confidence interval "
                                    "are displayed with every result; absence of a flag "
                                    "is never a reason not to escalate. See "
                                    "docs/human-oversight.md and risk-log.yaml R-03."
                                ),
                            },
                            {
                                "name": "Unknown subgroup performance",
                                "mitigationStrategy": (
                                    "No claim of comparable performance across sexes or "
                                    "age bands is made. See docs/KNOWN-GAPS.md and "
                                    "risk-log.yaml R-02."
                                ),
                            },
                        ],
                    },
                },
            }
        ],
    }
    write_json(BOM_PATH, bom)

    print(f"model_sha256    : {model_digest}")
    print(f"release version : {RELEASE_VERSION}")
    print(f"written         : custody/register.json, custody/ml-bom.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
