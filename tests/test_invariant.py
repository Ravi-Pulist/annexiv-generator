"""The invariant, from both sides.

Layer 1 — the type system refuses to build an unsupported claim.
Layer 2 — the auditor catches one anyway, because a pack on disk is JSON and
          anyone can edit JSON. A type system protects the generator; it does
          not protect a document that left the process.

Both layers are tested, because either alone is a false comfort.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from annexiv.audit import audit_pack
from annexiv.model import (Claim, EvidenceRecord, GapEntry, GapKind)


def _ev() -> EvidenceRecord:
    return EvidenceRecord.measured(
        extractor="test", source_path="a.txt", source_sha256="ab" * 32,
        summary="a fact")


def _gap() -> GapEntry:
    return GapEntry.make(section=5, requirement="r", reason="why",
                         kind=GapKind.ABSENT, remediation="do the thing")


# ── layer 1: the type system ──────────────────────────────────────────────

def test_claim_with_neither_evidence_nor_gap_is_unconstructable():
    with pytest.raises(ValueError, match="silent assertion"):
        Claim(section=1, text="the system is validated")


def test_claim_with_both_evidence_and_gap_is_unconstructable():
    with pytest.raises(ValueError, match="never both"):
        Claim(section=1, text="x", evidence_ids=("ev_1",), gap_id="gap_1")


def test_supported_requires_at_least_one_record():
    with pytest.raises(ValueError):
        Claim.supported(section=1, text="x", evidence=[])


def test_supported_and_gap_constructors_work():
    assert not Claim.supported(section=1, text="x", evidence=[_ev()]).is_gap
    assert Claim.gap(section=1, text="x", gap=_gap()).is_gap


def test_attested_refuses_anonymous_prose():
    with pytest.raises(ValueError, match="named attester"):
        EvidenceRecord.attested(
            extractor="d", source_path="p.md", source_sha256="0" * 64,
            summary="s", attested_by="   ", role="Lead", date="2026-08-04")


def test_attested_refuses_undated_signature():
    with pytest.raises(ValueError, match="requires a date"):
        EvidenceRecord.attested(
            extractor="d", source_path="p.md", source_sha256="0" * 64,
            summary="s", attested_by="A. Person", role="Lead", date="")


def test_attested_refuses_roleless_signature():
    with pytest.raises(ValueError, match="role"):
        EvidenceRecord.attested(
            extractor="d", source_path="p.md", source_sha256="0" * 64,
            summary="s", attested_by="A. Person", role="", date="2026-08-04")


def test_evidence_ids_are_content_addressed_and_collision_resistant():
    a = EvidenceRecord.measured(extractor="ab", source_path="c",
                                source_sha256="0" * 64, summary="s")
    b = EvidenceRecord.measured(extractor="a", source_path="bc",
                                source_sha256="0" * 64, summary="s")
    assert a.id != b.id, "coordinate fields must not run together when hashed"


# ── layer 2: the auditor, against planted defects ─────────────────────────

@pytest.fixture
def planted(tmp_path: Path):
    """A minimal but structurally valid pack on disk, plus its repo."""
    repo = tmp_path / "repo"
    repo.mkdir()
    (repo / "a.txt").write_text("hello", encoding="utf-8")
    import hashlib
    sha = hashlib.sha256(b"hello").hexdigest()

    pack = {
        "spec_version": "1.0", "tool_version": "0.1.0", "repo_commit": None,
        "repo_name": "repo", "classification_route": None,
        "sections": [{
            "number": 1, "title": "s", "state": "partial", "gapped": ["b"],
            "claims": [
                {"section": 1, "subpoint": "a", "text": "supported",
                 "evidence_ids": ["ev_x"], "gap_id": None},
                {"section": 1, "subpoint": "b", "text": "gapped",
                 "evidence_ids": [], "gap_id": "gap_y"},
            ]}],
        "evidence": [{"id": "ev_x", "cls": "MEASURED", "extractor": "t",
                      "source_path": "a.txt", "source_sha256": sha,
                      "locator": None, "summary": "s", "provides": [],
                      "commit": None, "attested_by": None, "role": None,
                      "date": None}],
        "gaps": [{"id": "gap_y", "section": 1, "subpoint": "b",
                  "requirement": "r", "reason": "why", "kind": "absent",
                  "permanent": False, "remediation": "do it"}],
        "completion": {"spec_version": "1.0", "tool_version": "0.1.0",
                       "repo_commit": None, "sections_total": 1,
                       "sections_addressed": 1, "claims_total": 2,
                       "claims_evidence_backed": 1, "claims_gapped": 1,
                       "citations_measured": 1, "citations_attested": 0,
                       "gaps_total": 1, "gaps_permanent": 0},
    }
    path = tmp_path / "pack.json"

    def write(doc):
        path.write_text(json.dumps(doc, indent=2), encoding="utf-8")
        return path

    return pack, write, repo


def test_clean_pack_passes(planted):
    pack, write, repo = planted
    assert audit_pack(write(pack), repo).ok


def test_defect_silent_assertion_is_caught(planted):
    pack, write, repo = planted
    pack["sections"][0]["claims"].append(
        {"section": 1, "subpoint": "c", "text": "the system is safe",
         "evidence_ids": [], "gap_id": None})
    res = audit_pack(write(pack), repo)
    assert not res.ok
    assert any("SILENT ASSERTION" in f.detail for f in res.failed)


def test_defect_claim_citing_both_is_caught(planted):
    pack, write, repo = planted
    pack["sections"][0]["claims"][0]["gap_id"] = "gap_y"
    res = audit_pack(write(pack), repo)
    assert any(f.check == "evidence-or-gap" for f in res.failed)


def test_defect_dangling_citation_is_caught(planted):
    pack, write, repo = planted
    pack["sections"][0]["claims"][0]["evidence_ids"] = ["ev_does_not_exist"]
    res = audit_pack(write(pack), repo)
    assert any(f.check == "citation-resolves" for f in res.failed)


def test_defect_deleted_evidence_file_is_caught(planted):
    pack, write, repo = planted
    (repo / "a.txt").unlink()
    res = audit_pack(write(pack), repo)
    assert any(f.check == "source-exists" for f in res.failed)


def test_defect_tampered_evidence_file_is_caught(planted):
    pack, write, repo = planted
    (repo / "a.txt").write_text("hello, but different", encoding="utf-8")
    res = audit_pack(write(pack), repo)
    assert any(f.check == "hash-matches" for f in res.failed)


def test_defect_broken_hash_in_pack_is_caught(planted):
    pack, write, repo = planted
    pack["evidence"][0]["source_sha256"] = "ff" * 32
    res = audit_pack(write(pack), repo)
    assert any(f.check == "hash-matches" for f in res.failed)


def test_defect_dangling_gap_reference_is_caught(planted):
    pack, write, repo = planted
    pack["sections"][0]["claims"][1]["gap_id"] = "gap_deleted"
    res = audit_pack(write(pack), repo)
    assert any(f.check == "gap-resolves" for f in res.failed)


def test_defect_deleted_gap_register_entry_is_caught(planted):
    pack, write, repo = planted
    pack["gaps"] = []
    res = audit_pack(write(pack), repo)
    assert any(f.check == "gap-resolves" for f in res.failed)


def test_defect_inflated_completion_counts_are_caught(planted):
    pack, write, repo = planted
    pack["completion"]["claims_evidence_backed"] = 2
    pack["completion"]["claims_gapped"] = 0
    res = audit_pack(write(pack), repo)
    assert any(f.check == "counts-agree" for f in res.failed)


def test_defect_emptied_section_is_caught(planted):
    pack, write, repo = planted
    pack["sections"][0]["claims"] = []
    res = audit_pack(write(pack), repo)
    assert any(f.check == "section-addressed" for f in res.failed)


def test_defect_unparseable_pack_is_caught(tmp_path):
    p = tmp_path / "pack.json"
    p.write_text("{not json", encoding="utf-8")
    res = audit_pack(p, tmp_path)
    assert not res.ok
