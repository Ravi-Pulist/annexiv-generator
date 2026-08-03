---
name: "financial-messaging"
description: "SWIFT MT/MX, ISO 20022, FIX protocol, ACH/NACHA file formats"
tier: domain
domain: "fintech"
version: "1.0.0"
relevance_keywords:
  - swift
  - iso-20022
  - fix
  - ach
  - nacha
  - mt103
---

# Financial Messaging Standards

## When to Activate
- When working on fintech projects that involve interbank messaging, payment file formats, or trading protocols
- When implementing SWIFT message handling, ISO 20022 migration, ACH/NACHA file generation, or FIX protocol integration

## Core Principles
### 1. Schema Validation Before Transmission
Every outbound financial message must be validated against its schema (SWIFT MT format rules, ISO 20022 XSD, NACHA file specs) before transmission. Invalid messages cause payment failures, reconciliation breaks, and potential regulatory issues.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Transmitting financial messages without schema validation or ignoring validation errors
