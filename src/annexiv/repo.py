"""RepoContext — read-only access to the subject repository.

Read-only is a product property, not an implementation detail: the tool runs
against a client's repository under an engagement, and it must be incapable of
changing what it documents. Nothing in this module opens a file for writing.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from functools import cached_property
from pathlib import Path


@dataclass
class RepoContext:
    root: Path

    def __post_init__(self) -> None:
        self.root = Path(self.root).resolve()

    # ── files ────────────────────────────────────────────────────────────
    def path(self, rel: str) -> Path:
        return self.root / rel

    def exists(self, rel: str) -> bool:
        return (self.root / rel).is_file()

    def read_text(self, rel: str) -> str:
        return (self.root / rel).read_text(encoding="utf-8")

    def sha256(self, rel: str) -> str:
        h = hashlib.sha256()
        with (self.root / rel).open("rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()

    def first_existing(self, *rels: str) -> str | None:
        for rel in rels:
            if self.exists(rel):
                return rel
        return None

    def glob(self, pattern: str) -> list[str]:
        return sorted(
            p.relative_to(self.root).as_posix()
            for p in self.root.glob(pattern) if p.is_file()
        )

    # ── git ──────────────────────────────────────────────────────────────
    @cached_property
    def _git(self):
        try:
            import git
            return git.Repo(self.root)
        except Exception:      # noqa: BLE001 — a non-repo is a fact, not a crash
            return None

    @property
    def is_git(self) -> bool:
        return self._git is not None

    @cached_property
    def commit(self) -> str | None:
        if not self._git:
            return None
        try:
            return self._git.head.commit.hexsha
        except Exception:      # noqa: BLE001 — an unborn HEAD is a fact too
            return None

    @cached_property
    def is_dirty(self) -> bool:
        return bool(self._git and self._git.is_dirty(untracked_files=False))

    @property
    def name(self) -> str:
        return self.root.name
