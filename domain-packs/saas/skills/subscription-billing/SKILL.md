---
name: "subscription-billing"
description: "Subscription lifecycle, usage metering, invoicing, dunning"
tier: domain
domain: "saas"
version: "1.0.0"
relevance_keywords:
  - subscription
  - billing
  - metering
  - invoice
  - dunning
---

# Subscription & Billing

## When to Activate
- When working on SaaS projects that involve subscription lifecycle management, usage-based billing, or invoicing
- When implementing plan changes, proration, dunning flows, or metering infrastructure

## Core Principles
### 1. Billing State Must Be Authoritative
The billing system (e.g., Stripe) is the source of truth for subscription state. Your application database should sync from the billing system via webhooks, not the other way around. Discrepancies between billing state and application state cause access issues and revenue leakage.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Managing subscription state in the application database without syncing from the billing provider's webhooks
