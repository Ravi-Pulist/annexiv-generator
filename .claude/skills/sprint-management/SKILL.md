---
name: "sprint-management"
description: "Sprint management — planning, story lifecycle, velocity tracking, dependency tracking, retrospectives"
tier: engineering
version: "1.1.0"
---

# Sprint Management

## When to Activate
- When planning sprints or managing story lifecycle
- When assigning stories to agents or planning waves
- When stories are blocked or dependencies change

## Core Principles
### 1. Story Format
Title, acceptance criteria, file list, complexity, assigned agent, wave, dependencies.
Each story MUST include a `## Dependencies` section listing story IDs it depends on.

### 2. Lifecycle
TODO → IN_PROGRESS → REVIEW → DONE (or BLOCKED).
When a story is BLOCKED, record the blocking story ID and reason.

### 3. Wave Planning
Group by dependency. Maximize parallelism within waves.
Use `/sprint-deps` to visualize and optimize wave ordering.

### 4. Dependency Tracking
- Every story lists its dependencies explicitly
- Before starting a story, verify all dependencies are DONE
- When a story completes, check if it unblocks other stories
- Run `/sprint-deps` after status changes to update the wave plan

### 5. Cross-Story Awareness
- Stories that modify the same files should not run in parallel
- Integration stories (Lena) typically depend on backend (Soren) and data (Anya)
- E2E testing stories (Tara) depend on all implementation stories
- DevOps stories (Ravi) can often run in parallel with development

## Red Flags
- Stories without acceptance criteria
- Overcommitted capacity
- Circular dependencies between stories
- Stories started before their dependencies are DONE
- Missing dependency declarations on stories that clearly depend on others
- Parallel stories modifying the same files
