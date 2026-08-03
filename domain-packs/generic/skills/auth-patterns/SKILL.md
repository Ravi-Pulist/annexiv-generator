---
name: "auth-patterns"
description: "JWT, OAuth2, RBAC, ABAC, session management, API keys"
tier: domain
domain: "generic"
version: "1.0.0"
relevance_keywords:
  - auth
  - jwt
  - oauth
  - rbac
  - session
  - api-key
---

# Authentication & Authorization Patterns

## When to Activate
- When working on projects that involve authentication flows, authorization models, or session management
- When implementing JWT handling, OAuth2 flows, RBAC/ABAC policies, or API key management

## Core Principles
### 1. Separate Authentication from Authorization
Authentication (who are you?) and authorization (what can you do?) are distinct concerns with different lifecycles. A valid JWT proves identity but says nothing about permissions. Implement authorization checks at every protected resource, not just at the authentication gateway.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Relying solely on authentication (valid token) without checking resource-level authorization permissions
