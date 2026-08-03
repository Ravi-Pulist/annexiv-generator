---
description: "Security-focused review — Kai analyzes code for vulnerabilities, OWASP compliance"
---

You are dispatching a focused security review. **Kai is a subagent you spawn with the Task
tool (`subagent_type: kai-security`)** — not a persona you narrate. You resolve the scope,
spawn him, and report what he returns. You do not perform the security analysis yourself: a
context that has read (or written) the code is exactly the context that will rationalize its
weak spots.

## Scope
$ARGUMENTS

Resolve the scope FIRST, yourself, then hand Kai the *resolved* scope:

- No arguments provided → all staged/uncommitted changes.
- A file path → that specific scope.
- A PR number → `gh pr diff {number}`.

Echo the resolved scope before dispatching.

## Dispatch

Spawn ONE subagent: `subagent_type: kai-security`. Give him the resolved scope (explicit file
list + the diff), the repo's conventions, and the analysis brief below **verbatim** —
including the output format, so what comes back is reportable as-is.

Kai has `tools: [Read, Bash, Grep, Glob]` and **no Write tool** — deliberately. He reads the
tree himself, runs `npm audit` (or the ecosystem equivalent) himself, and returns findings as
text. **You** persist the report if it needs to live on disk. Never instruct him to write a
file.

Tell him explicitly: *"Report only what you can prove with `file:line` evidence and a concrete
exploitation scenario — attacker input → impact. A theoretical weakness with no reachable
path is at most informational, and say so rather than inflating it."*

## Analysis (Kai's brief)

### 1. Threat Surface Mapping
Identify the attack surface of the changed code:
- External inputs (user data, API params, file uploads, URLs)
- Trust boundaries crossed
- Privileged operations performed
- Data flows involving sensitive information

### 2. Vulnerability Scan
For each file changed, check for:
- **Injection:** SQL, NoSQL, OS command, LDAP, XPath, template
- **Broken Auth:** Missing checks, session issues, weak credentials
- **Sensitive Data:** Logging PII/PHI, exposing in errors, insecure storage
- **XXE:** External entity processing in XML
- **Broken Access Control:** IDOR, privilege escalation, CORS misconfig
- **Security Misconfiguration:** Debug enabled, default creds, verbose errors
- **XSS:** Reflected, stored, DOM-based
- **Insecure Deserialization:** Untrusted data deserialized
- **Vulnerable Dependencies:** CVEs in packages
- **Insufficient Logging:** Security events not logged

### 3. Domain Compliance Check
Read `.planning/skill-config.yaml` for domain context:
- Healthcare: Check for PHI exposure, HIPAA safeguard violations
- Fintech: Check for PCI-DSS violations, payment data mishandling
- Any regulated: Check domain-specific security requirements

### 4. Dependency Audit
If package changes are in scope:
- Check for known CVEs (use `npm audit` or equivalent)
- Flag new dependencies with security concerns
- Check license compliance

## Output

Kai returns this as text; you report it and persist it if asked. If Kai failed or returned
nothing, report the review as **NOT RUN with the reason** — never fill the gap with your own
analysis under his name.

```
## Security Review

**Reviewer:** Kai (Security Engineer)
**Scope:** {description of what was reviewed}
**Date:** {timestamp}

### Threat Surface
{brief description of attack surface}

### Findings
| # | Severity | Category | File:Line | Description | Remediation | Effort |
|---|----------|----------|-----------|-------------|-------------|--------|

### Dependency Audit
| Package | Version | Known CVEs | Risk |
|---------|---------|-----------|------|

### Compliance Impact
{domain-specific compliance implications}

### Verdict: {APPROVE | REQUEST_CHANGES | CRITICAL_BLOCK}
### Risk Rating: {LOW | MEDIUM | HIGH | CRITICAL}
```

$ARGUMENTS
