---
document_type: cybersecurity_measures
attested_by: "J. Lindqvist"
role: "Information Security Officer"
date: "2026-08-04"
covers_annex_iv: ["2(h)"]
---

# Cybersecurity measures

Scope: the repository and the model artefact it distributes. The deployer's runtime,
network, identity and access controls are out of scope and are the deployer's
responsibility — this document says what the provider hands over and what it does not.

## Threat model

The system holds no data at rest, has no user accounts, no network listener, no
credentials and no secrets. That removes most of the usual attack surface and leaves three
threats that are real.

**T1 — artefact substitution.** `models/model.joblib` is a Python pickle, which executes
code on load. An attacker who replaces it runs arbitrary code in the deployer's process. A
subtler attacker replaces it with a model that scores differently and lets it run under a
documented digest, changing clinical decisions with no visible tampering. This is the
principal threat and it is R-09.

**T2 — dependency compromise.** The pipeline pulls seven third-party packages. A
compromised release of any of them executes at import time, in the same process, with the
same access.

**T3 — data or evidence tampering.** Altering `data/*.csv` or `eval/report.json` to make
the model look better than it is. The consequence is not a breach; it is a documentation
package that certifies performance the system does not have.

Explicitly out of the provider's threat model: adversarial inputs crafted to suppress a
flag. The inputs are clinical observations entered by staff, and a member of staff who
wants to avoid escalating a patient does not need to attack a model to do it.

## Measures in place

**Content addressing throughout.** Every artefact is pinned by SHA-256 by something other
than itself: the model by `custody/register.json` and `custody/ml-bom.json`, each data
split by `data/manifest.json`, and the generator by its own entry in that manifest. The
digests are cross-checked at three points in the pipeline — `train.py` refuses to fit if a
CSV does not match the manifest, `eval/evaluate.py` refuses to score if the model was
fitted against a different manifest, and `custody/pin.py` refuses to publish a register
built from a stale evaluation. Each refusal is a hard exit, not a warning. (T1, T3)

**Reproducibility as an integrity control.** This is the strongest measure here and it is
worth stating plainly: a third party does not have to trust the published digests. With
the pinned requirements and seed 20260804 they can rebuild the dataset and the model from
source and compare. A tampered artefact fails that comparison even if every declared
digest has been rewritten to match it. Verification does not depend on the provider's
honesty. (T1, T3)

**Verification made a first-class instruction.** Step 1 of the instructions for use in
`docs/model-card.md` is to verify the model digest against the register before loading.
A control nobody is told to run is not a control. (T1)

**Exact dependency pinning.** `requirements.txt` pins every package to an exact version.
The published digests are only reproducible against that set, which means a silent
dependency bump is detectable as a reproducibility failure rather than invisible. (T2)

**Minimal attack surface by construction.** No network calls at training, evaluation or
inference. No filesystem writes outside the repository. No credentials, tokens or
connection strings anywhere in the tree — there is nothing to leak because there is
nothing held. The test suite scans every file for identifier-shaped values and fails on
any hit. (T1, T2)

**Continuous verification.** `tests/test_repo.py` re-derives every published digest from
the bytes on disk and rebuilds the dataset twice in isolated trees to confirm the
committed data is what the generator produces. Tampering that does not also update every
cross-reference fails the suite. (T1, T3)

**Change traceability.** Every artefact is versioned in git with signed-off, descriptive
commits and annotated release tags. A change to the model that does not appear in the
history is visible as a digest mismatch.

## Measures deliberately NOT in place

Stated plainly, because a security section that lists only what was done is a marketing
document.

- **No cryptographic signing.** Neither the model artefact, the ML-BOM nor the git tags
  are signed. The digests establish integrity against accidental corruption and against an
  attacker who cannot write to the repository; they establish nothing against one who can.
  For a real distribution, artefact signing and signed tags would both be required. This
  is the residual on R-09.
- **Pickle is retained as the serialisation format.** `joblib.load` executes code. The
  model is ten coefficients and an intercept and could be shipped as JSON with no
  executable content at all, which would eliminate T1's code-execution path entirely. It
  has not been done because the artefact also carries the sklearn pipeline object that
  `eval/evaluate.py` calls directly. This is a known weakness with a known fix that has
  not been applied.
- **No automated dependency vulnerability scanning.** No `pip-audit`, no Dependabot, no
  advisory feed. Pinned versions age, and nothing here will notice when one of them
  acquires a CVE.
- **No runtime hardening guidance.** No sandboxing, resource-limit or process-isolation
  recommendations for the deployer.
- **No monitoring of any kind**, security included. There is no post-market monitoring
  plan (`docs/KNOWN-GAPS.md`), and that gap covers security telemetry as much as
  performance telemetry. Nothing here would detect an artefact swap in service; the
  digest check happens at load, and only if the deployer performs it.

These are acceptable for an artefact that is never deployed and never sees a patient. None
of them would be acceptable for one that was.
