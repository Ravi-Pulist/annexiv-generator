# Known gaps

This file is deliberately **not** an attested document. It has no YAML front-matter and
nobody has signed it, because signing it would make it read as an attestation that these
gaps are acceptable. They are not acceptable. They are recorded.

Two items required by Annex IV are absent from this repository. Both are absences by
decision, taken with the requirement in front of us, not oversights. They are listed here
so that the difference is visible to a reader — and to a documentation generator — without
anyone having to guess.

---

## 1. No subgroup accuracy breakdown

**What is missing.** Annex IV point 3 requires the "degrees of accuracy for specific
persons or groups of persons on which the system is intended to be used". This repository
reports aggregate accuracy only. `eval/report.json` carries `"subgroup_breakdown": null`.

**Where you will see it.** The key is present and null rather than omitted. An absent key
looks like a schema that never had the field; an explicit null looks like the decision it
was. `eval/evaluate.py` carries a comment at the emit site saying the same thing, and
`tests/test_repo.py::test_absence_no_subgroup_breakdown` asserts the null so it cannot be
quietly filled in later.

**Why it is missing.** Not because it is hard, and not because the data is unavailable.
`sex` and `age_years` are recorded in every split precisely so the analysis stays possible,
and stratifying the four proportions is roughly fifteen lines of the code that already
exists.

The honest reason is that a defensible breakdown needs statistical power this test split
does not have. There are 111 positive encounters in the test split. Split by sex, that is
around 55 per stratum; add age bands and it falls to twenty-odd. A Wilson interval on a
sensitivity computed over twenty positives spans something like forty percentage points.
Two such intervals will overlap almost regardless of the truth, and publishing them as
evidence of subgroup parity would be worse than publishing nothing — it would convert
"we don't know" into "we checked", which is the more dangerous statement.

Doing it properly means a larger evaluation split, a pre-registered set of strata, and a
stated minimum detectable difference. That is real work and it was not done here.

**The consequence, stated where it matters.** `docs/model-card.md` makes no claim that
performance is comparable across sexes or age bands and tells deployers not to assume it.
Tracked as **R-02** (open, owner Dr. A. Nowak, review 2026-11-01).

---

## 2. No post-market monitoring plan

**What is missing.** There is no post-market monitoring plan, no telemetry configuration,
no realised alert-rate measurement, no outcome feedback loop and no drift detection.
Nothing in this repository observes the system after release.

**Where you will see it.** There is no `docs/post-market-monitoring.md`, no monitoring or
telemetry configuration under `config/`, and no attested document of type
`post_market_monitoring`. `tests/test_repo.py::test_absence_no_post_market_monitoring_plan`
asserts all of that, so the gap cannot close silently either.

**Why it is missing.** Because the system is never deployed. There is no post-market to
monitor: no ward, no patient, no observation ever reaches it. Writing a monitoring plan for
a market that does not exist would produce a document with nothing behind it, which is the
failure mode this whole exhibit is arguing against.

**Why it matters anyway.** This gap is load-bearing for other risks, and that is the part
worth reading. Three entries in `risk-log.yaml` name monitoring as the control they would
otherwise rely on:

- **R-01 (alarm fatigue)** — nothing measures the alert rate the ward actually experiences.
- **R-03 (automation bias)** — nothing detects a ward drifting into treating the flag as
  authoritative.
- **R-04 (input drift)** — nothing notices when a new device or charting convention moves
  the input distribution inside the accepted ranges.

Each of those risks is therefore weaker than its mitigation text alone would suggest. The
controls that do exist are procedural and depend on a human noticing, which is why R-01,
R-03 and R-04 are all held **open** rather than mitigated.

Tracked as **R-07** (accepted, owner H. Bauer, review 2026-11-01). "Accepted" here means
understood, uncontrolled, and owned by a named person. It does not mean closed, and for
any real deployment this would be a blocking gap.

---

## If you close one of these

Three things change together, or the repository starts lying:

1. the artefact itself (the breakdown, or the monitoring plan);
2. the entry above;
3. the assertion in `tests/test_repo.py` that currently pins the absence, and the
   corresponding risk-log entry.

The tests are written to fail on step 1 alone. That is intentional — it forces the
documentation to move at the same time as the code, and puts the change in front of a
reviewer instead of past one.
