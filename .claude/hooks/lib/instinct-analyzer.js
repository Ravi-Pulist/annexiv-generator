// instinct-analyzer.js
// Analyzes observations to discover recurring patterns and generate instinct candidates
// Used by /learn-review command

const fs = require('fs');
const path = require('path');

/**
 * Analyze observations and generate instinct candidates
 * @param {string} basePath - project root (defaults to cwd)
 * @returns {Object} analysis results with instinct candidates
 */
function analyzeObservations(basePath) {
  basePath = basePath || process.cwd();
  const obsDir = path.join(basePath, '.planning', 'learning', 'observations');
  const obsFile = path.join(obsDir, 'observations.jsonl');

  if (!fs.existsSync(obsFile)) {
    return { observations: 0, patterns: [], instincts: [] };
  }

  const lines = fs.readFileSync(obsFile, 'utf8').trim().split('\n').filter(Boolean);
  const observations = lines.map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  if (observations.length === 0) {
    return { observations: 0, patterns: [], instincts: [] };
  }

  // Pattern detection
  const patterns = [];

  // 1. Tool usage patterns per agent
  const agentToolUsage = {};
  for (const obs of observations) {
    const key = obs.agent || 'unknown';
    if (!agentToolUsage[key]) agentToolUsage[key] = {};
    const tool = obs.tool || 'unknown';
    agentToolUsage[key][tool] = (agentToolUsage[key][tool] || 0) + 1;
  }

  for (const [agent, tools] of Object.entries(agentToolUsage)) {
    const total = Object.values(tools).reduce((s, v) => s + v, 0);
    const sorted = Object.entries(tools).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      const topTool = sorted[0];
      const percentage = Math.round((topTool[1] / total) * 100);
      if (percentage > 60 && total > 10) {
        patterns.push({
          type: 'tool-preference',
          agent,
          pattern: `${agent} uses ${topTool[0]} ${percentage}% of the time (${topTool[1]}/${total} calls)`,
          confidence: Math.min(percentage / 100, 0.95),
          occurrences: topTool[1]
        });
      }
    }
  }

  // 2. File access patterns — most frequently accessed files
  const fileAccess = {};
  for (const obs of observations) {
    if (obs.input_summary && obs.input_summary.startsWith('File: ')) {
      const file = obs.input_summary.replace('File: ', '');
      fileAccess[file] = (fileAccess[file] || 0) + 1;
    }
  }

  const hotFiles = Object.entries(fileAccess)
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  if (hotFiles.length > 0) {
    patterns.push({
      type: 'hot-files',
      pattern: `Frequently accessed files: ${hotFiles.map(([f, c]) => `${f} (${c}x)`).join(', ')}`,
      confidence: 0.9,
      occurrences: hotFiles.reduce((s, [, c]) => s + c, 0)
    });
  }

  // 3. Session length patterns
  const sessions = {};
  for (const obs of observations) {
    const date = obs.timestamp ? obs.timestamp.split('T')[0] : 'unknown';
    const agent = obs.agent || 'unknown';
    const key = `${date}-${agent}`;
    sessions[key] = (sessions[key] || 0) + 1;
  }

  const sessionLengths = Object.values(sessions);
  if (sessionLengths.length > 0) {
    const avg = Math.round(sessionLengths.reduce((s, v) => s + v, 0) / sessionLengths.length);
    patterns.push({
      type: 'session-length',
      pattern: `Average session: ${avg} tool calls across ${sessionLengths.length} sessions`,
      confidence: 0.8,
      occurrences: sessionLengths.length
    });
  }

  // 4. Command patterns — repeated bash commands
  const commands = {};
  for (const obs of observations) {
    if (obs.input_summary && obs.input_summary.startsWith('Cmd: ')) {
      // Normalize command — remove args that look like file paths
      const cmd = obs.input_summary.replace('Cmd: ', '').split(' ')[0];
      commands[cmd] = (commands[cmd] || 0) + 1;
    }
  }

  const frequentCmds = Object.entries(commands)
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);

  if (frequentCmds.length > 0) {
    patterns.push({
      type: 'frequent-commands',
      pattern: `Frequent commands: ${frequentCmds.map(([c, n]) => `${c} (${n}x)`).join(', ')}`,
      confidence: 0.85,
      occurrences: frequentCmds.reduce((s, [, c]) => s + c, 0)
    });
  }

  // Generate instinct candidates from high-confidence patterns
  const configPath = path.join(basePath, '.planning', 'config.yaml');
  let threshold = 0.85;
  if (fs.existsSync(configPath)) {
    const config = fs.readFileSync(configPath, 'utf8');
    const match = config.match(/instinct_confidence_threshold:\s*([\d.]+)/);
    if (match) threshold = parseFloat(match[1]);
  }

  const instincts = patterns
    .filter(p => p.confidence >= threshold)
    .map(p => ({
      id: `instinct-${p.type}-${Date.now()}`,
      source_pattern: p.type,
      description: p.pattern,
      confidence: p.confidence,
      occurrences: p.occurrences,
      status: 'candidate',
      generated: new Date().toISOString()
    }));

  return {
    observations: observations.length,
    timeRange: {
      first: observations[0]?.timestamp || 'unknown',
      last: observations[observations.length - 1]?.timestamp || 'unknown'
    },
    patterns,
    instincts
  };
}

