---
name: "sso-identity"
description: "OIDC, SAML, SCIM provisioning, SSO, MFA, session management"
tier: domain
domain: "saas"
version: "1.0.0"
relevance_keywords:
  - sso
  - saml
  - oidc
  - scim
  - mfa
  - identity
---

# SSO & Identity Management

## When to Activate
- When working on SaaS projects that involve enterprise SSO integration, SCIM user provisioning, or MFA implementation
- When designing authentication flows using OIDC or SAML, or managing session lifecycle

## Core Principles
### 1. Delegate Authentication, Own Authorization
Use an identity provider (IdP) for authentication — never build your own SSO protocol implementation. However, authorization (what a user can do within your app) must remain in your system, mapped from IdP claims/groups to your application's permission model.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Implementing custom SAML or OIDC protocol handling instead of using a vetted library or identity service
