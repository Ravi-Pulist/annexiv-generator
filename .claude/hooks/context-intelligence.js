#!/usr/bin/env node
// context-intelligence.js — PostToolUse hook
// Monitors context usage, tracks token spend, provides optimization advisories.
// Exit 0 always (informational).
//
// Context pressure is measured from .planning/.context-bridge.json when fresh —
// real harness numbers written by statusline.js (context_window.used_percentage).
// Per-tool token estimates remain as the fallback when no bridge data exists.
// Advisories reach the model via hookSpecificOutput.additionalContext; the
// stderr TOON boxes are kept for humans running with --debug.

const fs = require('fs');
const path = require('path');
const { formatTOON } = require('./lib/toon-formatter.js');
const {
  parseHookInput,
  resolveAgent,
  isHookDisabled,
  emitAdditionalContext,
  readContextBridge,
} = require('./lib/hook-input.js');

const HEALTH_PATH = path.join(process.cwd(), '.planning', 'context-health.json');
const STATE_PATH = path.join(process.cwd(), '.planning', 'STATE.md');
const DEBOUNCE_CALLS = 5;

// Rough token estimates per tool operation (fallback when no bridge data)
const TOKEN_ESTIMATES = {
  Read: 1500,       // avg file read ~1500 tokens
  Write: 800,       // write content ~800 tokens
  Edit: 400,        // edit diff ~400 tokens
  Bash: 600,        // command + output ~600 tokens
  Grep: 300,        // search results ~300 tokens
  Glob: 100,        // file list ~100 tokens
  WebSearch: 500,   // search results ~500 tokens
  WebFetch: 2000,   // web page content ~2000 tokens
};

const DEFAULT_HEALTH = {
  callCount: 0,
  lastThreshold: 'comfortable',
  lastCheck: null,
  session: {
    startedAt: null,
    agent: 'unknown',
    story: 'none',
    toolCalls: {},      // { toolName: count }
    filesRead: [],       // unique file paths read this session
    estimatedTokens: 0,  // rough estimate of context consumed (fallback metric)
    advisoriesIssued: [] // track which advisories were already shown
  }
};

