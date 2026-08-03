"""CHANGELOG: lifecycle changes (point 6), in the provider's own words.

Git history records what changed in the code; a changelog records what the
provider considers a *relevant* change to the system — which is the wording
point 6 uses. Both are collected; neither is treated as the other.
"""

from __future__ import annotations

import re

from ..model import EvidenceRecord
from ..repo import RepoContext

CANDIDATES = ("CHANGELOG.md", "CHANGELOG", "docs/CHANGELOG.md", "HISTORY.md")

_VERSION_HEADING = re.compile(r"^#{1,3}\s*\[?v?(\d+\.\d+[^\]\s]*)\]?", re.MULTILINE)


def extract(repo: RepoContext) -> list[EvidenceRecord]:
    rel = repo.first_existing(*CANDIDATES)
    if not rel:
        return []
    try:
        text = repo.read_text(rel)
    except (OSError, UnicodeDecodeError):
        return []
    versions = _VERSION_HEADING.findall(text)
    if not versions:
        return []
    return [EvidenceRecord.measured(
        extractor="changelog", source_path=rel, source_sha256=repo.sha256(rel),
        locator="versions",
        summary=(f"{len(versions)} released version(s) with described changes: "
                 f"{', '.join(versions[:10])}"),
        provides=("changelog.lifecycle_changes",),
        commit=repo.commit,
    )]
