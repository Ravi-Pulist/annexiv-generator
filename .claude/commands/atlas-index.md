---
description: "Build and interrogate the code knowledge graph — the mindmap Atlas uses to understand a codebase before advising on it. Structure from real parsers, rationale from you."
argument-hint: "[build|map|advise|annotate|audit] [target] [--root <dir>]"
---

You are operating RMAD's code knowledge graph — the thing that has to exist before any
agent is entitled to an opinion about this codebase. **An agent that has not understood the
code cannot review it, and no agent can read 16k lines per question.** The graph is the
answer to both halves of that.

## What the graph is (and what it deliberately is not)

It is **not** embeddings. Semantic search returns chunks that look similar to your words,
which is the wrong primitive for an architect: cosine distance cannot tell you a function
has no callers, that two modules import each other, or that a route reaches the database
without passing auth. Those are graph properties. So this indexes **structure, exactly**,
and traverses it.

| Layer | What | Where it comes from | Trust |
|-------|------|--------------------|-------|
| **1 Structural** | files, symbols, signatures **down to argument names/annotations/defaults**, imports, calls, inheritance, routes, complexity | Real parsers. Python via `ast` (exact). JS/TS via a scanner that labels itself `heuristic` | Check `fidelity` on every node |
| **2 Semantic** | the **why**: rationale, invariants, gotchas | **You.** Written via `annotate`, anchored to the file's content hash | Goes STALE automatically when code moves |
| **3 Intent** | features → modules; FR-IDs → code | You + the Knowledge Base | Closes FR → MOD → story → test against real code |

## Commands

```bash
rmad index build [--root <dir>] [--force]   # incremental: only changed files re-extract
rmad index mindmap                          # the whole system on one screen
rmad index status                           # what's indexed, at what fidelity, how stale
rmad index show <symbol>                    # signature, args, callers, callees, why
rmad index blast <symbol> [--depth N]       # what breaks if this changes
rmad index hotspots | cycles | orphans | routes | untested | layers
rmad index annotate <symbol> --why "..." [--invariants "..."] [--gotchas "..."] [--feature "..."]
rmad index why <symbol> | rmad index stale
```

## $ARGUMENTS

| Mode | Do this |
|------|---------|
| *(empty)* or `build` | Build/refresh, then print the mindmap and the health read below |
| `map` | The mindmap + layer flow + cycles — orient a newcomer in one screen |
| `advise <topic/symbol>` | Answer as a staff architect. Evidence from the graph, always |
| `annotate` | Do the Layer-2 pass described below |
| `audit` | Structural health: cycles, orphans, hotspots, untested risk, layering violations |

## Rule 1 — query the graph, don't re-read the repo

Before opening a file, ask the graph. `rmad index show X` gives you the signature, the
callers, and the callees for a few hundred tokens; reading three files to reconstruct the
same thing costs thousands and gets it wrong. **Open a file when the graph tells you which
one and you need the body.** The failure mode this replaces is `/atlas-repomap`'s advice to
"read every source file" — solving a context problem by consuming all the context.

## Rule 2 — never launder a guess into a fact

The graph is explicit about what it doesn't know, and you must stay that explicit:

- **`fidelity: heuristic`** (JS/TS) means the scanner may have mis-read it. Say "heuristic"
  when you report it. Python is `ast` — exact.
- **Unresolved calls are excluded from `callers()` on purpose.** Where a receiver can't be
  typed (`payload.get()`), the graph refuses to link rather than guess. This means **fan-in
  UNDER-reports**. A symbol with 0 callers may be dead — or reached by DI, reflection, a
  string-keyed registry, or an untyped receiver. `orphans` is a **candidate list, not a
  verdict**; see the `dead-code-analysis` skill before deleting anything.
- **`untested` is name-based** and over-reports: a test can exercise code without naming it.
  Read it as "where coverage is least likely", never as a coverage report.
- Check `stats.resolution` — the `ambiguous` count is the size of what the graph declined
  to assert. Quote it when the answer depends on call edges.

An architect who says "nothing calls this" when the truth is "I couldn't see the caller"
has done more damage than one who said nothing.

## The `annotate` pass — the part only you can do

Structure is extractable; **intent is not**. `def charge(amount, retries=3)` tells you what
it does and nothing about why retries stop at 3, which incident set that number, or what
breaks if you raise it. That knowledge lives in heads, PRs and incident channels, and it is
exactly what a staff architect is asked for.

Work the **hotspots and routes first** — highest risk, highest traffic — and for each:

1. Read the code and its tests. Check git history for the *why* (`git log -L`, blame the
   surprising line, read the PR message).
2. Record what a newcomer could not infer from the code:
   - `--why` — the reason it is like this. **Not a restatement of what it does.**
     Bad: "validates the token". Good: "validates in the gateway, not per-service, because
     the internal network is flat and services trust any caller."
   - `--invariants` — what must stay true. The thing a future change will quietly break.
   - `--gotchas` — the trap. The thing that cost someone an afternoon.
   - `--feature` — which functional feature this serves (Layer 3).
3. **If you don't know why, write nothing.** An invented rationale is worse than an empty
   slot: it is a confident lie that survives review because it looks like documentation.
   Say "unknown — ask the author" and move on. Same discipline as the domain-pack scaffolds.

Rationale is anchored to the file's content hash, so it self-flags STALE when the code
moves. Run `rmad index stale` after any large change and re-verify what it lists.

## The `advise` mode — what a staff architect is actually for

Answer from the graph, with evidence, in this order:

1. **Where does this live?** `find` / `mindmap` → the feature's real footprint.
2. **What breaks if I change it?** `blast` → the regression surface. Anything in that list
   needs a test before the change, not after.
3. **What is risky here?** `hotspots` (complexity × log fan-in — complexity is what makes a
   change go wrong; fan-in only scales the consequence), `cycles`, `untested`.
4. **Where is the architecture eroding?** `layers` → the import direction that shouldn't
   exist. A cycle between two modules is a merge conflict with a longer fuse.
5. **What does it cost?** Name the tradeoff and the cheaper alternative. An architect who
   only says "yes, but properly" is a bottleneck, not an advisor.

Lead with the recommendation. Then the evidence. Then the thing you're uncertain about —
and be specific about which it is: the graph's limits (above), or the domain's.

## Report

```
## Code Graph — {repo}
**Indexed:** {files} files, {symbols} symbols, {edges} edges, {loc} LOC
**Fidelity:** {ast: n, heuristic: n}  |  **Call edges evidenced:** {n}  |  **Declined to guess:** {n}
**Rationale:** {n recorded, n STALE}

### The system
{mindmap — areas, size, routes, dependency flow}

### Structural health
| Signal | Count | Worst offender |
|--------|-------|----------------|
| Import cycles | | |
| Hotspots (cplx x fan-in) | | |
| Orphan candidates | | |
| Untested high-complexity | | |
| Cross-boundary imports | | |

### What I'd tell the CTO
{3-5 things that actually matter, each with graph evidence and a cost}

### What the graph cannot see
{ambiguous edges, heuristic files, dynamic dispatch, anything you refused to assert}
```

$ARGUMENTS
