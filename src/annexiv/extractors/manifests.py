"""Dependency manifests: third-party components (2(a)) and versions (1(c), 2(c)).

Annex IV 2(a) asks about "recourse to pre-trained systems or tools provided by
third parties". A pinned lockfile is the honest machine-readable answer to
"what did you build on"; an unpinned requirements file names libraries without
identifying which build of them ran, so it is recorded as a weaker claim and
said to be so.
"""

from __future__ import annotations

import re

from ..model import EvidenceRecord
from ..repo import RepoContext

CANDIDATES = ("requirements.txt", "pyproject.toml", "poetry.lock",
              "requirements.lock", "Pipfile.lock", "package-lock.json",
              "environment.yml")

_PINNED = re.compile(r"^[A-Za-z0-9_.\-\[\]]+\s*==\s*\S+", re.MULTILINE)
_ANY_REQ = re.compile(r"^\s*[A-Za-z0-9_.\-\[\]]+", re.MULTILINE)


def extract(repo: RepoContext) -> list[EvidenceRecord]:
    records: list[EvidenceRecord] = []
    for rel in CANDIDATES:
        if not repo.exists(rel):
            continue
        try:
            text = repo.read_text(rel)
        except (OSError, UnicodeDecodeError):
            continue
        pinned = len(_PINNED.findall(text))
        if rel == "requirements.txt":
            total = len([ln for ln in text.splitlines()
                         if ln.strip() and not ln.strip().startswith("#")])
            note = (f"{pinned}/{total} dependencies pinned to exact versions"
                    if total else "no dependencies declared")
            if total and pinned < total:
                note += " — unpinned entries do not identify which build ran"
        else:
            note = f"dependency manifest ({pinned} exact pins detected)"
        records.append(EvidenceRecord.measured(
            extractor="manifests", source_path=rel,
            source_sha256=repo.sha256(rel), locator="dependencies",
            summary=f"third-party components declared in {rel}: {note}",
            provides=("deps.third_party", "deps.versions"),
            commit=repo.commit,
        ))
    return records
