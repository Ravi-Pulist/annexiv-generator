---
name: "marketplace-patterns"
description: "Multi-vendor marketplace, seller onboarding, commission, disputes"
tier: domain
domain: "e-commerce"
version: "1.0.0"
relevance_keywords:
  - marketplace
  - vendor
  - seller
  - commission
  - multi-vendor
---

# Marketplace Patterns

## When to Activate
- When working on e-commerce projects that involve multi-vendor marketplace design, seller management, or commission calculation
- When implementing seller onboarding, dispute resolution, or split payment flows

## Core Principles
### 1. Isolate Seller Economics
Each seller's financial data (sales, commissions, payouts, disputes) must be fully isolated and independently auditable. Commission calculations must be deterministic and transparent. Sellers will dispute any payout they cannot independently verify.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Commingling seller funds or calculating commissions without a transparent, auditable formula
