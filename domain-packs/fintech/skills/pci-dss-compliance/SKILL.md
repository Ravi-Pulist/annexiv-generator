---
name: "pci-dss-compliance"
description: "PCI DSS requirements, SAQ selection, network segmentation, cardholder data"
tier: domain
domain: "fintech"
version: "1.0.0"
relevance_keywords:
  - pci
  - cardholder
  - pan
  - tokenization
  - segmentation
---

# PCI DSS Compliance

## When to Activate
- When working on fintech projects that involve cardholder data environments, PCI scope reduction, or SAQ assessment
- When designing network segmentation or data flow architectures for payment systems

## Core Principles
### 1. Minimize PCI Scope
The most effective PCI compliance strategy is scope reduction. Use tokenization, P2PE, and network segmentation to shrink the cardholder data environment (CDE) to the smallest possible footprint. Less scope means fewer controls to implement and audit.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Allowing cardholder data to flow through systems outside the defined CDE boundary
