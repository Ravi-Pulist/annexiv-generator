---
description: "Garden the project memory — verify entries against the repo, prune dead pointers, merge duplicates, refresh the index"
---

You are gardening `.planning/memory/`. Memory earns its keep only while it's true — this command re-validates it against reality.

## Process
1. **Read `MEMORY.md`** (the index) and every topic file it references.
2. **Verify each entry against the repo:**
   - Evidence pointer (file, symbol, commit) still exists? If the file moved, fix the pointer. If the fact no longer holds, the entry is dead.
   - Decision entries: still in force? If overturned, mark `superseded-by:` with a pointer to the newer decision — keep one line of history, don't silently delete (git holds the full archaeology).
   - Greppable-in-a-minute facts that snuck in: delete — memory is for what the repo can't tell you quickly.
3. **Merge duplicates and contradictions.** Two entries on the same fact become one (newest evidence wins, contradiction noted). Never leave both.
4. **Right-size the index.** MEMORY.md stays under ~50 lines: one line per topic file with a hook that says when to open it. Index lines for topics that no longer exist get removed.
5. **Check the four planes** — move misfiled content:
   - Normative "always do X" → belongs in CLAUDE.md (flag for CTO, don't move silently)
   - Current position/next steps → belongs in STATE.md
   - Behavioral pattern with occurrence counts → belongs in the learning system (`/learn-review`)
   - Memory keeps: durable project FACTS with evidence (decisions + rationale, gotchas, environment quirks)

## Report
```
## Memory GC

| Action | Count | Detail |
|--------|-------|--------|
| Verified intact | {n} | |
| Pointers fixed | {n} | {old → new} |
| Superseded | {n} | {which} |
| Deleted | {n} | {which + why} |
| Merged | {n} | |
| Misfiled (flagged) | {n} | {where they belong} |

Index: {n} lines | Topic files: {n}
```

Run this at stage transitions and whenever the index feels untrustworthy. Wrong memory is worse than no memory.

$ARGUMENTS
