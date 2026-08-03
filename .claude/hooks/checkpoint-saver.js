#!/usr/bin/env node
// checkpoint-saver.js — PreCompact hook
// Saves structured checkpoint before auto-compaction for session recovery
// Exit 0 always

const fs = require('fs');
const path = require('path');

const CHECKPOINT_DIR = path.join(process.cwd(), '.planning', 'checkpoints');
const STATE_PATH = path.join(process.cwd(), '.planning', 'STATE.md');
const DECISION_LOG_PATH = path.join(process.cwd(), '.planning', 'accountability', 'decision-log.md');
const MAX_CHECKPOINTS = 20; // Keep last N checkpoints

async function main() {
  try {
    if (!fs.existsSync(CHECKPOINT_DIR)) {
      fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Read current state
    let stateContent = 'No state available';
    if (fs.existsSync(STATE_PATH)) {
      stateContent = fs.readFileSync(STATE_PATH, 'utf8');
    }

    // Extract key info from state
    const agentMatch = stateContent.match(/- Name: (.+)/);
    const storyMatch = stateContent.match(/- Story: (.+)/);
    const phaseMatch = stateContent.match(/- Phase: (.+)/);
    const sprintMatch = stateContent.match(/- Sprint: (.+)/);
    const taskMatch = stateContent.match(/- Task: (.+)/);
    const workingMatch = stateContent.match(/- Working on: (.+)/);

    const agent = agentMatch ? agentMatch[1].trim() : 'unknown';
    const story = storyMatch ? storyMatch[1].trim() : 'no-story';
    const phase = phaseMatch ? phaseMatch[1].trim() : 'unknown';
    const sprint = sprintMatch ? sprintMatch[1].trim() : 'none';
    const task = taskMatch ? taskMatch[1].trim() : 'none';
    const workingOn = workingMatch ? workingMatch[1].trim() : 'none';

    // Read recent decision log entries (last 20 lines)
    let recentDecisions = 'No decisions logged';
    if (fs.existsSync(DECISION_LOG_PATH)) {
      const logContent = fs.readFileSync(DECISION_LOG_PATH, 'utf8');
      const lines = logContent.split('\n');
      const headerLines = lines.slice(0, 3); // Table header
      const dataLines = lines.slice(3).filter(l => l.trim().startsWith('|'));
      const recentLines = dataLines.slice(-20);
      recentDecisions = [...headerLines, ...recentLines].join('\n');
    }

    // Find recently modified files (from decision log)
    const modifiedFiles = [];
    if (fs.existsSync(DECISION_LOG_PATH)) {
      const logContent = fs.readFileSync(DECISION_LOG_PATH, 'utf8');
      const fileMatches = logContent.match(/\| [^|]+ \| [^|]+ \| [^|]+ \| ([^|]+) \|/g);
      if (fileMatches) {
        const seen = new Set();
        for (const match of fileMatches.slice(-30)) {
          const fileMatch = match.match(/\| [^|]+ \| [^|]+ \| [^|]+ \| ([^|]+) \|/);
          if (fileMatch) {
            const file = fileMatch[1].trim();
            if (file !== 'File' && file !== '—' && file !== 'unknown' && !seen.has(file)) {
              seen.add(file);
              modifiedFiles.push(file);
            }
          }
        }
      }
    }

    // Read active story file if available
    let storyContext = '';
    if (sprint !== 'none' && story !== 'no-story' && story !== 'none') {
      const storiesDir = path.join(process.cwd(), '.planning', 'sprints', `sprint-${sprint}`, 'stories');
      if (fs.existsSync(storiesDir)) {
        const storyFiles = fs.readdirSync(storiesDir).filter(f => f.includes(story));
        if (storyFiles.length > 0) {
          storyContext = fs.readFileSync(path.join(storiesDir, storyFiles[0]), 'utf8');
        }
      }
    }

    // Build checkpoint
    const checkpointId = `${timestamp}-${agent}-${story}`.replace(/[^a-zA-Z0-9-]/g, '-');
    const checkpointFile = path.join(CHECKPOINT_DIR, `${checkpointId}.md`);

    const checkpoint = `---
checkpoint_id: "${checkpointId}"
timestamp: "${new Date().toISOString()}"
agent: "${agent}"
phase: "${phase}"
sprint: "${sprint}"
story: "${story}"
task: "${task}"
reason: "pre-compaction"
---

# Checkpoint: ${checkpointId}

## Recovery Context
> Load this checkpoint to resume work after context compaction.
> Command: /resume ${checkpointId}

## Session State
- **Agent:** ${agent}
- **Phase:** ${phase}
- **Sprint:** ${sprint}
- **Story:** ${story}
- **Task:** ${task}
- **Working on:** ${workingOn}
- **Saved at:** ${new Date().toISOString()}

## What Was Being Done
> ${workingOn}

## Files Modified This Session
${modifiedFiles.length > 0 ? modifiedFiles.map(f => '- ' + f).join('\n') : '- None recorded'}

## Recent Decisions
${recentDecisions}

${storyContext ? `## Active Story Context\n${storyContext}` : ''}

## Full State Snapshot
${stateContent}

## Recovery Instructions
1. Read this checkpoint to understand where work left off
2. Re-read the files listed in "Files Modified" to understand current state
3. Check the active story for remaining tasks
4. Continue from where the previous session ended
`;

    fs.writeFileSync(checkpointFile, checkpoint);

    // Rotate old checkpoints
    rotateCheckpoints();

    // Update STATE.md with last checkpoint reference
    if (fs.existsSync(STATE_PATH)) {
      let state = fs.readFileSync(STATE_PATH, 'utf8');
      if (state.includes('- Last checkpoint:')) {
        state = state.replace(/- Last checkpoint: .+/, `- Last checkpoint: ${checkpointId}`);
      } else if (state.includes('## Metrics')) {
        state = state.replace('## Metrics', `## Last Checkpoint\n- Last checkpoint: ${checkpointId}\n- Saved at: ${new Date().toISOString()}\n\n## Metrics`);
      }
      fs.writeFileSync(STATE_PATH, state);
    }

    process.exit(0);
  } catch (err) {
    process.exit(0);
  }
}

function rotateCheckpoints() {
  try {
    if (!fs.existsSync(CHECKPOINT_DIR)) return;
    const files = fs.readdirSync(CHECKPOINT_DIR)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse();

    if (files.length > MAX_CHECKPOINTS) {
      for (const file of files.slice(MAX_CHECKPOINTS)) {
        fs.unlinkSync(path.join(CHECKPOINT_DIR, file));
      }
    }
  } catch (e) {
    // Non-critical — don't block on rotation errors
  }
}

main();
