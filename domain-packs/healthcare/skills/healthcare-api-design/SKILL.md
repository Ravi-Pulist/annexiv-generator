---
name: "healthcare-api-design"
description: "RESTful FHIR APIs, CapabilityStatement, pagination, error handling, SMART scopes"
tier: domain
domain: "healthcare"
version: "1.0.0"
relevance_keywords:
  - api
  - fhir-api
  - capability
  - rest
  - endpoint
---

# Healthcare API Design

## When to Activate
- When working on healthcare projects that involve designing or implementing FHIR RESTful APIs, CapabilityStatements, or SMART-scoped endpoints
- When building API layers that serve clinical data with proper pagination, error handling, and authorization

## Core Principles
### 1. CapabilityStatement as Contract
The FHIR CapabilityStatement is the machine-readable API contract. It must accurately reflect supported resources, search parameters, operations, and security schemes. Clients depend on it for dynamic discovery — inaccurate capability statements break interoperability.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Publishing a CapabilityStatement that does not match the actual API behavior or supported features
