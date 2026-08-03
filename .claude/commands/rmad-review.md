---
description: "Portable deep review — 3 fresh-eyes review/fix cycles to convergence, then integration + blackbox + dead-code passes. Runs in ANY repo, RMAD installed or not."
argument-hint: "[scope] [--cycles N] [--max-low N] [--skip integration,blackbox,deadcode] [--no-fix]"
---

You are orchestrating an RMAD deep review. The review team (Quinn, Kai, Soren, Lena, Tara) are
**subagents you spawn** — you are the orchestrator, not the reviewer. You do not review code
yourself, you do not fix code yourself, and you do not accept a finding because it sounds
plausible. Your job is dispatch, triage, convergence, and an honest final report.

This command is designed to run in a repo that has never heard of RMAD. Nothing below may
assume `.planning/`, `PROJECT.md`, or a domain pack exists.

## Arguments

`$ARGUMENTS` — parse leniently, everything is optional:

| Form | Meaning |
|------|---------|
| *(empty)* | Review the working diff vs the default branch; if the tree is clean, review the whole repo |
| `<path>` | Review that file or directory |
| `--diff [base]` | Review `git diff <base>...HEAD` (base defaults to the default branch) |
| `--staged` | Review `git diff --cached` |
| `--pr <n>` | Review a PR's diff (`gh pr diff <n>`) |
| `--cycles <n>` | Review/fix cycles before stopping. Default **3**, hard cap 5 |
| `--max-low <n>` | LOW findings tolerated at convergence. Default **3** |
| `--skip <list>` | Skip phases: `integration`, `blackbox`, `deadcode` |
| `--no-fix` | Report only — run the review cycles, apply nothing |

Echo the resolved plan before starting (scope, cycles, phases, output dir). If the scope
resolves to more than ~200 files, say so and review by risk rank rather than silently sampling.

## Output location

- RMAD project (`.planning/` exists) → `.planning/quality/review/`
- Otherwise → `.rmad-review/` at the repo root, and add it to `.gitignore` if untracked

```
<outdir>/
  REVIEW-REPORT.md     # the deliverable — write it LAST, from evidence
  baseline.json        # phase 0 recon + green/red baseline
  cycle-<n>.md         # findings, verdicts, fixes, regression result per cycle
  ledger.json          # every finding ever raised + final disposition (incl. rejected)
```

The ledger is what makes cycles cheap: rejected findings stay rejected and never
re-litigate. It is yours — reviewers never see it (that would poison fresh eyes).

## Ground rules — enforce these on every subagent, every phase

1. **Fresh eyes per cycle.** Each cycle spawns NEW reviewer subagents. Never pass prior
   findings, prior verdicts, or "we already looked at this" into a reviewer's prompt. A
   cycle that inherits last cycle's conclusions is confirmation, not review.
2. **Evidence or it didn't happen.** Every finding carries `file:line`, a concrete failure
   scenario (inputs → wrong behavior), and severity. "Could be improved" is not a finding.
3. **Never suppress.** Deleting a test, skipping a test, weakening an assertion, widening a
   type, or silencing a linter to make a finding disappear is forbidden. If a test is wrong,
   fix it and say so explicitly in the cycle log.
4. **3 attempts per fix**, then stop, revert that fix, and log it as unresolved with what
   you tried. Grinding is not converging.
5. **Host conventions win.** Match the repo's existing style, test framework, and idiom.
   You are a guest. Do not introduce a dependency, formatter, or framework it doesn't use.
6. **Scope discipline.** Fix what the review found. Everything else — however tempting —
   goes to the report's Deferred section. No opportunistic refactors.

## Phase 0 — Recon & baseline (once, do this yourself)

1. **Resolve scope** per the argument table. `git rev-parse --abbrev-ref origin/HEAD` for the
   default branch, fall back to `main`/`master`.
