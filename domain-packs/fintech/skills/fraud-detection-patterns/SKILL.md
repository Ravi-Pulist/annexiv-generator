---
name: "fraud-detection-patterns"
description: "Transaction monitoring, velocity checks, anomaly detection, risk scoring"
tier: domain
domain: "fintech"
version: "1.0.0"
relevance_keywords:
  - fraud
  - anomaly
  - velocity
  - risk-score
  - monitoring
---

# Fraud Detection Patterns

## When to Activate
- When working on fintech projects that involve transaction monitoring, real-time risk assessment, or suspicious activity detection
- When implementing velocity checks, anomaly detection models, or risk scoring engines

## Core Principles
### 1. Layer Multiple Signals
No single fraud signal is sufficient. Combine velocity checks, device fingerprinting, behavioral analysis, and transaction patterns into a composite risk score. Individual signals produce too many false positives; layered signals dramatically improve precision.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Relying on a single fraud indicator (e.g., only IP geolocation) instead of a multi-signal approach
