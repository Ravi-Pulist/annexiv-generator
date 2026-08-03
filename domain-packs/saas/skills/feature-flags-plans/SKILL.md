---
name: "feature-flags-plans"
description: "Feature gating, plan-based access, entitlements, usage limits"
tier: domain
domain: "saas"
version: "1.0.0"
relevance_keywords:
  - feature-flag
  - plan
  - entitlement
  - usage-limit
  - gating
---

# Feature Flags & Plan Management

## When to Activate
- When working on SaaS projects that involve feature gating by plan tier, entitlement management, or usage limit enforcement
- When implementing feature flag infrastructure, plan upgrade/downgrade logic, or metered feature access

## Core Principles
### 1. Separate Feature Flags from Entitlements
Feature flags (temporary, for rollout control) and entitlements (permanent, plan-based access) serve different purposes and should be managed separately. Conflating them leads to stale "flags" that are actually business rules, making both systems unreliable.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Using feature flags as a permanent entitlement system instead of building proper plan-based access control
