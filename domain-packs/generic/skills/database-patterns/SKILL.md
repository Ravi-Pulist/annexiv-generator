---
name: "database-patterns"
description: "Schema design, indexing, migrations, connection pooling, caching"
tier: domain
domain: "generic"
version: "1.0.0"
relevance_keywords:
  - database
  - schema
  - migration
  - index
  - cache
---

# Database Patterns

## When to Activate
- When working on projects that involve database schema design, indexing strategies, or migration management
- When implementing connection pooling, query optimization, or caching layers

## Core Principles
### 1. Migrations Must Be Reversible
Every schema migration should have a corresponding rollback. Deploy migrations independently from application code so that a failed deployment can roll back the schema without data loss. Irreversible migrations (dropping columns, changing types) require extra care and staging.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Running destructive schema migrations (DROP COLUMN, type changes) without a tested rollback plan or data backup
