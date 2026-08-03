---
name: "testing-standards"
description: "Testing standards — test pyramid, coverage thresholds, test quality, CI integration"
tier: engineering
version: "1.0.0"
---

# Testing Standards

## When to Activate
- When reviewing test quality and coverage

## Core Principles
### 1. Test Pyramid
Many unit, fewer integration, minimal E2E.

### 2. Coverage
New code >= 80%. Critical paths: 100% branch.

### 3. Quality
Deterministic. Independent. Fast.

## Red Flags
- Flaky tests
- Coverage below thresholds
