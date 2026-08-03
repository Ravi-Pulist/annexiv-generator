---
name: "open-weight-llm-deployment"
description: "Model shelf and licence gates, VRAM arithmetic, serving runtimes, egress containment, external verification, checkpoint pinning"
tier: domain
domain: "ai-engineering"
version: "1.0.0"
relevance_keywords:
  - ollama
  - vllm
  - quantization
  - vram
  - gguf
  - safetensors
  - self-hosted
  - model-custody
  - ml-bom
---

# Open-Weight LLM Deployment

## When to Activate
- Standing up an inference runtime on a client's hardware or cloud account
- Choosing which models go on a shelf, and proving one fits the hardware
- Reviewing the security posture of a self-hosted model deployment
- Establishing model provenance, pinning or a bill of materials

## Core Principles

### 1. Self-hosted is not private
This is the finding to lead with, because buyers conflate the two. Large-scale
scanning has found on the order of **175,000 publicly reachable, unauthenticated
inference servers**, a persistent core in the tens of thousands, and roughly **half
with tool-calling enabled** — which makes an exposed endpoint a remote-execution and
lateral-movement risk, not merely a data-leak one. At least one unauthenticated
system-prompt-and-environment dump has carried a CVSS above 9.

**The trap is a default, not incompetence.** Common container images bind to
`0.0.0.0` and ship with no authentication of their own, so following the quickstart
on a cloud VM publishes an open endpoint.

### 2. Verify from outside, with a scan
Bind to loopback or the mesh interface, front it with an authenticating proxy, and
put the control plane on a private mesh. Then **scan it from outside the host**.

A configuration review is not evidence. Configuration intent and network reality
diverge constantly — a rule ordering, a published container port, a helpful default
in an orchestrator. The runbook step is a port scan, and it either comes back closed
or the deployment is not done.

### 3. Do the VRAM arithmetic, and refuse rather than degrade
Compute the footprint at the intended quantisation and compare it to available
memory *before* committing. Include the KV cache, which scales with context length
and concurrency and is routinely the thing that was forgotten.

If it does not fit, **refuse and show the arithmetic**. Silently loading at a lower
quantisation or a shorter context produces a system that behaves differently from
the one that was specified, and nobody finds out until quality drops.

### 4. Contract against a checkpoint hash, never a model name
An endpoint can remain "healthy" while its effective identity changes — weights,
tokenizer, quantisation, inference engine, kernels, caching, routing, hardware.
Within-provider drift has been measured at a scale comparable to cross-provider
difference. A name is not an identity; a hash is.

Record the hash in the model inventory, and re-verify on a schedule.

### 5. Licence is a gate, checked mechanically
Verify the licence permits the intended use **before** a model enters the shelf, and
enforce it by a field in the register rather than by recollection. Apache-2.0 and MIT
weights are the clean tier. Watch for: non-commercial variants sitting in the same
family as permissive ones, attribution and naming obligations that flow down to
derivatives, user-count thresholds, and regional carve-outs.

### 6. Provenance, because "where did these weights come from" is a real question
`safetensors` or GGUF only — never pickle formats, where deserialisation is code
execution on load. Checksum-pin every artefact. Scan before it enters the registry,
and treat scanning as necessary rather than sufficient; documented bypasses exist.
Mirror to a private registry so nothing is pulled from a public hub at runtime, and
ship a bill of materials with the deployment.

### 7. Embeddings are sensitive data
Vectors are recoverable text — inversion research recovers a substantial fraction of
source content from embeddings alone. Encrypt the vector store exactly as you would
the source documents, scope database roles to it, and apply consent and deletion at
the embedding layer rather than at query time. A revoked subject's vectors are
**deleted**, not filtered.

## Patterns

**Runtime selection.** `llama.cpp`/Ollama for single-node, low-concurrency and CPU or
mixed hardware; vLLM where throughput and concurrency matter. Both speak an
OpenAI-compatible API, which keeps the application layer portable.

**Know your runtime's quirks before the client does.** OpenAI-compatibility layers
have shipped defects where generation options are silently dropped — context length
among them — producing a smaller effective window than requested with no error. Pin
behaviour with a regression test rather than trusting the flag.

**Telemetry is on by default in more places than expected.** Serving runtimes and
observability tooling frequently phone home unless explicitly disabled. For an
air-gapped or residency-constrained deployment, enumerate and disable every
outbound path, then verify with the scan from principle 2.

**Fit the shelf to the hardware honestly.** A consumer-tier card of roughly 24–32 GB
runs a good 30B-class model at Q4 and does not run a 100B-class one, whatever the
parameter count on the card suggests. Consumer GPUs also generally lack hardware
partitioning, so isolation on that tier is logical rather than physical — say which
one you are providing.

## Red Flags

- A deployment declared secure on the basis of a config file
- Binding to `0.0.0.0` anywhere, including "temporarily"
- `:latest`, or any model reference without a checkpoint hash
- Pickle-format weights, or artefacts pulled from a public hub at runtime
- A model chosen before the VRAM arithmetic, then quantised down to fit
- A vector store with weaker protection than the documents it was built from
- Claiming physical isolation on hardware that does not support partitioning
- Presenting an air-gap without an enumerated egress inventory behind it

## What this does not do

Deployment controls close the exfiltration path. They do nothing about behaviour
baked into weights — measured differences in output quality under particular framings
persist in privately deployed models and are typically **silent**, appearing as
plausible answers rather than refusals. Only differential evaluation on the client's
own workload reaches that. Containment is necessary and insufficient; say both.