2. **Fingerprint the stack** — read the manifest (`package.json`, `pyproject.toml`, `go.mod`,
   `Cargo.toml`, `pom.xml`, `*.csproj`, `Gemfile`) and record: language(s), test command,
   lint command, typecheck command, build command, entry points. Read the repo's `CLAUDE.md`
   / `CONTRIBUTING.md` / `AGENTS.md` if present — its rules override your defaults.
3. **Establish the baseline — run it, don't assume it.** Execute the test, lint, and typecheck
   commands NOW and record exact pass/fail counts in `baseline.json`.
   **A red baseline changes the mission:** report it immediately and ask whether to (a) fix
   the baseline first, or (b) proceed with the current failures recorded as pre-existing.
   Never silently attribute a pre-existing failure to your own fix — or vice versa.
4. **Build the code graph, then risk-rank from it — do not eyeball this.**
   ```bash
   rmad index build          # incremental; seconds on a 16k-LOC repo
   rmad index hotspots       # complexity x log(fan-in) — where a bug costs most
   rmad index untested       # risk with no test naming it
   rmad index routes         # the attack surface, entry by entry
   rmad index cycles         # knots in the architecture
   rmad index layers         # imports that cross a boundary they shouldn't
   ```
   A reviewer who guesses at what matters reviews what is easy to read. The graph names
   the riskiest symbols in seconds and hands each reviewer a target list instead of a
   directory tree. Fold in the judgement the graph can't have — auth/authz, money,
   PII/PHI, migrations, external input parsing, crypto — and rank on both.

   Pass the ranked list to every reviewer in step 1a. **They should not spend context
   rediscovering structure the graph already knows.**

   If `rmad index` isn't installed, say so and rank by hand — but say so, because the
   review is weaker for it.
5. **Detect regulated data.** Grep for PHI/PCI/PII signals (patient/mrn/ssn/card/pan/iban/
   token/secret). If found — or if a `.planning/skill-config.yaml` names a regulated domain —
   Vera joins every cycle as a third reviewer.

Write `baseline.json`. Report the plan. Then start Cycle 1.

## Phase 1 — Review ↔ Fix cycles (the loop the whole command exists for)

Run up to `--cycles` (default 3) cycles. Each cycle is five steps, in order:

### 1a. Review — parallel, fresh, adversarial

Spawn in ONE message so they run concurrently:

| Subagent | Lens | Prompt them to hunt for |
|----------|------|------------------------|
| `rmad-quinn-quality` | Correctness & maintainability | Logic errors, unhandled errors/rejections, race conditions, resource leaks, off-by-one, null/undefined paths, missing test coverage on risky paths, dead branches, complexity hotspots |
| `rmad-kai-security` | Security | OWASP Top 10, injection, authz gaps, secrets, unsafe deserialization, SSRF, path traversal, weak crypto, dependency CVEs, data exposure in logs/errors |
| `rmad-vera-compliance` | Regulatory *(only if Phase 0 found regulated data)* | Unlogged access to sensitive data, missing retention/consent handling, PHI/PCI in logs or errors, missing audit trail |

Each reviewer gets: the scope, the risk rank, the stack fingerprint, and the repo's own
conventions. **Not** the ledger, not prior cycles. Tell each one explicitly: *"Cycle N of a
fresh-eyes review. Assume the code is broken in a way previous reviewers missed. Report only
what you can prove with file:line evidence and a concrete failure scenario."*

### 1b. Triage — you do this, in code, not by vibes

1. **Dedupe** against `ledger.json` by `(file, line±3, category)`. A finding already
   `rejected` with the same root cause is dropped silently — note the count only.
2. **Normalize severity** — the reviewers propose, you decide:
   - **CRITICAL** — exploitable security hole, data loss/corruption, or a break in the
     primary flow. Ship-blocking.
   - **HIGH** — wrong behavior on a realistic input, or a security weakness needing a
     precondition.
   - **MEDIUM** — wrong behavior on an edge case, missing coverage on risky code, real
     debt with a concrete cost.
   - **LOW** — style, naming, minor duplication, docs. Anything with no behavioral consequence.
   Downgrade anything whose "failure scenario" is hypothetical. A finding with no reachable
   caller is LOW at most — often nothing.
