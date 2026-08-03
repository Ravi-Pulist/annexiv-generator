---
name: "phi-deidentification"
description: "Safe Harbor method, Expert Determination, de-identification for research"
tier: domain
domain: "healthcare"
version: "1.0.0"
relevance_keywords:
  - de-identification
  - deidentify
  - safe-harbor
  - anonymize
---

# PHI De-Identification

## When to Activate
- When working on healthcare projects that involve de-identifying patient data for research, analytics, or secondary use
- When implementing Safe Harbor or Expert Determination methods per HIPAA 164.514

## Core Principles
### 1. Complete Removal of All 18 Identifiers
The Safe Harbor method requires removal or generalization of all 18 HIPAA identifier categories. Missing even one identifier (e.g., dates more specific than year, ZIP codes beyond first 3 digits) means the data is still considered PHI.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Assuming data is de-identified after removing only names and SSNs while retaining dates, ZIP codes, or MRNs
