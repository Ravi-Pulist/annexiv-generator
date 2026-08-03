---
name: "graph-engineering-design"
description: "Designing an estate map that states its own gaps — resolution denominators, blast radius, ERD confidence banding"
tier: domain
domain: "ai-engineering"
version: "1.0.0"
relevance_keywords:
  - graph
  - blast-radius
  - erd
  - dependency
  - estate
  - impact
  - architecture-discovery
---

# Graph Engineering Design

## When to Activate
- Entering an unfamiliar codebase or client estate and needing a defensible picture of it
- Designing what an AI system is allowed to touch, and what breaks if it does
- Producing an architecture or data model that a third party will be asked to trust
- Deciding the retrieval strategy for a code or systems corpus

## Core Principles

### 1. The graph decides; similarity only nominates
Lexical and vector search find *candidates*. They cannot tell you a function has no
callers, that two modules import each other, or that a route reaches the database
without passing auth. Those are graph properties, and they are what someone about to
change a system actually needs. Rank on real edges, and treat similarity as the
seeding step rather than the answer.

### 2. A map without denominators is a guess wearing a diagram
Every extraction has a resolution rate. Report it: how many edges resolved, how many
were refused, and why they were refused — untyped receiver, ambiguous name,
out-of-project target. A map that presents 65% resolution as if it were complete
will be trusted for the 35% it never saw, and that is where the incident comes from.

**Refused is a category, not a failure.** Counting a thing you could not resolve is
strictly more honest than silently dropping it or guessing at it.

### 3. Confidence is a band, not a boolean
A foreign key declared in the schema and a relationship inferred from a column name
are not the same fact. Band them — `certain` when the constraint is declared,
`heuristic` when it is inferred — and show the evidence for each. In practice the
heuristic band is where the interesting findings live: an inferred relationship with
**no declared FK** is either a missing constraint or a misunderstanding, and both are
worth the client's attention.

### 4. Say what the map cannot see
Static reading cannot see schemaless stores, JSON columns with implicit structure,
dynamically created tables, relationships enforced only in application code, or any
call made through reflection or dynamic import. **Ship that list as a section of the
deliverable, not as a footnote.** It is the difference between an audit and a
brochure — and a reviewer who finds an unstated limit stops trusting the stated ones.

### 5. Answer the change question before the change
"What breaks if I touch this" and "which tests guard this" are answerable from the
graph, cheaply, *before* the edit. Running them afterwards is a postmortem.

## Patterns

**Seed → expand → rank → budget.** Exact matches seed the candidate set; the graph
expands it across real edges; fusion ranks by strength of evidence with exact above
lexical above adjacency; a hard token budget packs the result. Damp candidates
reached *only* by traversal so a neighbour with no textual connection cannot outrank
a direct hit.

**The budget is hard, not advisory.** Models degrade non-uniformly as input grows,
well before the context limit. Returning more than was asked for is harm, not
generosity — and when results are dropped, say how many.

**Mirror exclusion.** Byte-identical copies of a file (vendored trees, template
mirrors) make symbols ambiguous and break resolution. Detect and exclude them by
content, and report what was excluded.

**Layered estate mapping.** Code is one layer. An estate also has data (schema),
infrastructure (compose/K8s/Terraform), egress (every reachable outbound
destination), and documents (inventory only — counts and locations, never contents).
Each layer reports its own denominators.

## Red Flags

- A dependency diagram with no resolution rate printed anywhere
- Relationships shown as equally certain when some are declared and some inferred
- An architecture review that never states what the analysis could not reach
- Ranking retrieval results on text similarity alone for a change-impact question
- Reading document *contents* during an estate inventory — scope is counts and
  locations; contents are a separate, consented step
- Presenting a graph built from one language's parser as covering a polyglot estate

## What this does not do

Graph engineering describes structure, not behaviour. It cannot tell you the system
is *correct*, that a path is *reachable at runtime*, or that data flowing through an
edge is *lawful*. It narrows where to look and bounds what a change can reach. Claim
that, and no more.
