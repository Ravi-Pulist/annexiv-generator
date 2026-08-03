// coverage.js — RMAD-21. Which functions actually RAN, from the runtime rather than the graph.
//
// WHY THIS EXISTS: O2 asked "does a call path exist from a test to this symbol?" and
// answered it by traversing the graph. Measured on this framework, only 21.1% of
// production functions are reachable that way, and 47.6% were being counted as covered
// purely because a test IMPORTED their file. Raising the traversal depth does not help —
// reachability saturates at 24.6% by depth 5 — because 28.8% of symbols have no inbound
// resolved call edge at all.
//
// The reason is architectural, not analytical. RMAD is entry-point heavy: hooks, agents
// and CLI commands are PROCESSES. Tests exercise them by spawning a subprocess, so at the
// source level there is no call edge from the test to the hook's main(), and no static
// analysis can invent one.
//
// V8 coverage has no such problem: it records what executed, including in spawned
// children. Zero new dependencies — NODE_V8_COVERAGE is built into Node.
//
// WHAT THIS IS NOT: evidence that the software WORKS. It is evidence that a function ran.
// That is strictly weaker than Augment's verifier exercising a change in a live
// environment, and the difference should not be blurred.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

/** file:///E:/repo/src/a.js -> src/a.js, or null when outside the repo. */
function relFromUrl(url, root) {
  let p = String(url || '');
  if (!p.startsWith('file://')) return null;
  try { p = decodeURIComponent(p.replace(/^file:\/\/\/?/, '')); } catch { return null; }
  p = p.split('\\').join('/');
  const r = path.resolve(root).split('\\').join('/');
  const lower = (s) => (process.platform === 'win32' ? s.toLowerCase() : s);
  if (!lower(p).startsWith(lower(r) + '/')) return null;
  return p.slice(r.length + 1);
}

/** Byte offset -> 1-based line. Built once per file; V8 reports many functions per script. */
function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * Read a NODE_V8_COVERAGE directory into { file, line, name } for every function that ran.
 * Skips node_modules and anything outside the repo — a dependency executing is not evidence
 * about this codebase.
 */
function readCoverageDir(dir, root) {
  const executed = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return executed; }

  const lineOf = new Map();   // rel -> fn
  for (const f of files) {
    let doc;
    try { doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    for (const script of (doc.result || [])) {
      const rel = relFromUrl(script.url, root);
      if (!rel || rel.includes('node_modules/')) continue;
      if (!lineOf.has(rel)) {
        try { lineOf.set(rel, lineIndex(fs.readFileSync(path.join(root, rel), 'utf8'))); }
        catch { lineOf.set(rel, null); }
      }
      const toLine = lineOf.get(rel);
      if (!toLine) continue;
      for (const fn of (script.functions || [])) {
        const range = (fn.ranges || [])[0];
        if (!range || !range.count) continue;          // count 0 means it never ran
        executed.push({ file: rel, line: toLine(range.startOffset), name: fn.functionName || '' });
      }
    }
  }
  return executed;
}

/**
 * Run a command with V8 coverage on and return what executed.
 * The command is the PROJECT'S OWN test command — RMAD does not own an execution
 * environment and must not pretend to.
 */
