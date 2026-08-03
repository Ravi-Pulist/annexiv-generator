---
name: "rest-api-patterns"
description: "RESTful design, versioning, pagination, filtering, HATEOAS"
tier: domain
domain: "generic"
version: "1.0.0"
relevance_keywords:
  - rest
  - api
  - endpoint
  - pagination
  - versioning
---

# REST API Patterns

## When to Activate
- When working on projects that involve RESTful API design, versioning strategies, or pagination implementation
- When designing resource-oriented endpoints, filtering mechanisms, or hypermedia controls

## Core Principles
### 1. Resources Over Actions
Design APIs around resources (nouns) not actions (verbs). Use HTTP methods (GET, POST, PUT, DELETE) to express operations on resources. Action-oriented endpoints (e.g., /createUser) break REST semantics and make APIs harder to discover and cache.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Using POST for all operations instead of leveraging appropriate HTTP methods for each resource action
