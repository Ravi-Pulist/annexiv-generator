---
name: "bulk-fhir"
description: "FHIR Bulk Data Access ($export), NDJSON, backend services authorization"
tier: domain
domain: "healthcare"
version: "1.0.0"
relevance_keywords:
  - bulk
  - export
  - ndjson
  - backend-services
  - population
---

# Bulk FHIR

## When to Activate
- When working on healthcare projects that involve population-level data export, NDJSON processing, or backend services authorization
- When implementing or consuming the FHIR Bulk Data Access ($export) API for analytics or reporting

## Core Principles
### 1. Asynchronous by Design
Bulk FHIR exports are inherently asynchronous. Design clients to poll the status endpoint, handle partial results, and process NDJSON files in streaming fashion. Never attempt to load entire bulk exports into memory.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Attempting synchronous bulk data retrieval or loading full NDJSON files into memory at once
