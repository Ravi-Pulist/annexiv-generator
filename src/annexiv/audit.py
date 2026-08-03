"""``annexiv audit`` — the independent re-walk.

Same design signature as a de-identification gate that re-checks with a
different model from the one that scrubbed: **the thing that produces must not
be the thing that approves.** This module deliberately does not import the
predicate, the extractors or the renderer. It reads the finished pack JSON
from disk as an untrusted document and re-derives every check from the
repository itself.

That independence is what makes the checks meaningful. If audit reused the
generator's in-memory objects it would confirm the generator's opinion of
itself; reading the serialised pack means a hand-edited claim, a stale hash or
a deleted evidence file is caught by machinery that never saw the run that
wrote them.

Six checks:

1. Every claim carries exactly one of evidence / gap — re-checked on the raw
   JSON, because a hand-edited pack bypasses the type system entirely.
2. Every evidence id a claim cites exists in the evidence index.
3. Every evidence source file still exists in the repository.
4. Every recorded SHA-256 still matches the file on disk.
5. Every gap id a claim cites exists in the gap register.
6. The completion counts in the pack match a recount of its own contents.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Finding:
    check: str
    severity: str            # "fail" | "warn"
    detail: str


@dataclass
class AuditResult:
    pack_path: str
    repo_root: str
    findings: list[Finding] = field(default_factory=list)
    claims_checked: int = 0
    citations_checked: int = 0
    gaps_checked: int = 0

    @property
    def failed(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "fail"]

    @property
    def ok(self) -> bool:
        return not self.failed

    def summary(self) -> str:
        return (f"{self.claims_checked} claims, {self.citations_checked} "
                f"citations, {self.gaps_checked} gaps checked — "
                f"{len(self.failed)} failure(s)")


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def audit_pack(pack_path: Path, repo_root: Path) -> AuditResult:
    pack_path, repo_root = Path(pack_path), Path(repo_root)
    res = AuditResult(pack_path=str(pack_path), repo_root=str(repo_root))

    try:
        doc = json.loads(pack_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        res.findings.append(Finding("pack-readable", "fail",
                                    f"pack could not be read: {exc}"))
        return res

    evidence = {e["id"]: e for e in doc.get("evidence", [])}
    gaps = {g["id"]: g for g in doc.get("gaps", [])}
    sections = doc.get("sections", [])
    res.gaps_checked = len(gaps)

    if not sections:
        res.findings.append(Finding("sections-present", "fail",
                                    "pack contains no sections"))

    counted_backed = 0
    counted_gapped = 0
    counted_measured = 0
    counted_attested = 0

    for section in sections:
        num = section.get("number")
        if not section.get("claims"):
            res.findings.append(Finding(
                "section-addressed", "fail",
                f"section {num} carries no claims — a section may be populated "
                "or gap-flagged, never silently omitted"))
        for claim in section.get("claims", []):
            res.claims_checked += 1
            ev_ids = claim.get("evidence_ids") or []
            gap_id = claim.get("gap_id")

            # 1 · the invariant, re-checked on raw JSON
            if ev_ids and gap_id:
                res.findings.append(Finding(
                    "evidence-or-gap", "fail",
                    f"section {num} claim {claim.get('subpoint') or ''} cites "
                    "both evidence and a gap"))
            if not ev_ids and not gap_id:
                res.findings.append(Finding(
                    "evidence-or-gap", "fail",
                    f"section {num} claim {claim.get('subpoint') or ''!r} is a "
                    "SILENT ASSERTION: no evidence reference and no gap "
                    "reference"))
                continue

            if gap_id:
                counted_gapped += 1
                # 5 · gap resolves
                if gap_id not in gaps:
                    res.findings.append(Finding(
                        "gap-resolves", "fail",
                        f"section {num} cites gap {gap_id} which is absent from "
                        "the gap register"))
                continue

            counted_backed += 1
            for eid in ev_ids:
                res.citations_checked += 1
                # 2 · citation resolves to an index entry
                rec = evidence.get(eid)
                if rec is None:
                    res.findings.append(Finding(
                        "citation-resolves", "fail",
                        f"section {num} cites evidence {eid} which is absent "
                        "from the evidence index"))
                    continue
                cls = rec.get("cls")
                if cls == "MEASURED":
                    counted_measured += 1
                elif cls == "ATTESTED":
                    counted_attested += 1

                src = rec.get("source_path", "")
                # git-derived records point at the repository itself, not a
                # blob; their content address is the commit sha.
                if src == ".git":
                    continue
                target = repo_root / src
                # 3 · the file still exists
                if not target.is_file():
                    res.findings.append(Finding(
                        "source-exists", "fail",
                        f"evidence {eid} cites `{src}`, which is not in the "
                        "repository"))
                    continue
                # 4 · the hash still matches
                actual = _sha256(target)
                if actual.lower() != str(rec.get("source_sha256", "")).lower():
                    res.findings.append(Finding(
                        "hash-matches", "fail",
                        f"evidence {eid} cites `{src}` at "
                        f"{str(rec.get('source_sha256'))[:12]}…, but the file "
                        f"now hashes {actual[:12]}… — the pack describes a "
                        "version of this repository that no longer exists"))

    # 6 · the pack's own arithmetic
    stated = doc.get("completion") or {}
    for key, counted in (("claims_evidence_backed", counted_backed),
                         ("claims_gapped", counted_gapped),
                         ("citations_measured", counted_measured),
                         ("citations_attested", counted_attested)):
        if key in stated and stated[key] != counted:
            res.findings.append(Finding(
                "counts-agree", "fail",
                f"completion state says {key}={stated[key]} but a recount of "
                f"the pack's own claims gives {counted}"))

    unused = set(gaps) - {c.get("gap_id") for s in sections
                          for c in s.get("claims", [])}
    if unused:
        res.findings.append(Finding(
            "gaps-referenced", "warn",
            f"{len(unused)} gap(s) in the register are not referenced by any "
            f"claim: {', '.join(sorted(unused)[:5])}"))

    return res
