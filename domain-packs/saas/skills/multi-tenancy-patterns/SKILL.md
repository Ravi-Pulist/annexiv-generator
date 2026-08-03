---
name: "multi-tenancy-patterns"
description: "Tenant isolation, shared vs dedicated, row-level security"
tier: domain
domain: "saas"
version: "1.0.0"
relevance_keywords:
  - multi-tenant
  - tenant
  - isolation
  - rls
  - schema-per-tenant
---

# Multi-Tenancy Patterns

## When to Activate
- When working on SaaS projects that involve tenant data isolation, multi-tenant database design, or row-level security
- When choosing between shared database, schema-per-tenant, or database-per-tenant architectures

## Core Principles
### 1. Tenant Isolation is Non-Negotiable
Every data access path must enforce tenant scoping. Use row-level security policies, middleware tenant filters, or schema isolation — but never rely solely on application-level WHERE clauses. A single missing tenant filter is a data breach.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Database queries that lack tenant_id filtering or rely solely on application code to enforce tenant boundaries
