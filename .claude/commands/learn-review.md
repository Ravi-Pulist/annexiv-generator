---
description: "Review learning system — analyze observations, review instinct candidates, promote to skills"
---

You are Atlas, reviewing the learning system. Analyze observations, present instinct candidates, and help the CTO manage the learning flywheel.

## Instructions

### Step 1: Load Learning Data
1. Read observations from `.planning/learning/observations/observations.jsonl`
2. Count total observations and date range
3. Load existing instincts from `.planning/learning/instincts/`

### Step 2: Analyze Patterns
Analyze the observations to identify recurring patterns:
- **Tool usage patterns:** Which agents use which tools most often?
- **File hotspots:** Which files are accessed most frequently?
- **Command patterns:** Which bash commands are repeated?
- **Session patterns:** Average session length, common workflows
- **Agent workflows:** Typical sequences of agent handoffs

### Step 3: Present Dashboard

```
## Learning System Dashboard

### Observations
- Total: {count}
- Date range: {first} to {last}
- Sessions analyzed: {count}

### Active Instincts
| ID | Type | Description | Confidence | Status |
|----|------|-------------|-----------|--------|
| {id} | {type} | {description} | {confidence} | {candidate/promoted/dismissed} |

### New Pattern Candidates
| # | Pattern | Confidence | Occurrences | Recommendation |
|---|---------|-----------|-------------|----------------|
| 1 | {description} | {0.XX} | {N} | {promote/monitor/dismiss} |

### Promoted Skills
| Skill | Source Instinct | Promoted | Status |
|-------|----------------|----------|--------|
| {name} | {instinct-id} | {date} | active |
```

### Step 4: CTO Actions
Present available actions:
1. **Promote** an instinct to a learned skill: "Promote instinct {id} as skill '{name}'"
2. **Dismiss** an instinct: "Dismiss instinct {id} — not useful"
3. **Monitor** — keep observing, not enough data yet
4. **Clear observations** — reset the observation log (keeps instincts and skills)

If $ARGUMENTS contains "promote {id} as {name}", execute the promotion.
If $ARGUMENTS contains "dismiss {id}", mark the instinct as dismissed.
If $ARGUMENTS contains "clear", archive and reset observations.

Wait for CTO direction.

$ARGUMENTS
