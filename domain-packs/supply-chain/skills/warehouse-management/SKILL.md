---
name: "warehouse-management"
description: "WMS design, pick/pack/ship, bin locations, inventory allocation, wave planning"
tier: domain
domain: "supply-chain"
version: "1.0.0"
relevance_keywords:
  - wms
  - warehouse
  - pick
  - pack
  - bin
  - allocation
---

# Warehouse Management Patterns

## When to Activate
- When working on supply chain projects that involve warehouse operations, pick/pack/ship workflows, or inventory allocation
- When designing WMS systems, bin location structures, or wave planning algorithms

## Core Principles
### 1. Inventory Accuracy is the Foundation
Every warehouse operation must maintain real-time inventory accuracy. Picking, receiving, putaway, and cycle counting must all update inventory atomically. Inaccurate inventory cascades into failed picks, overselling, and customer dissatisfaction.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Allowing inventory adjustments without requiring reason codes and supervisor approval
