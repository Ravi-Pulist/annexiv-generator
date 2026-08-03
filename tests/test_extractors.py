"""Extractors, against fixtures built for each interesting case.

The cases that matter most are the negative ones: the present-but-empty eval
report, the unsigned document, the stale hash. Those are where a documentation
tool either earns its keep or quietly writes a sentence nobody can defend.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from annexiv.extractors import attested, custody, dataset, evalreport, risklog
from annexiv.extractors.inputschema import extract as extract_schema
from annexiv.extractors.manifests import extract as extract_manifests
from annexiv.model import EvidenceClass
from annexiv.repo import RepoContext


@pytest.fixture
def repo(tmp_path) -> RepoContext:
    return RepoContext(tmp_path)


def write(repo: RepoContext, rel: str, content: str) -> None:
    p = repo.root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")


# ── attested docs ─────────────────────────────────────────────────────────

SIGNED = """---
document_type: model_card
attested_by: "Dr. A. Nowak"
role: "Clinical Lead"
date: "2026-08-04"
covers_annex_iv: ["1(a)", "3"]
---
# Model card
Intended purpose.
"""

UNSIGNED = """---
document_type: model_card
attested_by: ""
role: "Clinical Lead"
date: "2026-08-04"
---
# Model card
"""


def test_signed_document_yields_attested_evidence(repo):
    write(repo, "docs/model-card.md", SIGNED)
    recs = attested.extract(repo)
    assert len(recs) == 1
    r = recs[0]
    assert r.cls is EvidenceClass.ATTESTED
    assert r.attested_by == "Dr. A. Nowak" and r.role == "Clinical Lead"
    assert "doc.intended_purpose" in r.provides
    assert "declared.1(a)" in r.provides


def test_unsigned_document_yields_nothing_and_is_reported(repo):
    write(repo, "docs/model-card.md", UNSIGNED)
    assert attested.extract(repo) == []
    unsigned = attested.unsigned_documents(repo)
    assert unsigned and unsigned[0][1] == ["attested_by"]


def test_plain_prose_without_front_matter_is_not_an_attestation(repo):
    write(repo, "docs/notes.md", "# Just some notes\nNo front matter here.")
    assert attested.extract(repo) == []
    assert attested.unsigned_documents(repo) == []


# ── eval report: the deliberate split ─────────────────────────────────────

def _report(subgroup) -> str:
    return json.dumps({
        "split": {"name": "test", "n": 800},
        "metrics": {"sensitivity": {"value": 0.71, "ci_low": 0.66,
                                    "ci_high": 0.76, "method": "wilson-95"}},
        "subgroup_breakdown": subgroup,
        "signed_by": "Dr. A. Nowak", "role": "Clinical Lead",
        "date": "2026-08-04",
        "dataset_manifest_sha256": "ab" * 32,
    })


def test_eval_report_with_null_subgroup_does_not_provide_subgroup_accuracy(repo):
    write(repo, "eval/report.json", _report(None))
    provides = {k for r in evalreport.extract(repo) for k in r.provides}
    assert "eval.overall_accuracy" in provides
    assert "eval.subgroup_accuracy" not in provides, (
        "a present eval report whose subgroup section is null must NOT satisfy "
        "the subgroup requirement — this is the exact failure the tool sells "
        "against")


def test_eval_report_with_subgroups_does_provide_it(repo):
    write(repo, "eval/report.json",
          _report({"age_over_65": {"sensitivity": 0.68}}))
    provides = {k for r in evalreport.extract(repo) for k in r.provides}
    assert "eval.subgroup_accuracy" in provides


def test_eval_report_notes_absence_of_intervals(repo):
    write(repo, "eval/report.json", json.dumps({
        "split": {"name": "test", "n": 10},
        "metrics": {"accuracy": {"value": 0.9}}}))
    recs = evalreport.extract(repo)
    assert any("NO confidence intervals" in r.summary for r in recs)


def test_missing_eval_report_yields_nothing_without_raising(repo):
    assert evalreport.extract(repo) == []


# ── risk log: structure machine-checked ───────────────────────────────────

GOOD_RISK = """risks:
  - id: R-01
    description: alarm fatigue
    owner: Dr. A. Nowak
    status: mitigated
    mitigation: threshold tuned
    review_date: "2026-11-01"
