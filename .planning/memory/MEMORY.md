# Project Memory Index

> One line per topic file — a map, not the territory. This index is injected at
> session start; topic files load just-in-time when their line matches the task.
> Keep under 50 lines. Garden with /memory-gc.
>
> Memory is one of four planes — file the right thing in the right place:
> CLAUDE.md = instructions (normative, "always do X") | STATE.md = position (now)
> memory/ = durable facts (descriptive, with evidence) | learning/ = behavioral patterns (earn trust via /learn-review)
>
> Entry format inside topic files — one fact per bullet:
> `- {fact}. Evidence: {file/commit/date}. (added {YYYY-MM-DD})`
> Save only what is durable, not derivable from the repo in under a minute, and
> cost real time to learn: corrections, decisions + rationale, >15-minute surprises,
> third occurrences. Never save: session narrative, greppable facts, secrets,
> anything that belongs in STATE.md or CLAUDE.md. Contradiction rule: never add a
> fact that conflicts with an existing one — update it or mark `superseded-by:`.

<!-- Topic lines go below, e.g.:
- [decisions.md](decisions.md) — architecture/tooling decisions with rationale; check before proposing changes
- [gotchas.md](gotchas.md) — environment quirks and traps that cost >15 minutes
- [integrations.md](integrations.md) — external-system facts (auth quirks, rate limits, vendor specifics)
-->
