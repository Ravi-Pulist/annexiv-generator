"""Git history: versions (1(a), 1(c)) and lifecycle changes (point 6).

Point 6 asks for "relevant changes made by the provider to the system through
its lifecycle" — which is what a tagged history is, provided the history is
real. A repository with one commit called "initial commit" evidences a version
identifier and nothing about a lifecycle, and this extractor says so rather
than dressing a single commit up as a change history.

**Two sources of history, and the second is the better-evidenced one.**

A live ``.git`` directory is the obvious source, but it cannot be
content-addressed: a directory has no hash, so records drawn from it carry the
HEAD commit sha as their address and the auditor has to skip re-resolving them.
That is a real weakness — git-derived claims are the least verifiable ones in a
pack built from a live checkout.

A **history bundle** (``git bundle create``) has neither problem. It is a
single file, so it hashes; the auditor re-resolves it like any other evidence
and catches tampering. It is also what a client engagement actually looks
like: repositories arrive as exports and archives far more often than as live
clones, and an export routinely omits ``.git`` while a bundle can travel with
it.

So: prefer the live repository when present, fall back to a bundle, and say
which one a record came from.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

from ..model import EvidenceRecord
from ..repo import RepoContext

#: below this, a history documents an origin, not a lifecycle
LIFECYCLE_MIN_COMMITS = 3


def _facts(git_repo) -> tuple[list, list]:
    """(commits, tags) from an open GitPython repo, newest commit first."""
    try:
        commits = list(git_repo.iter_commits(max_count=500))
    except Exception:      # noqa: BLE001
        commits = []
    try:
        tags = sorted(git_repo.tags, key=lambda t: t.name)
    except Exception:      # noqa: BLE001
        tags = []
    return commits, tags


def _records(commits, tags, *, source_path: str, source_sha256: str,
             commit: str | None, provenance: str) -> list[EvidenceRecord]:
    out: list[EvidenceRecord] = []
    if tags:
        names = [t.name for t in tags]
        out.append(EvidenceRecord.measured(
            extractor="git", source_path=source_path,
            source_sha256=source_sha256, locator="tags",
            summary=(f"{len(names)} released version(s) tagged: "
                     f"{', '.join(names[:10])}; current version {names[-1]} "
                     f"({provenance})"),
            provides=("git.versions", "git.version_relation"),
            commit=commit,
        ))
    if len(commits) >= LIFECYCLE_MIN_COMMITS:
        first, last = commits[-1], commits[0]
        out.append(EvidenceRecord.measured(
            extractor="git", source_path=source_path,
            source_sha256=source_sha256, locator="history",
            summary=(f"{len(commits)} commits from {first.hexsha[:8]} to "
                     f"{last.hexsha[:8]} documenting changes across the "
                     f"system's lifecycle ({provenance})"),
            provides=("git.lifecycle_changes",),
            commit=commit,
        ))
    return out


def _from_live_repo(repo: RepoContext) -> list[EvidenceRecord]:
    commits, tags = _facts(repo._git)
    # A directory has no content address, so the HEAD sha stands in — and the
    # auditor cannot re-resolve it. See the module docstring.
    return _records(commits, tags, source_path=".git",
                    source_sha256=repo.commit or "", commit=repo.commit,
                    provenance="live repository")


def _from_bundle(repo: RepoContext) -> list[EvidenceRecord]:
    """History from a vendored ``*.bundle``, content-addressed to the file."""
    bundles = repo.glob("*.bundle") + repo.glob("*/*.bundle")
    if not bundles:
        return []
    rel = bundles[0]
    tmp = tempfile.mkdtemp(prefix="annexiv-bundle-")
    try:
        proc = subprocess.run(
            ["git", "clone", "--bare", "--quiet", str(repo.path(rel)), tmp],
            capture_output=True, text=True, timeout=120)
        if proc.returncode != 0:
            return []                     # not a usable bundle; not an error
        import git
        bundle_repo = git.Repo(tmp)
        commits, tags = _facts(bundle_repo)
        head = commits[0].hexsha if commits else None
        return _records(
            commits, tags, source_path=rel,
            source_sha256=repo.sha256(rel), commit=head,
            provenance=f"history bundle {Path(rel).name}")
    except Exception:      # noqa: BLE001 — an unreadable bundle is a fact
        return []
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def extract(repo: RepoContext) -> list[EvidenceRecord]:
    if repo.is_git and repo.commit:
        return _from_live_repo(repo)
    return _from_bundle(repo)
