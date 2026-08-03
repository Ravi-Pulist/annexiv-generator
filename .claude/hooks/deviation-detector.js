#!/usr/bin/env node
// deviation-detector.js — PreToolUse hook (Write, Edit)
// Checks if file modification serves current story's scope
// Exit 0 always — warns but never blocks.
// The warning is delivered to the model via hookSpecificOutput.additionalContext
// (stderr on exit 0 is ignored by Claude Code and kept only for humans/debug).

const fs = require('fs');
const path = require('path');
const { formatTOON } = require('./lib/toon-formatter.js');
const { isHookDisabled, emitAdditionalContext } = require('./lib/hook-input.js');

async function main() {
  try {
    if (isHookDisabled('deviation-detector')) process.exit(0);

    const statePath = path.join(process.cwd(), '.planning', 'STATE.md');
    if (!fs.existsSync(statePath)) process.exit(0);

    const state = fs.readFileSync(statePath, 'utf8');

    // Extract current story from STATE.md
    const storyMatch = state.match(/- Story: (S\d+-\d+)/);
    if (!storyMatch) process.exit(0); // No active story

    const storyId = storyMatch[1];

    // Find the story file
    const sprintMatch = state.match(/- Sprint: (\d+)/);
    if (!sprintMatch) process.exit(0);

    const sprintNum = sprintMatch[1];
    const storiesDir = path.join(process.cwd(), '.planning', 'sprints', `sprint-${sprintNum}`, 'stories');
    if (!fs.existsSync(storiesDir)) process.exit(0);

    const storyFiles = fs.readdirSync(storiesDir).filter(f => f.startsWith(storyId));
    if (storyFiles.length === 0) process.exit(0);

    const storyContent = fs.readFileSync(path.join(storiesDir, storyFiles[0]), 'utf8');

    // Extract file list from story
    const fileListMatch = storyContent.match(/## File List\n([\s\S]*?)(?=\n## |$)/);
    if (!fileListMatch) process.exit(0);

    const fileList = fileListMatch[1]
      .split('\n')
      .map(l => l.replace(/^- /, '').replace(/\s*\(.*\)$/, '').trim())
      .filter(Boolean);

    // Get the file being modified
    const input = await readStdin();
    if (!input) process.exit(0);

    const data = JSON.parse(input);
    const filePath = (data.tool_input && (data.tool_input.file_path || data.tool_input.path)) || '';
    if (!filePath) process.exit(0);

    const normalizedPath = filePath.replace(/\\/g, '/');
    const inScope = fileList.some(f => normalizedPath.includes(f) || f.includes(normalizedPath));

    if (!inScope) {
      process.stderr.write(formatTOON('DEVIATION DETECTED', {
        File: filePath,
        Story: storyId,
        Issue: 'File not in story file list',
        Action: 'Add file to story or refocus on assigned work'
      }));
      emitAdditionalContext(
        'PreToolUse',
        `[RMAD deviation-detector] ${filePath} is outside story ${storyId}'s file list. ` +
        'Apply the Deviation Rules in CLAUDE.md: fix only what this story caused; ' +
        'either add the file to the story File List with a one-line justification, ' +
        'log it in deferred-items and continue, or stop and ask the CTO if this is an architectural change.'
      );
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
