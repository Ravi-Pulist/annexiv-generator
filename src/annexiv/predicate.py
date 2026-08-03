"""The completion predicate: what can this repository actually support?

Re-targeted from RMAD's "is the work done" to "is the pack supported". The
shape is the same and so is the discipline: completion is computed from
evidence, never reported by whoever did the work.

For every requirement of every Annex IV section the predicate asks one
question — is there a record from an extractor the mapping spec accepts for
this requirement, carrying a capability key the spec demands? — and produces
either a supported claim or a gap. There is no third outcome, because
:class:`~annexiv.model.Claim` has no third constructor.

Gap reasons are specific where the repository lets them be. "No risk log
found" and "risk log found but three entries have no owner" are different
findings that need different work, and collapsing both to "missing" would
waste the most useful thing the tool produces.
"""

from __future__ import annotations

from .extractors import REGISTRY
from .extractors.attested import unsigned_documents
from .extractors.custody import stale_pins
from .extractors.dataset import hash_mismatches
from .extractors.risklog import structural_problems
from .model import (Claim, CompletionState, EvidenceClass, EvidenceRecord,
                    GapEntry, GapKind, SectionResult, SectionState)
from .repo import RepoContext
from .spec import MappingSpec, Section


def collect_evidence(repo: RepoContext) -> list[EvidenceRecord]:
    """Run every extractor. Deterministically ordered."""
    records: list[EvidenceRecord] = []
    for name in sorted(REGISTRY):
        try:
            records.extend(REGISTRY[name](repo))
        except Exception as exc:      # noqa: BLE001
            # An extractor that fails must not take the run down: the pack's
            # job is to report what a repository supports, and "the eval
            # extractor crashed" is itself something the reader needs to see
            # rather than a stack trace instead of a document.
            records.append(EvidenceRecord.measured(
                extractor=name, source_path="<extractor-error>",
                source_sha256="0" * 64,
                locator="error",
                summary=(f"extractor {name} raised {type(exc).__name__} and "
                         "produced no evidence"),
                provides=(),
            ))
    return [r for r in records if r.source_path != "<extractor-error>"], [
        r for r in records if r.source_path == "<extractor-error>"]


def _diagnose(repo: RepoContext, section: Section, req: str) -> tuple[GapKind, str, str]:
    """(kind, reason, remediation) for an unsupported requirement.

    Remediation is always an engineering action. This tool does not tell
    anyone what the law requires of them.
    """
    extractors = {s.extractor for s in section.evidence_sources
                  if req in s.supports or "whole" in s.supports}

    if "risk_log" in extractors:
        rel, problems = structural_problems(repo)
        if rel and problems:
            return (GapKind.STRUCTURALLY_INVALID,
                    f"risk log at {rel} is incomplete: " + "; ".join(problems[:4]),
                    "complete the missing fields — every risk needs an owner, a "
                    "status, a mitigation and a review date before the log "
                    "evidences a managed process")
        return (GapKind.ABSENT, "no structured risk log found in the repository",
                "add a risk-log.yaml with one entry per risk carrying id, "
                "description, owner, status, mitigation and review_date")

    if "attested_docs" in extractors:
        unsigned = unsigned_documents(repo)
        if unsigned:
            paths = ", ".join(f"{p} (missing {', '.join(m)})"
                              for p, m in unsigned[:3])
            return (GapKind.UNSIGNED,
                    f"document(s) present but not attributable: {paths}",
                    "add document_type, attested_by, role and date front-matter "
                    "— an unsigned document cannot be checked against the "
                    "version it describes")
        return (GapKind.ABSENT,
                "no signed document in the repository covers this requirement",
                "add a Markdown document under docs/ with front-matter naming "
                "the attester, their role and the date")

    if "dataset_manifest" in extractors:
        mismatches = hash_mismatches(repo)
        if mismatches:
            return (GapKind.STRUCTURALLY_INVALID,
                    "dataset manifest disagrees with the files on disk: "
                    + "; ".join(mismatches[:3]),
                    "regenerate the manifest so its hashes match the data, or "
                    "restore the data the manifest describes")
        return (GapKind.ABSENT, "no dataset manifest covers this requirement",
                "add data/manifest.json recording per-file hashes, the "
                "selection rule, the cleaning method and the label definition")

    if "custody" in extractors:
        stale = stale_pins(repo)
        if stale:
            return (GapKind.STRUCTURALLY_INVALID,
                    "custody register is stale: " + "; ".join(stale[:3]),
                    "re-pin the model so the register hash matches the artefact")
        return (GapKind.ABSENT, "no model custody register found",
                "pin each model by checkpoint SHA-256 with its licence, and "
                "emit a CycloneDX ML-BOM")

    if "eval_report" in extractors:
        if req == "subgroup_accuracy":
            return (GapKind.ABSENT,
                    "the evaluation report contains no per-subgroup accuracy "
                    "breakdown (the file is present; this section of it is not)",
                    "compute and record accuracy per relevant subgroup in the "
                    "eval report's subgroup_breakdown field")
        return (GapKind.ABSENT, "no evaluation report covers this requirement",
                "run the evaluation harness on a held-out split and commit the "
                "report with metrics and confidence intervals")

    if "git" in extractors or "changelog" in extractors:
        return (GapKind.ABSENT,
                "no tagged release history or changelog documents changes over "
                "the system's lifecycle",
                "tag releases and maintain a CHANGELOG describing what changed "
                "between them")

    if "input_schema" in extractors:
        return (GapKind.ABSENT, "no typed input specification found",
                "declare the inference input as a typed schema with field "
                "names, units and ranges")

    if "telemetry_config" in extractors:
        return (GapKind.ABSENT, "no monitoring configuration committed",
                "commit the monitoring/telemetry configuration that evaluates "
                "performance after release")

    return (GapKind.ABSENT, "no evidence source in this repository covers this "
            "requirement",
            "produce the artefact named in the mapping spec for this section")


