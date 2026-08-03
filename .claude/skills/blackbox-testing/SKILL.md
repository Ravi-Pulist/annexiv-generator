---
name: "blackbox-testing"
description: "Black box testing — E2E, API testing, UAT, exploratory testing without source access"
tier: engineering
version: "1.0.0"
---

# Black Box Testing

## When to Activate
- When testing system behavior from the outside

## Core Principles
### 1. Test the Contract
Validate inputs produce expected outputs. No internal assumptions.

### 2. Coverage
Happy path, error paths, boundary values, edge cases, concurrency.

### 3. Reports
PASS/FAIL with counts. Reproduction steps. Environment details.

## Red Flags
- Tests requiring source knowledge
- Missing error path coverage
