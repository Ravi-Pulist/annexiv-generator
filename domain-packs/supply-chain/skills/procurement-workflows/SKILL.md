---
name: "procurement-workflows"
description: "Purchase orders, RFQ, vendor management, approval workflows, three-way match"
tier: domain
domain: "supply-chain"
version: "1.0.0"
relevance_keywords:
  - procurement
  - purchase-order
  - rfq
  - vendor
  - three-way-match
---

# Procurement Workflows

## When to Activate
- When working on supply chain projects that involve purchase order management, vendor sourcing, or approval workflows
- When implementing three-way matching (PO, receipt, invoice) or RFQ processes

## Core Principles
### 1. Three-Way Match Before Payment
Never approve an invoice for payment without matching it against both the purchase order and the goods receipt. The three-way match (PO, receipt, invoice) is the fundamental control preventing overpayment, duplicate payment, and fraud.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Auto-approving invoices without three-way match validation against PO and receipt records
