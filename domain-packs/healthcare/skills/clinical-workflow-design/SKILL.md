---
name: "clinical-workflow-design"
description: "Clinical order workflows, referral flows, care coordination patterns"
tier: domain
domain: "healthcare"
version: "1.0.0"
relevance_keywords:
  - clinical
  - workflow
  - order
  - referral
  - care-coordination
---

# Clinical Workflow Design

## When to Activate
- When working on healthcare projects that involve modeling clinical order entry, referral management, or care coordination workflows
- When designing systems that mirror or support real-world clinical processes

## Core Principles
### 1. Clinical Reality Drives Technical Design
Workflows must reflect how clinicians actually work, not how developers assume they work. Engage clinical stakeholders to validate state machines, exception handling, and edge cases. A technically elegant workflow that disrupts clinical practice will be rejected or worked around.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Designing rigid linear workflows without accounting for clinical exceptions, cancellations, or modifications mid-process
