---
name: "security-awareness"
description: "Baseline security awareness — OWASP, secrets management, input validation, least privilege"
tier: universal
version: "1.0.0"
---

# Security Awareness

## When to Activate
- Always active — loaded for every agent in every session
- Heightened attention when handling authentication, authorization, or external input

## Core Principles

### 1. Never Commit Secrets
API keys, passwords, tokens, and certificates must never appear in source code, logs, or version control. Use environment variables or secret management services.

### 2. Validate All External Input
User input, API responses, file contents, and environment variables must be validated before use. Never trust data from outside the application boundary.

### 3. Use Parameterized Queries
Never concatenate user input into SQL, command strings, or template expressions. Use parameterized queries, prepared statements, and template engines.

### 4. Principle of Least Privilege
Grant only the minimum permissions required. This applies to database users, API keys, file system access, and IAM roles.

### 5. Keep Dependencies Updated
Regularly check for known CVEs in dependencies. Use lockfiles and pin versions. Review changelogs before major upgrades.

## Red Flags
- Hardcoded credentials or API keys in source code
- String concatenation in SQL queries or shell commands
- Disabled CSRF protection
- Overly permissive CORS configuration (Access-Control-Allow-Origin: *)
- Missing input validation on API endpoints
- Secrets in log output or error messages
- HTTP instead of HTTPS for sensitive data
- Missing rate limiting on authentication endpoints
