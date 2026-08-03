---
name: "graphql-patterns"
description: "Schema design, resolvers, batching, subscriptions, federation"
tier: domain
domain: "generic"
version: "1.0.0"
relevance_keywords:
  - graphql
  - schema
  - resolver
  - subscription
  - federation
---

# GraphQL Patterns

## When to Activate
- When working on projects that involve GraphQL schema design, resolver implementation, or API federation
- When building query batching, subscription infrastructure, or schema stitching

## Core Principles
### 1. Schema-First Design
Define the GraphQL schema as a contract before implementing resolvers. The schema represents the API's public interface and should be driven by client needs, not by the underlying data model. Schema-first development prevents leaking internal implementation details.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Auto-generating GraphQL schemas directly from database tables, exposing internal data structures to clients
