---
name: "loop-engineering-design"
description: "Attempt, check, repair, escalate — machine-checkable targets, specific feedback, hard caps, tier ladders, abstention"
tier: domain
domain: "ai-engineering"
version: "1.0.0"
relevance_keywords:
  - loop
  - retry
  - escalation
  - agentic-rag
  - reflection
  - self-correction
  - token-budget
---

# Loop Engineering Design

## When to Activate
- Designing any workflow where a model attempts a task more than once
- Deciding between a larger model and more attempts from a smaller one
- Budgeting tokens or cost for an autonomous workflow
- Building self-correction, reflection, or agentic retrieval

## Core Principles

### 1. There is no loop without a check the machine can run
Iteration only converges where a good answer can be told from a bad one **without a
human**. Extraction, classification, structured output, code that must compile or
pass tests, arithmetic that must reconcile — these check themselves. Open-ended
drafting, strategy and genuine judgement do not.

**Where you cannot verify, iteration produces confident wrong answers faster and
costs more doing it.** Never design a loop without naming the check that closes it.
If a task has no automatic check, it belongs on a larger model — say so.

### 2. Name the check before choosing the model
The order matters. Teams pick a model, build a loop, then discover there is nothing
to terminate on. Start from the check: what condition, computed by a machine, means
this is done? Everything else — tier, caps, feedback — follows from that answer.

Prefer a check that is a *computation over evidence* rather than a grader's opinion.
A deterministic predicate returns the same verdict on the same inputs and survives a
model swap; a model-graded check inherits the variance of the thing it is grading.

### 3. Retry with the specific failure, never the original request
A loop that re-sends the same prompt is a slot machine. Feed back **what failed** —
the failing assertion, the missing field, the unsatisfied obligation. Where the check
can name the *heaviest* unmet condition, dispatch against that rather than against
whatever failed most recently.

### 4. Caps are declared before the loop runs
Attempts, wall-clock, and tokens — all three, all declared up front. Production
discipline caps iterations around **5–6**; beyond that, additional rounds rarely
improve the answer and reliably consume the budget.

On metered inference an uncapped loop is an unbounded bill. On owned hardware the
marginal token is free, which removes the *money* failure but not the failure: an
uncapped loop there consumes **availability** instead. Cap both cases.

### 5. Escalation is a written policy, not a judgement call
Declare the tier ladder in advance: which model tier attempts first, what triggers a
move up, how many attempts per tier. Record every crossing as an event. A ladder
decided in the moment cannot be audited, reproduced, or costed.

### 6. Abstain rather than loop forever
When the ladder is exhausted, return "I could not determine this" **with the residual**
— what remained unsatisfied and what evidence was missing. An abstention is
actionable; a confident wrong answer produced on the twentieth attempt is not.

## Patterns

**The economics, which are the reason this skill exists.** Autonomous workflows
multiply token consumption roughly **3–10×** over a single pass, and **20–40×** for
work needing several rounds. Two consequences:

- On metered APIs this is the dominant cost, and it is *unpredictable* — attempt
  count is unknown until the job finishes.
- On owned hardware it is close to free, which makes loop depth that is uneconomic
  on an API entirely affordable. This is the asymmetry to design around.

**Per-token price is not cost.** Cost is price × tokens emitted. A model priced 50%
cheaper per token has been measured costing **57% more per query** by emitting 3.13×
the tokens; a model matching a frontier peer's accuracy has been measured burning
**26.3×** the tokens to do it. Always evaluate cost per *task*, never per token.

**Reasoning budget is policy, not a default.** Thinking off unless the task class
needs it; task-classified escalation; hard token caps; timeouts.

**Loop and eval are the same machinery.** The harness that measures which tier
suffices *is* the check inside the loop. Build it once; it does both jobs, plus
regression gating on every model or prompt change.

## Red Flags

- A loop whose exit condition is the model saying it is finished
- Retrying with an unchanged prompt
- No cap on attempts, time, or tokens — or a cap on only one of the three
- Escalation decided per-run instead of by declared policy
- Cost reasoned about per token rather than per completed task
- A loop applied to open-ended generation where nothing can check the output
- Reporting a token estimate as a cost when no rate is configured — unknown is
  `null`, never zero

## What this does not do

A loop does not make a model more capable. It converges on a **checkable target**
more reliably and more cheaply than a single expensive attempt. Where the target is
not checkable, the loop adds cost and confidence without adding correctness.
