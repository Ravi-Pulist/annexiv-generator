"""The type system that makes fabrication impossible.

The central invariant of this tool: **a claim carries either a resolvable
evidence reference or a gap reference — never neither, never both.** That is
not a policy or a review checklist; it is the only way a ``Claim`` can be
constructed. There is no third constructor, so "the renderer wrote a sentence
nothing supports" is not a bug that can occur, it is a state that cannot be
represented.

A blank Word template rewards fluent prose: a validation section reads equally
finished whether or not a validation report exists. This module is the
structural answer to that.

Three evidence classes, and only three:

``MEASURED``   produced by running something — a hash, a test report, a git
               history. Reproducible from the repository.
``ATTESTED``   prose a NAMED human signed, with owner and date. Anonymous
               prose is not ATTESTED; it is MISSING. That rule is enforced in
               :meth:`EvidenceRecord.attested`, not left to the extractor's
               conscience.
``MISSING``    the repository cannot support this. It becomes a gap entry with
               a named reason, and it appears in the pack.
"""

from __future__ import annotations

import hashlib
import json
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


def _sha8(*parts: str) -> str:
    # The separator matters: without it ("ab", "c") and ("a", "bc") would mint
    # the same id, and two different pieces of evidence would silently become
    # one citation.
    joined = "\x1f".join(parts)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:8]


class EvidenceClass(str, Enum):
    MEASURED = "MEASURED"
    ATTESTED = "ATTESTED"
    MISSING = "MISSING"


class GapKind(str, Enum):
    #: the artefact simply is not in the repository
    ABSENT = "absent"
    #: prose exists but carries no named attester — deliberately not accepted
    UNSIGNED = "unsigned"
    #: the artefact exists but does not parse / lacks required structure
    STRUCTURALLY_INVALID = "structurally_invalid"
    #: this tool will never generate it, by design (the EU declaration of
    #: conformity is the provider's legal act)
    BY_DESIGN = "by_design"


class EvidenceRecord(BaseModel):
    """A content-addressed pointer to something real in the repository.

    The id is derived from the content coordinates, so the same evidence
    extracted twice is the same record, and a changed file is a different
    record. That is what makes regeneration deterministic and tampering
    visible.
    """

    model_config = ConfigDict(frozen=True)

    id: str
    cls: EvidenceClass
    extractor: str
    source_path: str
    source_sha256: str
    #: where inside the source — a JSON path, a line range, a git ref
    locator: str | None = None
    #: one sentence: what this evidence actually says
    summary: str
    #: capability keys this record can support, e.g. ``eval.subgroup_accuracy``.
    #: The spec matches requirements to records through these, so "the eval
    #: report exists" cannot satisfy a requirement the report does not actually
    #: cover — which is exactly how a missing subgroup breakdown would
    #: otherwise hide behind a present file.
    provides: tuple[str, ...] = Field(default_factory=tuple)
    commit: str | None = None
    # ATTESTED only — absent on MEASURED records
    attested_by: str | None = None
    role: str | None = None
    date: str | None = None

    @staticmethod
    def _mint(extractor: str, source_path: str, source_sha256: str,
              locator: str | None) -> str:
        return "ev_" + _sha8(extractor, source_path, source_sha256, locator or "")

    @classmethod
    def measured(cls, *, extractor: str, source_path: str, source_sha256: str,
                 summary: str, locator: str | None = None,
                 provides: tuple[str, ...] | list[str] = (),
                 commit: str | None = None) -> "EvidenceRecord":
        return cls(
            id=cls._mint(extractor, source_path, source_sha256, locator),
            cls=EvidenceClass.MEASURED, extractor=extractor,
            source_path=source_path, source_sha256=source_sha256,
            locator=locator, summary=summary, commit=commit,
            provides=tuple(provides),
        )

    @classmethod
    def attested(cls, *, extractor: str, source_path: str, source_sha256: str,
                 summary: str, attested_by: str, role: str, date: str,
                 locator: str | None = None,
                 provides: tuple[str, ...] | list[str] = (),
                 commit: str | None = None) -> "EvidenceRecord":
        """Build an ATTESTED record. Refuses anonymous prose.

        Annex IV genuinely needs human prose in places — design rationale,
        metric appropriateness, oversight measures. The honest move is to
        label it as signed prose rather than dress it up as derived fact. An
        unnamed or undated attestation is not a weaker attestation; it is
        nothing, and the caller must record a gap instead.
        """
        if not (attested_by or "").strip():
            raise ValueError(
                "ATTESTED evidence requires a named attester — anonymous prose "
                "is MISSING, not ATTESTED")
        if not (date or "").strip():
            raise ValueError(
                "ATTESTED evidence requires a date — an undated signature "
                "cannot be checked against the version it describes")
        if not (role or "").strip():
            raise ValueError(
                "ATTESTED evidence requires the attester's role — Annex IV 2(g) "
                "expects reports signed by the responsible persons")
        return cls(
            id=cls._mint(extractor, source_path, source_sha256, locator),
            cls=EvidenceClass.ATTESTED, extractor=extractor,
            source_path=source_path, source_sha256=source_sha256,
            locator=locator, summary=summary, commit=commit,
            provides=tuple(provides),
            attested_by=attested_by.strip(), role=role.strip(), date=date.strip(),
        )


