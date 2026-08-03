---
name: "terminology-services"
description: "SNOMED CT, ICD-10, LOINC, RxNorm, CPT — terminology binding and translation"
tier: domain
domain: "healthcare"
version: "1.0.0"
relevance_keywords:
  - snomed
  - icd-10
  - loinc
  - rxnorm
  - terminology
  - valueset
---

# Healthcare Terminology Services

## When to Activate
- When working on healthcare projects that involve clinical terminology binding, code translation, or value set management
- When mapping between code systems (e.g., SNOMED to ICD-10) or validating coded clinical data

## Core Principles
### 1. Bind to Standard Terminologies
Always bind clinical data elements to recognized code systems (SNOMED CT, LOINC, RxNorm, ICD-10) rather than using local codes. Use FHIR ValueSet and ConceptMap resources to manage bindings and translations formally.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Using free-text or local codes where standard terminology bindings are available
