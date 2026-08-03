---
name: "event-driven-architecture"
description: "Message queues, event sourcing, CQRS, saga patterns"
tier: domain
domain: "generic"
version: "1.0.0"
relevance_keywords:
  - event
  - queue
  - kafka
  - rabbitmq
  - cqrs
  - saga
---

# Event-Driven Architecture

## When to Activate
- When working on projects that involve message queue integration, event sourcing, CQRS, or distributed transaction patterns
- When designing saga orchestration, event schemas, or asynchronous processing pipelines

## Core Principles
### 1. Design for Idempotency
Every event consumer must be idempotent. Messages will be delivered at least once — duplicates are inevitable due to retries, redelivery, and partition rebalancing. Consumers that are not idempotent will produce corrupted state from duplicate processing.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Event consumers that assume exactly-once delivery and lack idempotency checks or deduplication logic