"""

INCOMPLETE_RISK = """risks:
  - id: R-01
    description: alarm fatigue
    status: open
    mitigation: tbd
"""


def test_complete_risk_log_yields_attested_evidence(repo):
    write(repo, "risk-log.yaml", GOOD_RISK)
    recs = risklog.extract(repo)
    assert len(recs) == 1 and recs[0].cls is EvidenceClass.ATTESTED
    assert "risk.log_structured" in recs[0].provides


def test_risk_log_missing_owner_is_structurally_invalid_not_weak_evidence(repo):
    write(repo, "risk-log.yaml", INCOMPLETE_RISK)
    assert risklog.extract(repo) == []
    rel, problems = risklog.structural_problems(repo)
    assert rel and problems
    assert any("owner" in p for p in problems)


def test_absent_risk_log_is_reported_as_absent(repo):
    rel, problems = risklog.structural_problems(repo)
    assert rel is None and problems == ["no risk log found"]


# ── dataset manifest: hashes re-checked ───────────────────────────────────

def test_dataset_manifest_hash_mismatch_is_detected(repo):
    write(repo, "data/train.csv", "a,b\n1,2\n")
    write(repo, "data/manifest.json", json.dumps({
        "files": {"data/train.csv": "ff" * 32}}))
    assert dataset.hash_mismatches(repo)


def test_dataset_manifest_matching_hash_is_clean(repo):
    write(repo, "data/train.csv", "a,b\n1,2\n")
    real = hashlib.sha256((repo.root / "data/train.csv").read_bytes()).hexdigest()
    write(repo, "data/manifest.json", json.dumps({
        "files": {"data/train.csv": real}, "synthetic_only": True,
        "seed": 1, "selection": {"rule": "r", "excluded": 3},
        "cleaning": {"method": "m", "modified": 2},
        "label_definition": "d", "generator_sha256": "cd" * 32}))
    assert dataset.hash_mismatches(repo) == []
    provides = {k for r in dataset.extract(repo) for k in r.provides}
    assert {"data.provenance", "data.selection", "data.cleaning",
            "data.labelling", "data.reproducible"} <= provides


def test_manifest_listing_an_absent_file_is_a_mismatch(repo):
    write(repo, "data/manifest.json", json.dumps({
        "files": {"data/gone.csv": "ab" * 32}}))
    assert any("absent" in m for m in dataset.hash_mismatches(repo))


# ── custody ───────────────────────────────────────────────────────────────

def test_stale_custody_pin_is_detected(repo):
    write(repo, "models/m.bin", "weights")
    write(repo, "custody/register.json", json.dumps({
        "models": [{"id": "m", "path": "models/m.bin", "sha256": "ff" * 32}]}))
    assert custody.stale_pins(repo)


def test_cyclonedx_bom_is_recognised(repo):
    write(repo, "custody/ml-bom.json", json.dumps({
        "bomFormat": "CycloneDX", "specVersion": "1.6",
        "components": [{"type": "machine-learning-model", "name": "m"}]}))
    provides = {k for r in custody.extract(repo) for k in r.provides}
    assert "custody.mlbom" in provides


# ── manifests + input schema ──────────────────────────────────────────────

def test_unpinned_requirements_are_called_out(repo):
    write(repo, "requirements.txt", "numpy\npandas==2.3.3\n")
    recs = extract_manifests(repo)
    assert recs and "unpinned" in recs[0].summary


def test_input_schema_is_parsed_statically_not_imported(repo):
    write(repo, "input_schema.py",
          "raise RuntimeError('importing this would be a bug')\n"
          "from pydantic import BaseModel\n"
          "class VitalsInput(BaseModel):\n"
          "    heart_rate: float\n    spo2: float\n")
    recs = extract_schema(repo)          # must not raise
    assert recs and "VitalsInput" in recs[0].summary
