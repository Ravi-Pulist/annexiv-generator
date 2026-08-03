---
name: "hipaa-technical-safeguards"
description: "HIPAA 164.312 technical safeguards — access control, audit, integrity, transmission"
tier: domain
domain: "healthcare"
version: "1.0.0"
relevance_keywords:
  - hipaa
  - safeguard
  - encryption
  - audit
  - access-control
---

# HIPAA Technical Safeguards

## When to Activate
- When working on healthcare projects that involve PHI storage, access control, audit logging, or transmission security
- When designing or reviewing infrastructure that must comply with HIPAA 164.312 requirements

## Core Principles
### 1. Defense in Depth
No single safeguard is sufficient. Layer access controls, encryption, audit logging, and integrity checks so that a failure in one control does not expose PHI. Every layer must independently enforce the minimum necessary principle.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Storing PHI without encryption at rest or transmitting PHI over unencrypted channels
