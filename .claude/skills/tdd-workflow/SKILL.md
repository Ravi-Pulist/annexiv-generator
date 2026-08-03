---
name: "tdd-workflow"
description: "Test-driven development — red-green-refactor cycle, test design, coverage strategies"
tier: engineering
version: "1.0.0"
---

# TDD Workflow

## When to Activate
- Before writing any implementation code
- When implementing new features, fixing bugs, or refactoring

## Core Principles
### 1. Red-Green-Refactor
Write a failing test first (red). Write minimal code to pass (green). Improve without changing behavior (refactor).

### 2. Test Design
Unit tests: isolated, fast, one assertion per concept. Integration tests: verify component interactions.

### 3. Coverage Strategy
Aim for >= 80% on new code. Cover happy path, error cases, edge cases. Test behavior, not implementation.

## Red Flags
- Writing implementation before tests
- Tests that test implementation details
- Disabled or skipped tests without reason