class GapEntry(BaseModel):
    """A named absence. The product's most important output.

    Every gap says what is missing, why that counts as missing, and what
    engineering action would close it. Remediation is stated as an engineering
    action only — never as legal advice, and never as a compliance outcome.
    """

    model_config = ConfigDict(frozen=True)

    id: str
    section: int
    subpoint: str | None = None
    #: what is absent, in the regulation's terms
    requirement: str
    #: why the repository cannot support it
    reason: str
    kind: GapKind
    #: permanent gaps are never closable by this tool (section 8)
    permanent: bool = False
    #: the engineering action that would close it — not legal advice
    remediation: str

    @classmethod
    def make(cls, *, section: int, requirement: str, reason: str, kind: GapKind,
             remediation: str, subpoint: str | None = None,
             permanent: bool = False) -> "GapEntry":
        return cls(
            id="gap_" + _sha8(str(section), subpoint or "", requirement, kind.value),
            section=section, subpoint=subpoint, requirement=requirement,
            reason=reason, kind=kind, permanent=permanent, remediation=remediation,
        )


class Claim(BaseModel):
    """A sentence in the pack, and what stands behind it.

    Construct through :meth:`supported` or :meth:`gap`. Both paths are
    validated by :meth:`_exactly_one_support`, so hand-constructing a claim
    with neither reference — or with both — raises rather than producing a
    sentence the pack cannot defend.
    """

    model_config = ConfigDict(frozen=True)

    section: int
    subpoint: str | None = None
    #: the sentence that will appear in the pack
    text: str
    evidence_ids: tuple[str, ...] = Field(default_factory=tuple)
    gap_id: str | None = None

    @model_validator(mode="after")
    def _exactly_one_support(self) -> "Claim":
        has_evidence = len(self.evidence_ids) > 0
        has_gap = self.gap_id is not None
        if has_evidence and has_gap:
            raise ValueError(
                f"claim on section {self.section} cites evidence AND a gap — "
                "a claim is either supported or it is a gap, never both; "
                "ambiguity here is how a gap gets quietly buried under a "
                "citation")
        if not has_evidence and not has_gap:
            raise ValueError(
                f"claim on section {self.section} has neither evidence nor a "
                "gap reference — this is the silent assertion this tool exists "
                "to make impossible")
        return self

    @classmethod
    def supported(cls, *, section: int, text: str,
                  evidence: list[EvidenceRecord] | tuple[EvidenceRecord, ...],
                  subpoint: str | None = None) -> "Claim":
        if not evidence:
            raise ValueError("supported() requires at least one evidence record")
        return cls(section=section, subpoint=subpoint, text=text,
                   evidence_ids=tuple(e.id for e in evidence))

    @classmethod
    def gap(cls, *, section: int, text: str, gap: GapEntry,
            subpoint: str | None = None) -> "Claim":
        return cls(section=section, subpoint=subpoint, text=text, gap_id=gap.id)

    @property
    def is_gap(self) -> bool:
        return self.gap_id is not None


class SectionState(str, Enum):
    #: every requirement in the section is backed by evidence
    SUPPORTED = "supported"
    #: backed, but only by signed prose — nothing machine-derived
    ATTESTED_ONLY = "attested_only"
    #: some requirements backed, some gapped
    PARTIAL = "partial"
    #: nothing in the repository supports this section
    MISSING = "missing"
    #: not generatable by this tool, ever (section 8)
    BY_DESIGN_GAP = "by_design_gap"


class SectionResult(BaseModel):
    model_config = ConfigDict(frozen=True)

    number: int
    title: str
    state: SectionState
    claims: tuple[Claim, ...]
    #: subpoint letters (or limb names) with no evidence
    gapped: tuple[str, ...] = Field(default_factory=tuple)

    @property
    def claim_count(self) -> int:
        return len(self.claims)


class CompletionState(BaseModel):
    """The machine-readable answer to "what can this repo actually support?"."""

    model_config = ConfigDict(frozen=True)

    spec_version: str
    tool_version: str
    repo_commit: str | None
    sections_total: int
    sections_addressed: int
    claims_total: int
    claims_evidence_backed: int
    claims_gapped: int
    citations_measured: int
    citations_attested: int
    gaps_total: int
    gaps_permanent: int

    @property
    def evidence_backed_ratio(self) -> float:
        return (self.claims_evidence_backed / self.claims_total
                if self.claims_total else 0.0)

    @property
    def measured_share(self) -> float:
        total = self.citations_measured + self.citations_attested
        return self.citations_measured / total if total else 0.0


class Pack(BaseModel):
    """The generated Annex IV pack, as data. Markdown is a rendering of this."""

    model_config = ConfigDict(frozen=True)

    spec_version: str
    tool_version: str
    repo_commit: str | None
    repo_name: str
    classification_route: str | None
    sections: tuple[SectionResult, ...]
    evidence: tuple[EvidenceRecord, ...]
    gaps: tuple[GapEntry, ...]
    completion: CompletionState

    def evidence_by_id(self) -> dict[str, EvidenceRecord]:
        return {e.id: e for e in self.evidence}

    def gap_by_id(self) -> dict[str, GapEntry]:
        return {g.id: g for g in self.gaps}


def canonical_json(obj) -> str:
    """Canonical serialisation: sorted keys, fixed indent, LF, trailing newline.

    Determinism is a product claim — the same commit must regenerate the same
    pack byte for byte — so serialisation is pinned here rather than left to
    the caller's json.dumps defaults.
    """
    if isinstance(obj, BaseModel):
        obj = obj.model_dump(mode="json")
    return json.dumps(obj, sort_keys=True, indent=2, ensure_ascii=False) + "\n"
