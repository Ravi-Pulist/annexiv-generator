#!/usr/bin/env node
// accountability-logger.js — PostToolUse hook (Write, Edit)
// Logs file modifications for audit trail
// Exit 0 always

const fs = require('fs');
const path = require('path');
const { resolveAgent, isHookDisabled } = require('./lib/hook-input.js');

const LOG_PATH = path.join(process.cwd(), '.planning', 'accountability', 'decision-log.md');

async function main() {
  try {
    if (isHookDisabled('accountability-logger')) process.exit(0);

    const input = await readStdin();
    if (!input) process.exit(0);

    const data = JSON.parse(input);
    const agentName = resolveAgent(data) || 'unknown';
    const toolName = data.tool_name || 'unknown';
    const filePath = (data.tool_input && (data.tool_input.file_path || data.tool_input.path)) || 'unknown';
    const timestamp = new Date().toISOString();

    const logEntry = `| ${timestamp} | ${agentName} | ${toolName} | ${filePath} | File modified |\n`;

    if (fs.existsSync(LOG_PATH)) {
      fs.appendFileSync(LOG_PATH, logEntry);
    }

    process.exit(0);
  } catch (err) {
    process.exit(0);
  }
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(''));
    setTimeout(() => resolve(data), 5000);
  });
}

main();