def _claim_sentence(section: Section, req: str, records: list[EvidenceRecord],
                    supported: bool) -> str:
    label = section.requirement_text(req)
    short = label if len(label) < 180 else label[:177].rstrip() + "…"
    if supported:
        return short
    return short


def evaluate(repo: RepoContext, spec: MappingSpec) -> tuple[
        list[SectionResult], list[EvidenceRecord], list[GapEntry], list[str]]:
    """Returns (sections, evidence, gaps, extractor_errors)."""
    records, errors = collect_evidence(repo)
    error_notes = [e.summary for e in errors]

    sections: list[SectionResult] = []
    gaps: list[GapEntry] = []
    used_evidence: dict[str, EvidenceRecord] = {}

    for section in spec.sections:
        claims: list[Claim] = []
        gapped: list[str] = []

        if section.permanent_gap:
            gap = GapEntry.make(
                section=section.number,
                requirement=section.text,
                reason=section.permanent_gap_reason.strip(),
                kind=GapKind.BY_DESIGN,
                permanent=True,
                remediation=("the provider draws up and signs the EU "
                             "declaration of conformity itself; this tool will "
                             "never generate, draft or template it"),
            )
            gaps.append(gap)
            claims.append(Claim.gap(section=section.number,
                                    text=section.text, gap=gap))
            gapped.append("whole")
            sections.append(SectionResult(
                number=section.number, title=section.title,
                state=SectionState.BY_DESIGN_GAP, claims=tuple(claims),
                gapped=tuple(gapped)))
            continue

        for req in section.requirements:
            sources = [s for s in section.evidence_sources
                       if req in s.supports or "whole" in s.supports]
            matched = [r for r in records
                       if any(src.matches(r) for src in sources)]
            # deterministic order, and stable across runs
            matched = sorted(matched, key=lambda r: (r.extractor, r.id))

            if matched:
                for r in matched:
                    used_evidence[r.id] = r
                claims.append(Claim.supported(
                    section=section.number, subpoint=req,
                    text=_claim_sentence(section, req, matched, True),
                    evidence=matched))
            else:
                kind, reason, remediation = _diagnose(repo, section, req)
                gap = GapEntry.make(
                    section=section.number, subpoint=req,
                    requirement=section.requirement_text(req),
                    reason=reason, kind=kind, remediation=remediation)
                gaps.append(gap)
                claims.append(Claim.gap(
                    section=section.number, subpoint=req,
                    text=_claim_sentence(section, req, [], False), gap=gap))
                gapped.append(req)

        supported_claims = [c for c in claims if not c.is_gap]
        classes = {used_evidence[eid].cls
                   for c in supported_claims for eid in c.evidence_ids}
        if not supported_claims:
            state = SectionState.MISSING
        elif gapped:
            state = SectionState.PARTIAL
        elif classes == {EvidenceClass.ATTESTED}:
            state = SectionState.ATTESTED_ONLY
        else:
            state = SectionState.SUPPORTED

        sections.append(SectionResult(
            number=section.number, title=section.title, state=state,
            claims=tuple(claims), gapped=tuple(gapped)))

    evidence = sorted(used_evidence.values(), key=lambda r: r.id)
    gaps = sorted(gaps, key=lambda g: (g.section, g.subpoint or "", g.id))
    return sections, evidence, gaps, error_notes


def completion_state(spec: MappingSpec, sections: list[SectionResult],
                     evidence: list[EvidenceRecord], gaps: list[GapEntry],
                     repo_commit: str | None, tool_version: str) -> CompletionState:
    by_id = {e.id: e for e in evidence}
    all_claims = [c for s in sections for c in s.claims]
    backed = [c for c in all_claims if not c.is_gap]
    measured = sum(1 for c in backed for eid in c.evidence_ids
                   if by_id[eid].cls is EvidenceClass.MEASURED)
    attested = sum(1 for c in backed for eid in c.evidence_ids
                   if by_id[eid].cls is EvidenceClass.ATTESTED)
    return CompletionState(
        spec_version=spec.spec_version,
        tool_version=tool_version,
        repo_commit=repo_commit,
        sections_total=len(spec.sections),
        # "Addressed" means populated OR explicitly gap-flagged. Every section
        # is addressed by construction — that is the invariant, and the metric
        # exists so a reader can verify it rather than take it on trust.
        sections_addressed=sum(1 for s in sections if s.claims),
        claims_total=len(all_claims),
        claims_evidence_backed=len(backed),
        claims_gapped=len(all_claims) - len(backed),
        citations_measured=measured,
        citations_attested=attested,
        gaps_total=len(gaps),
        gaps_permanent=sum(1 for g in gaps if g.permanent),
    )
