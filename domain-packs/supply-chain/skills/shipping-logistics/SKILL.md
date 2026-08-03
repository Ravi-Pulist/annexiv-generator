---
name: "shipping-logistics"
description: "Carrier integration, rate shopping, label generation, tracking, last-mile"
tier: domain
domain: "supply-chain"
version: "1.0.0"
relevance_keywords:
  - shipping
  - carrier
  - tracking
  - label
  - last-mile
  - freight
---

# Shipping & Logistics

## When to Activate
- When working on supply chain projects that involve carrier integration, shipping rate comparison, or tracking implementation
- When building label generation, last-mile delivery, or freight management features

## Core Principles
### 1. Abstract the Carrier Layer
Integrate with carriers through an abstraction layer that normalizes rate requests, label generation, and tracking across providers. Direct coupling to a single carrier API creates vendor lock-in and makes multi-carrier rate shopping impossible.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Hard-coding carrier-specific logic throughout the application instead of using a carrier abstraction layer
