#!/usr/bin/env node
// observation-capture.js — PreToolUse hook (async, all tools)
// Captures session activity for learning system
// Exit 0 always, async, non-blocking

const fs = require('fs');
const path = require('path');
const { resolveAgent, isHookDisabled } = require('./lib/hook-input.js');

const OBS_DIR = path.join(process.cwd(), '.planning', 'learning', 'observations');
const OBS_FILE = path.join(OBS_DIR, 'observations.jsonl');
const MAX_SIZE = 10 * 1024 * 1024; // 10MB rotation threshold

async function main() {
  try {
    if (isHookDisabled('observation-capture')) process.exit(0);

    if (!fs.existsSync(OBS_DIR)) {
      fs.mkdirSync(OBS_DIR, { recursive: true });
    }

    const input = await readStdin();
    if (!input) process.exit(0);

    const data = JSON.parse(input);
    const toolName = data.tool_name || 'unknown';
    const agentName = resolveAgent(data) || 'unknown';
    const inputSummary = summarize(data.tool_input);

    const observation = {
      timestamp: new Date().toISOString(),
      event: 'ToolUse',
      tool: toolName,
      agent: agentName,
      input_summary: inputSummary,
      scrubbed: true
    };

    // Rotate if needed
    if (fs.existsSync(OBS_FILE)) {
      const stats = fs.statSync(OBS_FILE);
      if (stats.size > MAX_SIZE) {
        const rotated = OBS_FILE.replace('.jsonl', `-${Date.now()}.jsonl`);
        fs.renameSync(OBS_FILE, rotated);
      }
    }

    fs.appendFileSync(OBS_FILE, JSON.stringify(observation) + '\n');
    process.exit(0);
  } catch (err) {
    process.exit(0);
  }
}

function summarize(input) {
  if (!input) return '';
  // Scrub sensitive data — return only structural summary
  if (input.file_path) return `File: ${input.file_path}`;
  if (input.command) return `Cmd: ${input.command.substring(0, 80)}`;
  if (input.pattern) return `Search: ${input.pattern}`;
  return 'tool-input';
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
    setTimeout(() => resolve(data), 3000);
  });
}

main();
