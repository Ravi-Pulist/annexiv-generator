---
name: "coding-standards"
description: "Code quality standards — naming, formatting, patterns, maintainability, linting, git conventions"
tier: engineering
version: "1.1.0"
---

# Coding Standards

## When to Activate
- When writing or reviewing any code

## Core Principles
### 1. Naming
Descriptive, intention-revealing. Booleans: is/has/should. Constants: UPPER_SNAKE_CASE. Classes: PascalCase.

### 2. Functions
Single responsibility. Short (< 30 lines). Few parameters (3 or fewer). Pure where possible.

### 3. Error Handling
Handle at appropriate level. Typed errors. Never swallow silently. Fail fast.

### 4. Lint-After-Write Protocol
After any Write or Edit to source code, run the project linter before proceeding. Fix all issues immediately — do not defer lint fixes as tech debt.

**Auto-detect linter from project config:**
- JavaScript/TypeScript: ESLint (`.eslintrc.*`, `eslint.config.*`) or Biome (`biome.json`)
- Python: Ruff (`ruff.toml`, `pyproject.toml`) > Flake8 (`.flake8`) > Pylint
- Go: `go vet`
- Rust: `cargo clippy`

**Workflow:**
1. Write or edit source file
2. Run detected linter against the changed file
3. If issues found, fix them immediately
4. Re-lint to confirm clean output
5. Only then proceed to next task

### 5. Git Conventions
**Commit message format:**
```
{type}({agent}): {description} [{story-id}]
```
- Types: `feat` | `fix` | `refactor` | `test` | `docs` | `chore`
- Agent: the agent ID performing the commit (e.g., `soren-backend`, `milo-frontend`)
- Story ID: from `.planning/STATE.md` or current task context

**Branch naming:**
- Story branches: `story/{story-id}`
- Feature branches: `feature/{description}`
- Fix branches: `fix/{description}`

**Co-author attribution:**
Every commit must include a `Co-Authored-By` trailer identifying the AI model used.

## Red Flags
- Single-letter variables (except loop counters)
- Functions over 50 lines
- Deeply nested conditionals (> 3 levels)
- Magic numbers without constants
- Editing source code without running the linter afterward
- Committing with lint errors unresolved
- Commit messages missing type prefix or agent attribution
- Commits to `main`/`master` without a PR
- Branch names that do not follow the naming convention