function collect(root, { command, args, timeoutMs } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmad-cov-'));
  try {
    const res = spawnSync(command || process.execPath, args || [], {
      cwd: root,
      env: Object.assign({}, process.env, { NODE_V8_COVERAGE: dir }),
      encoding: 'utf8',
      timeout: timeoutMs || 600000,
      shell: false
    });
    return {
      executed: readCoverageDir(dir, root),
      status: res.status,
      timedOut: !!res.error && /ETIMEDOUT|timed out/i.test(String(res.error.message)),
      stderr: String(res.stderr || '').slice(0, 4000)
    };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * The Python equivalent of NODE_V8_COVERAGE, and it exists because O2 was UNSATISFIABLE
 * on a Python project.
 *
 * `collect` above sets NODE_V8_COVERAGE, which a Python interpreter ignores, so the run
 * produced nothing and RMAD correctly refused to record an empty pass -- leaving O2
 * permanently INCONCLUSIVE for every Python codebase. An obligation that no evidence can
 * ever satisfy is not a strict obligation, it is a broken one.
 *
 * Mechanism: a `sitecustomize.py` on PYTHONPATH installs `sys.setprofile`, which fires on
 * function ENTRY only -- far cheaper than line tracing, and precisely the question O2
 * asks ("did this symbol run?"). `threading.setprofile` covers worker threads, and because
 * PYTHONPATH is inherited, spawned subprocesses are covered too. That last part matters
 * for the same reason it did for Node: a CLI exercised by spawning it has no static call
 * edge from the test.
 *
 * Zero new dependencies: `sys`, `threading`, `atexit` and `json` are stdlib. coverage.py
 * would have been the obvious choice and is a dependency this framework does not take.
 *
 * KNOWN LIMIT, stated rather than discovered later: only one `sitecustomize` module can
 * be imported, so a project shipping its own would be shadowed. We chain to it explicitly
 * before installing the profiler; if that chaining ever fails the project's own startup
 * hook is skipped for the duration of the measured run, and nothing else.
 */
const PY_SITECUSTOMIZE = `# Written by RMAD for one measured run. Not installed anywhere permanent.
import os, sys, json, atexit, threading

_OUT = os.environ.get("RMAD_PYCOV_DIR")

# Chain to any sitecustomize the project itself ships -- ours must not silently replace it.
try:
    import importlib.util as _u
    _here = os.path.dirname(os.path.abspath(__file__))
    for _p in sys.path:
        if not _p or os.path.abspath(_p) == _here:
            continue
        _c = os.path.join(_p, "sitecustomize.py")
        if os.path.isfile(_c):
            _s = _u.spec_from_file_location("_project_sitecustomize", _c)
            _m = _u.module_from_spec(_s)
            _s.loader.exec_module(_m)
            break
except Exception:
    pass

if _OUT:
    _seen = set()
    _add = _seen.add

    def _profile(frame, event, arg):
        # 'call' only. Return/exception events would double the work and answer nothing new.
        if event == "call":
            c = frame.f_code
            _add((c.co_filename, c.co_firstlineno, c.co_name))

    def _dump():
        sys.setprofile(None)
        threading.setprofile(None)
        try:
            with open(os.path.join(_OUT, "cov-%d.json" % os.getpid()), "w", encoding="utf-8") as fh:
                json.dump([list(x) for x in _seen], fh)
        except Exception:
            # A failed dump must never fail the run being measured. Missing evidence is
            # reported as missing; a crashed test suite would be reported as a red oracle.
            pass

    atexit.register(_dump)
    threading.setprofile(_profile)
    sys.setprofile(_profile)
`;

/** Read every per-process dump and normalise to repo-relative { file, line, name }. */
function readPythonCoverageDir(dir, root) {
  const out = [];
  const seen = new Set();
  const rootAbs = path.resolve(root).replace(/\\/g, '/').toLowerCase();
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return out; }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    let rows;
    try { rows = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    for (const [abs, line, name] of rows || []) {
      const norm = String(abs).replace(/\\/g, '/');
      if (!norm.toLowerCase().startsWith(rootAbs + '/')) continue;   // stdlib and site-packages
      const rel = norm.slice(rootAbs.length + 1);
      const key = `${rel}:${line}:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // `<module>` is a file's top level, not a symbol the graph records.
      if (name === '<module>') continue;
      out.push({ file: rel, line, name });
    }
  }
  return out;
}

function collectPython(root, { command, args, timeoutMs } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmad-pycov-'));
  const boot = fs.mkdtempSync(path.join(os.tmpdir(), 'rmad-pyboot-'));
  try {
    fs.writeFileSync(path.join(boot, 'sitecustomize.py'), PY_SITECUSTOMIZE);
    const sep = process.platform === 'win32' ? ';' : ':';
    const prior = process.env.PYTHONPATH ? sep + process.env.PYTHONPATH : '';
    const res = spawnSync(command, args || [], {
      cwd: root,
      env: Object.assign({}, process.env, {
        PYTHONPATH: boot + prior,
        RMAD_PYCOV_DIR: dir,
        // Without this the child may not flush; more importantly a .pyc-less run keeps
        // co_filename absolute and stable, which is what the mapping keys on.
        PYTHONDONTWRITEBYTECODE: '1'
      }),
      encoding: 'utf8',
      timeout: timeoutMs || 600000,
      shell: false
    });
    return {
      executed: readPythonCoverageDir(dir, root),
      status: res.status,
      timedOut: !!res.error && /ETIMEDOUT|timed out/i.test(String(res.error.message)),
      stderr: String(res.stderr || '').slice(0, 4000)
    };
  } finally {
    for (const d of [dir, boot]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }
  }
}

/** Which runtime can instrument this command? Null when we have no collector for it. */
function runtimeFor(command) {
  const base = path.basename(String(command || '')).toLowerCase().replace(/\.exe$/, '');
  if (/^python[0-9.]*$|^py$/.test(base)) return 'python';
  if (/^node$|^nodejs$/.test(base) || command === process.execPath) return 'node';
  return null;
}

/**
 * Collect for whichever runtime the command names.
 *
 * Dispatching rather than defaulting to Node: handing a Python command to the V8 collector
 * returns zero symbols, which is indistinguishable from "nothing ran". Refusing a runtime
 * we cannot instrument is the honest answer, and the caller reports it as such.
 */
function collectAuto(root, opts = {}) {
  const rt = runtimeFor(opts.command);
  if (rt === 'python') return { runtime: 'python', ...collectPython(root, opts) };
  if (rt === 'node') return { runtime: 'node', ...collect(root, opts) };
  return { runtime: null, executed: [], status: null, timedOut: false, stderr: '' };
}

/**
 * Map executed { file, line } onto graph symbol ids.
 *
 * Exact (file, line) first. V8 points at the function keyword and the graph records the
 * declaration line, so these agree for ordinary declarations; decorators and leading
 * comments can shift by a line or two, hence the small window. Beyond that it gives up
 * rather than guessing — a wrong attribution here would silently mark an untested symbol
 * as covered, which is the failure mode this whole obligation exists to prevent.
 */
function toSymbolIds(g, executed, { window = 2 } = {}) {
  const byFile = new Map();
  for (const [id, n] of Object.entries(g.nodes || {})) {
    if (!n || (n.kind !== 'function' && n.kind !== 'method' && n.kind !== 'class')) continue;
    const f = String(n.file || '').split('\\').join('/');
    if (!f) continue;
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push({ id, line: n.line, name: n.name });
  }
  const hit = new Set();
  let unmatched = 0;
  for (const e of executed) {
    const cands = byFile.get(String(e.file).split('\\').join('/'));
    if (!cands) { unmatched++; continue; }
    let best = cands.find((c) => c.line === e.line);
    if (!best && e.name) {
      best = cands.find((c) => c.name === e.name && Math.abs((c.line || 0) - e.line) <= window);
    }
    if (!best) best = cands.find((c) => Math.abs((c.line || 0) - e.line) <= window && !e.name);
    if (best) hit.add(best.id); else unmatched++;
  }
  return { covered: hit, unmatched };
}

module.exports = {
  collect, collectPython, collectAuto, runtimeFor,
  readCoverageDir, readPythonCoverageDir, toSymbolIds, relFromUrl, lineIndex
};
