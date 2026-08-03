"""Eval report: the richest MEASURED source, and the fussiest.

Annex IV 2(g) wants validation and testing procedures, the data used, the
metrics, and test reports "dated and signed by the responsible persons".
Point 3 wants accuracy — and separately, accuracy "for specific persons or
groups of persons".

Those are two different obligations, so this extractor emits two different
capability keys. A report whose ``subgroup_breakdown`` is null provides
``eval.overall_accuracy`` and NOT ``eval.subgroup_accuracy``: the file exists,
the requirement still gaps. This is the single most important line in the
extractor set, because it is the exact shape of the failure the tool sells
against — a document that looks complete because a file was present.

Metrics without intervals are recorded, but a report that gives no interval on
any rate is noted: a point estimate on a held-out split is a number without an
error bar, and Annex IV 2(g) asks for metrics used to measure accuracy, which
a bare number answers only weakly.
"""

from __future__ import annotations

import json

from ..model import EvidenceRecord
from ..repo import RepoContext

CANDIDATES = ("eval/report.json", "eval/eval_report.json",
              "reports/eval.json", "evaluation/report.json")

_INTERVAL_KEYS = ("ci_low", "ci_high")


def _has_interval(metric) -> bool:
    return isinstance(metric, dict) and all(k in metric for k in _INTERVAL_KEYS)


def extract(repo: RepoContext) -> list[EvidenceRecord]:
    rel = repo.first_existing(*CANDIDATES)
    if not rel:
        return []
    try:
        data = json.loads(repo.read_text(rel))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(data, dict):
        return []

    sha = repo.sha256(rel)
    records: list[EvidenceRecord] = []
    metrics = data.get("metrics") or {}
    split = data.get("split") or {}

    if metrics:
        with_ci = sorted(k for k, v in metrics.items() if _has_interval(v))
        named = ", ".join(sorted(metrics))
        interval_note = (f"; {len(with_ci)} with 95% intervals ({', '.join(with_ci)})"
                         if with_ci else
                         "; NO confidence intervals reported — point estimates only")
        records.append(EvidenceRecord.measured(
            extractor="eval_report", source_path=rel, source_sha256=sha,
            locator="metrics",
            summary=(f"held-out evaluation on split "
                     f"{split.get('name', 'unnamed')!r} (n={split.get('n', '?')}): "
                     f"{named}{interval_note}"),
            provides=("eval.overall_accuracy", "eval.metrics_defined",
                      "eval.validation_procedure"),
            commit=repo.commit,
        ))

    # The deliberate split. Present-and-null is not present.
    subgroup = data.get("subgroup_breakdown")
    if subgroup:
        groups = (sorted(subgroup) if isinstance(subgroup, dict)
                  else [str(i) for i in range(len(subgroup))])
        records.append(EvidenceRecord.measured(
            extractor="eval_report", source_path=rel, source_sha256=sha,
            locator="subgroup_breakdown",
            summary=(f"per-subgroup accuracy reported for {len(groups)} "
                     f"group(s): {', '.join(groups[:8])}"),
            provides=("eval.subgroup_accuracy",),
            commit=repo.commit,
        ))

    if data.get("operating_point"):
        op = data["operating_point"]
        records.append(EvidenceRecord.measured(
            extractor="eval_report", source_path=rel, source_sha256=sha,
            locator="operating_point",
            summary=(f"operating threshold {op.get('threshold')} with a stated "
                     f"rationale"),
            provides=("eval.operating_point",),
            commit=repo.commit,
        ))

    # A dated, attributed test report is what 2(g) actually asks for.
    if data.get("signed_by") and data.get("date"):
        records.append(EvidenceRecord.measured(
            extractor="eval_report", source_path=rel, source_sha256=sha,
            locator="signature",
            summary=(f"test report attributed to {data['signed_by']} "
                     f"({data.get('role', 'role unstated')}) dated {data['date']}"),
            provides=("eval.signed_report",),
            commit=repo.commit,
        ))

    if data.get("dataset_manifest_sha256"):
        records.append(EvidenceRecord.measured(
            extractor="eval_report", source_path=rel, source_sha256=sha,
            locator="dataset_manifest_sha256",
            summary=("evaluation pinned to dataset manifest "
                     f"{str(data['dataset_manifest_sha256'])[:16]}… — the test "
                     "data used is identified by hash"),
            provides=("eval.testing_data_identified",),
            commit=repo.commit,
        ))
    return records
