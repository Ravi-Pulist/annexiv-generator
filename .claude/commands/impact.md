---
description: "Before you change it, find out what guards it — impacted tests, blast radius, and what the graph could not see"
argument-hint: "[symbol|path] [--diff <base>] [--staged] [--depth N]"
---

Run this **before** editing, not after. It answers three questions an agent otherwise
guesses at:

1. **What did I actually change?** — changed symbols, from diff line ranges, not whole files
2. **What guards it?** — the tests with an evidenced call path into that code
3. **What can't I see?** — the call edges the graph refused to assert

This works in any repository. It needs no coverage run, no instrumentation and no prior
setup beyond an index.

## Why this command exists

Handing an agent a code-to-test map before it edits cut regressions from **6.08% to 1.82%**
on SWE-bench Verified and raised issue resolution from **24% to 32%**. Handing it TDD
*instructions* without that map pushed regressions to **9.94%** — worse than saying nothing.

The lesson is not "test more". It is that **context beats procedure**: an agent that knows
which four tests cover the function it is about to touch behaves better than one told to
follow a discipline in the abstract. This command is that context.

## Use

```bash
rmad index build --root .                 # once, then incremental

rmad index impact --diff main             # the working branch vs main
rmad index impact --staged                # what is about to be committed
rmad index impact TokenStore.verify       # a specific symbol
rmad index impact src/auth/token.ts       # everything in a file
rmad index impact --diff main --json      # for scripting
```

In a foreign repo, point it: `rmad index impact --root ../their-app --diff main`.
The index lands in `.rmad/` there, not `.planning/` — the toolkit does not leave a
footprint it was not asked to leave.

## How to read the output

| Field | Meaning |
|---|---|
| `changed` | Symbols whose **line span** intersects a changed hunk. Not every symbol in a touched file — a one-line fix should not select the whole module |
| `tests` | Test symbols and files with an evidenced path to the changed code, heaviest first |
| `weight` | Closer paths weigh more; reaching several changed symbols weighs more; a complex target weighs double |
| `ambiguousExcluded` | **The important one.** Call edges around the changed code the resolver declined to link |
| `unindexed` | Changed files with no extractor — they contributed *nothing* to this analysis |

## The caveat that must survive into your report

> **This is a floor, not a complete set.**

The graph refuses to link a call whose receiver it cannot type, so fan-in under-reports by
design — that refusal is what stops one method accumulating hundreds of fabricated callers,
and the price is that some real callers are missing. Coverage that happens through fixtures,
dependency injection, reflection or string-keyed dispatch is invisible to a call graph
entirely.

So: **run the impacted set first for fast feedback, then run the full suite before declaring
anything done.** If `ambiguousExcluded` is large relative to the change, say so — a short
list read as a complete one is how impact analysis stops being safe.

If `unindexed` is non-empty, name those files. A change the analysis could not see is not
the same as a change with no impact.

## What to do with it

- **Before editing** — read the guarding tests. They are the specification of the behaviour
  you are about to modify.
- **While editing** — run only the impacted set. Seconds, not minutes.
- **Before finishing** — run everything, because of the caveat above.
- **If nothing is impacted** — that is a finding, not a green light. Either the code is
  genuinely untested (check `rmad index untested`), or the coverage is invisible to the
  graph. Decide which before proceeding.

$ARGUMENTS
