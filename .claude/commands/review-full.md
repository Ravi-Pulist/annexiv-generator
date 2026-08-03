---
description: "Full code review — Quinn (quality) + Kai (security) review concurrently as real subagents"
---

You are **orchestrating** a full code review. Quinn (quality) and Kai (security) are
**subagents you spawn with the Task tool** — they are not personas you narrate. You do not
review the code yourself, you do not write their findings for them, and you do not accept a
finding because it sounds plausible. Your job is scope resolution, dispatch, and synthesis.

If you catch yourself writing "As Quinn, I looked at…" — stop. You have skipped the one step
that makes this review worth running: a reviewer whose context did not write the code under
review. A name tag on your own analysis is not a second opinion.

## Scope
$ARGUMENTS

Resolve the scope FIRST, yourself, then hand the *resolved* scope to both reviewers:

- No arguments → all staged/uncommitted changes (`git diff` and `git diff --cached`).
- A file path or directory → that specific scope.
- A PR number → that PR's changes (`gh pr diff {number}`).

Echo the resolved scope (the file list, and how it was resolved) before dispatching.

## Dispatch — both reviewers, ONE message, concurrently

**Spawn `quinn-qa` and `kai-security` with the Task tool in a single message (two Task calls
in one block) so they run concurrently.** The two reviews are independent — nothing Quinn
finds changes what Kai should look for, and serializing them buys nothing but wall-clock.

| Reviewer | `subagent_type` | Lens |
|----------|-----------------|------|
| Quinn — QA Lead (white box) | `quinn-qa` | Correctness, maintainability, coverage, standards |
| Kai — Security Engineer | `kai-security` | Vulnerabilities, OWASP Top 10, data exposure |

**Neither reviewer has a Write tool** (`tools: [Read, Bash, Grep, Glob]`) — deliberately. They
return their findings as structured text in their final message; **you** persist anything that
belongs on disk. Never instruct a reviewer to write a file: they cannot, and the artifact is
yours to own.

Give each subagent: the resolved scope (an explicit file list, not "the recent changes"), the
diff or the paths to read, the repo's own conventions (`CLAUDE.md`, lint config), and its
brief below **verbatim** — including the output format, so what comes back can be assembled
without a second round trip.

Tell both explicitly: *"Report only what you can prove with `file:line` evidence and a concrete
failure scenario — inputs → wrong behavior. 'Could be improved' is not a finding."*

## Phase 1: Quality Review — Quinn (`subagent_type: quinn-qa`)

Brief Quinn to analyze the code for:

### Code Quality
- **Readability:** Naming, formatting, code structure
- **Complexity:** Cyclomatic complexity, function length, nesting depth
- **Duplication:** Repeated patterns that should be abstracted
- **Error handling:** Missing try/catch, unhandled promises, error swallowing
- **Test coverage:** Are changes covered by tests? Are edge cases tested?

### Architecture Compliance
- Does the code follow the patterns in `.planning/architecture/`?
- Are there ADR violations?
- API contract adherence

### Standards
- Lint compliance (run the linter if configured — Quinn has Bash)
- Naming conventions per `coding-standards` skill
- Git commit message format per CLAUDE.md rules

Output format — Quinn returns this as text, he does not write it to a file:
```
## Quality Review (Quinn)

### Summary
{1-2 sentence overall assessment}

### Findings
| # | Severity | File:Line | Finding | Recommendation |
|---|----------|-----------|---------|----------------|
| 1 | {critical/major/minor/info} | {path:line} | {issue} | {fix} |

### Metrics
- Files reviewed: {n}
- Issues found: {critical: n, major: n, minor: n, info: n}
- Test coverage: {assessment}

### Verdict: {APPROVE | REQUEST_CHANGES | NEEDS_DISCUSSION}
```

## Phase 2: Security Review — Kai (`subagent_type: kai-security`)

Brief Kai to analyze the same scope for:

### Security Analysis
- **Injection risks:** SQL injection, command injection, XSS, template injection
- **Authentication/Authorization:** Broken access control, missing auth checks
- **Data exposure:** Sensitive data in logs, error messages, responses
- **Cryptography:** Weak algorithms, hardcoded keys, insecure random
- **Dependencies:** Known vulnerable packages (check package.json/requirements.txt)
- **OWASP Top 10:** Systematic check against current OWASP Top 10

### Domain-Specific Security
- Check `.planning/skill-config.yaml` for domain security requirements — Kai reads it himself
- If healthcare: PHI exposure, HIPAA violations
- If fintech: PCI-DSS violations, payment data handling
- If any regulated domain: compliance implications

Output format — Kai returns this as text, he does not write it to a file:
```
## Security Review (Kai)

### Summary
{1-2 sentence security assessment}

### Findings
| # | Severity | Category | File:Line | Finding | Remediation |
|---|----------|----------|-----------|---------|-------------|
| 1 | {critical/high/medium/low} | {OWASP category} | {path:line} | {vulnerability} | {fix} |

### OWASP Top 10 Check
| # | Category | Status |
|---|----------|--------|
| A01 | Broken Access Control | {PASS/REVIEW/FAIL} |
| A02 | Cryptographic Failures | {PASS/REVIEW/FAIL} |
| A03 | Injection | {PASS/REVIEW/FAIL} |
| A04 | Insecure Design | {PASS/REVIEW/FAIL} |
| A05 | Security Misconfiguration | {PASS/REVIEW/FAIL} |
| A06 | Vulnerable Components | {PASS/REVIEW/FAIL} |
| A07 | Auth Failures | {PASS/REVIEW/FAIL} |
| A08 | Data Integrity Failures | {PASS/REVIEW/FAIL} |
| A09 | Logging Failures | {PASS/REVIEW/FAIL} |
| A10 | SSRF | {PASS/REVIEW/FAIL} |

### Verdict: {APPROVE | REQUEST_CHANGES | CRITICAL_BLOCK}
```

## Combined Verdict — you write this, from what came back

Both subagents are reviewers, not deciders. You own severity normalization: downgrade any
finding whose failure scenario is hypothetical, and drop a duplicate raised by both reviewers
(keep the one with better evidence, note the overlap). If a reviewer returned a finding with
no `file:line`, say so rather than laundering it into the table.

```
## Review Summary

| Reviewer | Findings | Verdict |
|----------|----------|---------|
| Quinn (Quality) | {n critical, n major, n minor} | {verdict} |
| Kai (Security) | {n critical, n high, n medium} | {verdict} |

**Overall:** {APPROVE | REQUEST_CHANGES | BLOCKED}
**Action items:** {numbered list of required fixes before merge}
```

A subagent that failed or returned nothing is reported as **NOT RUN with the reason** — never
silently replaced by your own reading of the code.

$ARGUMENTS
