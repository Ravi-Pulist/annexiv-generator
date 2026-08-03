"""Extractors: repository facts → evidence records.

Every extractor has the same shape and the same manners:

    extract(repo: RepoContext) -> list[EvidenceRecord]

Manners, in order of importance:

1. **Report what is there, never what should be there.** An extractor that
   finds nothing returns an empty list. It does not invent a placeholder, and
   it does not raise: an absent artefact is a gap for the predicate to name,
   not an error that aborts the run. A tool that crashes on an incomplete
   repository is useless for its main job, which is telling you the repository
   is incomplete.
2. **Every record is content-addressed** to a real file with a real SHA-256.
   The audit command re-resolves each one against the repository, so a record
   pointing at nothing is caught by a different code path than the one that
   wrote it.
3. **Capability keys are precise.** A record says what it actually covers via
   ``provides``. An eval report whose subgroup section is null does not provide
   ``eval.subgroup_accuracy`` — the requirement then gaps, which is the whole
   point of the exercise.
"""

from __future__ import annotations

from .attested import extract as extract_attested_docs
from .changelog import extract as extract_changelog
from .custody import extract as extract_custody
from .dataset import extract as extract_dataset_manifest
from .evalreport import extract as extract_eval_report
from .gitlog import extract as extract_git
from .inputschema import extract as extract_input_schema
from .manifests import extract as extract_manifests
from .risklog import extract as extract_risk_log
from .telemetry import extract as extract_telemetry_config

#: extractor name (as used in the mapping spec) -> callable
REGISTRY = {
    "attested_docs": extract_attested_docs,
    "changelog": extract_changelog,
    "custody": extract_custody,
    "dataset_manifest": extract_dataset_manifest,
    "eval_report": extract_eval_report,
    "git": extract_git,
    "input_schema": extract_input_schema,
    "manifests": extract_manifests,
    "risk_log": extract_risk_log,
    "telemetry_config": extract_telemetry_config,
}

__all__ = ["REGISTRY"]
