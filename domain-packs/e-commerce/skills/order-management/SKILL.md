---
name: "order-management"
description: "Order lifecycle, fulfillment, returns, refunds, split shipments"
tier: domain
domain: "e-commerce"
version: "1.0.0"
relevance_keywords:
  - order
  - fulfillment
  - return
  - refund
  - shipment
---

# Order Management

## When to Activate
- When working on e-commerce projects that involve order lifecycle management, fulfillment workflows, or return/refund processing
- When designing order state machines, split shipment logic, or fulfillment routing

## Core Principles
### 1. Explicit State Machine
Model the order lifecycle as an explicit state machine with defined transitions and guards. Orders move through states (placed, confirmed, picking, shipped, delivered, returned) with clear rules about which transitions are valid. Implicit state management leads to impossible order states.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Using boolean flags (is_shipped, is_refunded) instead of an explicit order state machine with defined transitions
