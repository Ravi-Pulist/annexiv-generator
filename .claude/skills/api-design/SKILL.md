---
name: "api-design"
description: "API design — REST/GraphQL, versioning, pagination, error handling, contracts"
tier: engineering
version: "1.0.0"
---

# API Design

## When to Activate
- When designing or modifying APIs

## Core Principles
### 1. RESTful Design
Nouns for resources, HTTP verbs for actions. Consistent URL structure. Appropriate status codes.

### 2. Pagination
Always paginate list endpoints. Support filtering, sorting, field selection.

### 3. Error Handling
Consistent format: { error: { code, message, details } }. Correlation IDs. No internal details exposed.

## Red Flags
- Verbs in URL paths
- Unbounded list endpoints
- Inconsistent error formats
