---
description: "Stage 2 — derive the Tech Spec from the approved Knowledge Base; the single implementation contract"
---

You are running Stage 2 of the RMAD pipeline. Input: the APPROVED Knowledge Base. Output: ONE artifact — `.planning/spec/TECH-SPEC.md` — the complete implementation contract. The CTO iterates with `/refine`/`/elicit` until they can say "this accounts for everything I need", then `/approve` unlocks Stage 3.

## Step 0: Gate check
- `.planning/knowledge/KNOWLEDGE-BASE.md` must be `status: approved`. If not: STOP — "Stage 1 gate not passed; the spec would build on sand. Run /approve knowledge-base or finish refining it."
- Record `knowledge_base_rev:` in the spec frontmatter — the spec is derived from THAT revision; if the KB changes later, the spec must be re-derived or consciously reconciled.

## Step 1: Design (agent-led sections)
- **Winston (lead):** architecture overview, AD-N decisions (each with rejected alternatives — a decision without alternatives is a description, not a decision), tech stack vs KB §7 constraints
- **Anya:** data model from KB §6 — every entity, sensitivity class per field, migration approach
- **Winston + Lena:** API contracts for every KB §4 integration + every externally visible interface
- **Winston:** module breakdown MOD-N — each maps to FR-Ns, gets an owner (which engineer), and dependency edges
- **Kai + Vera:** §7 controls table — every KB §5 obligation lands in a concrete control in a concrete module
- **Quinn:** §8 testing strategy including the Stage 4 CLEAN-iteration definition (what "done hardening" means is decided NOW, not during hardening)
- **Derek + Nadia:** §9 epic seeds ordered by dependency and value

## Step 2: Run the Coverage Check (§11)
Mechanically verify every box; list failures explicitly. The spec is not presentable while a must-have FR is unmapped.

## Step 3: Present for the refinement loop
```
## Tech Spec ready for review (rev {n}, from KB rev {m})

**Shape:** {n} modules | {n} ADs | {n} API contracts | {n} epics | Coverage Check: {all green | N failures}

### Decisions the CTO should scrutinize
- AD-{x}: {the call and its sharpest tradeoff}

### Suggested next moves
- /refine tech-spec "{first refinement you'd make}"
- /elicit tech-spec — red-team the architecture, steelman rejected alternatives
- /approve tech-spec — locks the contract and opens Stage 3 (build)
```

Update `.planning/STATE.md`: Stage `2-spec`, spec revision noted.

$ARGUMENTS
