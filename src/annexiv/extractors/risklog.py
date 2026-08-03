"""Risk log: structure checked by machine, content attested by a human.

Annex IV point 5 wants "a detailed description of the risk management system
in accordance with Article 9". No tool can judge whether a risk analysis is
adequate — that is engineering and clinical judgement. What a tool can do is
check that the log has the shape a risk management system produces: every risk
owned by someone, with a status, a mitigation, and a review date.

So the split is explicit: **structure is MEASURED, content is ATTESTED.** A
log that parses and is complete yields attested evidence naming its owners. A
log missing owners or review dates is not a weaker log — it is
``structurally_invalid``, and the section gaps. An unowned risk is not managed,
and a mitigation nobody revisits is a sentence, not a control.
"""

from __future__ import annotations

import yaml

from ..model import EvidenceRecord
from ..repo import RepoContext

CANDIDATES = ("risk-log.yaml", "risk_log.yaml", "docs/risk-log.yaml",
              "risks.yaml", "docs/risks.yaml")

REQUIRED = ("id", "description", "owner", "status", "mitigation", "review_date")


def _entries(data) -> list[dict]:
    if isinstance(data, dict):
        rows = data.get("risks", [])
    elif isinstance(data, list):
        rows = data
    else:
        rows = []
    return [r for r in rows if isinstance(r, dict)]


def structural_problems(repo: RepoContext) -> tuple[str | None, list[str]]:
    """(path, problems). Empty problems with a path means a clean log."""
    rel = repo.first_existing(*CANDIDATES)
    if not rel:
        return None, ["no risk log found"]
    try:
        data = yaml.safe_load(repo.read_text(rel))
    except (OSError, yaml.YAMLError) as exc:
        return rel, [f"risk log does not parse: {type(exc).__name__}"]
    rows = _entries(data)
    if not rows:
        return rel, ["risk log parses but contains no risk entries"]
    problems = []
    for i, row in enumerate(rows):
        missing = [f for f in REQUIRED if not str(row.get(f, "") or "").strip()]
        if missing:
            problems.append(
                f"risk {row.get('id', f'#{i + 1}')} is missing "
                f"{', '.join(missing)}")
    return rel, problems


def extract(repo: RepoContext) -> list[EvidenceRecord]:
    rel, problems = structural_problems(repo)
    if not rel or problems:
        return []                     # structurally invalid → the predicate gaps it
    data = yaml.safe_load(repo.read_text(rel))
    rows = _entries(data)
    owners = sorted({str(r["owner"]).strip() for r in rows})
    statuses: dict[str, int] = {}
    for r in rows:
        key = str(r["status"]).strip()
        statuses[key] = statuses.get(key, 0) + 1
    status_note = ", ".join(f"{v} {k}" for k, v in sorted(statuses.items()))
    return [EvidenceRecord.attested(
        extractor="risk_log", source_path=rel, source_sha256=repo.sha256(rel),
        locator="risks",
        summary=(f"{len(rows)} risks, each with owner, status, mitigation and "
                 f"review date ({status_note}); owners: {', '.join(owners)}"),
        attested_by=owners[0],
        role="risk owner",
        date=min(str(r["review_date"]) for r in rows),
        provides=("risk.log_structured",),
        commit=repo.commit,
    )]
