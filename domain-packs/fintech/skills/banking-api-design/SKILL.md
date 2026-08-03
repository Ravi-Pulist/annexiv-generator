---
name: "banking-api-design"
description: "Open Banking APIs, PSD2, account info, payment initiation, consent"
tier: domain
domain: "fintech"
version: "1.0.0"
relevance_keywords:
  - open-banking
  - psd2
  - consent
  - account-info
  - payment-initiation
---

# Banking API Design

## When to Activate
- When working on fintech projects that involve Open Banking API design, PSD2 compliance, or consent-based data sharing
- When building account information or payment initiation services

## Core Principles
### 1. Consent-Driven Access
Every data access must be backed by explicit, revocable customer consent. Open Banking APIs must enforce granular consent scopes, track consent lifecycle, and immediately honor revocation. Access without valid consent is both a regulatory violation and a trust breach.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Accessing account data beyond the scope or duration of the customer's consent