/**
 * Save instinct candidates to the instincts directory
 */
function saveInstincts(instincts, basePath) {
  basePath = basePath || process.cwd();
  const instinctDir = path.join(basePath, '.planning', 'learning', 'instincts');

  if (!fs.existsSync(instinctDir)) {
    fs.mkdirSync(instinctDir, { recursive: true });
  }

  for (const instinct of instincts) {
    const file = path.join(instinctDir, `${instinct.id}.json`);
    fs.writeFileSync(file, JSON.stringify(instinct, null, 2));
  }

  return instincts.length;
}

/**
 * Load all instincts from the instincts directory
 */
function loadInstincts(basePath) {
  basePath = basePath || process.cwd();
  const instinctDir = path.join(basePath, '.planning', 'learning', 'instincts');

  if (!fs.existsSync(instinctDir)) return [];

  return fs.readdirSync(instinctDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(instinctDir, f), 'utf8'));
      } catch { return null; }
    })
    .filter(Boolean);
}

/**
 * Promote an instinct to a learned skill
 */
function promoteToSkill(instinctId, skillName, skillDescription, basePath) {
  basePath = basePath || process.cwd();
  const instinctDir = path.join(basePath, '.planning', 'learning', 'instincts');
  // Skills live flat under .claude/skills/ — the directory name is the skill's
  // invocation name in Claude Code; `tier: learned` in frontmatter marks provenance.
  const skillDir = path.join(basePath, '.claude', 'skills', skillName);

  // Find the instinct
  const instinctFile = path.join(instinctDir, `${instinctId}.json`);
  if (!fs.existsSync(instinctFile)) return null;

  const instinct = JSON.parse(fs.readFileSync(instinctFile, 'utf8'));

  // Create the learned skill
  if (!fs.existsSync(skillDir)) {
    fs.mkdirSync(skillDir, { recursive: true });
  }

  const skillContent = `---
name: "${skillName}"
description: "${skillDescription}"
tier: learned
version: "1.0.0"
source_instinct: "${instinctId}"
promoted_date: "${new Date().toISOString()}"
---

# ${skillName}

## Origin
Learned from observation pattern: ${instinct.description}
Confidence: ${instinct.confidence} | Occurrences: ${instinct.occurrences}

## When to Activate
- ${skillDescription}

## Core Principles
### 1. Observed Pattern
${instinct.description}

## Red Flags
- Deviating from this observed pattern without explicit reason
`;

  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), skillContent);

  // Update instinct status
  instinct.status = 'promoted';
  instinct.promoted_to = skillName;
  instinct.promoted_date = new Date().toISOString();
  fs.writeFileSync(instinctFile, JSON.stringify(instinct, null, 2));

  return { skill: skillName, path: path.join(skillDir, 'SKILL.md') };
}

module.exports = { analyzeObservations, saveInstincts, loadInstincts, promoteToSkill };