async function main() {
  try {
    if (isHookDisabled('context-intelligence')) process.exit(0);

    // Read or initialize health state
    let health = { ...DEFAULT_HEALTH };
    if (fs.existsSync(HEALTH_PATH)) {
      try {
        const existing = JSON.parse(fs.readFileSync(HEALTH_PATH, 'utf8'));
        health = { ...DEFAULT_HEALTH, ...existing, session: { ...DEFAULT_HEALTH.session, ...existing.session } };
      } catch { /* use defaults */ }
    }

    // Initialize session if new
    if (!health.session.startedAt) {
      health.session.startedAt = new Date().toISOString();
      // Read current agent/story from STATE.md
      if (fs.existsSync(STATE_PATH)) {
        const state = fs.readFileSync(STATE_PATH, 'utf8');
        const agentMatch = state.match(/- Name: (.+)/);
        const storyMatch = state.match(/- Story: (.+)/);
        if (agentMatch) health.session.agent = agentMatch[1].trim();
        if (storyMatch) health.session.story = storyMatch[1].trim();
      }
    }

    // Read stdin for tool call data
    const { data } = await parseHookInput(3000);
    let toolName = 'unknown';
    let filePath = '';

    if (data) {
      toolName = data.tool_name || 'unknown';
      filePath = (data.tool_input && (data.tool_input.file_path || data.tool_input.path)) || '';
      const agent = resolveAgent(data);
      if (agent) health.session.agent = agent;
    }

    // Track tool usage
    health.callCount = (health.callCount || 0) + 1;
    health.session.toolCalls[toolName] = (health.session.toolCalls[toolName] || 0) + 1;

    // Track files read (unique)
    if (toolName === 'Read' && filePath && !health.session.filesRead.includes(filePath)) {
      health.session.filesRead.push(filePath);
    }

    // Estimate token impact
    const tokenImpact = TOKEN_ESTIMATES[toolName] || 200;
    health.session.estimatedTokens = (health.session.estimatedTokens || 0) + tokenImpact;

    // Debounce detailed checks
    if (health.callCount % DEBOUNCE_CALLS !== 0) {
      fs.writeFileSync(HEALTH_PATH, JSON.stringify(health, null, 2));
      process.exit(0);
    }

    // ── Context advisories ──────────────────────────────────────

    const totalCalls = health.callCount;
    const totalTokens = health.session.estimatedTokens;
    const filesRead = health.session.filesRead.length;
    const advisories = [];

    // Advisory: High file read count without repo map
    if (filesRead > 15 && !health.session.advisoriesIssued.includes('repo-map')) {
      const repoMapPath = path.join(process.cwd(), '.planning', 'repo-map.md');
      if (!fs.existsSync(repoMapPath)) {
        advisories.push({
          id: 'repo-map',
          message: `${filesRead} files read this session. Generate a repo map for more efficient context loading.`,
          action: 'Run /atlas-repomap to generate .planning/repo-map.md'
        });
      }
    }

    // Advisory: Estimated token pressure (fallback metric only)
    if (totalTokens > 80000 && !health.session.advisoriesIssued.includes('token-pressure')) {
      advisories.push({
        id: 'token-pressure',
        message: `Estimated ~${Math.round(totalTokens / 1000)}K tokens consumed this session.`,
        action: 'Consider compacting or saving a checkpoint with /checkpoint-list'
      });
    }

    // Advisory: High token consumption on reads
    const readCount = health.session.toolCalls['Read'] || 0;
    if (readCount > 20 && !health.session.advisoriesIssued.includes('read-heavy')) {
      advisories.push({
        id: 'read-heavy',
        message: `${readCount} file reads this session. Use Grep/Glob for targeted discovery instead of reading full files.`,
        action: 'Prefer Grep for searching, load repo-map for structural overview'
      });
    }

    // Advisory: Session length
    if (totalCalls > 100 && !health.session.advisoriesIssued.includes('long-session')) {
      advisories.push({
        id: 'long-session',
        message: `${totalCalls} tool calls this session. Context window may be approaching limits.`,
        action: 'Consider saving checkpoint and starting fresh if context feels degraded'
      });
    }

    // ── Threshold alerts — real data first, estimates as fallback ──

    const thresholds = {
      comfortable: 50,
      cautious: 35,
      warning: 25,
      critical: 15,
      emergency: 10
    };

    const bridge = readContextBridge(process.cwd());
    let contextRemaining;
    let contextSource;
    if (bridge && typeof bridge.contextUsedPercent === 'number') {
      contextRemaining = Math.max(Math.round(100 - bridge.contextUsedPercent), 0);
      contextSource = 'harness';
    } else {
      // Fallback estimate assuming a 200K window
      const estimatedCapacity = 200000;
      const usagePercent = Math.round((totalTokens / estimatedCapacity) * 100);
      contextRemaining = Math.max(100 - usagePercent, 5);
      contextSource = 'estimate';
    }

    let currentThreshold = 'comfortable';
    if (contextRemaining <= thresholds.emergency) currentThreshold = 'emergency';
    else if (contextRemaining <= thresholds.critical) currentThreshold = 'critical';
    else if (contextRemaining <= thresholds.warning) currentThreshold = 'warning';
    else if (contextRemaining <= thresholds.cautious) currentThreshold = 'cautious';

    let thresholdMessage = null;
    if (currentThreshold !== health.lastThreshold) {
      const messages = {
        cautious: 'Context usage rising. Summarize non-essential context; prefer Grep over full-file reads.',
        warning: 'Context pressure. Wrap up the current step and recommend compacting to the CTO. Load repo-map summaries instead of full files.',
        critical: 'Context critical. Finish the in-flight change, update STATE.md, and request a compact — a checkpoint will be saved automatically.',
        emergency: 'Context emergency. Stop taking on new work. Update STATE.md with exact resume instructions and notify the CTO.'
      };
      if (messages[currentThreshold]) {
        thresholdMessage =
          `Context ${currentThreshold.toUpperCase()} — ~${contextRemaining}% remaining ` +
          `(${contextSource === 'harness' ? 'measured' : 'estimated'}). ${messages[currentThreshold]}`;
        process.stderr.write(formatTOON(
          `CONTEXT: ${currentThreshold.toUpperCase()}`,
          {
            Status: currentThreshold,
            'Remaining': `${contextRemaining}% (${contextSource})`,
            'Tool calls': String(totalCalls),
            'Files read': String(filesRead),
            Action: messages[currentThreshold]
          }
        ));
      }
    }

    // ── Deliver to the model (single additionalContext payload) ──

    const contextLines = [];
    if (advisories.length > 0) {
      const advData = {};
      for (const adv of advisories) {
        advData[adv.id] = `${adv.message} → ${adv.action}`;
        health.session.advisoriesIssued.push(adv.id);
        contextLines.push(`- ${adv.message} ${adv.action}`);
      }
      process.stderr.write(formatTOON('CONTEXT INTELLIGENCE', advData));
    }
    if (thresholdMessage) contextLines.unshift(`- ${thresholdMessage}`);

    if (contextLines.length > 0) {
      emitAdditionalContext('PostToolUse', `[RMAD context-intelligence]\n${contextLines.join('\n')}`);
    }

    health.lastThreshold = currentThreshold;
    health.lastCheck = new Date().toISOString();
    fs.writeFileSync(HEALTH_PATH, JSON.stringify(health, null, 2));

    process.exit(0);
  } catch (err) {
    process.exit(0);
  }
}

main();
