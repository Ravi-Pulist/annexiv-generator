// bash-guard.js
// Best-effort path extraction from shell commands, so agent boundaries survive Bash.
//
// WHY THIS EXISTS: path-enforcer classified tool calls by `tool_input.file_path`. Bash
// carries `command`, not `file_path`, so the enforcer fell straight through its
// "no path? allow" branch. 11 of 16 agents hold Bash. Tara is defined as "black box QA —
// NO source access" with `blocked: ['src/**']` and has no Grep/Glob, so Bash is her ONLY
// search tool: `Read src/app.js` was blocked and `cat src/app.js` was not. The declared
// boundary was one keystroke from irrelevant.
//
// WHAT THIS IS NOT: a sandbox. A shell is Turing-complete — base64, variable indirection,
// $(printf), a Python one-liner, or a script written elsewhere and executed will all
// defeat token scanning, and no amount of regex fixes that. This raises the cost of an
// ACCIDENTAL boundary crossing from zero to "you had to mean it", which is the realistic
// threat model: a well-intentioned agent reaching for `cat` because Read was blocked.
// A determined model is out of scope, and pretending otherwise is how the framework got
// its "hook-enforced" claim in the first place.
//
// DESIGN BIAS: false positives are worse than false negatives here. A guard that blocks
// `npm test` gets switched off within a day, and then it enforces nothing at all. So we
// only check the blocked LIST (unambiguous) plus explicit write targets — never the full
// readable allowlist.

// Commands whose non-flag arguments are read as file content.
const READ_COMMANDS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'bat', 'type',
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack',
  'awk', 'sed', 'cut', 'sort', 'uniq', 'wc', 'diff',
  'od', 'xxd', 'hexdump', 'strings', 'file', 'nl', 'tac',
  'jq', 'yq', 'python', 'python3', 'node',
  // Not obfuscation — these are the commands a well-intentioned agent actually reaches
  // for when it wants a file's contents, and every one of them walked past the guard.
  // `base64 .env`, `openssl base64 -in .env`, `tar cf - .env` and `perl -pe 1 src/app.js`
  // were all allowed against agents explicitly fenced from those paths. The guard is
  // best-effort by design; it should at minimum cover the obvious cases.
  'base64', 'openssl', 'tar', 'zip', 'gzip', 'gunzip', 'zcat', 'bzcat', 'xxd',
  'perl', 'ruby', 'php', 'sh', 'bash', 'zsh', 'pwsh', 'powershell',
  'md5sum', 'sha1sum', 'sha256sum', 'shasum', 'cmp', 'split', 'expand', 'fold',
  'iconv', 'dos2unix', 'unix2dos', 'realpath', 'readlink'
]);

// Commands whose arguments are written/destroyed.
const WRITE_COMMANDS = new Set([
  'tee', 'truncate', 'dd',
  'cp', 'mv', 'rm', 'rmdir', 'touch', 'mkdir', 'ln',
  'chmod', 'chown', 'install', 'shred'
]);

// Split on shell separators so each pipeline stage is inspected on its own.
function splitStages(command) {
  return String(command)
    .split(/(?:\|\||&&|[;|]|\n)/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function stripQuotes(tok) {
  return tok.replace(/^['"]|['"]$/g, '');
}

// Device sinks are not files anyone can have a boundary about. `2>/dev/null` appears in
// roughly every second shell command ever written, and an early version of this guard
// denied it — /dev/null resolves outside the project root, so a known agent was refused.
// A guard that blocks `2>/dev/null` is a guard that gets switched off by lunchtime.
const DEVICE_SINKS = new Set([
  '/dev/null', '/dev/stdout', '/dev/stderr', '/dev/zero', '/dev/tty', '/dev/fd',
  'nul', 'NUL', 'CON', 'con'
]);

function isDeviceSink(tok) {
  const t = tok.replace(/\\/g, '/');
  return DEVICE_SINKS.has(t) || DEVICE_SINKS.has(t.toLowerCase()) || t.startsWith('/dev/fd/');
}

// Does this token look like a path we should reason about, rather than a flag,
// a subcommand, or a bare word? Deliberately conservative.
function looksLikePath(tok) {
  if (!tok || tok.startsWith('-')) return false;
  if (/^[a-z]+=/i.test(tok)) return false; // VAR=value
  if (tok.includes('$') || tok.includes('`')) return false; // unresolvable at scan time
  if (isDeviceSink(tok)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(tok)) return false; // a URL is not a file path
  return /[/\\]/.test(tok) || /^\.[a-z]/i.test(tok) || /\.[a-z0-9]{1,8}$/i.test(tok);
}

function tokenize(stage) {
  // Keep quoted spans together; good enough for path extraction.
  return (stage.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(stripQuotes);
}

// Extract { path, op } candidates from one shell command.
function extractPaths(command) {
  const found = [];
  const add = (p, op) => {
    if (looksLikePath(p)) found.push({ path: p, op });
  };

  for (const stage of splitStages(command)) {
    const tokens = tokenize(stage);
    if (!tokens.length) continue;

    // Redirection targets are writes, wherever they appear: > f, >> f, 2> f
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const redirect = t.match(/^\d?>{1,2}$/);
      if (redirect && tokens[i + 1]) {
        add(tokens[i + 1], 'write');
        i++;
        continue;
      }
      // Attached form: >file
      const attached = t.match(/^\d?>{1,2}(.+)$/);
      if (attached) add(attached[1], 'write');
      // Input redirection is a read
      const inAttached = t.match(/^<(.+)$/);
      if (inAttached) add(inAttached[1], 'read');
      if (t === '<' && tokens[i + 1]) {
        add(tokens[i + 1], 'read');
        i++;
      }
    }

    // The command word, ignoring env prefixes and sudo
    let ci = 0;
    while (ci < tokens.length && (/^[a-z_][a-z0-9_]*=/i.test(tokens[ci]) || tokens[ci] === 'sudo')) ci++;
    const cmd = (tokens[ci] || '').split(/[/\\]/).pop();
    const args = tokens.slice(ci + 1).filter((a) => !/^\d?[<>]/.test(a));

    if (WRITE_COMMANDS.has(cmd)) {
      // sed -i edits in place; otherwise sed reads.
      const inPlace = cmd === 'sed' && args.some((a) => a.startsWith('-i'));
      for (const a of args) add(a, inPlace || WRITE_COMMANDS.has(cmd) ? 'write' : 'read');
    } else if (READ_COMMANDS.has(cmd)) {
      if (cmd === 'sed' && args.some((a) => a.startsWith('-i'))) {
        for (const a of args) add(a, 'write');
      } else {
        for (const a of args) add(a, 'read');
      }
    }
  }
  return found;
}

// Check a Bash command against an agent's boundaries.
// Returns { allowed, reason, path } — allowed:true when nothing identifiable is violated.
function checkBashCommand(command, agentName, matrix, projectRoot) {
  if (!command || !agentName) return { allowed: true };
  for (const { path: p, op } of extractPaths(command)) {
    // Blocked list applies to every extracted path, read or write.
    const blocked = matrix.isBlocked(agentName, p, projectRoot);
    if (blocked.blocked) {
      return { allowed: false, reason: blocked.reason, path: p, op };
    }
    // Write targets additionally need to fall inside the agent's writable set.
    if (op === 'write') {
      const verdict = matrix.isAllowed(agentName, p, 'write', projectRoot);
      if (!verdict.allowed) return { allowed: false, reason: verdict.reason, path: p, op };
    }
  }
  return { allowed: true };
}

module.exports = { checkBashCommand, extractPaths, READ_COMMANDS, WRITE_COMMANDS };
