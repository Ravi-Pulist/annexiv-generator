"""Dataset manifest: the data requirements of Annex IV 2(d).

2(d) asks for datasheets covering provenance, scope and main characteristics;
how the data was obtained and selected; labelling procedures; and data
cleaning methodologies. A manifest that hashes its files answers "which data",
and separate keys answer selection, cleaning and labelling — separately,
because a manifest can identify files perfectly while saying nothing about how
rows were excluded.

Manifest hashes are re-checked against the files on disk. A manifest that
disagrees with its own data is reported as a mismatch, not as provenance.
"""

from __future__ import annotations

import json

from ..model import EvidenceRecord
from ..repo import RepoContext

CANDIDATES = ("data/manifest.json", "data/dataset-manifest.json",
              "datasets/manifest.json", "manifest.json")


def hash_mismatches(repo: RepoContext) -> list[str]:
    rel = repo.first_existing(*CANDIDATES)
    if not rel:
        return []
    try:
        data = json.loads(repo.read_text(rel))
    except (OSError, json.JSONDecodeError):
        return []
    files = data.get("files") or {}
    out = []
    for path, want in files.items() if isinstance(files, dict) else []:
        if repo.exists(path):
            got = repo.sha256(path)
            if got.lower() != str(want).lower():
                out.append(f"{path}: manifest says {str(want)[:12]}…, file "
                           f"hashes {got[:12]}…")
        else:
            out.append(f"{path}: listed in the manifest but absent from the repo")
    return out


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
    files = data.get("files") or {}
    rows = data.get("rows") or {}

    if files:
        synthetic = data.get("synthetic_only")
        provenance = ("generated synthetically from a seeded script"
                      if synthetic else "provenance stated in the manifest")
        records.append(EvidenceRecord.measured(
            extractor="dataset_manifest", source_path=rel, source_sha256=sha,
            locator="files",
            summary=(f"{len(files)} dataset file(s) identified by SHA-256"
                     + (f"; splits {rows}" if rows else "")
                     + f"; {provenance}"
                     + (f"; seed {data['seed']}" if data.get("seed") is not None
                        else "")),
            provides=("data.provenance", "data.scope", "data.identified"),
            commit=repo.commit,
        ))
    if data.get("selection"):
        sel = data["selection"]
        records.append(EvidenceRecord.measured(
            extractor="dataset_manifest", source_path=rel, source_sha256=sha,
            locator="selection",
            summary=(f"selection rule applied: {sel.get('rule', 'stated')}"
                     + (f" (excluded {sel['excluded']} rows)"
                        if sel.get("excluded") is not None else "")),
            provides=("data.selection",),
            commit=repo.commit,
        ))
    if data.get("cleaning"):
        cl = data["cleaning"]
        records.append(EvidenceRecord.measured(
            extractor="dataset_manifest", source_path=rel, source_sha256=sha,
            locator="cleaning",
            summary=(f"cleaning methodology: {cl.get('method', 'stated')}"
                     + (f" (modified {cl['modified']} values)"
                        if cl.get("modified") is not None else "")),
            provides=("data.cleaning",),
            commit=repo.commit,
        ))
    if data.get("label_definition"):
        records.append(EvidenceRecord.measured(
            extractor="dataset_manifest", source_path=rel, source_sha256=sha,
            locator="label_definition",
            summary=f"label definition recorded: {data['label_definition']}",
            provides=("data.labelling",),
            commit=repo.commit,
        ))
    if data.get("generator_sha256"):
        records.append(EvidenceRecord.measured(
            extractor="dataset_manifest", source_path=rel, source_sha256=sha,
            locator="generator_sha256",
            summary=(f"the data-generation script itself is pinned by hash "
                     f"{str(data['generator_sha256'])[:16]}… — the dataset is "
                     "reproducible, not merely described"),
            provides=("data.reproducible",),
            commit=repo.commit,
        ))
    return records
