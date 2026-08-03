"""Attested documents: signed, dated human prose.

Annex IV genuinely needs prose in places — design rationale (2(b)), metric
appropriateness (4), oversight measures (2(e), 3). Pretending that prose is
machine-derived would be a lie; refusing to include it would make the pack
useless. The honest third option is to label it: a named person, their role,
and a date.

**Anonymous prose is not weak evidence — it is no evidence.** A document with
missing or empty front-matter fields yields no record and instead reports an
``unsigned`` absence, which the predicate turns into a gap. That rule is the
difference between "we have a document about oversight" and "a named clinical
lead signed our oversight assessment on a date we can check against the
version it describes".
"""

from __future__ import annotations

import re

import yaml

from ..model import EvidenceRecord
from ..repo import RepoContext

DOC_DIRS = ("docs", ".")
REQUIRED_FIELDS = ("document_type", "attested_by", "role", "date")

#: document_type -> capability keys it can provide
DOC_CAPABILITIES = {
    "model_card": ("doc.intended_purpose", "doc.deployment_forms",
                   "doc.user_interface", "doc.instructions_for_use",
                   "doc.limitations", "doc.unintended_outcomes"),
    "human_oversight": ("doc.human_oversight",),
    "design_rationale": ("doc.design_rationale",),
    "metric_rationale": ("doc.metric_rationale",),
    "labelling_procedure": ("doc.labelling_procedure",),
    "cybersecurity_measures": ("doc.cybersecurity",),
    "standards": ("doc.standards",),
    "post_market_monitoring_plan": ("doc.post_market_monitoring_plan",
                                    "doc.post_market_evaluation"),
    "post_market_evaluation": ("doc.post_market_evaluation",),
    "data_provenance": ("doc.data_provenance",),
    "predetermined_changes": ("doc.predetermined_changes",),
}

_FM = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def parse_front_matter(text: str) -> dict | None:
    m = _FM.match(text)
    if not m:
        return None
    try:
        data = yaml.safe_load(m.group(1))
    except yaml.YAMLError:
        return None
    return data if isinstance(data, dict) else None


def _candidate_docs(repo: RepoContext) -> list[str]:
    out: list[str] = []
    for d in DOC_DIRS:
        pattern = f"{d}/*.md" if d != "." else "*.md"
        out.extend(repo.glob(pattern))
    return sorted(set(out))


def extract(repo: RepoContext) -> list[EvidenceRecord]:
    records: list[EvidenceRecord] = []
    for rel in _candidate_docs(repo):
        try:
            text = repo.read_text(rel)
        except (OSError, UnicodeDecodeError):
            continue
        fm = parse_front_matter(text)
        if not fm:
            continue                       # ordinary prose, not an attestation
        missing = [f for f in REQUIRED_FIELDS
                   if not str(fm.get(f, "") or "").strip()]
        if missing:
            # Deliberately silent here: the document announced itself as an
            # attestation and failed to sign. The predicate reports it as an
            # `unsigned` gap via unsigned_documents() below.
            continue
        doc_type = str(fm["document_type"]).strip()
        caps = list(DOC_CAPABILITIES.get(doc_type, ()))
        # `covers_annex_iv` lets a document declare which points it addresses.
        # It is a hint from the author, recorded as a capability so the
        # mapping can use it, never as a substitute for the document type.
        for c in fm.get("covers_annex_iv", []) or []:
            caps.append(f"declared.{str(c).strip()}")
        try:
            records.append(EvidenceRecord.attested(
                extractor="attested_docs",
                source_path=rel,
                source_sha256=repo.sha256(rel),
                locator=f"front-matter:{doc_type}",
                summary=(f"{doc_type.replace('_', ' ')} signed by "
                         f"{str(fm['attested_by']).strip()} "
                         f"({str(fm['role']).strip()}) on "
                         f"{str(fm['date']).strip()}"),
                attested_by=str(fm["attested_by"]),
                role=str(fm["role"]),
                date=str(fm["date"]),
                provides=tuple(caps),
                commit=repo.commit,
            ))
        except ValueError:
            # attested() refused it — treat exactly like missing front-matter
            continue
    return records


def unsigned_documents(repo: RepoContext) -> list[tuple[str, list[str]]]:
    """[(path, missing_fields)] for documents that claim to be attestations
    but are not signed. Surfaced by the predicate as `unsigned` gaps."""
    out = []
    for rel in _candidate_docs(repo):
        try:
            fm = parse_front_matter(repo.read_text(rel))
        except (OSError, UnicodeDecodeError):
            continue
        if not fm:
            continue
        missing = [f for f in REQUIRED_FIELDS
                   if not str(fm.get(f, "") or "").strip()]
        if missing:
            out.append((rel, missing))
    return out
