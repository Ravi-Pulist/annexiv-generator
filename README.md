# annexiv

**EU AI Act Annex IV technical documentation, generated from the repository —
every claim cited to evidence, every gap flagged instead of hidden.**

```
$ annexiv generate ./my-model --route annex_i --out ./pack
annexiv 0.1.0 · toy-deterioration-model @ df2b1ee8dbb6
sections addressed: 9/9
claims: 29 (23 evidence-backed, 6 gaps)
evidence-backed ratio: 79.3% · MEASURED share: 63.8%
gap register: 6 (1 permanent)
```

---

> ### What this is, and what it is not
>
> This is **documentation support and engineering evidence**. It is **not
> legal advice**, **not a conformity assessment**, and it **does not by itself
> make any system compliant**. Classification of a system and submission to
> any authority remain with the provider's regulatory and legal owners. No
> tool can certify conformity — and this one is built so it cannot pretend to.

---

## First, a correction — because the deadline moved

Much of the material written about Annex IV in 2025 says the obligation lands
**2 August 2026**. As at 4 August 2026 that is **no longer correct**.

**Regulation (EU) 2026/1744** — the Digital Omnibus on AI, published 24 July
2026, in force 27 July 2026 — rewrote Article 113 and deferred Chapter III
Sections 1–3, which contain Article 11 and therefore the whole Annex IV duty:

| Your classification route | Annex IV applies from |
|---|---|
| **Annex III / Art. 6(2)** — standalone high-risk use case | **2 December 2027** |
| **Annex I / Art. 6(1)** — MDR/IVDR product route | **2 August 2028** |

And the route is not obvious. **Annex III contains no entry for medical
diagnosis, clinical decision support or treatment recommendation** — those
reach high-risk only through Article 6(1), which requires the system to be a
medical device (or safety component of one) *and* to need third-party
conformity assessment. Annex III does touch healthcare, at three separate
points: 5(a) benefits eligibility, 5(c) health insurance pricing, 5(d)
emergency triage.

This tool **never decides your route**. It takes the provider's declared
classification as an input and states the date that follows. Everything above
is verified against the Official Journal text — see
[the mapping spec](mapping/MAPPING.md) for sources.

The deferral is not bad news for readiness work. It is eighteen months to
build the evidence trail before anyone asks for it, which is cheaper than
assembling it under audit.

## Why generated beats templated

The facts Annex IV asks for already live in the repository — manifests,
lockfiles, eval outputs, model hashes, git history. The document, though, gets
written by hand in Word, at a distance from the code.

A blank template rewards fluent prose. A validation section reads equally
"finished" whether or not a validation report exists, and nothing in the
format distinguishes *measured* from *merely well-phrased*. The gaps surface
when a notified body, a customer or an auditor asks for the evidence behind a
sentence — the most expensive possible moment to find out.

So this tool inverts the default. **A claim cannot exist without either a
resolvable citation or a gap entry.** That is not a policy or a review
checklist; it is the only way the claim type can be constructed. There is no
third constructor, so "wrote a sentence nothing supports" is not a bug that
can occur — it is a state that cannot be represented.

## How it works

```
repository ──▶ 10 extractors ──▶ evidence records (content-addressed)
                                        │
     mapping spec (Annex IV §→sources) ──┤
                                        ▼
                            completion predicate
                          "what can this repo support?"
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
        claim + citation                            claim + gap entry
                    └───────────────────┬───────────────────┘
                                        ▼
                        Markdown pack · gap register · completion JSON
                                        │
                                        ▼
                    annexiv audit — an INDEPENDENT re-walk
              (different code path; re-resolves every citation)
```

**Three evidence classes, and only three:**

| Class | Meaning |
|---|---|
| **MEASURED** | Produced by running something — a hash, a test report, a dependency tree, a git history |
| **ATTESTED** | Prose a **named** human signed, with role and date. Anonymous prose is not weak evidence; it is *no* evidence, and the requirement gaps |
| **MISSING** | Named in the gap register with a reason and the engineering action that would close it |

**Capability keys** are the mechanic that makes this honest. A requirement is
satisfied not because a file exists but because the file actually covers it:
an evaluation report whose `subgroup_breakdown` is null provides
`eval.overall_accuracy` and **not** `eval.subgroup_accuracy`, so Annex IV
point 3's subgroup obligation gaps even though the report is right there. That
is the exact failure mode this tool sells against.

**Audit is a separate code path from generation.** It does not import the
predicate, the extractors or the renderer; it reads the finished pack from
disk as an untrusted document and re-derives every check from the repository.
The thing that produces must not be the thing that approves.

## Measured results

