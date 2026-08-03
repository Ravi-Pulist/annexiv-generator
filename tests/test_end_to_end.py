"""End to end: a fixture repository → pack → audit → determinism.

Exercises the real CLI entry points in-process against a repository built to
have exactly the interesting shape: some MEASURED evidence, some signed prose,
one unsigned document, and two deliberate absences. The assertions are about
behaviour a buyer would care about — does it find what is there, does it
refuse to claim what is not, does it say the same thing twice.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from annexiv.audit import audit_pack
from annexiv.cli import main
from annexiv.render import RefusalError, render_markdown
from annexiv.spec import load_spec

SIGNED = """---
document_type: {kind}
attested_by: "Dr. A. Nowak"
role: "Clinical Lead"
date: "2026-08-04"
covers_annex_iv: {covers}
---
# {kind}

Prose describing {kind}.
"""


@pytest.fixture
def rich_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "subject"
    (repo / "docs").mkdir(parents=True)
    (repo / "data").mkdir()
    (repo / "eval").mkdir()
    (repo / "custody").mkdir()

    (repo / "requirements.txt").write_text("numpy==2.2.6\npandas==2.3.3\n",
                                           encoding="utf-8")
    (repo / "CHANGELOG.md").write_text(
        "# Changelog\n\n## [0.2.0] - 2026-07-01\n- tuning\n\n"
        "## [0.1.0] - 2026-06-01\n- first release\n", encoding="utf-8")
    (repo / "input_schema.py").write_text(
        "from pydantic import BaseModel\n\n"
        "class VitalsInput(BaseModel):\n    heart_rate: float\n    spo2: float\n",
        encoding="utf-8")

    train = repo / "data" / "train.csv"
    train.write_text("hr,spo2,label\n88,97,0\n", encoding="utf-8")
    (repo / "data" / "manifest.json").write_text(json.dumps({
        "synthetic_only": True, "seed": 20260804,
        "generator_sha256": "cd" * 32,
        "files": {"data/train.csv":
                  hashlib.sha256(train.read_bytes()).hexdigest()},
        "selection": {"rule": "at least 6h observation", "excluded": 40},
        "cleaning": {"method": "winsorise at 1st/99th pct", "modified": 12},
        "label_definition": "deterioration within 24h",
    }), encoding="utf-8")

    # Deliberately: no subgroup_breakdown.
    (repo / "eval" / "report.json").write_text(json.dumps({
        "split": {"name": "test", "n": 800, "positive_rate": 0.11},
        "metrics": {"sensitivity": {"value": 0.71, "ci_low": 0.64,
                                    "ci_high": 0.77, "method": "wilson-95"}},
        "subgroup_breakdown": None,
        "operating_point": {"threshold": 0.32, "rationale": "screening"},
        "dataset_manifest_sha256": "ab" * 32,
        "signed_by": "Dr. A. Nowak", "role": "Clinical Lead",
        "date": "2026-08-04",
    }), encoding="utf-8")

    (repo / "custody" / "register.json").write_text(json.dumps({
        "models": [{"id": "clf", "sha256": "ef" * 32, "licence": "MIT"}]}),
        encoding="utf-8")
    (repo / "custody" / "ml-bom.json").write_text(json.dumps({
        "bomFormat": "CycloneDX", "specVersion": "1.6",
        "components": [{"type": "machine-learning-model", "name": "clf"}]}),
        encoding="utf-8")

    (repo / "risk-log.yaml").write_text(
        'risks:\n'
        '  - id: R-01\n    description: alarm fatigue\n'
        '    owner: Dr. A. Nowak\n    status: mitigated\n'
        '    mitigation: threshold tuned\n    review_date: "2026-11-01"\n',
        encoding="utf-8")

    for kind, covers in (("model_card", '["1(a)", "3"]'),
                         ("human_oversight", '["2(e)"]'),
                         ("design_rationale", '["2(b)"]'),
                         ("metric_rationale", '["4"]'),
                         ("labelling_procedure", '["2(d)"]'),
                         ("cybersecurity_measures", '["2(h)"]'),
                         ("standards", '["7"]')):
        (repo / "docs" / f"{kind}.md").write_text(
            SIGNED.format(kind=kind, covers=covers), encoding="utf-8")

    # An unsigned document: present, unusable, and it must be SAID to be.
    (repo / "docs" / "unsigned.md").write_text(
        '---\ndocument_type: data_provenance\nattested_by: ""\n'
        'role: "Data Lead"\ndate: "2026-08-04"\n---\n# provenance\n',
        encoding="utf-8")
    return repo


def test_generate_audit_and_determinism(rich_repo, tmp_path, capsys):
    out1, out2 = tmp_path / "o1", tmp_path / "o2"

    assert main(["generate", str(rich_repo), "--out", str(out1),
                 "--route", "annex_i"]) == 0
    captured = capsys.readouterr().out
    assert "sections addressed: 9/9" in captured
    assert "documentation support" in captured        # boundary statement

    pack = json.loads((out1 / "pack.json").read_text(encoding="utf-8"))
    assert pack["classification_route"] == "annex_i"
    assert pack["completion"]["claims_evidence_backed"] > 0
    assert pack["completion"]["citations_measured"] > 0
    assert pack["completion"]["citations_attested"] > 0

    # audit passes on a freshly generated pack
    res = audit_pack(out1 / "pack.json", rich_repo)
    assert res.ok, [f.detail for f in res.failed]
    assert res.citations_checked > 0

    # determinism: same repo, same bytes
    assert main(["generate", str(rich_repo), "--out", str(out2),
                 "--route", "annex_i"]) == 0
    assert (out1 / "pack.json").read_bytes() == (out2 / "pack.json").read_bytes()
    assert (out1 / "annex-iv.md").read_bytes() == (out2 / "annex-iv.md").read_bytes()


def test_the_two_deliberate_absences_are_named_not_papered_over(rich_repo, tmp_path):
    out = tmp_path / "o"
    main(["generate", str(rich_repo), "--out", str(out), "--route", "annex_i"])
    gaps = json.loads((out / "gap-register.json").read_text(encoding="utf-8"))
    reasons = " ".join(g["reason"] for g in gaps)

    subgroup = [g for g in gaps if g.get("subpoint") == "subgroup_accuracy"]
    assert subgroup, "a null subgroup breakdown must produce a named gap"
    assert "file is present" in subgroup[0]["reason"]

    monitoring = [g for g in gaps if g["section"] == 9]
    assert monitoring, "the absent post-market monitoring plan must be gapped"

    # and the unsigned document is reported as unsigned, not merely absent
    assert "not attributable" in reasons


def test_declaration_of_conformity_is_always_a_permanent_gap(rich_repo, tmp_path):
    out = tmp_path / "o"
    main(["generate", str(rich_repo), "--out", str(out), "--route", "annex_i"])
    gaps = json.loads((out / "gap-register.json").read_text(encoding="utf-8"))
    doc = [g for g in gaps if g["section"] == 8]
    assert len(doc) == 1
    assert doc[0]["permanent"] is True
    assert doc[0]["kind"] == "by_design"


def test_markdown_states_the_route_date_and_the_boundary(rich_repo, tmp_path):
    out = tmp_path / "o"
    main(["generate", str(rich_repo), "--out", str(out), "--route", "annex_i"])
    md = (out / "annex-iv.md").read_text(encoding="utf-8")
    assert "2028-08-02" in md, "the declared route's date must appear"
    assert "not legal advice" in md
    assert "## Gap register" in md and "## Evidence index" in md
    # our decomposition of unlettered points must be disclosed as ours
    assert "this tool's decomposition" in md


def test_no_route_declared_means_no_date_asserted(rich_repo, tmp_path):
    out = tmp_path / "o"
    main(["generate", str(rich_repo), "--out", str(out)])
    md = (out / "annex-iv.md").read_text(encoding="utf-8")
    assert "does not determine classification" in md
    assert "2028-08-02" not in md and "2027-12-02" not in md


def test_gaps_command_exit_codes(rich_repo, tmp_path, capsys):
    # gaps exits 1 when gaps exist so CI can gate on readiness
    assert main(["gaps", str(rich_repo)]) == 1
    assert "to close:" in capsys.readouterr().out


def test_audit_cli_exit_codes(rich_repo, tmp_path, capsys):
    out = tmp_path / "o"
    main(["generate", str(rich_repo), "--out", str(out), "--route", "annex_i"])
    assert main(["audit", str(out / "pack.json"), "--repo", str(rich_repo)]) == 0

    # break the repository under the finished pack
    (rich_repo / "risk-log.yaml").write_text("risks: []\n", encoding="utf-8")
    assert main(["audit", str(out / "pack.json"), "--repo", str(rich_repo)]) == 1
    assert "AUDIT FAILED" in capsys.readouterr().out


def test_unknown_route_is_refused(rich_repo, tmp_path):
    assert main(["generate", str(rich_repo), "--out", str(tmp_path / "o"),
                 "--route", "annex_ii"]) == 2


def test_renderer_refuses_a_section_with_no_claims(rich_repo, tmp_path):
    from annexiv.model import Pack, SectionResult, SectionState
    out = tmp_path / "o"
    main(["generate", str(rich_repo), "--out", str(out), "--route", "annex_i"])
    pack = Pack(**json.loads((out / "pack.json").read_text(encoding="utf-8")))
    hollow = pack.model_copy(update={"sections": tuple(
        s.model_copy(update={"claims": ()}) if s.number == 4 else s
        for s in pack.sections)})
    with pytest.raises(RefusalError, match="no claims"):
        render_markdown(hollow, load_spec())


def test_empty_repo_yields_all_gaps_and_no_prose(tmp_path, capsys):
    bare = tmp_path / "bare"
    bare.mkdir()
    out = tmp_path / "o"
    assert main(["generate", str(bare), "--out", str(out)]) == 0
    pack = json.loads((out / "pack.json").read_text(encoding="utf-8"))
    c = pack["completion"]
    assert c["sections_addressed"] == 9, "every section addressed even with nothing"
    assert c["claims_evidence_backed"] == 0
    assert c["claims_gapped"] == c["claims_total"]
    # audit still passes: a pack of pure gaps is a valid, honest pack
    assert audit_pack(out / "pack.json", bare).ok
