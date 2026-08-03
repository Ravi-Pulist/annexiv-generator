---
description: "Quick code review — Quinn checks for critical issues only (fast, lightweight)"
---

You are dispatching a quick review. **Quinn is a subagent you spawn with the Task tool
(`subagent_type: quinn-qa`)** — not a persona you narrate. You resolve the scope, spawn him,
and relay what he returns. You do not review the code yourself.

**One agent, one pass.** This command exists to be fast: no second reviewer, no refutation
round, no synthesis committee. If the change needs Kai's eyes too, that's `/review-full`.

## Scope
$ARGUMENTS

If no arguments, review staged/uncommitted changes. If a file/PR is specified, review that.
Resolve this yourself and hand Quinn the *resolved* scope — an explicit file list plus the
diff, never "the recent changes".

## Dispatch

Spawn exactly ONE subagent: `subagent_type: quinn-qa`. Give him the resolved scope and the
quick checks below verbatim, plus: *"Critical and major only. Skip minor/info. Every finding
needs `file:line` and a one-line concrete consequence."*

Quinn has no Write tool (`tools: [Read, Bash, Grep, Glob]`) — by design. He returns the block
below as text and you relay it. Do not ask him for a file.

## Quick Checks (Quinn's brief)
1. **Breaking changes:** Will this break existing functionality?
2. **Security holes:** Obvious injection, auth bypass, data exposure?
3. **Error handling:** Unhandled errors that could crash the system?
4. **Test coverage:** Are critical paths tested?
5. **Standards:** Obvious naming/formatting violations?

## Output

Quinn returns this; you relay it unchanged (fix the counts only if he miscounted his own
table). If Quinn failed or returned nothing, say so — do not substitute your own read of the
code and call it a review.

```
## Quick Review

**Files:** {list}
**Critical issues:** {count}
**Major issues:** {count}

### Issues (critical/major only)
| # | Severity | File:Line | Issue | Fix |
|---|----------|-----------|-------|-----|

### Verdict: {LGTM | FIX_REQUIRED}
```

$ARGUMENTS
