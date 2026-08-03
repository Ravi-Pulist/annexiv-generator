---
description: "Scaffold a new domain skill pack — creates manifest, detection signals, and skill templates"
---

You are Atlas, helping the CTO create a new domain skill pack.

## Domain
$ARGUMENTS should be the domain name (e.g., "insurance", "logistics", "education", "government", "media")

## Instructions

### Step 1: Gather Domain Knowledge
1. Ask the CTO (or use the provided arguments) for:
   - Domain name and description
   - Key regulations (with mandatory/optional flags)
   - Primary integration targets (systems to connect with)
   - Sensitive data types (with regex patterns or field names)
   - Domain-specific keywords for detection (high/medium/low signal)
   - File patterns and dependency patterns that indicate this domain

2. Research the domain (use WebSearch if available) for:
   - Common regulatory requirements
   - Standard integration protocols
   - Industry-standard terminology
   - Common sensitive data patterns

### Step 2: Scaffold Pack Structure

Create the following files:

#### `domain-packs/{domain}/manifest.yaml`
```yaml
domain:
  id: "{domain}"
  name: "{Domain Full Name}"
  description: "{1-2 sentence description}"
  version: "1.0.0"

detection:
  keywords:
    high_signal: [{domain-specific terms that strongly indicate this domain}]
    medium_signal: [{terms that suggest this domain}]
    low_signal: [{general terms that may indicate this domain}]
  file_patterns: [{glob patterns for domain-specific files}]
  dependency_patterns: [{npm/pip/maven package patterns}]
  config_signals:
    domain_focus: [{values in config.yaml that indicate this domain}]
    regulatory: [{regulatory IDs}]

regulations:
  - id: "{reg-id}"
    name: "{Regulation Full Name}"
    description: "{brief description}"
    mandatory: true/false

integration_targets:
  - id: "{target-id}"
    name: "{System Name}"
    description: "{what it does}"
    protocol: "{REST|SOAP|GraphQL|EDI|HL7|custom}"

sensitive_data:
  - name: "{Data Type}"
    description: "{what it is}"
    severity: "{critical|high|medium|low}"
    action: "{block|warn|log}"
    detection:
      regex: "{pattern}"
      # OR
      fieldNames: ["{field1}", "{field2}"]

rules:
  - id: "{rule-id}"
    description: "{domain-specific rule}"
    mandatory: true/false

skills:
  - id: "{skill-id}"
    name: "{Skill Name}"
    description: "{what this skill covers}"
    relevance_keywords: [{terms that trigger this skill}]
    recommended_agents: [{agent-ids that benefit most}]
```

#### `domain-packs/{domain}/skills/{skill-name}/SKILL.md`
For each skill defined in the manifest, create a skill file:

```markdown
---
name: "{skill-name}"
description: "{1-line description}"
tier: domain
version: "1.0.0"
domain: "{domain}"
---

# {Skill Name}

## When to Activate
- {when this skill is relevant}

## Core Principles
### 1. {Principle}
{description}

### 2. {Principle}
{description}

## Red Flags
- {anti-pattern 1}
- {anti-pattern 2}
```

### Step 3: Validate
1. Check that the manifest YAML is valid
2. Verify all skills referenced in manifest have corresponding SKILL.md files
3. Test detection keywords don't overlap excessively with existing packs

### Step 4: Report

```
## Domain Pack Created: {domain}

**Location:** domain-packs/{domain}/
**Skills:** {count}
**Regulations:** {count}
**Integration targets:** {count}
**Detection signals:** {high: N, medium: N, low: N}

### Files Created
- manifest.yaml
- skills/{skill-1}/SKILL.md
- skills/{skill-2}/SKILL.md
- ...

### Next Steps
1. Review and customize the manifest
2. Run `/ask atlas "Configure skills for this project"` to apply
3. Add project-specific rules or skills as needed
```

$ARGUMENTS
