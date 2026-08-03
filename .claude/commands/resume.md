---
description: "Resume work from a saved checkpoint after context compaction"
---

You are resuming from a saved checkpoint. Follow these steps to restore context and continue work.

## Instructions

### Step 1: Load Checkpoint
1. If $ARGUMENTS is provided, read `.planning/checkpoints/$ARGUMENTS.md`
2. If no argument, find the most recent checkpoint:
   - Read `.planning/STATE.md` for the "Last checkpoint" reference
   - OR list files in `.planning/checkpoints/` and use the most recent (by filename sort)

### Step 2: Restore Context
From the checkpoint, extract and internalize:
- **Who you are:** The agent name from the checkpoint
- **What phase you're in:** Current phase
- **What story you're working on:** Active story ID
- **What task was in progress:** The specific task
- **What was being done:** The working-on description
- **What files were modified:** Re-read these files to understand current state

### Step 3: Verify State
1. Read `.planning/STATE.md` for current project state
2. Read the active story file (if any) for remaining tasks
3. Check if the files listed in "Files Modified" reflect the expected state
4. Identify what work remains from where the checkpoint was saved

### Step 4: Report and Continue
Report to the CTO:

```
## Session Resumed from Checkpoint

**Checkpoint:** {id}
**Saved:** {timestamp}
**Agent:** {agent}
**Phase:** {phase}
**Story:** {story}
**Was working on:** {description}

### Files reviewed:
- {file1} — {brief status}
- {file2} — {brief status}

### Remaining work:
- {task1}
- {task2}

### Ready to continue. What would you like me to focus on?
```

Wait for CTO direction before proceeding with any work.

$ARGUMENTS
