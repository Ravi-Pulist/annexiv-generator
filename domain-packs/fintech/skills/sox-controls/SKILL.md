---
name: "sox-controls"
description: "Internal controls, audit trails, segregation of duties, financial reporting"
tier: domain
domain: "fintech"
version: "1.0.0"
relevance_keywords:
  - sox
  - internal-controls
  - audit-trail
  - segregation
---

# SOX Controls

## When to Activate
- When working on fintech projects that involve internal controls over financial reporting, audit trail design, or segregation of duties
- When building systems that generate or process data used in financial statements

## Core Principles
### 1. Immutable Audit Trails
Financial transaction records must be append-only and tamper-evident. No user or system process should be able to modify or delete historical transaction records. Audit trails must capture who did what, when, and why — with enough detail to reconstruct any transaction.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Allowing UPDATE or DELETE operations on financial transaction records instead of using correction entries
