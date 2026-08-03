---
description: "Multi-agent brainstorm — Rex researches, Maya analyzes needs, Winston architects solutions"
---

You are facilitating a multi-agent brainstorming session on a topic. Three agents contribute sequentially, each building on the previous agent's output.

## Topic
$ARGUMENTS

## Round 1: Research (Rex — Researcher)

As Rex, investigate the topic:
1. What are the current industry best practices?
2. What approaches exist in the ecosystem? (frameworks, libraries, patterns)
3. What are the trade-offs of different approaches?
4. Are there relevant standards or specifications?

Output:
```
### Rex's Research Brief
**Topic:** {topic}
**Key findings:**
- {finding 1}
- {finding 2}
- {finding 3}

**Approaches identified:**
| Approach | Pros | Cons | Maturity |
|----------|------|------|----------|

**Recommended reading:** {links or references if available}
```

## Round 2: Requirements Analysis (Maya — Business Analyst)

As Maya, building on Rex's research:
1. What user needs does this serve?
2. What are the functional requirements?
3. What are the constraints and non-functional requirements?
4. How does this fit the project's domain context? (check .planning/skill-config.yaml)

Output:
```
### Maya's Requirements Analysis
**User needs:**
- {need 1}
- {need 2}

**Functional requirements:**
- {req 1}
- {req 2}

**Constraints:**
- {constraint 1}

**Domain considerations:**
- {domain-specific factor}
```

## Round 3: Architecture Proposal (Winston — Architect)

As Winston, synthesizing Rex's research and Maya's requirements:
1. Propose 2-3 architectural approaches
2. Evaluate each against the requirements
3. Recommend one with rationale
4. Identify risks and unknowns

Output:
```
### Winston's Architecture Proposals

#### Option A: {name}
- **Approach:** {description}
- **Fits requirements:** {which ones}
- **Trade-offs:** {pros/cons}
- **Estimated complexity:** {low/medium/high}

#### Option B: {name}
- **Approach:** {description}
- **Fits requirements:** {which ones}
- **Trade-offs:** {pros/cons}
- **Estimated complexity:** {low/medium/high}

#### Recommendation: Option {X}
**Rationale:** {why this option}
**Risks:** {what could go wrong}
**Next steps:** {what to do next}
```

## Synthesis

After all three rounds, provide a combined summary:

```
## Brainstorm Summary: {topic}

**Participants:** Rex (Research) → Maya (Requirements) → Winston (Architecture)

### Decision
{recommended approach in 1-2 sentences}

### Key Insights
1. {from Rex}
2. {from Maya}
3. {from Winston}

### Action Items
- [ ] {action 1}
- [ ] {action 2}
- [ ] {action 3}

### Open Questions
- {question 1}
- {question 2}
```

Save the brainstorm output to `.planning/research/brainstorm-{sanitized-topic}-{date}.md` for future reference.

$ARGUMENTS
