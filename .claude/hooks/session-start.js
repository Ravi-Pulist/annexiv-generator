#!/usr/bin/env node
// session-start.js — SessionStart hook (startup | resume | clear | compact)
// 1. Archives the previous session's context metrics and resets
//    .planning/context-health.json (before this hook existed, session
//    counters accumulated forever and advisories went permanently stale).
// 2. Clears the stale context bridge (statusline rewrites it with live data).
// 3. Injects a compact project bootstrap into the model's context:
//    current phase/sprint/story/mode/domain from STATE.md, plus the latest
//    checkpoint pointer when resuming or recovering from compaction.
// Exit 0 always.

const fs = require('fs');
const path = require('path');
const { parseHookInput, isHookDisabled, emitJson } = require('./lib/hook-input.js');

const PLANNING = path.join(process.cwd(), '.planning');
const HEALTH_PATH = path.join(PLANNING, 'context-health.json');
const HISTORY_PATH = path.join(PLANNING, 'context-health-history.jsonl');
const BRIDGE_PATH = path.join(PLANNING, '.context-bridge.json');
const STATE_PATH = path.join(PLANNING, 'STATE.md');
const CHECKPOINT_DIR = path.join(PLANNING, 'checkpoints');

function archiveAndResetHealth(source) {
  try {
    if (!fs.existsSync(PLANNING)) return;
    if (fs.existsSync(HEALTH_PATH)) {
      try {
        const prev = JSON.parse(fs.readFileSync(HEALTH_PATH, 'utf8'));
        if (prev && prev.session && prev.session.startedAt && (prev.callCount || 0) > 0) {
          const record = {
            startedAt: prev.session.startedAt,
            endedAt: new Date().toISOString(),
            endedBy: source,
            agent: prev.session.agent || 'unknown',
            story: prev.session.story || 'none',
            toolCalls: prev.callCount || 0,
            filesRead: (prev.session.filesRead || []).length,
            estimatedTokens: prev.session.estimatedTokens || 0,
          };
          fs.appendFileSync(HISTORY_PATH, JSON.stringify(record) + '\n');
        }
      } catch { /* unreadable health file — just reset it */ }
    }
    const fresh = {
      callCount: 0,
      lastThreshold: 'comfortable',
      lastCheck: null,
      session: {
        startedAt: null,
        agent: 'unknown',
        story: 'none',
        toolCalls: {},
        filesRead: [],
        estimatedTokens: 0,
        advisoriesIssued: [],
      },
    };
    fs.writeFileSync(HEALTH_PATH, JSON.stringify(fresh, null, 2));
  } catch { /* never block session start */ }
}

function latestCheckpointId() {
  try {
    if (!fs.existsSync(CHECKPOINT_DIR)) return null;
    const files = fs.readdirSync(CHECKPOINT_DIR).filter((f) => f.endsWith('.md')).sort();
    if (files.length === 0) return null;
    return files[files.length - 1].replace(/\.md$/, '');
  } catch {
    return null;
  }
}

function buildBootstrap(source) {
  if (!fs.existsSync(STATE_PATH)) return null;
  let state = '';
  try {
    state = fs.readFileSync(STATE_PATH, 'utf8');
  } catch {
    return null;
  }

  const pick = (re) => {
    const m = state.match(re);
    return m ? m[1].trim() : null;
  };
  const stage = pick(/- Stage: (.+)/);
  const phase = pick(/- Phase: (.+)/);
  const sprint = pick(/- Sprint: (.+)/);
  const story = pick(/- Story: (.+)/);
  const mode = pick(/- Mode: (.+)/);
  const domain = pick(/- Primary: (.+)/);
  const agent = pick(/- Name: (.+)/);

  const lines = ['[RMAD session bootstrap]'];
  const position = [
    stage ? `Stage: ${stage}` : null,
    phase ? `Phase: ${phase}` : null,
    sprint && sprint !== 'none' ? `Sprint: ${sprint}` : null,
    story && story !== 'none' ? `Story: ${story}` : null,
    mode ? `Mode: ${mode}` : null,
    domain && !domain.startsWith('pending') ? `Domain: ${domain}` : null,
  ].filter(Boolean);
  if (position.length > 0) lines.push(position.join(' | '));
  if (agent && agent.toLowerCase() !== 'none') lines.push(`Active agent: ${agent}`);

  // Project memory recall — index only (a map, not the territory); topic files
  // load just-in-time. Mirrors Claude Code's own auto-memory pattern.
  try {
    const memIndexPath = path.join(PLANNING, 'memory', 'MEMORY.md');
    if (fs.existsSync(memIndexPath)) {
      const topics = fs.readFileSync(memIndexPath, 'utf8')
        .replace(/<!--[\s\S]*?-->/g, '') // examples in comments are not memories
        .split(/\r?\n/)
        .filter((l) => l.trim().startsWith('- ['))
        .slice(0, 30);
      if (topics.length > 0) {
        lines.push(`Project memory topics (open .planning/memory/<file> when relevant):`);
        lines.push(...topics);
      }
    }
  } catch { /* memory recall is best-effort */ }

  if (source === 'resume' || source === 'compact') {
    const checkpoint = latestCheckpointId();
    if (checkpoint) {
      lines.push(
        source === 'compact'
          ? `Context was compacted. A checkpoint was saved: run /resume ${checkpoint} if continuity is lost.`
          : `Resumed session. Latest checkpoint: ${checkpoint} (load with /resume if needed).`
      );
    }
  }

  lines.push('Read .planning/STATE.md before starting any task (CLAUDE.md state rule).');
  return lines.join('\n');
}

async function main() {
  try {
    if (isHookDisabled('session-start')) process.exit(0);

    const { data } = await parseHookInput(3000);
    const source = (data && data.source) || 'startup';

    // Reset per-session metrics except when recovering from compaction —
    // a compacted session is the same conversation with a trimmed window,
    // and the bridge will report real usage on the next statusline tick.
    if (source !== 'compact') {
      archiveAndResetHealth(source);
    }

    try {
      if (fs.existsSync(BRIDGE_PATH)) fs.unlinkSync(BRIDGE_PATH);
    } catch { /* best-effort */ }

    const bootstrap = buildBootstrap(source);
    if (bootstrap) {
      emitJson({
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: bootstrap,
        },
      });
    }

    process.exit(0);
  } catch (err) {
    process.exit(0);
  }
}

main();
