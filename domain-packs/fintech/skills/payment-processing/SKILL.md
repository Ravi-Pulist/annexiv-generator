---
name: "payment-processing"
description: "Payment gateway integration, tokenization, recurring billing, refunds, disputes"
tier: domain
domain: "fintech"
version: "1.0.0"
relevance_keywords:
  - payment
  - charge
  - refund
  - subscription
  - billing
---

# Payment Processing

## When to Activate
- When working on fintech projects that involve payment gateway integration, tokenization, or transaction lifecycle management
- When implementing recurring billing, refund flows, or dispute handling

## Core Principles
### 1. Never Touch Raw Card Data
Always delegate card handling to the payment processor's tokenization layer (e.g., Stripe Elements, Braintree Drop-in). Your servers should only ever see tokens, never raw PANs, CVVs, or expiration dates. This dramatically reduces PCI scope.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Accepting or logging raw card numbers on your own servers instead of using processor-side tokenization
