---
name: "system-architecture"
description: "System architecture — component design, ADRs, trade-off analysis, technology selection"
tier: engineering
version: "1.0.0"
---

# System Architecture

## When to Activate
- When designing system components
- When making technology decisions

## Core Principles
### 1. ADRs
Every non-trivial decision: context, decision, consequences, alternatives.

### 2. Component Design
Clear boundaries. Single responsibility. One-directional dependencies.

### 3. Trade-Offs
Explicit. Consider performance, scalability, maintainability, cost, familiarity.

## Red Flags
- Undocumented decisions
- Circular dependencies
- Technology chosen without evaluating alternatives
