# Examples

## `toy-deterioration-model/` — the demo subject

A complete, runnable machine-learning repository used as the subject of the
generated Annex IV pack in [`../exhibits/toy-model/`](../exhibits/toy-model/).
It is a real repository, not a prop: the data generator actually generates,
the training script actually trains, and every number in `eval/report.json`
came from a real run on a held-out split.

**Everything in it is synthetic.** No real patient data was used at any stage,
and `tests/test_repo.py` asserts it.

### What it is

A deterioration early-warning classifier — synthetic vitals and labs in,
"flag for clinician review" out. Deliberately small, and deliberately
mediocre: sensitivity 0.784 (95% CI 0.698–0.850), PPV 0.264. A mediocre model
documented accurately demonstrates the point better than an impressive one,
because the pack's job is to describe the system truthfully.

### The two deliberate absences

The repository is missing two things **on purpose**, so the generated pack has
real gaps to name rather than manufactured ones:

1. **No subgroup accuracy breakdown** — `eval/report.json` has
   `subgroup_breakdown: null`. Note that `sex` *is* recorded in the data but
   is deliberately not a model feature, which makes the missing breakdown
   visibly a choice rather than a data limitation.
2. **No post-market monitoring plan** — no Article 72(3) artefact, no
   telemetry configuration.

Both are documented in `docs/KNOWN-GAPS.md`, and the example's own test suite
asserts that they remain absent — so nobody quietly fills them in and
flattens the exhibit.

### Running it

```
cd toy-deterioration-model
pip install -r requirements.txt
python data/generate.py && python train.py && python eval/evaluate.py
python -m pytest tests -q
```

Everything is seeded (`SEED = 20260804`) and reproduces byte-identically:
two full rebuilds produce the same manifest, report, model and ML-BOM digests.

### Generating the pack from it

```
cd ..                       # back to the generator repo root
set PYTHONPATH=src
python -m annexiv generate examples/toy-deterioration-model --route annex_i --out out/demo
python -m annexiv audit out/demo/pack.json --repo examples/toy-deterioration-model
```

### About the git history

This example was developed as its own repository with 12 commits and two
release tags. It is vendored here as plain files so the generator repository
tracks every one of them, and the original history is preserved alongside as
**`git-history.bundle`**. To restore it:

```
git clone git-history.bundle restored-with-history
```

This matters for one measurement. Two Annex IV requirements can be evidenced
from git — 1(a)/1(c) versions, and point 6 lifecycle changes — so the vendored
copy, having no live `.git`, yields **three fewer MEASURED citations**:

| | MEASURED share |
|---|---|
| Vendored copy (as shipped here) | **58.5%** |
| With the bundled history restored | **63.8%** |

**No requirement gaps either way.** The git evidence was redundant with the
CHANGELOG (point 6) and the model card and dependency manifests (1(a), 1(c)),
so losing it costs citation richness and nothing else. The shipped exhibit is
generated from the vendored copy, so the exhibit and the example always
describe the same thing.
