"""Model custody register and CycloneDX ML-BOM.

The pairing the portfolio sequences alongside this build: a register that pins
every model by checkpoint hash and classifies its licence, emitted as a
CycloneDX 1.6 ML-BOM. For Annex IV it feeds 2(a) (recourse to third-party
pre-trained components — answered by hash and licence, not by prose) and 2(d)
(what the model was built from).

A register entry whose hash does not match the artefact on disk is not
evidence: it is a stale pin, and reporting it as provenance would be worse
than reporting nothing. Mismatches are excluded here and surfaced by the
predicate.
"""

from __future__ import annotations

import json

from ..model import EvidenceRecord
from ..repo import RepoContext

REGISTER_CANDIDATES = ("custody/register.json", ".rmad/custody/register.json",
                       ".planning/custody/register.json")
BOM_CANDIDATES = ("custody/ml-bom.json", "custody-mlbom.json", "ml-bom.json")


def _models(data) -> list[dict]:
    if isinstance(data, dict):
        rows = data.get("models", [])
    elif isinstance(data, list):
        rows = data
    else:
        rows = []
    return [r for r in rows if isinstance(r, dict)]


def stale_pins(repo: RepoContext) -> list[str]:
    """Register entries whose recorded hash disagrees with the file on disk."""
    rel = repo.first_existing(*REGISTER_CANDIDATES)
    if not rel:
        return []
    try:
        rows = _models(json.loads(repo.read_text(rel)))
    except (OSError, json.JSONDecodeError):
        return []
    out = []
    for m in rows:
        path = m.get("path")
        want = str(m.get("sha256", "")).lower()
        if path and want and repo.exists(path):
            if repo.sha256(path).lower() != want:
                out.append(f"{m.get('id', path)}: register says {want[:12]}…, "
                           f"artefact hashes {repo.sha256(path)[:12]}…")
    return out


def extract(repo: RepoContext) -> list[EvidenceRecord]:
    records: list[EvidenceRecord] = []

    rel = repo.first_existing(*REGISTER_CANDIDATES)
    if rel:
        try:
            rows = _models(json.loads(repo.read_text(rel)))
        except (OSError, json.JSONDecodeError):
            rows = []
        clean = [m for m in rows if m.get("sha256")]
        if clean:
            licences = sorted({str(m.get("licence") or m.get("license") or "unstated")
                               for m in clean})
            records.append(EvidenceRecord.measured(
                extractor="custody", source_path=rel,
                source_sha256=repo.sha256(rel), locator="models",
                summary=(f"{len(clean)} model(s) pinned by checkpoint SHA-256 "
                         f"with licences: {', '.join(licences)}"),
                provides=("custody.model_pinned", "custody.licences"),
                commit=repo.commit,
            ))

    bom = repo.first_existing(*BOM_CANDIDATES)
    if bom:
        try:
            data = json.loads(repo.read_text(bom))
        except (OSError, json.JSONDecodeError):
            data = {}
        if str(data.get("bomFormat", "")).lower() == "cyclonedx":
            comps = [c for c in data.get("components", []) if isinstance(c, dict)]
            ml = [c for c in comps if c.get("type") == "machine-learning-model"]
            records.append(EvidenceRecord.measured(
                extractor="custody", source_path=bom,
                source_sha256=repo.sha256(bom), locator="bom",
                summary=(f"CycloneDX {data.get('specVersion', '?')} ML-BOM: "
                         f"{len(comps)} component(s), {len(ml)} "
                         f"machine-learning-model"),
                provides=("custody.mlbom",),
                commit=repo.commit,
            ))
    return records
