#!/usr/bin/env node
// statusline.js — Statusline hook
// Outputs a single-line status for Claude Code and persists real harness
// telemetry (model, context usage, cost) to .planning/.context-bridge.json
// so context-intelligence.js can alert on MEASURED context pressure.
//
// Claude Code pipes a JSON payload on stdin (model, workspace, cost,
// context_window.used_percentage, ...). All parsing is best-effort — with
// no stdin the hook falls back to STATE.md-only output.

const fs = require('fs');
const path = require('path');
const { readStdin, writeContextBridge } = require('./lib/hook-input.js');

async function main() {
  let harness = null;
  try {
    const { raw } = await readStdin(1500);
    if (raw) harness = JSON.parse(raw);
  } catch { /* no or invalid stdin — STATE.md fallback below */ }

  const parts = [];
  let contextUsedPercent = null;
  let model = null;
  let costUsd = null;

  try {
    if (harness) {
      model = (harness.model && (harness.model.display_name || harness.model.id)) || null;
      if (harness.context_window && typeof harness.context_window.used_percentage === 'number') {
        contextUsedPercent = harness.context_window.used_percentage;
      }
      if (harness.cost && typeof harness.cost.total_cost_usd === 'number') {
        costUsd = harness.cost.total_cost_usd;
      }
      writeContextBridge(process.cwd(), {
        model,
        contextUsedPercent,
        costUsd,
        sessionId: harness.session_id || null,
      });
    }
  } catch { /* bridge is best-effort */ }

  try {
    if (model) parts.push(model);

    const statePath = path.join(process.cwd(), '.planning', 'STATE.md');
    if (fs.existsSync(statePath)) {
      const state = fs.readFileSync(statePath, 'utf8');

      const stageMatch = state.match(/- Stage: (.+)/);
      const phaseMatch = state.match(/- Phase: (.+)/);
      const sprintMatch = state.match(/- Sprint: (.+)/);
      const storyMatch = state.match(/- Story: (.+)/);
      const modeMatch = state.match(/- Mode: (.+)/);
      const domainMatch = state.match(/- Primary: (.+)/);

      if (stageMatch) parts.push(stageMatch[1].trim());
      else if (phaseMatch) parts.push(phaseMatch[1].trim());
      if (sprintMatch && sprintMatch[1].trim() !== 'none') parts.push(`Sprint ${sprintMatch[1].trim()}`);
      if (storyMatch && storyMatch[1].trim() !== 'none') parts.push(storyMatch[1].trim());
      if (modeMatch) parts.push(modeMatch[1].trim());
      if (domainMatch) {
        const domain = domainMatch[1].trim().split(' ')[0];
        if (domain !== 'pending') parts.push(domain);
      }
    } else if (parts.length === 0) {
      console.log('rmad v2.1.0 | No project initialized');
      process.exit(0);
    }

    if (contextUsedPercent !== null) {
      parts.push(`ctx ${Math.max(0, Math.round(100 - contextUsedPercent))}%`);
    }
    if (costUsd !== null) {
      parts.push(`$${costUsd.toFixed(2)}`);
    }

    console.log(parts.join(' | ') || 'rmad v2.1.0');
    process.exit(0);
  } catch (err) {
    console.log('rmad v2.1.0');
    process.exit(0);
  }
}

main();