3. Append everything to the ledger with status `pending`.

### 1c. Verify — kill the false positives before spending a fix on them

For every CRITICAL/HIGH/MEDIUM, spawn a `rmad-quinn-quality` subagent **with a refuter's
brief**: *"Refute this finding. Trace the actual code path, check the callers, check for an
existing guard, run the test if one exists. Default to REFUTED if you cannot construct a
concrete reproduction. Return CONFIRMED only with the exact trigger."*

Spawn these concurrently — one per finding. Then:
- `CONFIRMED` → goes to the fix queue.
- `REFUTED` → ledger status `rejected` + the refutation reason. It stays dead for all
  later cycles.

This step is not optional and not a formality. On a typical run it removes a real fraction
of the review's output, and every false positive that survives here costs a fix, a
regression, and your credibility.

### 1d. Fix — one owner, minimal diffs

Skip entirely if `--no-fix`.

Dispatch CONFIRMED findings to `rmad-soren-fixer` — **serially by file** (two agents editing
one file is a lost afternoon), concurrently across independent files. Default fix policy:
CRITICAL + HIGH + MEDIUM; LOW only if the fix is trivial and local.

Each fix carries: the finding, the refuter's reproduction, and the rule *"minimal diff that
fixes the root cause; add or extend a test that fails before your fix and passes after; do
not touch anything else."*

A fix that can't be made in 3 attempts → revert, ledger status `unresolved`, move on. Say so
in the report.

### 1e. Regression gate — the step that makes the loop honest

Re-run tests + lint + typecheck. Compare to `baseline.json`:
- **Anything green before and red now is a regression.** Root-cause it, fix it, or revert the
  fix that caused it. A cycle NEVER ends red on something that was green at baseline.
- Record the fix set and the post-fix numbers in `cycle-<n>.md`.

### 1f. Convergence check

**CONVERGED when a cycle's verified findings are: 0 CRITICAL, 0 HIGH, 0 MEDIUM, and
≤ `--max-low` (default 3) LOW.** Stop early — do not burn cycle 3 to prove cycle 2 was right.

Stop conditions, in priority order:
| Condition | Action |
|-----------|--------|
| Converged | Exit Phase 1, go to Phase 2. Say which cycle converged. |
| Cycle N found MORE CRITICAL+HIGH than cycle N−1 | **STOP.** Fixes are making it worse. Escalate to the CTO with the delta — do not start another cycle. |
| Same finding class survives 3 cycles | STOP. It's structural, not a bug. Escalate with the pattern. |
| `--cycles` exhausted | Exit Phase 1 NOT converged. Report the residue honestly. |

After the last cycle, report the trend — `C/H/M/L` per cycle. **A flat or rising trend across
3 cycles means the loop isn't working, and that finding is more valuable than any individual
bug in the report.** Say it plainly.

## Phase 2 — Integration testing *(skip with `--skip integration`)*

Spawn `rmad-lena-integration`. Unit tests passing says the parts work; this phase asks whether
they work *together* — the seams the reviewers can't see by reading one file.

1. **Map the seams**: module→module contracts, DB/queue/cache boundaries, external API calls,
   auth flow end to end, config/env loading, migrations.
2. **Find the gaps**: which seams have NO integration test? Rank by blast radius.
3. **Write real tests** for the top gaps in the repo's existing framework and layout. Real
   collaborators or the repo's existing fixtures/containers — a test that mocks the seam it
   is supposed to be testing proves nothing and is worse than no test.
4. **Run them.** A test that has never failed is not a test — verify each new test fails
   against a deliberately broken version of the code before you count it.
5. Failures → findings (verify → fix → regression gate, same as Phase 1).

## Phase 3 — Blackbox testing *(skip with `--skip blackbox`)*

Spawn `rmad-tara-blackbox` — **no source access, by design**. Tara sees docs, API contracts,
CLI `--help`, the running app, and the tests she writes. This is not ceremony: every other
reviewer in this pipeline has read the implementation and is anchored by it. Tara is the only
one who can catch what the code does not say it does.

