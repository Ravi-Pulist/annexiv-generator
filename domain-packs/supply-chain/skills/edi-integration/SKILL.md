---
name: "edi-integration"
description: "X12/EDIFACT parsing, 850/856/810/997 transaction sets, AS2 transport"
tier: domain
domain: "supply-chain"
version: "1.0.0"
relevance_keywords:
  - edi
  - x12
  - edifact
  - as2
  - "850"
  - "856"
  - "810"
---

# EDI Integration

## When to Activate
- When working on supply chain projects that involve B2B document exchange, EDI transaction set parsing, or AS2 transport
- When implementing X12 or EDIFACT document flows for purchase orders, invoices, or advance ship notices

## Core Principles
### 1. Validate Against Trading Partner Specs
Every trading partner has specific EDI implementation guides that extend base X12/EDIFACT standards. Always validate documents against the partner-specific spec, not just the generic standard. A valid X12 850 may still be rejected by a partner with stricter requirements.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Sending EDI documents without validating against the specific trading partner's implementation guide
