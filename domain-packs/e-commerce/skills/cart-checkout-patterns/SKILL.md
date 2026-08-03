---
name: "cart-checkout-patterns"
description: "Shopping cart, checkout flow, payment integration, order creation"
tier: domain
domain: "e-commerce"
version: "1.0.0"
relevance_keywords:
  - cart
  - checkout
  - payment
  - order
  - coupon
---

# Cart & Checkout Patterns

## When to Activate
- When working on e-commerce projects that involve shopping cart implementation, checkout flow design, or payment integration
- When building coupon/discount application, tax calculation, or order creation from cart

## Core Principles
### 1. Idempotent Order Creation
The cart-to-order transition must be idempotent. Network failures, browser refreshes, and double-clicks must not create duplicate orders or double-charge customers. Use idempotency keys for payment intents and ensure order creation is atomic.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Creating orders and charging payments in separate non-atomic operations without idempotency protection
