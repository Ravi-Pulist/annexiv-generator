---
name: "observability-patterns"
description: "Structured logging, distributed tracing, metrics, alerting, SLO/SLI"
tier: domain
domain: "generic"
version: "1.0.0"
relevance_keywords:
  - logging
  - tracing
  - metrics
  - observability
  - slo
---

# Observability Patterns

## When to Activate
- When working on projects that involve structured logging, distributed tracing, or metrics instrumentation
- When designing alerting strategies, SLO/SLI definitions, or observability infrastructure

## Core Principles
### 1. Correlate Across the Three Pillars
Logs, metrics, and traces must share correlation identifiers (trace IDs, request IDs) so that a metric alert can lead to relevant traces, which lead to relevant logs. Without correlation, debugging distributed systems requires manual timeline reconstruction across disconnected data sources.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Implementing logs, metrics, and traces as independent systems without shared correlation identifiers