Generated from [the toy diagnostic model](#the-toy-model), a real repository
with a real trained model, on 4 August 2026:

| Metric | Target | **Measured** |
|---|---|---|
| Section coverage | 9/9 | **9/9** |
| Evidence-backed claim ratio | ≥ 70% | **79.3%** (23/29) |
| MEASURED share of citations | ≥ 33.3% | **63.8%** (30 measured / 17 attested) |
| Zero silent assertions | 0, absolutely | **0** — confirmed by the independent audit |
| Citation resolution | 100% | **47/47** |
| Gaps named | ≥ 3 | **6** (1 permanent) |
| Determinism | byte-identical | **byte-identical** pack and Markdown |

**Auditor mutation adequacy: 22/22.** The auditor is the component whose
failure is invisible — a generator bug produces a wrong document, which
someone might notice; an auditor bug produces a green tick on a wrong
document, which nobody does. So the auditor is broken on purpose, 22 ways, and
the test suite must notice every one. It does. `tests/mutation/results.json`
carries the per-mutant record.

**68 tests**, including 12 planted defects the auditor must catch: a silent
assertion, a claim citing both evidence and a gap, a dangling citation, a
deleted evidence file, a tampered file, a broken hash, a dangling gap
reference, a deleted gap register, inflated completion counts, an emptied
section, a pack with no sections, an unparseable pack.

## The gap register — the part worth reading

These are the sentences the pack **does not** write. A template would have
written them anyway.

| Annex IV | Kind | Why |
|---|---|---|
| **1(f)** | absent | no evidence source covers photographs/illustrations of the product's external features |
| **2(f)** | absent | no signed document describes pre-determined changes |
| **3 (subgroup accuracy)** | absent | the evaluation report contains no per-subgroup breakdown — *the file is present; this section of it is not* |
| **8** | **by design, permanent** | the EU declaration of conformity is a legal act executed by the provider under Article 47. This tool will never generate, draft or template it |
| **9 (evaluation system)** | absent | no post-market performance evaluation described |
| **9 (monitoring plan)** | absent | no Article 72(3) monitoring plan as its own artefact |

Section 8 is the honesty invariant made visible: a permanent gap that appears
in **every** pack, including otherwise complete ones. The spec loader enforces
it — a permanent-gap section that declares evidence sources is a validation
error, so the refusal cannot be quietly removed.

## The empty-repo exhibit

Point the tool at a bare repository and it produces
[a pack that is almost entirely gap register](exhibits/empty-repo/annex-iv.md):
**9/9 sections addressed, 29 gaps, zero prose, and the audit still passes** —
because a pack of pure gaps is a valid, honest pack.

That contrast is the whole pitch. A template, given nothing, still produces a
document that looks finished. This tool, given nothing, says so.

## The toy model

A deliberately small deterioration early-warning classifier on **entirely
synthetic** vitals and labs — 4,016 encounters after selection, seed-pinned,
byte-reproducible. Its performance is deliberately modest and reported
unflatteringly, with Wilson intervals:

| Metric | Value | 95% CI |
|---|---|---|
| AUROC | 0.797 | — |
| Sensitivity | 0.784 | 0.698 – 0.850 |
| Specificity | 0.650 | 0.614 – 0.684 |
| PPV | 0.264 | 0.219 – 0.314 |
| NPV | 0.949 | 0.926 – 0.966 |

A mediocre model documented accurately demonstrates the point better than an
impressive one: **the pack's job is to describe the system truthfully.** Note
that `sex` is recorded in the data but is deliberately not a model feature —
which makes the missing subgroup breakdown visibly a *choice* rather than a
data limitation.

No real patient data was used at any stage, and a test asserts it.

## Quickstart

```
pip install -r requirements.txt
set PYTHONPATH=src

python -m annexiv generate ../my-repo --route annex_i --out ./pack
python -m annexiv audit ./pack/pack.json --repo ../my-repo
python -m annexiv gaps ../my-repo          # the readiness scan on its own
```

Exit codes are the product: `audit` returns 0 when every check passes and
**1 when the pack fails one** — a working tool reporting a true finding, not
an error. `gaps` returns 1 while gaps remain, so CI can gate on readiness.

The tool is **read-only** against the subject repository. Nothing in it opens
a file for writing.

## Lineage

The evidence-plane and completion-predicate patterns are adapted from the RMAD
framework (content-addressed records; "done" as a predicate over obligations
rather than a report from whoever did the work). The custody register and
CycloneDX ML-BOM in the toy repo are the same pairing. The
verifier-not-implementer stance — audit as a separate code path — is carried
over from a DICOM de-identification verifier built on the same principle.

## Honest limits

- **PDF rendering is not implemented.** Markdown is the source of truth by
  design; the PDF was scheduled for a day-6 decision and neither renderer was
  available on the build host. Recorded as unfinished rather than claimed.
- The section titles are **our labels**; points 3, 7 and 9 are unlettered
  blocks in the Official Journal, and any sub-structure this tool imposes is
  disclosed as ours in every pack.
- The measured ratios above are properties of **this demo subject**, not
  promises about your repository. A repo with less evidence will produce a
  longer gap register — which is the tool working.
- Article 11(3) lets the Commission amend Annex IV by delegated act. The spec
  is versioned and hashed, and the test suite pins the verified structure so
  an amendment fails loudly rather than silently.

## How an engagement starts

**Readiness scan** — a read-only `annexiv gaps` run against your repository.
You get the gap register: every Annex IV requirement scored supported /
attested-only / missing, with the engineering action that would close each
one. It doubles as the scope for the work that follows, which is the point.

Then: evidence build-out (stand up the artefacts the gaps name, wire the
extractors to your stack, leave the audit command behind), and optionally
documentation-as-CI, so the pack regenerates per release and drifts loudly
instead of quietly.

Every engagement states, in writing: this is documentation support and
engineering evidence; it is not legal advice, not a conformity assessment, and
does not by itself make any system compliant. We work alongside your
regulatory and legal owners, not instead of them.

## Licence

MIT.
