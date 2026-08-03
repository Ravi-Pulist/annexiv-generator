"""The mapping spec is the tool's claim to have read the regulation.

These tests pin the facts that were verified against the Official Journal text
on 2026-08-04. If a delegated act under Article 11(3) amends Annex IV, these
tests are supposed to fail — that is the alarm, and the fix is a deliberate
spec_version bump, not a quiet edit.
"""

from __future__ import annotations

import pytest
import yaml

from annexiv.spec import DEFAULT_SPEC_PATH, load_spec


@pytest.fixture(scope="module")
def spec():
    return load_spec()


# ── the verified structure ────────────────────────────────────────────────

def test_annex_iv_has_exactly_nine_top_level_points(spec):
    assert len(spec.sections) == 9
    assert [s.number for s in spec.sections] == list(range(1, 10))


def test_only_points_one_and_two_carry_lettered_subpoints(spec):
    lettered = {s.number for s in spec.sections if s.subpoints}
    assert lettered == {1, 2}
    for n in (1, 2):
        assert sorted(spec.section(n).subpoints) == list("abcdefgh")


def test_points_three_seven_nine_decompositions_are_flagged_as_ours(spec):
    # The OJ prints these as unlettered blocks. Any sub-structure the tool
    # imposes must be marked as the tool's, not the regulation's.
    for n in (3, 7, 9):
        s = spec.section(n)
        assert s.limbs, f"section {n} should carry limbs"
        assert s.limbs_are_our_decomposition is True


def test_declaration_of_conformity_is_a_permanent_gap_with_no_sources(spec):
    s = spec.section(8)
    assert s.permanent_gap is True
    assert s.evidence_sources == ()
    assert "Article 47" in s.article_refs
    assert s.permanent_gap_reason.strip()


def test_article_cross_references_match_the_verified_text(spec):
    assert set(spec.articles_cited_by_annex_iv) == {
        "Article 9", "Article 11(1)", "Article 13(3)(d)", "Article 14",
        "Article 47", "Article 72", "Article 72(3)"}
    # Commonly assumed, and genuinely absent from the annex text.
    assert set(spec.articles_not_cited_despite_common_assumption) == {
        "Article 10", "Article 15"}


def test_risk_management_cites_article_nine(spec):
    assert spec.section(5).article_refs == ("Article 9",)


def test_post_market_section_cites_both_72_and_72_3(spec):
    refs = spec.section(9).article_refs
    assert "Article 72" in refs and "Article 72(3)" in refs


def test_subgroup_accuracy_is_its_own_requirement(spec):
    # "degrees of accuracy for specific persons or groups" is a distinct
    # obligation from overall accuracy; collapsing them would let a report
    # with no subgroup breakdown satisfy both.
    reqs = spec.section(3).requirements
    assert "subgroup_accuracy" in reqs and "overall_accuracy" in reqs


def test_subgroup_requirement_demands_a_capability_key(spec):
    srcs = [s for s in spec.section(3).evidence_sources
            if "subgroup_accuracy" in s.supports]
    assert srcs, "no source supports subgroup_accuracy"
    assert all(s.via_keys for s in srcs), (
        "the subgroup requirement must be gated on a capability key, or a "
        "present-but-empty eval report would satisfy it")


def test_lifecycle_changes_distinct_from_predetermined_changes(spec):
    assert spec.section(6).distinct_from, (
        "point 6 (actual lifecycle changes) and 2(f) (pre-determined changes) "
        "must be documented as distinct")


# ── applicability: the fact the plan got wrong ────────────────────────────

def test_annex_iv_duty_is_not_yet_in_force(spec):
    # Regulation (EU) 2026/1744 deferred Chapter III Sections 1-3.
    assert spec.applicability.in_force_now is False


def test_route_dates_are_the_deferred_ones(spec):
    assert spec.applicability.route_date("annex_iii")[0] == "2027-12-02"
    assert spec.applicability.route_date("annex_i")[0] == "2028-08-02"


def test_healthcare_diagnosis_routes_via_annex_i_not_annex_iii(spec):
    annex_iii = spec.applicability.routes["annex_iii"]
    note = " ".join(str(v) for v in annex_iii.values())
    assert "no entry for medical diagnosis" in note.lower() or \
           "NO entry" in note


def test_unknown_route_yields_no_date(spec):
    assert spec.applicability.route_date("made_up") == (None, None)
    assert spec.applicability.route_date(None) == (None, None)


# ── the loader refuses malformed spines ───────────────────────────────────

def _mutate(tmp_path, fn):
    data = yaml.safe_load(DEFAULT_SPEC_PATH.read_text(encoding="utf-8"))
    fn(data)
    p = tmp_path / "mutated.yaml"
    p.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    return p


def test_loader_refuses_a_spec_with_the_wrong_section_count(tmp_path):
    p = _mutate(tmp_path, lambda d: d["sections"].pop())
    with pytest.raises(ValueError, match="9"):
        load_spec(p)


def test_loader_refuses_a_permanent_gap_that_declares_evidence(tmp_path):
    def add_source(d):
        for s in d["sections"]:
            if s["number"] == 8:
                s["evidence_sources"] = [{"extractor": "git", "yields": "MEASURED",
                                          "supports": ["whole"], "looks_for": "x"}]
    p = _mutate(tmp_path, add_source)
    with pytest.raises(ValueError, match="permanent gap"):
        load_spec(p)


def test_loader_refuses_a_section_with_no_route_to_evidence(tmp_path):
    def strip(d):
        for s in d["sections"]:
            if s["number"] == 5:
                s["evidence_sources"] = []
    p = _mutate(tmp_path, strip)
    with pytest.raises(ValueError, match="no evidence sources"):
        load_spec(p)


def test_loader_refuses_a_source_supporting_an_unknown_requirement(tmp_path):
    def bogus(d):
        for s in d["sections"]:
            if s["number"] == 5:
                s["evidence_sources"][0]["supports"] = ["not_a_requirement"]
    p = _mutate(tmp_path, bogus)
    with pytest.raises(ValueError, match="not one of"):
        load_spec(p)


def test_spec_is_hashed_so_a_pack_records_which_reading_produced_it(spec):
    assert len(spec.spec_sha256) == 64
