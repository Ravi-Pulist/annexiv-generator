---
description: "Compliance review — Vera audits code for regulatory requirements"
---

You are dispatching a compliance review. **Vera is a subagent you spawn with the Task tool
(`subagent_type: vera-compliance`)** — not a persona you narrate. You resolve the scope, spawn
her, and report what she returns. You do not perform the audit yourself. An audit written by
the same context that wrote the code is not an audit; it is a self-attestation, and Rule 5
findings are exactly the ones that context is most motivated to miss.

## Scope
$ARGUMENTS

Resolve the scope FIRST, yourself, then hand Vera the *resolved* scope:

- No arguments provided → all staged/uncommitted changes.
- A file path → that specific scope.

Echo the resolved scope before dispatching.

## Dispatch

Spawn ONE subagent: `subagent_type: vera-compliance`. Give her the resolved scope (explicit
file list + the diff) and the analysis brief below **verbatim**, including the output format.

Vera reads `.planning/skill-config.yaml` and `.planning/compliance/` herself — she has
`tools: [Read, Write, Grep, Glob]`. **She returns the audit as text; you persist it.** Vera's
Write grant is for her own compliance documentation lane, not for this command's output — one
writer for one artifact, and here that writer is you.

Tell her explicitly: *"Every gap needs `file:line` evidence and the specific regulatory
requirement it violates. A checklist item you could not verify is UNVERIFIED, not PASS."*

## Analysis (Vera's brief)

### 1. Regulatory Context
1. Read `.planning/skill-config.yaml` for domain and regulations
2. Read `.planning/compliance/` for existing compliance documentation
3. Identify which regulations apply to the changed code

### 2. Data Handling Audit
- What data types does this code process? (PII, PHI, PCI, confidential)
- Is data classification applied before processing?
- Is access to sensitive data logged?
- Is data encrypted at rest and in transit?
- Are retention policies respected?

### 3. Access Control Audit
- Are authorization checks present for privileged operations?
- Is the principle of least privilege followed?
- Are audit trails maintained?

### 4. Regulatory Checklist
For each applicable regulation, verify:

**HIPAA (if healthcare):**
- [ ] PHI is encrypted at rest and in transit
- [ ] Access to PHI is logged
- [ ] Minimum necessary standard applied
- [ ] BAA requirements considered for third-party data sharing

**PCI-DSS (if payment data):**
- [ ] Card data is not logged
- [ ] Encryption meets PCI standards
- [ ] Access restricted to need-to-know

**GDPR/CCPA (if PII):**
- [ ] Consent mechanisms in place
- [ ] Data minimization applied
- [ ] Right to deletion supported
- [ ] Cross-border transfer rules respected

**SOC 2 (if SaaS):**
- [ ] Change management documented
- [ ] Access controls verified
- [ ] Monitoring and alerting in place

### 5. Rule 5 Check
Are there any compliance requirements being deferred? Per CLAUDE.md: "Domain compliance requirements are NEVER deferred as tech debt."

## Output

Vera returns this as text; you report it and persist it. If Vera failed or returned nothing,
report the review as **NOT RUN with the reason** — a compliance review that didn't run is an
open question, never an implied COMPLIANT.

```
## Compliance Review

**Reviewer:** Vera (Compliance Analyst)
**Scope:** {description}
**Regulations:** {list of applicable regulations}

### Data Handling
| Data Type | Classification | Handling | Compliant? |
|-----------|---------------|----------|-----------|

### Regulatory Compliance
| Regulation | Requirement | Status | Evidence | Gap |
|-----------|------------|--------|----------|-----|

### Rule 5 Violations
{any compliance requirements being deferred as tech debt — MUST be resolved}

### Findings
| # | Severity | Regulation | Finding | Required Action |
|---|----------|-----------|---------|----------------|

### Verdict: {COMPLIANT | NON_COMPLIANT | CONDITIONALLY_COMPLIANT}
### Action Required: {list of items that must be addressed}
```

$ARGUMENTS
