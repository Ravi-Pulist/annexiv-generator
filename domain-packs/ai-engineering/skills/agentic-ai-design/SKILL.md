---
name: "agentic-ai-design"
description: "Agent topology, least-privilege tool surfaces, breaking the lethal trifecta, human approval on side effects"
tier: domain
domain: "ai-engineering"
version: "1.0.0"
relevance_keywords:
  - agent
  - tool-use
  - mcp
  - prompt-injection
  - containment
  - orchestration
  - trifecta
---

# Agentic AI Design

## When to Activate
- Designing any system where a model calls tools or takes actions
- Choosing an agent topology — single agent, pipeline, or multi-agent
- Exposing internal capability to a model through MCP or a tool API
- Reviewing an agentic system for security

## Core Principles

### 1. Prompt injection is a containment problem, not a prompting problem
It is not solved and will not be solved by better instructions. Treat it as
architecture. Containment-style designs defend roughly **two thirds** of a standard
attack benchmark; prompting-based defences frequently score near **zero**. Design for
the two thirds and assume the rest.

### 2. Break a leg of the trifecta
An agent becomes dangerous when it simultaneously has **private data**, **exposure to
untrusted content**, and **the ability to communicate externally**. Remove any one
and the attack class collapses.

In a system that retrieves over the client's own documents, the first two legs are
inherent. **So the design must attack the third**: no unattended outbound calls, an
explicit egress allowlist, and human approval for anything with an external
consequence.

### 3. Never enforce authorisation in a prompt
Assume the system prompt leaks; treat it as public. Authorisation belongs in query
predicates and database grants — inside the query plan, where the model cannot
persuade its way past it.

Corollary for retrieval: **filter before the search, never after.** Filter-after-retrieve
leaks through ranking signals and result counts even when documents are withheld.
Ungated probes have shown near-total cross-tenant leakage; the fix is structural.

### 4. Least privilege, and treat tool descriptions as untrusted
An agent gets the narrowest tool surface that lets it do the job. No dynamic tool
registration. **Tool descriptions are a documented injection vector** — they arrive
as text and are read by the model, so they are input, not configuration.

Prefer tools that return **identifiers and counts** over tools that return prose. A
search that returns chunk ids and scores is far harder to weaponise than one that
returns paragraphs, and it keeps the audit record free of the content it protects.

### 5. Side effects are gated on a human
Anything that writes, sends, pays, deletes or publishes requires approval. The
approval must show the human what is actually about to happen — not a summary the
model wrote of what it intends.

### 6. Containment closes exfiltration and nothing else
Removing egress makes it near-impossible for a model to *send* data out. It does
nothing about a model that produces a plausible, well-formed, subtly worse answer.
That failure is silent by construction — no gateway catches it, and no isolation
story addresses it. Only evaluation on the actual workload reaches it. State that
boundary rather than letting an isolation diagram imply more than it delivers.

## Patterns

**Start with one agent.** Multi-agent topologies multiply token cost, failure modes
and debugging surface. Add a second agent when a *specific* capability boundary
demands it — different privileges, different model tier, genuinely independent
review — not because the diagram looks better.

**Independent review means independent.** A reviewer sharing the author's context,
model and prompt is a rubber stamp. Vary at least one axis, and prefer a
deterministic check over a second opinion wherever one exists.

**MCP as the sole tool interface**, with an explicit allowlist, keeps the surface
enumerable and auditable. One contract, one place to gate, one place to log.

**Record the attempt, not just the outcome.** Which tool, which arguments, which
tier, which decision. An agentic system whose audit shows only final answers cannot
be reconstructed after an incident.

## Red Flags

- "The system prompt tells it not to do that" offered as a security control
- Retrieval filtered after the search rather than before
- An agent with both document access and unrestricted network egress
- Dynamic tool registration, or tool descriptions loaded from untrusted sources
- Side-effecting tools with no human gate
- Multi-agent topology adopted before a single agent was measured
- Calling destination allow-listing a "sandbox" — it is destination detection at the
  tool boundary, defeated by a variable or an encoded string, and a compromised
  process can open a socket without asking

## What this does not do

None of this makes the model's *judgement* trustworthy. It bounds what poor
judgement can reach. Containment addresses exfiltration; evaluation addresses
behaviour; human approval addresses consequence. Three different controls for three
different failures — and no one of them substitutes for the others.
