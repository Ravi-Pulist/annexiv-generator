// treesitter.js — host side of the real-parser extractor.
//
// Mirrors extractors/python.js: probe for availability, spawn a child, parse JSON back,
// and record an honest failure per file when anything goes wrong. Nothing here throws
// into the index build — a missing grammar degrades one language, never the whole graph.
//
// GRAMMARS COME FROM RMAD'S OWN INSTALL, NOT THE TARGET REPO. `rmad index build --root
// ../some-app` must work against a repo that has never heard of tree-sitter, so the
// .wasm files are resolved relative to this file's package, wherever npx put it.
//
// THE DEPENDENCY IS OPTIONAL ON PURPOSE. web-tree-sitter and the grammar bundle are
// declared in optionalDependencies: if the install is offline, on an unsupported
// platform, or simply skipped, `npx rmad` still runs and JS/TS falls back to the
// heuristic scanner — labelled `heuristic`, exactly as before. A hard dependency would
// trade a working index for a slightly better one.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CHILD = path.join(__dirname, 'treesitter_extract.js');

// Languages this extractor can parse exactly, mapped from the graph's language names.
// `python` is present as a FALLBACK only — python_ast.py is preferred when python3 is on
// PATH because it resolves more (real scope analysis), but a machine without Python
// should still get an exact parse rather than nothing.
const SUPPORTED = new Set(['javascript', 'typescript', 'tsx', 'python', 'go', 'java', 'ruby', 'rust', 'csharp']);

let cached = null;

/**
 * Where the prebuilt grammars live, or null if they were never installed.
 * Resolved from this package so a global install works against any target repo.
 */
function grammarDir() {
  try {
    const pkg = require.resolve('tree-sitter-wasms/package.json', { paths: [__dirname] });
    const dir = path.join(path.dirname(pkg), 'out');
    return fs.existsSync(dir) ? dir : null;
  } catch {
    return null;
  }
}

function runtimeAvailable() {
  try {
    require.resolve('web-tree-sitter', { paths: [__dirname] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Is exact parsing available at all? Returns a reason when it is not, because
 * "why is my JS still heuristic" needs an answer the CLI can print.
 */
function probe() {
  if (cached) return cached;
  const dir = grammarDir();
  if (!runtimeAvailable()) cached = { ok: false, reason: 'web-tree-sitter not installed', grammarDir: null };
  else if (!dir) cached = { ok: false, reason: 'tree-sitter-wasms grammars not installed', grammarDir: null };
  else cached = { ok: true, reason: null, grammarDir: dir };
  return cached;
}

function supports(lang) {
  return SUPPORTED.has(lang) && probe().ok;
}

/**
 * Extract a batch. Returns one document per input file, in order.
 * Files are passed on stdin rather than argv: a 14,000-file repo blows the Windows
 * command-line limit, and one spawn beats forty.
 */
function extract(root, files) {
  const p = probe();
  if (!p.ok) {
    return files.map((f) => ({
      path: f.rel, language: f.lang, fidelity: 'unavailable', symbols: [], imports: [],
      error: p.reason
    }));
  }

  const payload = JSON.stringify({
    root,
    grammarDir: p.grammarDir,
    files: files.map((f) => ({ rel: f.rel, lang: f.lang }))
  });

  // A TIMEOUT is mandatory, not defensive tidiness. spawnSync BLOCKS, so a hostile or
  // merely pathological file — a multi-hundred-megabyte generated bundle, or input that
  // makes the WASM parser degenerate — hung `rmad index build` forever, and with it any
  // hook that triggers an index. Indexing runs over UNTRUSTED repository content by
  // definition, so "it will finish eventually" is not an assumption available here.
  const res = spawnSync(process.execPath, [CHILD], {
    input: payload,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    timeout: 120000,
    killSignal: 'SIGKILL',
    windowsHide: true
  });

  if (res.status !== 0 || !res.stdout) {
    const why = (res.stderr || res.error && res.error.message || 'no output').toString().slice(0, 200);
    return files.map((f) => ({
      path: f.rel, language: f.lang, fidelity: 'unavailable', symbols: [], imports: [],
      error: `tree-sitter extractor failed: ${why}`
    }));
  }

  try {
    return JSON.parse(res.stdout);
  } catch (err) {
    return files.map((f) => ({
      path: f.rel, language: f.lang, fidelity: 'unavailable', symbols: [], imports: [],
      error: `tree-sitter output unparseable: ${err.message}`
    }));
  }
}

module.exports = { extract, supports, probe, SUPPORTED };
