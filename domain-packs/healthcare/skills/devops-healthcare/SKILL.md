---
name: "devops-healthcare"
description: "HIPAA-compliant infrastructure, BAA management, encryption, audit infrastructure"
tier: domain
domain: "healthcare"
version: "1.0.0"
relevance_keywords:
  - hipaa-infra
  - baa
  - compliant-hosting
  - healthcare-cloud
---

# Healthcare DevOps

## When to Activate
- When working on healthcare projects that involve HIPAA-compliant infrastructure provisioning, BAA management, or audit log infrastructure
- When designing cloud deployments that store or process PHI

## Core Principles
### 1. BAA Coverage for Every PHI Touchpoint
Every cloud service, SaaS tool, or third-party system that stores, processes, or transmits PHI must be covered by a Business Associate Agreement. Infrastructure without BAA coverage is a HIPAA violation regardless of technical safeguards in place.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Deploying PHI workloads to cloud services without confirming BAA coverage
