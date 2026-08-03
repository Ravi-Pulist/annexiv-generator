---
document_type: human_oversight
attested_by: "S. Okonkwo"
role: "Nurse Consultant, Critical Care Outreach"
date: "2026-08-04"
covers_annex_iv: ["2(e)", "3"]
---

# Human oversight measures (Article 14)

## The oversight posture in one line

The screen has no authority. It cannot order, escalate, defer, or record anything. It can
only put a marker next to a name on a list, and a human decides what that is worth.

## What the clinician actually sees

Three things, always together, never the flag alone:

1. the boolean flag,
2. the probability that produced it and the threshold in force,
3. a standing statement of the screen's measured sensitivity with its confidence
   interval, drawn from `eval/report.json`.

Item 3 is the load-bearing one. A clinician who knows the screen finds roughly four in
five deteriorations — and that roughly three in four of its flags are false — reads both a
flag and a blank very differently from one who assumes it is usually right. Any deployer
interface that shows the flag without the accompanying performance statement is operating
outside the intended purpose in `docs/model-card.md`.

## Overriding

There is nothing to override, and that is the design. The clinician's existing escalation
route — bedside assessment, the ward's early-warning score, outreach referral — is
unchanged and takes precedence in both directions:

- **Flagged, clinician disagrees.** No action is required. The clinician is not asked to
  justify ignoring a flag, and no record is made of an unactioned flag. A screen that
  generates a paper trail of dissent teaches staff to act on flags they do not believe, to
  avoid the paperwork. That is automation bias with an audit trail attached.
- **Not flagged, clinician is concerned.** Escalate exactly as before. The absence of a
  flag is not evidence of stability and must never be quoted as a reason not to escalate.
  This is the failure mode that would injure a patient, and it is R-03 in the risk log.

## Interpreting the flag

A flag means: *the recorded observations for this encounter resemble those that preceded
deterioration in the synthetic training cohort.* It does not mean the patient is
deteriorating, is unstable, or needs a specific intervention. The expected clinical
response is to look at the patient — not to act on the number.

Three interpretive cautions the deployer must carry into training:

- **The probability is a ranking, not a calibrated risk.** No calibration assessment has
  been performed. A returned 0.30 does not mean "30% of such patients deteriorate". Treat
  it as ordinal.
- **Near-threshold scores are not meaningfully different from each other.** With the
  threshold at 0.4176, an encounter scoring 0.416 and one scoring 0.419 are the same
  encounter as far as the evidence goes. The threshold is a decision boundary, not a cliff
  in the underlying risk.
- **The screen cannot see a trend.** It sees one snapshot. A patient whose observations
  have been drifting the wrong way for six hours but remain in range will not be flagged.
  Trend remains the clinician's job and the screen does not touch it.

## Assignment of oversight

Oversight is not a role that is created for this system; it is the ward's existing
clinical judgement, applied to a new prompt. Concretely, the deployer is expected to:

- brief every user, before first use, on the measured sensitivity and specificity with
  intervals, and on the specific fact that a negative carries little information;
- state in local policy that a flag is never a precondition for escalation and never a
  substitute for one;
- name a clinical owner who can withdraw the screen from a ward unilaterally, without
  needing supplier agreement or a change-control cycle;
- keep the screen advisory in the record — the flag is not written to the patient record
  as a clinical finding.

## Stop conditions

The screen is withdrawn from a ward if any of the following holds. None of these are
detectable by the system itself, which is a real weakness given that no post-market
monitoring plan exists (`docs/KNOWN-GAPS.md`); they depend on a human noticing.

- Flags are being generated faster than the ward can look at patients (R-01).
- Any instance of a flag, or its absence, being used to gate an outreach referral.
- Any use outside the intended population in `docs/model-card.md` — paediatric, obstetric,
  ICU, or pre-admission.
- A change in how observations are recorded on the ward — a new device, a new rounding
  convention, a new charting default — with no way to test whether the model's inputs
  still mean what they meant (R-04).
- The model artefact's SHA-256 not matching `custody/register.json`.

## Honest limits of these measures

Everything above is procedural. There is no telemetry, no drift detector, no alert-rate
dashboard and no automated stop. If a ward slides into treating the flag as authoritative,
nothing in this repository will notice; a person has to. That is a genuine weakness of the
oversight design, not an oversight in describing it, and it is the reason R-03 is held
open rather than mitigated.
