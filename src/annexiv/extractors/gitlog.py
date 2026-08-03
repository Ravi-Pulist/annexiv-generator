"""Git history: versions (1(a), 1(c)) and lifecycle changes (point 6).

Point 6 asks for "relevant changes made by the provider to the system through
its lifecycle" — which is what a tagged history is, provided the history is
real. A repository with one commit called "initial commit" evidences a version
identifier and nothing about a lifecycle, and this extractor says so rather
than dressing a single commit up as a change history.
"""

from __future__ import annotations

from ..model import EvidenceRecord
from ..repo import RepoContext

#: below this, a history documents an origin, not a lifecycle
LIFECYCLE_MIN_COMMITS = 3


def extract(repo: RepoContext) -> list[EvidenceRecord]:
    if not repo.is_git or not repo.commit:
        return []
    g = repo._git
    records: list[EvidenceRecord] = []

    try:
        commits = list(g.iter_commits(max_count=500))
    except Exception:      # noqa: BLE001
        commits = []
    try:
        tags = sorted(g.tags, key=lambda t: t.name)
    except Exception:      # noqa: BLE001
        tags = []

    # Git objects are not files, so the "source" is the repository at HEAD and
    # the content address is the commit sha itself — stable, checkable, and
    # what the audit re-resolves against.
    if tags:
        names = [t.name for t in tags]
        records.append(EvidenceRecord.measured(
            extractor="git", source_path=".git", source_sha256=repo.commit,
            locator="tags",
            summary=(f"{len(names)} released version(s) tagged: "
                     f"{', '.join(names[:10])}; current version "
                     f"{names[-1]}"),
            provides=("git.versions", "git.version_relation"),
            commit=repo.commit,
        ))

    if len(commits) >= LIFECYCLE_MIN_COMMITS:
        first, last = commits[-1], commits[0]
        records.append(EvidenceRecord.measured(
            extractor="git", source_path=".git", source_sha256=repo.commit,
            locator="history",
            summary=(f"{len(commits)} commits from {first.hexsha[:8]} to "
                     f"{last.hexsha[:8]} documenting changes across the "
                     f"system's lifecycle"),
            provides=("git.lifecycle_changes",),
            commit=repo.commit,
        ))
    return records
