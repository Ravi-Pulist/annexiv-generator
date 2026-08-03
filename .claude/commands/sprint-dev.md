---
description: "Execute a sprint story with architect-first planning — Winston plans, engineers execute"
---

You are executing a sprint story using the Architect → Execute pattern for optimal token efficiency.

## Arguments
$ARGUMENTS should be a story ID (e.g., `S1-001`) or description of work to implement.

## Phase A: Architecture Planning (Winston's Role)

### Step 1: Load Context
1. Read `.planning/STATE.md` for current sprint and phase
2. Find the story file in `.planning/sprints/sprint-{N}/stories/` matching the story ID
3. Read the story's acceptance criteria, file list, and dependencies
4. Read `.planning/architecture/` for relevant ADRs and design documents
5. If a repo map exists (`.planning/repo-map.md`), load the relevant sections

### Step 2: Create Implementation Plan
As Winston (architect perspective), produce `.planning/sprints/sprint-{N}/plans/{story-id}-implementation-plan.md`:

```markdown
---
artifact: implementation-plan
story: "{story-id}"
producer: winston-architect
status: draft
created: "{timestamp}"
---

# Implementation Plan: {story-id}

## Story Summary
> {one-paragraph summary of what needs to be built}

## Architecture Context
> {relevant ADRs, design constraints, patterns to follow}

## Implementation Steps
### Step 1: {description}
- **File:** {path}
- **Action:** create | modify | delete
- **Details:** {what to implement/change}
- **Patterns:** {design patterns to use}
- **Tests:** {what tests to write first — TDD}

### Step 2: {description}
...

## File Change Map
| File | Action | Agent | Description |
|------|--------|-------|-------------|
| {path} | {create/modify} | {soren/milo/lena/anya/ravi} | {brief description} |

## Integration Points
- {what needs to connect to what}

## Test Strategy
### Unit Tests (write first)
- {test1}
- {test2}

### Integration Tests
- {test1}

## Acceptance Verification
| Criterion | How to Verify |
|-----------|--------------|
| {from story} | {specific check} |

## Risks
- {risk1}: {mitigation}
```

### Step 3: Review Plan
Present the implementation plan to the CTO for review. Wait for approval before proceeding.

## Phase B: Execution (Engineering Agents' Role)

### Step 4: Execute by Steps
Follow the implementation plan step by step:
1. For each step in the plan, execute as the appropriate engineering agent
2. Follow TDD — write tests FIRST, then implement
3. After each step, run related tests via Bash to verify
4. Check off completed steps

### Step 5: Integration Verification
After all steps complete:
1. Run the full test suite
2. Verify each acceptance criterion from the story
3. Update the story status to REVIEW

### Step 6: Report
```
## Sprint Dev: {story-id} Complete

**Plan:** .planning/sprints/sprint-{N}/plans/{story-id}-implementation-plan.md
**Status:** {COMPLETE | PARTIAL}

### Steps Completed
- [x] Step 1: {description}
- [x] Step 2: {description}
- [ ] Step 3: {description} (if incomplete)

### Test Results
- Unit: {passed}/{total}
- Integration: {passed}/{total}

### Files Modified
- {file1}: {what changed}
- {file2}: {what changed}

### Acceptance Criteria
| Criterion | Status |
|-----------|--------|
| {criterion} | {PASS/FAIL} |
```

Update `.planning/STATE.md` to reflect story completion status.

$ARGUMENTS
