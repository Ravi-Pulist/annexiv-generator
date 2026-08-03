---
name: "dead-code-analysis"
description: "Dead code analysis — reachability from real entry points, confidence bands, dynamic-reference traps, safe deletion protocol"
tier: engineering
version: "1.0.0"
---

# Dead Code Analysis

## When to Activate
- Phase 4 of `/rmad-review`, or a `/stage-harden` iteration
- Before a refactor, to know what you're allowed to ignore
- When a codebase has grown faster than anyone can hold in their head

## The core asymmetry

Reporting live code as dead is a **bug you introduce at 3am on a Saturday**. Missing some
dead code costs a little disk and a little confusion. These errors are not symmetric, and
this skill is built around that: **never delete anything you cannot prove unreachable.**

## Method

### 1. Find the REAL entry points — everything depends on this
An entry point is anything invoked from outside the code's own call graph. Miss one and
everything it reaches looks dead:

- `main`/`index`, CLI commands, `bin` in package.json
- HTTP routes, RPC/GraphQL resolvers, event/queue consumers, cron and scheduled jobs
- Framework lifecycle hooks (`componentDidMount`, `on_startup`, Django signals, Spring beans)
- Test files (they are entry points to the code under test — but see §4)
- Build/tooling config referenced by string (webpack loaders, babel plugins, ESLint rules)
- **A library's public API surface** — every export in the published entry is an entry point.
  Analyzing a library as if it were an app marks its entire reason for existing as dead.
- Anything in `package.json#exports`, `__init__.py`, `mod.rs`, `*.d.ts`

### 2. Prefer the ecosystem's tool over your own reasoning
The tools have solved the boring 90% and won't get bored on file 400:

| Ecosystem | Tools |
|-----------|-------|
| JS/TS | `knip` (best coverage: files + exports + deps), `ts-prune`, `depcheck`, `eslint no-unused-vars` |
| Python | `vulture`, `deadcode`, `ruff F401/F841`, `coverage` on the full suite |
| Go | `deadcode` (official), `staticcheck U1000`, `go vet` |
| Rust | `cargo-udeps`, `#[warn(dead_code)]` |
| Java/Kotlin | IntelliJ inspections, `unused-code` detekt rule |
| Any | Coverage from a full test+E2E run — as a *hint*, never as proof |

Run the tool, then **verify its output yourself**. Tools are systematically wrong about §3.

### 3. The dynamic-reference traps — where reachability analysis lies
Static analysis follows imports. These do not use imports, and every one of them is a
production incident waiting in a "safe" deletion:

- **String dispatch** — `handlers[type]()`, `getattr(obj, name)`, `Class.forName(s)`
- **Reflection / DI containers** — Spring, NestJS, `@inject`, annotation scanning
- **Plugin & registry patterns** — decorator-registered handlers, `entry_points`, auto-discovery globs
- **Serialization targets** — classes constructed only by a JSON/ORM/protobuf deserializer
- **Framework magic** — Rails/Django conventions, Next.js file routing, `__all__`, dunder methods
- **Config-referenced code** — a class named in a YAML/env value
- **Cross-language callers** — FFI, a Python worker calling a Go binary, SQL calling a UDF
- **The dead test** — a test nobody runs (excluded by config) makes its subject look live

Before calling anything dead, **grep for its name as a plain string across the whole repo
including configs, templates, and non-source files.** A hit means it stays.

### 4. Test-only code is a distinct category, not dead code
Code reachable *only* from tests is either (a) genuinely dead production code kept alive by
a test that should be deleted with it, or (b) a test helper. Report it as its own band and
let a human choose. Deleting the code and keeping the test breaks the build; deleting both
is right for (a) and destroys the harness for (b). Never guess.

## Confidence bands — report all three, delete only the first

| Band | Meaning | Bar to clear | Action |
|------|---------|--------------|--------|
| **certain** | Statically unreachable from every entry point, no string hit anywhere, not exported, not a framework convention | All four checks pass, traced by hand | Safe to delete with the trace attached |
| **suspected** | Looks unreachable, but touches §3 — dynamic, exported, or framework-adjacent | Static analysis says dead, one trap applies | **Report only.** Never auto-delete |
| **stale** | Reachable but no longer meaningful — feature-flagged off permanently, `if (false)`, superseded duplicate, commented-out block | Judgment | Report with the evidence and let a human decide |

## Deletion protocol
1. Delete only `certain`, one logical group per commit.
2. Attach the trace: "no import, no string reference, not exported, not reachable from
   entry points E1..En" — the proof, not the assertion.
3. **Re-run the full suite.** Deleting dead code is a no-op. If anything changes, it was not
   dead — revert and reclassify. This step catches the trap you missed.
4. Delete the code's tests, docs, and now-orphaned dependencies with it — half-deleted code
   is worse than dead code.
5. `git rm` beats commenting out. Version control is the archive; commented-out code is a
   distraction with a half-life measured in years.

## Report format
```
## Dead Code Analysis
**Scanned:** {n files} | **Tool:** {tool or "manual reachability"} | **Entry points:** {n}

| Band | Item | Location | Evidence | Action |
|------|------|----------|----------|--------|
| certain | {symbol/file} | {path:line} | no refs; unreachable from {entries} | deleted in {commit} |
| suspected | {symbol} | {path:line} | DI-constructed — {trap} | reported |
| stale | {symbol} | {path:line} | behind flag off since {date} | reported |

**Deleted:** {n} items, {n} LOC | **Suite after deletion:** {pass}/{total} (must equal baseline)
**Entry points used:** {list — the analysis is only as good as this list}
```

## Red Flags
- A dead-code report with no entry-point list — unverifiable by definition
- Deleting a public export from a library "because nothing calls it internally"
- A `certain` verdict on anything named in a config file or reachable by string
- Deleting code because coverage says 0% — coverage measures the tests you ran, not reachability
- A deletion commit that also "cleans up while we're here" — now the no-op check is worthless
