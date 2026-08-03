---
name: "data-privacy-awareness"
description: "Baseline data privacy awareness — PII handling, data classification, consent, access logging"
tier: universal
version: "1.0.0"
---

# Data Privacy Awareness

## When to Activate
- Always active — loaded for every agent in every session
- Domain-specific data protection skills supplement this with detailed guidance

## Core Principles

### 1. Classify Data Before Processing
Know what data is sensitive before you handle it. Data classifications (PHI, PII, PCI, financial, business-confidential) determine handling requirements. The data-guard hook enforces domain-specific patterns.

### 2. Apply Data Minimization
Collect only what is needed. Store only what is required. Transmit only what is necessary. Delete when retention period expires.

### 3. Log Access to Sensitive Data
Every access to sensitive data must be audit-logged: who accessed what, when, and why. This is non-negotiable regardless of domain.

### 4. Encrypt Sensitive Data
At rest: use AES-256 or equivalent. In transit: use TLS 1.2+. Key management: use dedicated services, never hardcode keys.

### 5. Respect Retention Policies
Data has a lifecycle. Do not keep data longer than needed. Implement automated deletion or anonymization per policy.

## Red Flags
- Sensitive data in log output or error messages
- PII in URL parameters (visible in server logs, browser history)
- Unencrypted sensitive data in database or file storage
- Missing access logging for sensitive data operations
- Data retained beyond policy limits
- Sensitive data in test fixtures using real values
- Missing consent tracking for personal data processing
