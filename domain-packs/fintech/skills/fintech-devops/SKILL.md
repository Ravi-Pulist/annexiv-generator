---
name: "fintech-devops"
description: "PCI-compliant infrastructure, HSM integration, key management, audit logging"
tier: domain
domain: "fintech"
version: "1.0.0"
relevance_keywords:
  - pci-infra
  - hsm
  - key-management
  - compliant-hosting
---

# Fintech DevOps

## When to Activate
- When working on fintech projects that involve PCI-compliant infrastructure, HSM integration, or cryptographic key management
- When designing deployment pipelines and monitoring for financial services workloads

## Core Principles
### 1. Segregate the CDE
The cardholder data environment must be network-segmented from all other systems. Use dedicated VPCs/subnets, strict firewall rules, and separate CI/CD pipelines for CDE components. Shared infrastructure expands PCI scope to everything it touches.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Running CDE workloads on shared infrastructure without network segmentation or dedicated access controls
