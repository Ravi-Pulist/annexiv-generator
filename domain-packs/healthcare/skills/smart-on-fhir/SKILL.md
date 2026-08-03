---
name: "smart-on-fhir"
description: "SMART App Launch, OAuth2 scopes, EHR launch context, standalone launch"
tier: domain
domain: "healthcare"
version: "1.0.0"
relevance_keywords:
  - smart
  - smart-on-fhir
  - oauth
  - launch
  - ehr-launch
---

# SMART on FHIR

## When to Activate
- When working on healthcare projects that involve SMART App Launch framework, OAuth2 authorization for FHIR, or EHR-embedded applications
- When implementing standalone or EHR launch flows for clinical applications

## Core Principles
### 1. Scope Minimization
Request only the SMART scopes necessary for the application's function. Overly broad scopes violate the principle of least privilege and may cause EHR administrators to reject app registration.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Requesting wildcard scopes (e.g., patient/*.read) when only specific resources are needed
