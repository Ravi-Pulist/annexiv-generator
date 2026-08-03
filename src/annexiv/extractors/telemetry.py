"""Telemetry / monitoring configuration: the measurable half of point 9.

Point 9 wants the system in place to evaluate post-market performance. A
committed monitoring configuration is evidence that something is actually
wired up, as distinct from a plan describing what will be. Absent in most
repositories — including, deliberately, the demo subject — which is exactly
why point 9 is one of the named gaps.
"""

from __future__ import annotations

from ..model import EvidenceRecord
from ..repo import RepoContext

CANDIDATES = ("monitoring/config.yaml", "monitoring.yaml", "telemetry.yaml",
              "config/monitoring.yaml", "observability/config.yaml")


def extract(repo: RepoContext) -> list[EvidenceRecord]:
    rel = repo.first_existing(*CANDIDATES)
    if not rel:
        return []
    return [EvidenceRecord.measured(
        extractor="telemetry_config", source_path=rel,
        source_sha256=repo.sha256(rel), locator="config",
        summary=f"post-market monitoring configuration committed at {rel}",
        provides=("telemetry.configured",),
        commit=repo.commit,
    )]
