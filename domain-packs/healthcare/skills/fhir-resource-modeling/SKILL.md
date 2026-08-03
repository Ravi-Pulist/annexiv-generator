---
name: "fhir-resource-modeling"
description: "FHIR R4 resource profiling, US Core conformance, extensions, data types"
tier: domain
domain: "healthcare"
version: "1.0.0"
relevance_keywords:
  - fhir
  - resource
  - profile
  - us-core
  - structuredefinition
---

# FHIR Resource Modeling

## When to Activate
- When working on healthcare projects that involve FHIR R4 resource design, profiling, or US Core conformance
- When creating or validating StructureDefinitions, extensions, or custom data types

## Core Principles
### 1. Profile Before Extend
Always check existing US Core and base FHIR profiles before creating custom extensions. Extensions add complexity and reduce interoperability. Only extend when no standard element can represent the data.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Creating custom resources instead of profiling existing base resources
