"""Repository invariants.

These are not unit tests of the model. They are checks that the evidence this
repository publishes is true: that the digests pin what they claim to pin, that
the attested documents are actually attested, and that the two gaps we chose to
leave are still gaps.

That last group is the unusual one. `test_absence_*` asserts that something is
MISSING. They exist so that a well-meaning contributor who fills a documented
gap has to also delete the assertion and the KNOWN-GAPS entry, which makes the
change visible in review instead of quietly closing a hole the documentation
still describes as open.

    python -m pytest tests -q
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]

MANIFEST_PATH = ROOT / "data" / "manifest.json"
REPORT_PATH = ROOT / "eval" / "report.json"
MODEL_PATH = ROOT / "models" / "model.joblib"
REGISTER_PATH = ROOT / "custody" / "register.json"
BOM_PATH = ROOT / "custody" / "ml-bom.json"
RISK_LOG_PATH = ROOT / "risk-log.yaml"
CONFIG_PATH = ROOT / "config" / "training.yaml"
DOCS_DIR = ROOT / "docs"

SPLITS = ("train", "val", "test")

#: Directories that are not part of the published repository.
SKIP_DIRS = {".git", "__pycache__", ".pytest_cache", ".venv", "venv", ".idea"}

#: The only columns any CSV in this repository is allowed to have.
EXPECTED_CSV_COLUMNS = [
    "encounter_id",
    "age_years",
    "sex",
    "observation_hours",
    "heart_rate",
    "systolic_bp",
    "diastolic_bp",
    "respiratory_rate",
    "spo2",
    "temperature",
    "wbc",
    "lactate",
    "creatinine",
    "label",
]

#: Column names that would indicate a real-person record had been introduced.
FORBIDDEN_COLUMNS = {
    "patient_id",
    "patient_name",
    "name",
    "surname",
    "forename",
    "given_name",
    "family_name",
    "mrn",
    "nhs_number",
    "ssn",
    "national_insurance",
    "dob",
    "date_of_birth",
    "birth_date",
    "address",
    "postcode",
    "zip",
    "email",
    "phone",
    "telephone",
    "hospital_number",
}

#: Value-shaped identifier patterns. Deliberately matched against VALUES, not
#: vocabulary -- a document that says "no hospital number is stored" is fine and
#: must not fail this test. What must never appear is something shaped like a
#: real identifier.
IDENTIFIER_PATTERNS = {
    "email address": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    "US social security number": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    "NHS-formatted number": re.compile(r"\b\d{3} \d{3} \d{4}\b"),
    "international phone number": re.compile(
        r"\+\d{1,3}[\s-]?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}\b"
    ),
    "16-digit payment card": re.compile(r"\b\d{16}\b"),
}

#: Wall-clock calls would break byte-identical rebuilds.
WALL_CLOCK_PATTERNS = (
    re.compile(r"date\.today\s*\("),
    re.compile(r"datetime\.now\s*\("),
    re.compile(r"datetime\.utcnow\s*\("),
    re.compile(r"time\.time\s*\("),
)

REQUIRED_FRONT_MATTER = (
    "document_type",
    "attested_by",
    "role",
    "date",
    "covers_annex_iv",
)

VALID_DOCUMENT_TYPES = {
    "model_card",
    "human_oversight",
    "design_rationale",
    "metric_rationale",
    "labelling_procedure",
    "cybersecurity_measures",
    "standards",
}

RISK_FIELDS = ("id", "description", "owner", "status", "mitigation", "review_date")
VALID_RISK_STATUS = {"open", "mitigated", "accepted"}


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def repo_files() -> list[Path]:
    """Every published file, excluding tooling and VCS directories."""
    found = []
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
            continue
        found.append(path)
    return sorted(found)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def executable_source(path: Path) -> str:
    """Source with comments and string literals removed.

    Scanning raw text for wall-clock calls flags the sentence "hardcoded, not
    date.today()" in a comment explaining why the clock is not read -- i.e. it
    fails on the documentation of the very discipline it is checking. Tokenise
    and drop COMMENT and STRING so only executable code is examined.
    """
    import io
    import tokenize

    kept = []
    with open(path, "rb") as handle:
        for token in tokenize.tokenize(io.BytesIO(handle.read()).readline):
            if token.type in (tokenize.COMMENT, tokenize.STRING):
                continue
            kept.append(token.string)
    return " ".join(kept)


def split_front_matter(text: str) -> tuple[dict | None, str]:
    """Return (front_matter, body). front_matter is None when absent."""
    if not text.startswith("---"):
        return None, text
    parts = text.split("---", 2)
    if len(parts) < 3:
        return None, text
    return yaml.safe_load(parts[1]), parts[2]


@pytest.fixture(scope="session")
def manifest() -> dict:
    with open(MANIFEST_PATH, "r", encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture(scope="session")
def report() -> dict:
    with open(REPORT_PATH, "r", encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture(scope="session")
def risk_log() -> dict:
    with open(RISK_LOG_PATH, "r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


@pytest.fixture(scope="session")
def config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as handle:
        return yaml.safe_load(handle)


@pytest.fixture(scope="session")
def rebuilds(tmp_path_factory) -> list[Path]:
    """Regenerate the dataset twice, from scratch, in two isolated trees.

    Nothing is written into the repository. Each rebuild gets a copy of only
    the two inputs the generator reads -- config/training.yaml and
    data/generate.py -- so a rebuild that accidentally depended on a committed
    CSV would fail here rather than silently pass.
    """
    outputs = []
    for run in range(2):
        sandbox = tmp_path_factory.mktemp(f"rebuild{run}")
        (sandbox / "config").mkdir()
        (sandbox / "data").mkdir()
        shutil.copy2(CONFIG_PATH, sandbox / "config" / "training.yaml")
        shutil.copy2(ROOT / "data" / "generate.py", sandbox / "data" / "generate.py")
        completed = subprocess.run(
            [sys.executable, str(sandbox / "data" / "generate.py")],
            capture_output=True,
            text=True,
            cwd=str(sandbox),
        )
        assert completed.returncode == 0, (
            f"rebuild {run} failed\nstdout:\n{completed.stdout}\n"
            f"stderr:\n{completed.stderr}"
        )
        outputs.append(sandbox)
    return outputs


# --------------------------------------------------------------------------
# determinism
# --------------------------------------------------------------------------
def test_dataset_rebuilds_byte_identically(rebuilds):
    """Two independent rebuilds from the seed produce identical bytes."""
    first, second = rebuilds
    for name in SPLITS:
        a = (first / "data" / f"{name}.csv").read_bytes()
        b = (second / "data" / f"{name}.csv").read_bytes()
        assert a == b, f"data/{name}.csv differs between two rebuilds from the seed"
    assert (first / "data" / "manifest.json").read_bytes() == (
        second / "data" / "manifest.json"
    ).read_bytes(), "manifest.json differs between two rebuilds from the seed"


def test_committed_dataset_matches_a_fresh_rebuild(rebuilds):
    """The committed CSVs and manifest are what the generator produces today."""
    fresh = rebuilds[0]
    for name in SPLITS:
        assert sha256_file(fresh / "data" / f"{name}.csv") == sha256_file(
            ROOT / "data" / f"{name}.csv"
        ), (
            f"committed data/{name}.csv does not match a fresh run of "
            "data/generate.py -- regenerate the dataset and the manifest together"
        )
    assert (fresh / "data" / "manifest.json").read_bytes() == MANIFEST_PATH.read_bytes()


def test_no_wall_clock_in_generated_artifact_pipeline():
    """Nothing in the pipeline may read the clock; it would break rebuilds."""
    sources = [
        ROOT / "data" / "generate.py",
        ROOT / "train.py",
        ROOT / "eval" / "evaluate.py",
        ROOT / "custody" / "pin.py",
    ]
    for source in sources:
        text = executable_source(source)
        for pattern in WALL_CLOCK_PATTERNS:
            assert not pattern.search(text), (
                f"{source.relative_to(ROOT).as_posix()} calls the wall clock "
                f"({pattern.pattern}); generated artifacts must be byte-identical "
                "between runs"
            )


# --------------------------------------------------------------------------
# manifest integrity
# --------------------------------------------------------------------------
def test_manifest_digests_match_files_on_disk(manifest):
    for relative_path, expected in manifest["files"].items():
        path = ROOT / relative_path
        assert path.is_file(), f"{relative_path} is pinned in the manifest but missing"
        assert sha256_file(path) == expected, f"{relative_path} does not match its digest"


def test_manifest_pins_its_own_generator(manifest):
    assert manifest["generator_sha256"] == sha256_file(ROOT / "data" / "generate.py")


def test_manifest_shape_and_counts(manifest):
    assert manifest["manifest_version"] == "1.0"
    assert manifest["seed"] == 20260804
    assert set(manifest["rows"]) == set(SPLITS)
    assert all(manifest["rows"][name] > 0 for name in SPLITS)
    assert manifest["selection"]["excluded"] > 0, "a selection rule that excludes nothing is not a selection rule"
    assert manifest["selection"]["rule"].strip()
    assert manifest["cleaning"]["modified"] > 0, "a cleaning step that modifies nothing is not a cleaning step"
    assert manifest["cleaning"]["method"].strip()
    assert manifest["label_definition"].strip()
    assert len(manifest["features"]) == 10
    for feature in manifest["features"]:
        assert set(feature) == {"name", "unit", "dtype"}
        assert feature["unit"].strip()


def test_seed_is_consistent_everywhere(manifest, report, config):
    assert config["seed"] == 20260804
    assert manifest["seed"] == 20260804
    assert report["seed"] == 20260804


# --------------------------------------------------------------------------
# synthetic-data guarantee
# --------------------------------------------------------------------------
def test_manifest_declares_synthetic_only(manifest):
    assert manifest["synthetic_only"] is True


def test_csv_columns_are_the_declared_schema():
    for path in ROOT.rglob("*.csv"):
        if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
            continue
        header = path.read_text(encoding="utf-8").splitlines()[0]
        columns = [c.strip() for c in header.split(",")]
        assert columns == EXPECTED_CSV_COLUMNS, (
            f"{path.relative_to(ROOT).as_posix()} has unexpected columns: {columns}"
        )
        overlap = {c.lower() for c in columns} & FORBIDDEN_COLUMNS
        assert not overlap, f"identifier-like columns present: {sorted(overlap)}"


def test_no_real_patient_identifiers_anywhere():
    """No value anywhere in the tree is shaped like a real-person identifier.

    Matched against values rather than vocabulary on purpose: a document that
    says "no hospital number is stored" is fine. Something shaped like an
    actual identifier is not.
    """
    offences = []
    for path in repo_files():
        text = read_text(path)
        for label, pattern in IDENTIFIER_PATTERNS.items():
            match = pattern.search(text)
            if match:
                offences.append(
                    f"{path.relative_to(ROOT).as_posix()}: {label} -> {match.group(0)!r}"
                )
    assert not offences, "identifier-shaped values found:\n" + "\n".join(offences)


def test_encounter_ids_are_visibly_synthetic():
    import csv

    for name in SPLITS:
        with open(ROOT / "data" / f"{name}.csv", newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                assert row["encounter_id"].startswith("SYN-"), row["encounter_id"]


# --------------------------------------------------------------------------
# evaluation report
# --------------------------------------------------------------------------
def test_report_metrics_are_valid_proportions(report):
    metrics = report["metrics"]
    assert 0.0 <= metrics["auroc"]["value"] <= 1.0

    for name in ("sensitivity", "specificity", "ppv", "npv"):
        block = metrics[name]
        assert block["method"] == "wilson-95", name
        assert block["n"] > 0, name
        for key in ("value", "ci_low", "ci_high"):
            assert 0.0 <= block[key] <= 1.0, f"{name}.{key} outside [0,1]"
        assert block["ci_low"] <= block["value"] <= block["ci_high"], (
            f"{name}: interval [{block['ci_low']}, {block['ci_high']}] does not "
            f"contain the point estimate {block['value']}"
        )
        assert block["ci_low"] < block["ci_high"], (
            f"{name}: zero-width interval -- this is the Wald failure mode Wilson "
            "was chosen to avoid"
        )


def test_report_is_pinned_to_the_artifacts_it_evaluated(report):
    assert report["report_version"] == "1.0"
    assert report["model_sha256"] == sha256_file(MODEL_PATH)
    assert report["dataset_manifest_sha256"] == sha256_file(MANIFEST_PATH)


def test_report_split_is_the_held_out_test_split(report, manifest):
    assert report["split"]["name"] == "test"
    assert report["split"]["n"] == manifest["rows"]["test"]
    assert 0.0 < report["split"]["positive_rate"] < 1.0


def test_report_operating_point_is_justified(report):
    threshold = report["operating_point"]["threshold"]
    assert 0.0 <= threshold <= 1.0
    assert len(report["operating_point"]["rationale"]) > 80, (
        "an operating point without a reasoned justification is a magic number"
    )


def test_report_is_attested(report):
    assert report["signed_by"].strip()
    assert report["role"].strip()
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", report["date"])


def test_report_confusion_matrix_agrees_with_the_metrics(report):
    matrix = report["confusion_matrix"]
    metrics = report["metrics"]
    total = sum(matrix.values())
    assert total == report["split"]["n"]
    assert metrics["sensitivity"]["n"] == matrix["true_positive"] + matrix["false_negative"]
    assert metrics["specificity"]["n"] == matrix["true_negative"] + matrix["false_positive"]
    assert metrics["ppv"]["n"] == matrix["true_positive"] + matrix["false_positive"]
    assert metrics["npv"]["n"] == matrix["true_negative"] + matrix["false_negative"]


# --------------------------------------------------------------------------
# attested documents
# --------------------------------------------------------------------------
def attested_docs() -> list[Path]:
    return sorted(p for p in DOCS_DIR.glob("*.md") if p.name != "KNOWN-GAPS.md")


@pytest.mark.parametrize(
    "doc", attested_docs(), ids=lambda p: p.name
)
def test_attested_doc_front_matter_is_complete(doc: Path):
    front_matter, body = split_front_matter(read_text(doc))
    assert front_matter is not None, (
        f"{doc.name} has no YAML front-matter; anonymous prose is not attestation"
    )

    missing = [key for key in REQUIRED_FRONT_MATTER if key not in front_matter]
    assert not missing, f"{doc.name} front-matter missing: {missing}"

    assert front_matter["document_type"] in VALID_DOCUMENT_TYPES, front_matter["document_type"]
    assert str(front_matter["attested_by"]).strip()
    assert str(front_matter["role"]).strip()
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(front_matter["date"])), front_matter["date"]

    covers = front_matter["covers_annex_iv"]
    assert isinstance(covers, list) and covers, f"{doc.name}: covers_annex_iv must be a non-empty list"
    for item in covers:
        assert re.fullmatch(r"\d+(\([a-z]\))?", str(item)), f"{doc.name}: bad Annex IV reference {item!r}"

    assert len(body.strip()) > 400, f"{doc.name} is attested but nearly empty"


def test_every_required_document_type_is_present():
    present = set()
    for doc in attested_docs():
        front_matter, _ = split_front_matter(read_text(doc))
        present.add(front_matter["document_type"])
    assert present == VALID_DOCUMENT_TYPES, f"missing document types: {sorted(VALID_DOCUMENT_TYPES - present)}"


def test_known_gaps_is_deliberately_not_attested():
    """KNOWN-GAPS.md is plain prose, and that is the point.

    It records what is absent. Signing it would make it read as an attestation
    that the gaps are acceptable, which is a different claim from the one it
    makes.
    """
    path = DOCS_DIR / "KNOWN-GAPS.md"
    assert path.is_file()
    front_matter, _ = split_front_matter(read_text(path))
    assert front_matter is None, "KNOWN-GAPS.md must stay plain prose"


# --------------------------------------------------------------------------
# risk log
# --------------------------------------------------------------------------
def test_risk_log_entries_are_complete(risk_log):
    risks = risk_log["risks"]
    assert len(risks) >= 6, "a deterioration screen with under six identified risks has not been assessed"

    seen = set()
    for risk in risks:
        missing = [field for field in RISK_FIELDS if field not in risk]
        assert not missing, f"{risk.get('id', '<no id>')} missing fields: {missing}"
        assert risk["id"] not in seen, f"duplicate risk id {risk['id']}"
        seen.add(risk["id"])

        assert re.fullmatch(r"R-\d{2}", risk["id"]), risk["id"]
        assert risk["status"] in VALID_RISK_STATUS, f"{risk['id']}: bad status {risk['status']!r}"
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(risk["review_date"])), risk["id"]
        for field in ("description", "owner", "mitigation"):
            assert str(risk[field]).strip(), f"{risk['id']}: {field} is empty"
        assert len(str(risk["mitigation"]).strip()) > 40, (
            f"{risk['id']}: a one-line mitigation is a risk nobody has thought about"
        )


def test_risk_log_covers_the_known_hazards(risk_log):
    """The hazards a deterioration screen is known to carry must be named."""
    blob = yaml.safe_dump(risk_log).lower()
    for hazard in ("alarm fatigue", "subgroup", "automation bias", "drift", "missing", "threshold"):
        assert hazard in blob, f"risk log does not address {hazard!r}"


# --------------------------------------------------------------------------
# custody
# --------------------------------------------------------------------------
def test_register_pins_the_model_on_disk():
    with open(REGISTER_PATH, "r", encoding="utf-8") as handle:
        register = json.load(handle)
    entries = register["models"]
    assert len(entries) == 1
    entry = entries[0]
    assert entry["id"] == "deterioration-clf"
    assert entry["sha256"] == sha256_file(MODEL_PATH), (
        "custody/register.json pins a digest that is not the model on disk -- "
        "re-run `python custody/pin.py`"
    )
    assert entry["licence"] == "MIT"
    assert entry["source"].strip()
    assert "pinned_at_commit" in entry


def test_ml_bom_is_cyclonedx_16_and_carries_the_same_digest():
    with open(BOM_PATH, "r", encoding="utf-8") as handle:
        bom = json.load(handle)
    assert bom["bomFormat"] == "CycloneDX"
    assert bom["specVersion"] == "1.6"

    models = [c for c in bom["components"] if c["type"] == "machine-learning-model"]
    assert len(models) == 1, "the BOM must carry exactly one machine-learning-model component"

    hashes = {h["alg"]: h["content"] for h in models[0]["hashes"]}
    assert hashes["SHA-256"] == sha256_file(MODEL_PATH)


def test_model_artifact_declares_the_manifest_it_was_trained_against():
    import joblib

    artifact = joblib.load(MODEL_PATH)
    assert artifact["seed"] == 20260804
    assert artifact["dataset_manifest_sha256"] == sha256_file(MANIFEST_PATH)
    assert len(artifact["feature_order"]) == 10


# --------------------------------------------------------------------------
# inference contract
# --------------------------------------------------------------------------
def test_input_schema_bounds_match_the_training_cleaner(config):
    """Serving-time acceptance must equal training-time plausibility.

    A drift between the two is how a model ends up scoring inputs it was never
    shown values like, silently.
    """
    from input_schema import FEATURE_BOUNDS

    bounds = config["data"]["cleaning"]["bounds"]
    for name, (_unit, low, high) in FEATURE_BOUNDS.items():
        assert name in bounds, f"{name} accepted at inference but not bounded at training"
        assert [low, high] == [float(v) for v in bounds[name]], (
            f"{name}: inference accepts [{low}, {high}] but the cleaner used "
            f"{bounds[name]}"
        )


def test_input_schema_rejects_out_of_range_values():
    from pydantic import ValidationError

    from input_schema import EncounterFeatures

    valid = dict(
        heart_rate=88.0,
        systolic_bp=118.0,
        diastolic_bp=70.0,
        respiratory_rate=18.0,
        spo2=96.0,
        temperature=37.2,
        wbc=11.0,
        lactate=1.4,
        creatinine=82.0,
        age_years=71.0,
    )
    assert len(EncounterFeatures(**valid).to_vector()) == 10

    for field, bad in (("spo2", 12.0), ("heart_rate", 400.0), ("age_years", 4.0)):
        with pytest.raises(ValidationError):
            EncounterFeatures(**{**valid, field: bad})

    # Missing values must not be silently imputed at inference time.
    incomplete = {k: v for k, v in valid.items() if k != "lactate"}
    with pytest.raises(ValidationError):
        EncounterFeatures(**incomplete)


def test_feature_order_matches_the_manifest(manifest):
    from input_schema import FEATURE_ORDER

    assert [f["name"] for f in manifest["features"]] == FEATURE_ORDER


# --------------------------------------------------------------------------
# THE TWO DELIBERATE ABSENCES
#
# These assert that something is missing. If you are here because one of them
# failed after you added the missing thing: good. Delete the assertion, delete
# the matching entry in docs/KNOWN-GAPS.md, and update the risk log. All
# three together, so the change is visible in review.
# --------------------------------------------------------------------------
def test_absence_no_subgroup_breakdown(report):
    """Annex IV point 3 wants per-group accuracy. We did not compute it."""
    assert "subgroup_breakdown" in report, (
        "the key must be present and null -- an omitted key looks like an "
        "oversight, an explicit null looks like the decision it was"
    )
    assert report["subgroup_breakdown"] is None, (
        "subgroup_breakdown is populated. If that is intended, remove this test, "
        "remove the entry from docs/KNOWN-GAPS.md and close R-02."
    )


def test_absence_no_post_market_monitoring_plan():
    """Nothing in this repository plans for monitoring after release."""
    forbidden = [
        DOCS_DIR / "post-market-monitoring.md",
        DOCS_DIR / "post_market_monitoring.md",
        ROOT / "post-market-monitoring.md",
        ROOT / "config" / "telemetry.yaml",
        ROOT / "config" / "monitoring.yaml",
    ]
    present = [p for p in forbidden if p.exists()]
    assert not present, (
        "post-market monitoring artifacts exist: "
        f"{[p.relative_to(ROOT).as_posix() for p in present]}. If that is "
        "intended, remove this test, remove the entry from docs/KNOWN-GAPS.md "
        "and close R-07."
    )

    for doc in attested_docs():
        front_matter, _ = split_front_matter(read_text(doc))
        assert front_matter["document_type"] != "post_market_monitoring"


def test_both_absences_are_declared_in_known_gaps():
    """A gap nobody wrote down is an oversight; a gap on the record is a choice."""
    text = read_text(DOCS_DIR / "KNOWN-GAPS.md").lower()
    assert "subgroup" in text
    assert "post-market" in text or "post market" in text
