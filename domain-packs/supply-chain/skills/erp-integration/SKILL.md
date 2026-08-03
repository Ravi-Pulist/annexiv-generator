---
name: "erp-integration"
description: "SAP IDoc/BAPI, Oracle REST, ERP master data sync, material master, BOM"
tier: domain
domain: "supply-chain"
version: "1.0.0"
relevance_keywords:
  - erp
  - sap
  - idoc
  - bapi
  - master-data
  - material
---

# ERP Integration Patterns

## When to Activate
- When working on supply chain projects that involve SAP or Oracle ERP integration, master data synchronization, or BOM management
- When implementing IDoc/BAPI interfaces, OData services, or ERP middleware patterns

## Core Principles
### 1. Master Data Governance
The ERP system is typically the system of record for master data (materials, vendors, customers, BOMs). External systems must sync from ERP, not the other way around, unless explicit governance rules define otherwise. Conflicting master data creates costly reconciliation problems.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Creating or modifying master data records in satellite systems without syncing back to the ERP system of record
