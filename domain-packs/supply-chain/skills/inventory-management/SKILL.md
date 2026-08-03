---
name: "inventory-management"
description: "Stock levels, reorder points, safety stock, lot/serial tracking, cycle counting"
tier: domain
domain: "supply-chain"
version: "1.0.0"
relevance_keywords:
  - inventory
  - stock
  - reorder
  - lot
  - serial
  - cycle-count
---

# Inventory Management

## When to Activate
- When working on supply chain projects that involve stock level management, reorder point calculations, or lot/serial tracking
- When implementing cycle counting, safety stock algorithms, or inventory valuation methods

## Core Principles
### 1. ACID-Compliant Inventory Operations
Inventory updates must be atomic and consistent. A partial update that decrements available stock without creating an allocation record produces ghost inventory — items that appear available but are committed elsewhere. Use database transactions for all inventory mutations.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Performing inventory decrements and allocation updates as separate non-transactional operations
