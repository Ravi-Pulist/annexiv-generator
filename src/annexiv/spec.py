"""Loader for the Annex IV mapping spec.

The spec (``mapping/annex-iv.yaml``) is data, not code: the section list, the
verbatim regulation text, the article cross-references, the applicability
dates, and which extractor can feed which subpoint. Article 11(3) lets the
Commission amend Annex IV by delegated act, so the spine is versioned and
loadable rather than hard-coded.

The loader validates the spec on load. A malformed spec is a refusal, not a
best-effort parse: this file is the tool's claim to have read the regulation,
and a silently half-loaded spine would produce a pack that looks complete
while checking less than it says.
"""

from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict

DEFAULT_SPEC_PATH = Path(__file__).parents[2] / "mapping" / "annex-iv.yaml"


class EvidenceSource(BaseModel):
    model_config = ConfigDict(frozen=True)

    extractor: str
    yields: str
    supports: tuple[str, ...]
    looks_for: str
    #: capability keys a record must provide to count for this source. Empty
    #: means "any record from this extractor counts". Where a requirement names
    #: something a file may or may not actually contain — a subgroup breakdown,
    #: an Article 72(3) monitoring plan — via_keys is what stops the file's
    #: mere existence from satisfying it.
    via_keys: tuple[str, ...] = ()

    def matches(self, record) -> bool:
        if record.extractor != self.extractor:
            return False
        if not self.via_keys:
            return True
        return bool(set(self.via_keys) & set(record.provides))


class Section(BaseModel):
    model_config = ConfigDict(frozen=True)

    number: int
    title: str
    text: str
    article_refs: tuple[str, ...] = ()
    subpoints: dict[str, str] = {}
    limbs: dict[str, str] = {}
    limbs_are_our_decomposition: bool = False
    evidence_sources: tuple[EvidenceSource, ...] = ()
    complete_when: str = ""
    permanent_gap: bool = False
    permanent_gap_reason: str = ""
    ojeu_oddity: str = ""
    distinct_from: str = ""

    @property
    def requirements(self) -> tuple[str, ...]:
        """The addressable units of this section.

        Subpoint letters where the OJ letters them; our limb names where it
        does not (points 3, 7, 9); otherwise the single pseudo-requirement
        ``whole``. Which of these the regulation itself defines is recorded by
        ``limbs_are_our_decomposition`` and surfaced in the pack.
        """
        if self.subpoints:
            return tuple(sorted(self.subpoints))
        if self.limbs:
            return tuple(sorted(self.limbs))
        return ("whole",)

    def requirement_text(self, req: str) -> str:
        if req in self.subpoints:
            return self.subpoints[req]
        if req in self.limbs:
            return self.limbs[req]
        return self.text


class Applicability(BaseModel):
    model_config = ConfigDict(frozen=True)

    as_at: str
    in_force_now: bool
    note: str
    routes: dict
    legacy_grace: dict = {}
    anomaly_flagged: str = ""

    def route_date(self, route: str | None) -> tuple[str | None, str | None]:
        """(applies_from, label) for a classification route, or (None, None)."""
        if not route:
            return None, None
        r = self.routes.get(route)
        if not r:
            return None, None
        return r.get("applies_from"), r.get("label")


class MappingSpec(BaseModel):
    model_config = ConfigDict(frozen=True)

    spec_version: str
    regulation: dict
    obligation: dict
    applicability: Applicability
    evidence_classes: dict
    sections: tuple[Section, ...]
    articles_cited_by_annex_iv: tuple[str, ...]
    articles_not_cited_despite_common_assumption: tuple[str, ...] = ()
    #: hash of the spec file itself — pinned into every pack so a reader can
    #: tell which reading of the regulation produced the document
    spec_sha256: str = ""

    def section(self, number: int) -> Section:
        for s in self.sections:
            if s.number == number:
                return s
        raise KeyError(f"no Annex IV section {number} in the spec")

    @property
    def route_names(self) -> tuple[str, ...]:
        return tuple(sorted(self.applicability.routes))


def _validate(spec: MappingSpec) -> None:
    numbers = [s.number for s in spec.sections]
    if numbers != sorted(numbers):
        raise ValueError("spec sections are out of order")
    if numbers != list(range(1, len(numbers) + 1)):
        raise ValueError(
            f"spec sections must be a contiguous run from 1; got {numbers}")
    if len(numbers) != 9:
        # Not a hard error — Article 11(3) allows amendment — but it must be
        # deliberate, so it is loud.
        raise ValueError(
            f"spec declares {len(numbers)} Annex IV sections; the verified text "
            "of Regulation (EU) 2024/1689 has 9. If the annex was amended by "
            "delegated act, bump spec_version and update this check "
            "deliberately.")
    for s in spec.sections:
        if s.permanent_gap:
            if s.evidence_sources:
                raise ValueError(
                    f"section {s.number} is a permanent gap but declares "
                    "evidence sources — a permanent gap must have none, or the "
                    "refusal is not real")
            if not s.permanent_gap_reason:
                raise ValueError(
                    f"section {s.number} is a permanent gap with no stated "
                    "reason; an unexplained refusal is not honest")
            continue
        if not s.evidence_sources:
            raise ValueError(
                f"section {s.number} has no evidence sources and is not marked "
                "as a permanent gap — every section needs a route to evidence "
                "or an explicit admission that it has none")
        for src in s.evidence_sources:
            if src.yields not in ("MEASURED", "ATTESTED", "MISSING"):
                raise ValueError(
                    f"section {s.number}: unknown evidence class {src.yields!r}")
            for req in src.supports:
                if req not in s.requirements and req != "whole":
                    raise ValueError(
                        f"section {s.number}: evidence source claims to support "
                        f"{req!r}, which is not one of {s.requirements}")


@lru_cache(maxsize=8)
def load_spec(path: str | Path | None = None) -> MappingSpec:
    p = Path(path) if path else DEFAULT_SPEC_PATH
    raw_bytes = p.read_bytes()
    data = yaml.safe_load(raw_bytes.decode("utf-8"))
    spec = MappingSpec(**data,
                       spec_sha256=hashlib.sha256(raw_bytes).hexdigest())
    _validate(spec)
    return spec
