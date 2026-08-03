---
description: "List available checkpoints for session recovery"
---

List all saved checkpoints from `.planning/checkpoints/`.

## Instructions

1. Read all `.md` files in `.planning/checkpoints/`
2. For each checkpoint, extract the YAML frontmatter fields: checkpoint_id, timestamp, agent, phase, story, reason
3. Display as a table sorted by timestamp (most recent first):

```
## Available Checkpoints

| # | Checkpoint ID | Date | Agent | Phase | Story | Reason |
|---|--------------|------|-------|-------|-------|--------|
| 1 | {id} | {date} | {agent} | {phase} | {story} | {reason} |
```

4. Suggest: "Use `/resume {checkpoint-id}` to restore from a checkpoint."

$ARGUMENTS
