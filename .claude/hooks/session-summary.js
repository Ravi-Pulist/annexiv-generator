#!/usr/bin/env node
// session-summary.js — Stop hook
// Generates session summary on exit
// Exit 0 always

const fs = require('fs');
const path = require('path');

async function main() {
  try {
    const statePath = path.join(process.cwd(), '.planning', 'STATE.md');
    if (!fs.existsSync(statePath)) process.exit(0);

    const state = fs.readFileSync(statePath, 'utf8');

    // Update metrics in STATE.md
    const metricsMatch = state.match(/## Metrics\n([\s\S]*?)(?=\n## |$)/);
    if (metricsMatch) {
      const sessionsMatch = state.match(/- Sessions: (\d+)/);
      const sessions = sessionsMatch ? parseInt(sessionsMatch[1]) + 1 : 1;
      const updated = state.replace(
        /- Sessions: \d+/,
        `- Sessions: ${sessions}`
      ).replace(
        /- Last session: .+/,
        `- Last session: ${new Date().toISOString()}`
      );
      fs.writeFileSync(statePath, updated);
    }

    process.exit(0);
  } catch (err) {
    process.exit(0);
  }
}

main();
