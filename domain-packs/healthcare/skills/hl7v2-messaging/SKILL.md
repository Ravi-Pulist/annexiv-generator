---
name: "hl7v2-messaging"
description: "HL7v2 message parsing, ADT/ORM/ORU/SIU, segment manipulation, transforms"
tier: domain
domain: "healthcare"
version: "1.0.0"
relevance_keywords:
  - hl7v2
  - hl7
  - adt
  - orm
  - oru
  - mllp
  - segment
---

# HL7v2 Messaging

## When to Activate
- When working on healthcare projects that involve HL7v2 message parsing, transformation, or MLLP transport
- When integrating with legacy EHR systems that use ADT, ORM, ORU, or SIU message types

## Core Principles
### 1. Validate Before Transform
Always validate inbound HL7v2 messages against the expected message structure before attempting segment manipulation or data extraction. Malformed messages should be quarantined and logged, never silently dropped.

## Patterns
{To be expanded with domain-specific patterns}

## Red Flags
- Parsing HL7v2 messages with simple string splitting instead of a proper parser library
