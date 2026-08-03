---
name: "code-review"
description: "Code review methodology — finding categories, verdicts, constructive feedback"
tier: engineering
version: "1.0.0"
---

# Code Review

## When to Activate
- When reviewing code changes

## Core Principles
### 1. Verdicts
APPROVED / CHANGES_REQUESTED / BLOCKED

### 2. Categories
CRITICAL > MAJOR > MINOR > SUGGESTION. Provide line references and fix suggestions.

### 3. Feedback
Explain WHY not just WHAT. Acknowledge good patterns.

## Red Flags
- Missing tests for new functionality
- Unhandled error paths
- Breaking API changes without version bump
