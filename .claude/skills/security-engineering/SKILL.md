---
name: "security-engineering"
description: "Security engineering — threat modeling, OWASP, vulnerability assessment, penetration testing"
tier: engineering
version: "1.0.0"
---

# Security Engineering

## When to Activate
- When performing threat modeling or security reviews

## Core Principles
### 1. Threat Modeling
Identify assets, actors, vectors, controls. Use STRIDE or similar.

### 2. OWASP Top 10
Check every web application against all categories.

### 3. Defense in Depth
Multiple layers. No single point of failure. Assume breach, limit blast radius.

## Red Flags
- Missing authentication on endpoints
- Direct object references without authorization
- Known vulnerable dependencies