1. Derive expected behavior from README/API docs/OpenAPI/`--help` — the *contract*.
2. Exercise it from the outside: run the CLI, hit endpoints, drive the E2E suite if one exists.
3. Hunt: contract violations, undocumented behavior, error paths that leak internals or
   stack traces, missing input validation at the boundary, auth bypass at the edge.
4. If the app cannot be started or exercised, say so explicitly and report the phase as
   NOT RUN with the reason. **Never simulate a test run or narrate a result you didn't observe.**

## Phase 4 — Dead code check *(skip with `--skip deadcode`)*

Spawn `rmad-deadcode-hunter`. Start from `rmad index orphans` — reachability from real entry
points is already computed, and routes, decorated symbols, dunders and tests are excluded.
**Read it as a candidate list, never a verdict:** the graph deliberately refuses to link
calls it cannot type, so fan-in UNDER-reports — a symbol with zero callers may simply be
reached through DI, reflection, or a string-keyed registry. Cross-check `stats.resolution`
for how much the graph declined to assert.

Then apply the `dead-code-analysis` skill in full: prefer the ecosystem's tool
(knip/ts-prune/vulture/deadcode/cargo-udeps), grep every candidate as a plain string across
the whole repo including configs, and delete only the `certain` band.

Report in confidence bands and **delete only the `certain` band** — with the entry-point trace
that proves it unreachable. Everything dynamic (reflection, DI, string-keyed dispatch, plugin
registries, framework magic, public API surface of a library) is `suspected` at best and gets
reported, never deleted. Re-run the full suite after any deletion; deleting dead code is
supposed to be a no-op and if it isn't, it wasn't dead.

## Phase 5 — Report

Write `<outdir>/REVIEW-REPORT.md`. Lead with the verdict. Then:

```markdown
# RMAD Deep Review — <scope>
**Verdict:** CLEAN | CONVERGED WITH RESIDUE | NOT CONVERGED | ESCALATED
**Scope:** <what was reviewed> | **Baseline:** <green|red: n failures> | **Date:** <date>

## Convergence
| Cycle | CRIT | HIGH | MED | LOW | Fixed | Regressions | Verdict |
|-------|------|------|-----|-----|-------|-------------|---------|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
<one honest sentence on the trend — did the loop converge, stall, or diverge?>

## What was fixed
| # | Sev | File:line | Finding | Fix | Test proving it |
|---|-----|-----------|---------|-----|-----------------|

## What is still open
| # | Sev | File:line | Finding | Why not fixed |
|---|-----|-----------|---------|---------------|

## Phase results
| Phase | Result | Evidence |
|-------|--------|----------|
| Integration | <n gaps found, n tests added, n failures> or NOT RUN: <reason> | |
| Blackbox | <n contract violations> or NOT RUN: <reason> | |
| Dead code | <n certain / n suspected; n deleted> or NOT RUN: <reason> | |

## Rejected findings (n)
<one line each: finding → why it was refuted. This is the false-positive audit trail.>

## Deferred
<out-of-scope items found along the way — not fixed, deliberately>

## Recommended next
<the 1-3 things a human should actually do>
```

Then print a ≤10-line summary to the terminal: verdict, per-cycle trend, fix count,
regression count, open CRITICAL/HIGH, and the single most important thing to do next.

## Honesty rules — these outrank everything above

- A phase that didn't run is **NOT RUN with a reason** — never a silent omission.
- Report the tests you actually ran, with real numbers. Never claim a green suite you didn't
  execute or infer a result from a summary.
- If cycle 3 leaves CRITICALs open, the verdict is **NOT CONVERGED**. Say it in the first
  line. A review that reports a clean bill of health it didn't earn is worse than no review —
  it converts an unknown risk into a false assurance.
- If you fixed something you couldn't test, mark it `UNVERIFIED` in the report.

$ARGUMENTS
