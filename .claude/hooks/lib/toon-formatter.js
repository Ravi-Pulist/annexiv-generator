// toon-formatter.js
// Text-Oriented Output Notation — human-readable hook output formatting

function formatBox(title, lines, width = 52) {
  const border = '='.repeat(width);
  const divider = '-'.repeat(width);
  const output = [];

  output.push(`\u2554${'='.repeat(width)}\u2557`);
  output.push(`\u2551  ${title.padEnd(width - 3)}\u2551`);
  output.push(`\u2560${divider}\u2563`);

  for (const line of lines) {
    const padded = `  ${line}`.padEnd(width - 1);
    output.push(`\u2551${padded}\u2551`);
  }

  output.push(`\u255A${'='.repeat(width)}\u255D`);
  return output.join('\n');
}

function formatTOON(title, data) {
  if (typeof data === 'string') {
    return formatBox(title, [data]);
  }

  if (Array.isArray(data)) {
    const lines = [];
    for (const item of data) {
      if (item.name) lines.push(`Pattern:  ${item.name}`);
      if (item.severity) lines.push(`Severity: ${item.severity.toUpperCase()}`);
      if (item.description) lines.push(`Detail:   ${item.description}`);
      if (item.action) lines.push(`Action:   ${item.action.toUpperCase()}`);
      lines.push('');
    }
    return formatBox(title, lines);
  }

  if (typeof data === 'object') {
    const lines = [];
    for (const [key, value] of Object.entries(data)) {
      lines.push(`${key}: ${value}`);
    }
    return formatBox(title, lines);
  }

  return formatBox(title, [String(data)]);
}

function formatProgressBar(percent, width = 20) {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty) + ` ${percent}%`;
}

function formatStatusLine(parts) {
  return parts.filter(Boolean).join(' | ');
}

module.exports = { formatBox, formatTOON, formatProgressBar, formatStatusLine };
