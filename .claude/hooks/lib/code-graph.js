// code-graph.js — the RMAD code knowledge graph.
//
// THE PROBLEM IT SOLVES: an agent that has not read the code cannot review it, and no
// agent can read 15k lines per question. The usual answer is embeddings + semantic
// search, which returns *chunks that look similar to your words*. That is the wrong
// primitive for an architect: "what breaks if I change this" is a graph traversal, not a
// similarity score. Cosine distance cannot tell you a function has no callers, that two
// modules import each other, or that a route reaches the database without passing auth.
//
// So this indexes STRUCTURE, exactly, and queries it as a graph:
//   Layer 1  structural   — deterministic, from real parsers. Files, symbols, signatures
//                           down to argument names/annotations/defaults, imports, calls,
//                           inheritance, routes, complexity. Python via ast (exact);
//                           JS/TS via a scanner that labels itself `heuristic`.
//   Layer 2  semantic     — the "what & why": purpose, invariants, gotchas. LLM-authored,
//                           keyed by CONTENT HASH so it self-invalidates when code moves.
//                           Never guessed here; written by /atlas-index.
//   Layer 3  intent       — features and requirements (FR-*) mapped onto modules, closing
//                           RMAD's FR -> MOD -> story -> test chain against real code.
//
// INCREMENTAL: every file carries a sha1. Re-indexing touches only what changed, which is
// what makes this usable on every commit rather than once a quarter.
//
// CONTEXT DISCIPLINE: the graph is never loaded into a prompt whole. Agents call
// `rmad index query` and get a slice. An index that blows the context window is a
// context problem wearing an index costume — which is exactly what /atlas-repomap's
// "read every source file" advice was.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// Lives HERE rather than in workflow/impact.js, which is where it started: impact.js
// already requires this module, so importing it back would be a cycle. Duplicating the
// regex was the other option and is worse — two copies of a classification rule drift,
// and the day they disagree is the day a file counts as a test in one obligation and as
// production in another. impact.js re-exports this, so its callers are unaffected.
const TEST_PATH = /(^|[/\\])(tests?|spec|__tests__)[/\\]|[._-](test|spec)\.[a-z]+$|^test_|_test\.[a-z]+$/i;

function isTestFile(p) {
  return Boolean(p) && TEST_PATH.test(p);
}

const jsExtractor = require('./extractors/javascript.js');
const treesitter = require('./extractors/treesitter.js');
const secrets = require('./security/secrets.js');

// Default location, kept as an export because callers and docs refer to it.
const INDEX_DIR = path.join('.planning', 'index');
const PORTABLE_INDEX_DIR = path.join('.rmad', 'index');

/**
 * Where the index lives for a given repo.
 *
 * RMAD is used two ways: installed into a project (which has .planning/), and pointed at
 * a foreign repo as a toolkit (which does not, and must not suddenly grow one). So the
 * index follows the same convention /rmad-review already uses for its output — .planning/
 * when this is an RMAD project, .rmad/ everywhere else. Writing .planning/ into someone
 * else's repo would be the toolkit leaving a footprint it was never asked to leave.
 */
function indexDir(root) {
  try {
    if (fs.existsSync(path.join(root, '.planning'))) return INDEX_DIR;
  } catch { /* unreadable root behaves like a foreign repo */ }
  return PORTABLE_INDEX_DIR;
}

// Is this root a directory that actually exists?
//
// WHY THIS EXISTS. Writing the index does `mkdirSync(dirname, { recursive: true })`, which
// is correct for creating `.rmad/index/` inside a real repo and destructive one level up:
// handed a root that does not exist, it invents the ENTIRE chain and reports success. A
// mistyped `--root`, or a hook handed a malformed `cwd`, silently materialised a phantom
// project skeleton on disk — one escaped as far as the root of a drive, and `index build`
// printed `Errors: 0` over a repository that had never been there.
//
// The rule: the ROOT must already exist; anything BELOW it may be created. That
// distinction is the entire fix — `rmad index build` against a fresh real repo, or one
// that has no index yet, is unaffected.
//
// Same principle as the return-value check in save(): a tool that reports success it did
// not achieve is worse than one that fails.
function rootExists(root) {
  try {
    return fs.statSync(root).isDirectory();
  } catch {
    return false;
  }
}

const GRAPH_FILE = 'graph.json';
const SCHEMA_VERSION = 1;

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '__pycache__', '.venv', 'venv', 'env', 'dist', 'build',
  '.next', '.nuxt', 'coverage', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  'site-packages', '.tox', 'target', 'vendor', '.planning', '.rmad-review'
]);

const LANG_BY_EXT = {
  '.py': 'python',
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'tsx',
  // Reachable only when tree-sitter grammars are installed. Without them these files are
  // still walked and recorded as `unavailable`, which is the honest state: we know the
  // file exists and we know we could not read it.
  '.go': 'go', '.java': 'java', '.rb': 'ruby', '.rs': 'rust', '.cs': 'csharp'
};

// Languages the bundled heuristic scanner can fall back to. Everything else has exactly
// one extractor, and no extractor means `unavailable` rather than a guess.
const HEURISTIC_FALLBACK = new Set(['javascript', 'typescript', 'tsx']);

// ─── walk ───────────────────────────────────────────────────────────────────

function walk(root, rel = '', out = [], ignore = null) {
  // .indexignore is read once at the top of the walk and applied to EVERY tier. A path
  // the user excluded must not reappear through lexical search because only one tier was
  // taught about it — exclusion happens here, before anything is extracted at all.
  const ig = ignore || secrets.loadIgnore(root);
  const abs = path.join(root, rel);
  let entries;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    // Symlinks are never followed.
    //
    // readdirSync reports a symlink as isDirectory() === false, so a link fell straight
    // into the file branch, got a language from its own extension, and was then read with
    // readFileSync — which resolves it. A cloned untrusted repo shipping
    // `src/config.py -> ~/.aws/credentials` had that file's contents indexed and stored.
    // It also defeated .indexignore and SKIP_DIRS entirely, because the matcher only ever
    // saw the link's own path: excluding `secrets/` means nothing when `pub.py ->
    // secrets/keys.py` is indexed.
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.') && e.name !== '.claude') continue;
      if (ig.ignores(r)) continue;
      walk(root, r, out, ig);
    } else {
      const lang = LANG_BY_EXT[path.extname(e.name).toLowerCase()];
      if (lang && !ig.ignores(r)) out.push({ rel: r, lang });
    }
  }
  return out;
}

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

// Methods that belong to the language rather than to any project. Used only to LABEL a
// refusal that has already happened — never to resolve an edge. Deliberately excludes
// names a project commonly defines itself (get, set, run, build, load, save, close, parse).
const BUILTIN_METHODS = new Set([
  'has', 'add', 'delete', 'clear', 'keys', 'values', 'entries',
  'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'concat', 'join', 'reverse',
  'map', 'filter', 'reduce', 'forEach', 'find', 'findIndex', 'some', 'every', 'flat', 'flatMap',
  'includes', 'indexOf', 'lastIndexOf', 'sort', 'fill', 'at',
  'trim', 'split', 'replace', 'replaceAll', 'match', 'padStart', 'padEnd',
  'startsWith', 'endsWith', 'toLowerCase', 'toUpperCase', 'charAt', 'charCodeAt', 'repeat',
  'toString', 'valueOf', 'toFixed', 'stringify',
  'then', 'catch', 'finally', 'call', 'apply', 'bind'
]);

// Directory names that suggest a file is DERIVED from another. Used only to choose which
// of two byte-identical files to keep — never to decide that a file is a duplicate. The
// duplication is always proven by content hash first.
const DERIVED_HINT = /(^|\/)(dist|build|out|output|generated|gen|templates?|vendor|third_party|copy|[a-z]+-copy|backup|bak|mirror|snapshot)(\/|$)/i;

function cmpOriginality(a, b) {
  const pa = a.split(path.sep).join('/');
  const pb = b.split(path.sep).join('/');
  const da = DERIVED_HINT.test(pa) ? 1 : 0;
  const db = DERIVED_HINT.test(pb) ? 1 : 0;
  if (da !== db) return da - db;                                   // source-looking wins
  const sa = pa.split('/').length, sb = pb.split('/').length;
  if (sa !== sb) return sa - sb;                                   // shallower wins
  return pa < pb ? -1 : pa > pb ? 1 : 0;                           // stable
}

// ─── extraction ─────────────────────────────────────────────────────────────

function extractPython(root, files, pythonCmd) {
  if (!files.length) return [];
  const script = path.join(__dirname, 'extractors', 'python_ast.py');
  const results = [];
  // Batch to stay clear of command-line length limits on Windows.
  const BATCH = 40;
  for (let i = 0; i < files.length; i += BATCH) {
    const chunk = files.slice(i, i + BATCH);
    // Timeout for the same reason the tree-sitter child has one: spawnSync BLOCKS, this
    // parses untrusted repository content, and a pathological file would otherwise hang
    // `index build` — and any hook that triggers it — indefinitely.
    const res = spawnSync(pythonCmd, [script, ...chunk.map((f) => path.join(root, f.rel))], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120000,
      killSignal: 'SIGKILL', windowsHide: true
    });
    if (res.status !== 0 || !res.stdout) {
      for (const f of chunk) {
        results.push({ path: f.rel, language: 'python', fidelity: 'unavailable', symbols: [], imports: [],
          error: `python extractor failed: ${(res.stderr || '').slice(0, 200)}` });
      }
      continue;
    }
    try {
      for (const doc of JSON.parse(res.stdout)) {
        doc.path = path.relative(root, doc.path).split(path.sep).join('/');
        results.push(doc);
      }
    } catch (err) {
      for (const f of chunk) {
        results.push({ path: f.rel, language: 'python', fidelity: 'unavailable', symbols: [], imports: [],
          error: `python extractor output unparseable: ${err.message}` });
      }
    }
  }
  return results;
}

function detectPython() {
  for (const cmd of ['python', 'python3', 'py']) {
    const r = spawnSync(cmd, ['-c', 'import ast,sys;print(sys.version_info[0])'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0 && String(r.stdout).trim() === '3') return cmd;
  }
  return null;
}

function extractJs(root, files) {
  return files.map((f) => {
    try {
      const src = fs.readFileSync(path.join(root, f.rel), 'utf8');
      return jsExtractor.extract(f.rel, src);
    } catch (err) {
      return { path: f.rel, language: f.lang, fidelity: 'unavailable', symbols: [], imports: [], error: err.message };
    }
  });
}

// ─── module resolution ──────────────────────────────────────────────────────

// Map a python dotted module (or relative import) to an indexed file path.
/**
 * Source roots the project DECLARES, for PEP 420 namespace packages.
 *
 * A namespace package has no `__init__.py`, so nothing on disk marks it as importable —
 * only configuration does. `pythonpath = tests src` in pytest.ini is why
 * `tests/corpus/generate.py` imports as `corpus.generate`, and without reading it those
 * imports never resolve.
 *
 * Read, never inferred. Treating any directory that holds .py files as a source root
 * would resolve `from dup import f` in a repo containing both `a/dup.py` and `b/dup.py`
 * — an edge to a module neither path exports.
 */
function declaredSourceRoots(root) {
  const roots = new Set();
  const add = (v) => String(v || '').split(/[\s,]+/).filter(Boolean)
    .forEach((r) => { const c = r.replace(/^\.\//, '').replace(/\/$/, ''); if (c && c !== '.') roots.add(c); });

  const read = (f) => { try { return fs.readFileSync(path.join(root, f), 'utf8'); } catch { return null; } };

  for (const f of ['pytest.ini', 'tox.ini', 'setup.cfg']) {
    const t = read(f);
    if (t) { const m = t.match(/^\s*pythonpath\s*=\s*(.+)$/m); if (m) add(m[1]); }
  }
  const toml = read('pyproject.toml');
  if (toml) {
    const m = toml.match(/^\s*pythonpath\s*=\s*\[([^\]]*)\]/m);
    if (m) add(m[1].replace(/["']/g, ' '));
    // [tool.setuptools.package-dir]  "" = "src"
    const pd = toml.match(/package-dir\s*=\s*\{([^}]*)\}/);
    if (pd) for (const q of pd[1].matchAll(/=\s*["']([^"']+)["']/g)) add(q[1]);
  }
  const cfg = read('setup.cfg');
  if (cfg) { const m = cfg.match(/^\s*package_dir\s*=\s*(?:\n\s*=\s*(.+))?$/m); if (m && m[1]) add(m[1]); }
  return [...roots];
}

function resolvePythonImport(imp, fromFile, byModule) {
  // `from pkg import sub` binds a MODULE, not a name inside pkg/__init__.py. Resolving it
  // to the __init__ means a later `sub.fn()` call has no import edge to follow, so the
  // module-receiver rung refuses it. Checked first because `pkg.sub` being an indexed
  // module is unambiguous evidence of which of the two forms this is.
  const submodule = (base) => (imp.name ? byModule.get(`${base}.${imp.name}`) : null) || null;

  if (imp.relative) {
    const parts = path.dirname(fromFile).split('/').filter(Boolean);
    const up = imp.relative - 1;
    const base = parts.slice(0, parts.length - up);
    const mod = imp.module ? imp.module.split('.') : [];
    const cand = [...base, ...mod].join('.');
    return submodule(cand) || byModule.get(cand) || byModule.get(`${cand}.__init__`) || null;
  }
  if (!imp.module) return null;
  return submodule(imp.module) || byModule.get(imp.module)
    || byModule.get(`${imp.module}.__init__`) || null;
}

function resolveJsImport(imp, fromFile, byPath) {
  if (!imp.module.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), imp.module));
  for (const ext of ['', '.js', '.ts', '.tsx', '.jsx', '.mjs', '.cjs', '/index.js', '/index.ts']) {
    if (byPath.has(base + ext)) return base + ext;
  }
  return null;
}

// ─── build ──────────────────────────────────────────────────────────────────

function buildGraph(root, opts = {}) {
  const started = Date.now();
  const files = walk(root);
  const pythonCmd = detectPython();

  // Reach the previous index through its cheap accessors when it is database-backed:
  // the hash check only needs one column, and the extractor documents (the largest blobs
  // in the store) are then fetched ONLY for the files actually being reused. Touching
  // `.files` instead would load every document just to compare a few hashes.
  const previous = opts.previous || null;
  const prevHashes = previous
    ? (previous._db ? previous.fileHashes() : Object.fromEntries(
        Object.entries(previous.files || {}).map(([p, r]) => [p, r.hash])))
    : {};
  const prevDoc = previous
    ? (previous._db ? (p) => previous.fileDoc(p) : (p) => (previous.files[p] || {}).doc)
    : () => null;

  const hashOf = {};
  const changed = [];
  const reused = [];

  for (const f of files) {
    let src;
    try {
      src = fs.readFileSync(path.join(root, f.rel), 'utf8');
    } catch {
      continue;
    }
    const h = sha1(src);
    hashOf[f.rel] = h;
    if (prevHashes[f.rel] === h && !opts.force) reused.push(f);
    else changed.push(f);
  }

  // ── mirror exclusion (RMAD-14) ──
  //
  // A directory that duplicates another part of the tree byte-for-byte — a vendored copy,
  // a distribution mirror, a synced template set — doubles every symbol in it, and the
  // resolver then cannot pick between the two. Measured on this framework, whose
  // `templates/` mirrors `.claude/`: 36.1% of the graph was a copy of itself and
  // **256 of 330 symbol names (77.6%) resolved to two nodes**, so `index blast` refused
  // for most symbols and O2 could not be computed at all.
  //
  // Detected by CONTENT, not by directory name. Excluding a path called `templates` would
  // be wrong in most repositories; excluding a file whose bytes already appear elsewhere
  // is right in all of them.
  //
  // Path names appear only to break the tie between two PROVEN duplicates — never to
  // decide that something is a duplicate. Sorted order alone picked wrong: `dist-copy/`
  // sorts before `src/`, so the copy was kept and the original dropped. So a
  // derived-looking directory loses to a source-looking one, then the shallower path
  // wins, then lexicographic for determinism across platforms.
  const mirrors = [];
  if (!opts.keepMirrors) {
    const byHash = new Map();
    for (const rel of Object.keys(hashOf)) {
      const h = hashOf[rel];
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(rel);
    }
    const firstByHash = new Map();
    for (const [h, rels] of byHash) {
      if (rels.length === 1) { firstByHash.set(h, rels[0]); continue; }
      const keep = rels.slice().sort((a, b) => cmpOriginality(a, b))[0];
      firstByHash.set(h, keep);
      for (const rel of rels) if (rel !== keep) mirrors.push({ rel, mirrorOf: keep });
    }
    if (mirrors.length) {
      const drop = new Set(mirrors.map((m) => m.rel));
      for (const rel of drop) delete hashOf[rel];
      const keep = (f) => !drop.has(f.rel);
      changed.splice(0, changed.length, ...changed.filter(keep));
      reused.splice(0, reused.length, ...reused.filter(keep));
    }
  }

  const docs = [];
  for (const f of reused) docs.push(prevDoc(f.rel));

  // ── extractor routing ──
  //
  // Preference order per language, best evidence first:
  //   python  : python_ast.py (real scope analysis) > tree-sitter > nothing
  //   js/ts   : tree-sitter (exact) > the heuristic scanner (says so) > nothing
  //   others  : tree-sitter > nothing
  //
  // "Nothing" is a document with fidelity `unavailable` and a reason, never a guess.
  // A language we cannot parse must be visibly absent from the graph rather than
  // silently half-present.
  const pyChanged = changed.filter((f) => f.lang === 'python');
  const otherChanged = changed.filter((f) => f.lang !== 'python');

  if (pyChanged.length) {
    if (pythonCmd) docs.push(...extractPython(root, pyChanged, pythonCmd));
    else if (treesitter.supports('python')) docs.push(...treesitter.extract(root, pyChanged));
    else {
      for (const f of pyChanged) {
        docs.push({ path: f.rel, language: 'python', fidelity: 'unavailable', symbols: [], imports: [],
          error: 'python3 not found on PATH — python symbols not indexed' });
      }
    }
  }

  if (otherChanged.length) {
    const exact = otherChanged.filter((f) => treesitter.supports(f.lang));
    const rest = otherChanged.filter((f) => !treesitter.supports(f.lang));

    // Fall back PER FILE, on the actual result — not on the global probe.
    //
    // `treesitter.supports()` only answers "is the runtime installed and is there a
    // grammar directory". It says nothing about whether a given file parsed. A missing or
    // corrupt grammar, or a child-process crash (which marks the WHOLE batch unavailable),
    // therefore produced zero symbols with no fallback at all: `index build` exited 0
    // reporting `Symbols: 0`, every node `fidelity: unavailable`, and every downstream
    // query answered "nothing found" rather than erroring. The heuristic scanner exists
    // for exactly this case, so it has to stay reachable when the exact path fails.
    if (exact.length) {
      const attempted = treesitter.extract(root, exact);
      for (let i = 0; i < attempted.length; i++) {
        const doc = attempted[i];
        const src = exact[i];
        if (doc && doc.fidelity !== 'unavailable') { docs.push(doc); continue; }
        if (src && HEURISTIC_FALLBACK.has(src.lang)) {
          const [fallback] = extractJs(root, [src]);
          // Record WHY fidelity dropped. "heuristic" with no reason reads as a choice.
          if (fallback) fallback.error = `exact parse failed, used heuristic scanner: ${(doc && doc.error) || 'unknown'}`;
          docs.push(fallback || doc);
        } else {
          docs.push(doc);
        }
      }
    }

    for (const f of rest) {
      if (HEURISTIC_FALLBACK.has(f.lang)) docs.push(...extractJs(root, [f]));
      else {
        docs.push({ path: f.rel, language: f.lang, fidelity: 'unavailable', symbols: [], imports: [],
          error: `no extractor for ${f.lang} — ${treesitter.probe().reason || 'unsupported language'}` });
      }
    }
  }

  // ── redact, once, before anything is built from these documents ──
  //
  // `docs` is the single source for BOTH the nodes and the cached extractor documents in
  // files.doc_json. Redacting at the node literal alone left the credential sitting in
  // doc_json — invisible through the API, still present in the database bytes, and
  // restored verbatim on the next incremental build that reused the cache. One pass here
  // is the only place that covers every downstream consumer.
  for (const d of docs) {
    if (typeof d.doc === 'string' && d.doc) d.doc = secrets.redact(d.doc).text;
    for (const s of d.symbols || []) redactNodeText(s);
  }

  // ── assemble nodes ──
  const nodes = {};
  const edges = [];
  const byModule = new Map();
  const byPath = new Set();

  // Python module names are relative to a SOURCE ROOT, not to the repo root. Keying only
  // on the repo-relative path breaks the src-layout that PyPA recommends: a file at
  // `src/pkg/mod.py` registers as `src.pkg.mod` while every import in the project says
  // `pkg.mod`, so NOTHING resolves and only globally-unique bare names survive. Measured
  // on a src-layout project before this fix: 0 of 47 intra-project imports resolved.
  //
  // A source root is found the way Python finds one: walk up while each directory is a
  // package (has `__init__.py`); the first directory that is not is the source root.
  const pkgDirs = new Set();
  for (const d of docs) {
    if (d.language === 'python' && /(^|\/)__init__\.py$/.test(d.path)) {
      pkgDirs.add(d.path.replace(/(^|\/)__init__\.py$/, '') || '.');
    }
  }
  // PEP 420 namespace packages have no `__init__.py`, so the walk above cannot see them.
  // Rather than guess, read the roots the project DECLARES -- pytest's `pythonpath`, and
  // setuptools' `package-dir`. Configuration is evidence; a directory merely containing
  // .py files is not.
  const declaredRoots = declaredSourceRoots(root);
  const pythonModuleNames = (p) => {
    const parts = p.replace(/\.py$/, '').split('/');
    const names = [parts.join('.')];              // repo-root relative, always registered
    let cut = parts.length - 1;                   // index of the first package dir, if any
    while (cut > 0 && pkgDirs.has(parts.slice(0, cut).join('/'))) cut--;
    if (cut > 0 && cut < parts.length - 1) names.push(parts.slice(cut).join('.'));
    // A declared source root wins over the __init__ walk: `pythonpath = tests` makes
    // `tests/corpus/generate.py` importable as `corpus.generate` with no __init__ anywhere.
    for (const r of declaredRoots) {
      if (p.startsWith(r + '/')) names.push(p.slice(r.length + 1).replace(/\.py$/, '').split('/').join('.'));
    }
    // DELIBERATELY NOT registering a bare `mod` for `anydir/mod.py`. Doing so claims every
    // directory is a source root, which resolved `from dup import f` in a project holding
    // both `a/dup.py` and `b/dup.py` -- a module neither path actually exports.
    //
    // The known gap this leaves: PEP 420 namespace packages have no `__init__.py`, so a
    // package made importable purely by a `pythonpath` setting is not detected. Those stay
    // unresolved, which under-reports rather than inventing an edge.
    return names;
  };

  // A name claimed by two different files is genuine ambiguity. It is dropped rather than
  // resolved to whichever was indexed last -- the same refusal the call resolver makes.
  const moduleClashes = new Set();
  for (const d of docs) {
    byPath.add(d.path);
    if (d.language !== 'python') continue;
    for (const mod of pythonModuleNames(d.path)) {
      if (byModule.has(mod) && byModule.get(mod) !== d.path) { moduleClashes.add(mod); continue; }
      byModule.set(mod, d.path);
    }
  }
  for (const mod of moduleClashes) byModule.delete(mod);

  const addEdge = (from, to, type, meta) => {
    if (!from || !to) return;
    edges.push(meta ? { from, to, type, ...meta } : { from, to, type });
  };

  for (const d of docs) {
    const fileId = `file:${d.path}`;
    nodes[fileId] = ({
      id: fileId, kind: 'file', path: d.path, language: d.language,
      fidelity: d.fidelity, loc: d.loc || 0, doc: d.doc || null,
      hash: hashOf[d.path], error: d.error || null,
      dir: path.posix.dirname(d.path)
    });

    for (const s of d.symbols || []) {
      const id = `sym:${d.path}#${s.qualname}`;
      nodes[id] = ({
        id, kind: s.kind, name: s.name, qualname: s.qualname, file: d.path,
        line: s.line, end_line: s.end_line, loc: s.loc || 0,
        args: s.args || null, returns: s.returns || null,
        decorators: s.decorators || [], bases: s.bases || [],
        route: s.route || null, doc: s.doc || null,
        complexity: s.complexity || null, is_async: Boolean(s.is_async),
        exported: s.exported !== undefined ? s.exported : null,
        fidelity: d.fidelity
      });
      addEdge(fileId, id, 'contains');

      for (const b of s.bases || []) {
        const base = b.split('.').pop();
        addEdge(id, `name:${base}`, 'inherits', { unresolved: base });
      }
      for (const c of s.calls || []) {
        const nm = c.name || String(c.callee).split('.').pop();
        addEdge(id, `name:${nm}`, 'calls', {
          unresolved: nm, line: c.line,
          receiver: c.receiver || null, callee: c.callee, fromFile: d.path,
          fromClass: (s.qualname || '').includes('.') ? s.qualname.split('.')[0] : null
        });
      }
      if (s.route) addEdge(id, `route:${s.route.method} ${s.route.path}`, 'exposes');
    }

    // Module-level calls belong to the file itself: `data_svc = InternalClient("data")`
    // at import time is a real reference, and missing it makes the class look dead.
    for (const c of d.module_calls || []) {
      const nm = c.name || String(c.callee).split('.').pop();
      addEdge(fileId, `name:${nm}`, 'calls', {
        unresolved: nm, line: c.line, receiver: c.receiver || null,
        callee: c.callee, fromFile: d.path, fromClass: null
      });
    }

    for (const imp of d.imports || []) {
      const target = d.language === 'python'
        ? resolvePythonImport(imp, d.path, byModule)
        : resolveJsImport(imp, d.path, byPath);
      if (target) addEdge(fileId, `file:${target}`, 'imports', { line: imp.line });
      else addEdge(fileId, `ext:${imp.module}`, 'imports-external', { line: imp.line });
    }
  }

  // ── resolve name-based call/inherit edges to real symbols ──
  const symbolsByName = new Map();
  for (const n of Object.values(nodes)) {
    if (n.kind === 'file') continue;
    const list = symbolsByName.get(n.name) || [];
    list.push(n.id);
    symbolsByName.set(n.name, list);
  }

  // ── call resolution ──────────────────────────────────────────────────────
  // THE RULE: resolve on EVIDENCE, or don't resolve at all.
  //
  // The naive version — take the last dotted segment and link to any symbol with that
  // name — measured 532 callers for `InternalClient.get` in a repo containing 583 total
  // `.get(` calls. Every `dict.get()`, `os.environ.get()` and `response.get()` had been
  // welded onto one method. That graph would tell an architect the blast radius of a
  // one-line HTTP helper is the entire codebase, and it would be confidently wrong.
  //
  // A missing edge is a known unknown. A fabricated edge is a false belief that survives
  // review because it looks like data. So: same-class > binding > import > globally
  // unique. Anything else stays unresolved and is EXCLUDED from callers()/blast().

  // var -> Class bindings per file (module scope and per-class scope)
  const bindingsByFile = new Map();
  for (const d of docs) {
    const m = new Map();
    for (const b of d.bindings || []) m.set(`${b.scope}::${b.var}`, b.type);
    bindingsByFile.set(d.path, m);
  }
  // file -> set of files it imports (already computed as edges)
  const importsByFile = new Map();
  for (const e of edges) {
    if (e.type !== 'imports') continue;
    const from = e.from.replace(/^file:/, '');
    if (!importsByFile.has(from)) importsByFile.set(from, new Set());
    importsByFile.get(from).add(e.to.replace(/^file:/, ''));
  }

  // localName -> {file, name} for every imported symbol.
  // A binding lives where the object is CONSTRUCTED, but the calls live wherever it was
  // imported to: `data_svc = InternalClient("data")` in internal.py, then
  // `from services.common.internal import data_svc; data_svc.get(...)` in nine routers.
  // Without following the import, a receiver-aware resolver refuses every one of those
  // and the client's methods look dead — which is how InternalClient.get went from 532
  // fabricated callers straight to 0 real ones.
  const importedNamesByFile = new Map();
  for (const d of docs) {
    const m = new Map();
    for (const imp of d.imports || []) {
      if (!imp.name) continue;
      const target = d.language === 'python'
        ? resolvePythonImport(imp, d.path, byModule)
        : resolveJsImport(imp, d.path, byPath);
      if (target) m.set(imp.alias || imp.name, { file: target, name: imp.name });
    }
    importedNamesByFile.set(d.path, m);
  }

  // Resolve a receiver to a constructed type, following imports one hop.
  function typeOfReceiver(callerFile, recv, fromClass) {
    const local = bindingsByFile.get(callerFile);
    if (local) {
      const t = local.get(`module::${recv}`) || (fromClass && local.get(`${fromClass}::${recv}`));
      if (t) return t;
    }
    const imported = importedNamesByFile.get(callerFile);
    const src = imported && imported.get(String(recv).split('.')[0]);
    if (src) {
      const remote = bindingsByFile.get(src.file);
      if (remote) {
        const t = remote.get(`module::${src.name}`);
        if (t) return t;
      }
    }
    return null;
  }

  const STDLIB_RECEIVERS = /^(os|sys|json|re|time|datetime|logging|math|random|itertools|collections|pathlib|typing|asyncio|subprocess|hashlib|uuid|copy|functools|self\.__class__)\b/;

  const fileOf = (id) => (nodes[id] && nodes[id].file) || null;
  const classOf = (id) => {
    const n = nodes[id];
    if (!n || !n.qualname || !n.qualname.includes('.')) return null;
    return n.qualname.split('.')[0];
  };

  const resolved = [];
  const stats = { unique: 0, sameClass: 0, binding: 0, imported: 0, ambiguous: 0, external: 0 };

  for (const e of edges) {
    if (!e.to.startsWith('name:')) { resolved.push(e); continue; }
    const cands = symbolsByName.get(e.unresolved) || [];
    if (!cands.length) { stats.external++; resolved.push({ ...e, resolution: 'external', resolved: false }); continue; }

    const callerFile = e.fromFile || fileOf(e.from);
    const recv = e.receiver;

    // 1. self.method() / self.attr.method() — look inside the caller's own class first.
    if (recv === 'self' && e.fromClass) {
      const hit = cands.find((c) => fileOf(c) === callerFile && classOf(c) === e.fromClass);
      if (hit) { stats.sameClass++; resolved.push({ ...e, to: hit, resolution: 'same-class', resolved: true }); continue; }
    }

    // 2. receiver bound to a constructor: data_svc = InternalClient(...) -> InternalClient.get
    //    Follows imports, so a client constructed in one module resolves at every call site.
    if (recv) {
      const type = typeOfReceiver(callerFile, recv, e.fromClass);
      if (type) {
        const hit = cands.find((c) => classOf(c) === type);
        if (hit) { stats.binding++; resolved.push({ ...e, to: hit, resolution: 'binding', resolved: true }); continue; }
      }
      // A stdlib/builtin receiver is never a project symbol, whatever the name collides with.
      if (STDLIB_RECEIVERS.test(recv)) {
        stats.external++;
        resolved.push({ ...e, resolution: 'external-stdlib', resolved: false });
        continue;
      }

      // 2b. The receiver is a MODULE ALIAS: `const G = require('./code-graph'); G.buildGraph()`.
      //
      // This is the dominant idiom in CommonJS and in `import * as X`, and without it the
      // whole pattern is invisible. Measured on this repo before the fix: `buildGraph` had
      // 29 real call sites and ZERO evidenced callers, `orphans` listed the entire public
      // API as dead-code candidates, and 32% of all resolvable calls were refused.
      //
      // The evidence here is as strong as any other rung — we followed a real import to a
      // real indexed file and found exactly one symbol of that name in it. The
      // exactly-one condition is what keeps this honest: two same-named exports in the
      // target file is genuine ambiguity, and it falls through to a refusal rather than a
      // coin toss. Note this only ever considers TOP-LEVEL symbols of the target file, so
      // it cannot silently match a method on some unrelated class.
      const aliasTarget = (importedNamesByFile.get(callerFile) || new Map()).get(String(recv).split('.')[0]);
      if (aliasTarget) {
        const inTarget = cands.filter((c) => fileOf(c) === aliasTarget.file && !String(nodes[c].qualname || '').includes('.'));
        if (inTarget.length === 1) {
          stats.imported++;
          resolved.push({ ...e, to: inTarget[0], resolution: 'module-alias', resolved: true });
          continue;
        }
      }

      // The receiver is a MODULE we imported: `internal.get_client()`.
      const importedFiles = importsByFile.get(callerFile) || new Set();
      const viaModule = cands.filter((c) => {
        const cf = fileOf(c);
        if (!cf || !importedFiles.has(cf)) return false;
        const modName = cf.replace(/\.(py|js|ts)$/, '').split('/').pop();
        return modName === recv;
      });
      if (viaModule.length === 1) {
        stats.imported++;
        resolved.push({ ...e, to: viaModule[0], resolution: 'module-receiver', resolved: true });
        continue;
      }

      // RMAD-18 — before refusing, say WHY honestly. A call on an untypeable receiver
      // whose method is a language built-in — `seen.has()`, `cands.find()`,
      // `JSON.parse()` — is not an unresolved PROJECT edge; it is a call out of the
      // project. Both stay unresolved, but conflating them overstated the internal gap
      // badly: of 435 edges classified `untyped-receiver`, 110 (25.3%) were built-ins, and
      // the reported internal resolution rate moved from 84.6% to 88.0% once they were
      // separated out.
      //
      // This changes the LABEL, never the resolution. A project may legitimately define a
      // method called `has`, so this is still a refusal — just a correctly-named one.
      const method = String(e.unresolved || String(e.callee || '').split('.').pop() || '');
      if (BUILTIN_METHODS.has(method)) {
        stats.external++;
        resolved.push({ ...e, resolution: 'external-builtin', resolved: false });
        continue;
      }

      // STOP. We have a receiver we cannot type — `payload.get()`, `patient.get()`,
      // `chunk.get()`. Falling through to name matching is exactly how `.get` collapsed
      // onto InternalClient.get 532 times. Without types, an attribute call on an unknown
      // object is unknowable, and saying so is the only correct answer.
      stats.ambiguous++;
      resolved.push({ ...e, resolution: 'untyped-receiver', resolved: false, candidates: cands.length });
      continue;
    }

    // 3. same file
    const sameFile = cands.filter((c) => fileOf(c) === callerFile);
    if (sameFile.length === 1) { stats.unique++; resolved.push({ ...e, to: sameFile[0], resolution: 'same-file', resolved: true }); continue; }

    // 4. defined in a file the caller actually imports
    const imported = cands.filter((c) => {
      const set = importsByFile.get(callerFile);
      return set && set.has(fileOf(c));
    });
    if (imported.length === 1) { stats.imported++; resolved.push({ ...e, to: imported[0], resolution: 'imported', resolved: true }); continue; }

    // 5. globally unique name — a bare call with one possible target
    if (cands.length === 1 && !recv) { stats.unique++; resolved.push({ ...e, to: cands[0], resolution: 'unique', resolved: true }); continue; }

    // 6. Not enough evidence. Say so; do not invent an edge.
    stats.ambiguous++;
    resolved.push({ ...e, resolution: 'ambiguous', resolved: false, candidates: cands.length });
  }

  const filesOut = {};
  for (const d of docs) filesOut[d.path] = { hash: hashOf[d.path], doc: d };

  return {
    schema: SCHEMA_VERSION,
    root: path.resolve(root),
    generated: new Date().toISOString(),
    durationMs: Date.now() - started,
    stats: {
      files: docs.length,
      changed: changed.length,
      reused: reused.length,
      // What was dropped and why. An exclusion nobody can see reads as "we indexed
      // everything", which is the failure this field exists to prevent.
      mirrored: mirrors.length,
      mirrors: mirrors.slice(0, 20),
      symbols: Object.values(nodes).filter((n) => n.kind !== 'file').length,
      edges: resolved.length,
      loc: Object.values(nodes).filter((n) => n.kind === 'file').reduce((a, b) => a + (b.loc || 0), 0),
      pythonExtractor: pythonCmd || 'MISSING',
      // Why JS/TS is exact or heuristic, recorded in the index rather than left for a
      // user to deduce from node fidelity one file at a time.
      treeSitter: treesitter.probe().ok ? 'available' : `MISSING (${treesitter.probe().reason})`,
      errors: docs.filter((d) => d.error).length,
      // How the call graph was earned. `ambiguous` are calls we refused to guess at —
      // they are excluded from callers()/blast(), so fan-in UNDER-reports rather than
      // over-reports. That direction is deliberate.
      resolution: stats
    },
    nodes,
    edges: resolved,
    files: filesOut,
    semantic: (opts.previous && opts.previous.semantic) || {},
    features: (opts.previous && opts.previous.features) || {}
  };
}

// ─── persistence ────────────────────────────────────────────────────────────
//
// The store is SQLite (see store/db.js for why). The JSON path is kept as a READ-ONLY
// fallback so an index built by an older version — or by a Node without node:sqlite —
// still answers questions instead of erroring. It is never written to again.

const store = require('./store/db.js');
const { writeGraph, writeMutableLayers, writeSpans } = require('./store/write.js');
const { readGraph } = require('./store/read.js');

function indexPath(root) {
  const dir = indexDir(root);
  return store.isAvailable()
    ? store.dbPath(root, dir)
    : path.join(root, dir, GRAPH_FILE);
}

function legacyPath(root) {
  return path.join(root, indexDir(root), GRAPH_FILE);
}

function load(root) {
  if (store.isAvailable()) {
    const g = readGraph(store.dbPath(root, indexDir(root)));
    if (g) return g.schema === SCHEMA_VERSION ? g : null;
  }
  // Legacy JSON, read-only. Everything below treats it exactly as before.
  const p = legacyPath(root);
  if (!fs.existsSync(p)) return null;
  try {
    const g = JSON.parse(fs.readFileSync(p, 'utf8'));
    return g.schema === SCHEMA_VERSION ? g : null;
  } catch {
    return null;
  }
}

/**
 * Keep the index out of version control WITHOUT touching the host repo's .gitignore.
 *
 * The index is a derived second copy of the source — it carries docstrings, signatures and
 * default argument values — so committing it publishes exactly what the repo's own ignore
 * rules were protecting. But appending to someone else's .gitignore is a footprint the
 * toolkit was never asked to leave, and `rmad index build --root ../their-app` is
 * explicitly a supported use.
 *
 * A nested .gitignore inside our OWN directory solves both: git honours it, it is
 * self-contained, and removing the directory removes every trace.
 */
function ensureSelfIgnored(dir) {
  try {
    const marker = path.join(dir, '.gitignore');
    if (!fs.existsSync(marker)) {
      fs.writeFileSync(marker,
        '# Written by rmad. The code index is derived from your source and must not be\n' +
        '# committed: it contains docstrings, signatures and default argument values.\n' +
        '*\n');
    }
  } catch { /* an unwritable index dir will fail louder on the next line */ }
}

function save(root, graph) {
  // Refuse to invent the project. mkdirSync below is recursive, so without this a bad
  // root writes a whole phantom tree and every downstream check reports success.
  if (!rootExists(root)) {
    throw new Error(
      `cannot write an index: ${root} does not exist (or is not a directory).\n` +
      '  RMAD creates the index directory inside a repository; it does not create the repository.'
    );
  }
  const p = indexPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  ensureSelfIgnored(path.dirname(p));

  if (store.isAvailable()) {
    // A graph that came back from load() owns its structure in the database. The only
    // thing that legitimately changes it afterwards is `annotate`, which touches Layers
    // 2 and 3 — so write those and leave the structure alone. Rewriting 350k rows to
    // record one rationale would also mean re-materialising every node just to save it.
    //
    // The return value is CHECKED. It used to be discarded, so a failed write (corrupt
    // db, crashed prior write, unwritable path) still returned the path and `index build`
    // printed its full success block and exited 0 — after which the very next query said
    // "no index, run build". A tool that reports success it did not achieve is worse than
    // one that crashes.
    // ── RMAD-R2. Index the 62.8% of lines that sit inside no symbol span. ──
    //
    // Chunks are computed BEFORE the graph is written, and this ordering is a correctness
    // property, not a style choice. Mutating graph.stats after writeGraph left the
    // PERSISTED stats and the in-memory object disagreeing — store-parity caught it
    // immediately, which is exactly the silent-divergence class that suite exists for.
    //
    // Only on a FULL write: the annotate path (writeMutableLayers) must not touch spans,
    // because it has not re-read the source and would replace a correct tier with one
    // derived from a graph it did not build.
    //
    // Failure here does NOT fail the build. Spans are an additive retrieval tier — a repo
    // whose working tree moved under us, or one file we cannot read, must still get a valid
    // symbol index. The count rides in stats, so an empty tier is visible rather than silent.
    let spanChunks = null;
    if (!graph._db) {
      try {
        const chunksLib = require('./retrieve/chunks.js');
        // isTestPath is reused from the audit module rather than re-inlined. Two copies of
        // "what counts as a test" drift, and the copy in the indexer is the one nobody
        // notices is wrong.
        const { isTestPath } = require('./retrieve/audit.js');
        spanChunks = chunksLib.chunkGraph(
          graph,
          (rel) => fs.readFileSync(path.join(root, rel), 'utf8'),
          isTestPath
        );
        graph.stats = graph.stats || {};
        graph.stats.spanChunks = spanChunks.length;
        graph.stats.spanLines = spanChunks.reduce((a, c) => a + (c.end_line - c.line + 1), 0);
      } catch (err) {
        graph.stats = graph.stats || {};
        graph.stats.spanError = err.message;
        spanChunks = null;
      }
    }

    // The return value is CHECKED. It used to be discarded, so a failed write (corrupt
    // db, crashed prior write, unwritable path) still returned the path and `index build`
    // printed its full success block and exited 0 — after which the very next query said
    // "no index, run build". A tool that reports success it did not achieve is worse than
    // one that crashes.
    const ok = graph._db
      ? writeMutableLayers(p, { semantic: graph.semantic, features: graph.features })
      : writeGraph(p, graph);
    if (!ok) {
      throw new Error(
        `failed to write the index at ${p}. The file may be corrupt or unwritable — ` +
        'delete it and rebuild.'
      );
    }

    // writeSpans needs the database to exist, so it necessarily follows writeGraph. It
    // writes no stats, so it cannot reintroduce the divergence above.
    if (spanChunks) {
      try { writeSpans(p, spanChunks); }
      catch (err) { graph.stats.spanError = err.message; }
    }
    return p;
  }

  fs.writeFileSync(p, JSON.stringify(graph));
  return p;
}

// ─── access layer ───────────────────────────────────────────────────────────
//
// Every query below is the SAME ALGORITHM it always was. The only thing that changed is
// how it reaches the data: a SQLite-backed graph uses an index, an in-memory one keeps
// scanning arrays. Keeping one algorithm per question — rather than a SQL rewrite beside
// a JS original — is what makes the parity suite meaningful instead of aspirational.

/**
 * Redact credentials at the moment a node is CREATED, not when it is stored.
 *
 * The first attempt redacted in the writer, which left the in-memory graph carrying the
 * raw value and — worse — broke the round-trip invariant, because what went in no longer
 * matched what came out. The parity suite caught that immediately.
 *
 * Doing it here is both stronger and simpler: after this point there is no unredacted node
 * anywhere in the process, so `nodes.props`, `files.doc_json`, the FTS mirror, symbol
 * cards, embeddings, `index show --json` and the retrieval funnel all read the same clean
 * object. A guarantee enforced at one chokepoint cannot be forgotten at the next.
 */
function redactNodeText(n) {
  if (typeof n.doc === 'string' && n.doc) n.doc = secrets.redact(n.doc).text;
  if (Array.isArray(n.args)) {
    for (const a of n.args) {
      // A default value is the other place a credential hides in a signature:
      // `def connect(dsn="postgres://user:pass@host/db")`.
      if (a && typeof a.default === 'string' && a.default) a.default = secrets.redact(a.default).text;
    }
  }
  return n;
}

// An evidenced REFERENCE means live: a call, or an inheritance (an abstract base is
// referenced by its subclasses, never called). Structural edges must NOT count:
// `contains` runs file -> symbol for every symbol that exists, so treating it as a
// reference marks the entire codebase live.
const REFERENCE_EDGES = new Set(['calls', 'inherits', 'exposes']);

const A = {
  nodes:       (g) => (g._db ? g.nodesIter() : Object.values(g.nodes)),
  nodesOfKind: (g, k) => (g._db ? g.nodesByKind(k) : Object.values(g.nodes).filter((n) => n.kind === k)),
  node:        (g, id) => (g._db ? g.getNode(id) : g.nodes[id]),
  edgesOfType: (g, t) => (g._db ? g.edgesOfType(t) : g.edges.filter((e) => e.type === t)),
  fanIn:       (g, id) => (g._db ? g.fanIn(id) : callers(g, id).length),
  referenced:  (g, id) => (g._db
    ? g.hasReference(id)
    : g.edges.some((e) => e.to === id && e.resolved !== false && REFERENCE_EDGES.has(e.type))),

  // ── bulk forms, for the queries that sweep the WHOLE graph ──
  //
  // A point lookup wants the full node; a sweep wants six fields from every node. Reading
  // full rows for a sweep means a JSON.parse per row, which measured SLOWER than the array
  // scan this migration replaced — `untested()` was 10x worse before these existed. The
  // rule that follows: a sweep uses the projected form, a point query uses the full one.
  scanNodes:   (g) => (g._db ? g.nodeCols() : Object.values(g.nodes)),
  // Pre-filtered sweeps. The predicate is applied in SQL on the stored path and by the
  // caller's own .filter() on the in-memory path — so both produce the same set, and the
  // stored path never builds objects it is about to discard. The caller keeps its filter
  // either way: this narrows the input, it does not replace the rule.
  scanWithComplexity: (g) => (g._db ? g.hotspotCols() : Object.values(g.nodes)),
  scanOrphanCandidates: (g) => (g._db ? g.orphanCols() : Object.values(g.nodes)),
  scanUntestedCandidates: (g) => (g._db ? g.untestedCols() : Object.values(g.nodes)),
  nameIndex:   (g) => {
    if (g._db) return g.nameIndex();
    const m = new Map();
    for (const n of Object.values(g.nodes)) m.set(n.id, n);
    return m;
  },
  filePaths:   (g) => (g._db ? g.filePaths() : Object.values(g.nodes).filter((n) => n.kind === 'file').map((n) => n.path)),
  edgePairs:   (g, t) => (g._db
    ? g.typePairs(t).map((r) => ({ from: r.from_id, to: r.to_id }))
    : g.edges.filter((e) => e.type === t)),
  callPairs:   (g) => (g._db
    ? g.callPairs().map((r) => ({ from: r.from_id, to: r.to_id, unresolved: r.unresolved ?? undefined }))
    : g.edges.filter((e) => e.type === 'calls')),
  fanInMap:    (g) => {
    if (g._db) return g.fanInAll();
    const m = new Map();
    for (const e of g.edges) {
      if (e.type !== 'calls' || e.resolved === false) continue;
      m.set(e.to, (m.get(e.to) || 0) + 1);
    }
    return m;
  },
  referencedIds: (g) => {
    if (g._db) return g.referencedIds();
    const s = new Set();
    for (const e of g.edges) {
      if (e.resolved !== false && REFERENCE_EDGES.has(e.type)) s.add(e.to);
    }
    return s;
  }
};

// ─── queries ────────────────────────────────────────────────────────────────

function edgesFrom(g, id, type) {
  if (g._db) return g.outEdges(id, type);
  return g.edges.filter((e) => e.from === id && (!type || e.type === type));
}
function edgesTo(g, id, type) {
  if (g._db) return g.inEdges(id, type);
  return g.edges.filter((e) => e.to === id && (!type || e.type === type));
}

function findSymbols(g, query) {
  const q = String(query).toLowerCase();
  if (g._db) return g.findByQualnameSubstring(query);
  return Object.values(g.nodes).filter((n) =>
    n.kind !== 'file' && (n.qualname || '').toLowerCase().includes(q)
  );
}

// Only EVIDENCED edges count. An unresolved call is a known unknown, not a caller.
function callers(g, id) {
  return edgesTo(g, id, 'calls')
    .filter((e) => e.resolved !== false)
    .map((e) => ({ id: e.from, line: e.line, resolution: e.resolution }));
}
function callees(g, id) {
  return edgesFrom(g, id, 'calls')
    .filter((e) => e.resolved !== false)
    .map((e) => ({ id: e.to, line: e.line, resolution: e.resolution }));
}

// What breaks if this changes: reverse closure over calls + file imports.
function blastRadius(g, id, maxDepth = 3) {
  const seen = new Map();
  let frontier = [id];
  for (let d = 1; d <= maxDepth && frontier.length; d++) {
    const next = [];
    for (const cur of frontier) {
      const inbound = edgesTo(g, cur)
        .filter((e) => (e.type === 'calls' && e.resolved !== false) || e.type === 'imports');
      for (const e of inbound) {
        if (seen.has(e.from)) continue;
        seen.set(e.from, d);
        next.push(e.from);
      }
      // A symbol's file is also affected.
      const node = A.node(g, cur);
      if (node && node.file) {
        const fid = `file:${node.file}`;
        if (!seen.has(fid)) { seen.set(fid, d); next.push(fid); }
      }
    }
    frontier = next;
  }
  seen.delete(id);
  return [...seen.entries()].map(([nid, depth]) => ({ id: nid, depth })).sort((a, b) => a.depth - b.depth);
}

// Import cycles between files (Tarjan-lite via DFS colouring).
function cycles(g) {
  const adj = new Map();
  // Adjacency order is load-bearing: this is a DFS, and a different edge order finds the
  // same cycles in a different rotation. Both the array scan and the indexed read return
  // edges in insertion order, which is why store/db.js keeps an explicit `seq`.
  for (const e of A.edgePairs(g, 'imports')) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const stack = [];
  const found = [];
  // Iterative DFS with an explicit frame stack, NOT recursion.
  //
  // The recursive form overflowed the JS call stack on a 14,420-file repo — `rmad index
  // cycles` did not report "too big", it crashed the process. Import chains are as deep
  // as the codebase is layered, so the depth is attacker-free but unbounded in practice,
  // and a crash at exactly the scale where cycle detection matters most is the worst
  // place to have this limit. Visit order, and therefore the contents and ordering of
  // `found`, are identical to the recursive version.
  const visit = (start) => {
    color.set(start, GRAY);
    stack.push(start);
    const frames = [{ node: start, i: 0 }];
    while (frames.length) {
      const f = frames[frames.length - 1];
      const children = adj.get(f.node) || [];
      if (f.i < children.length) {
        const m = children[f.i++];
        const c = color.get(m) || WHITE;
        if (c === GRAY) {
          const i = stack.indexOf(m);
          if (i !== -1) found.push(stack.slice(i).concat(m));
        } else if (c === WHITE) {
          color.set(m, GRAY);
          stack.push(m);
          frames.push({ node: m, i: 0 });
        }
      } else {
        stack.pop();
        color.set(f.node, BLACK);
        frames.pop();
      }
    }
  };
  for (const n of adj.keys()) if ((color.get(n) || WHITE) === WHITE) visit(n);
  // Dedupe by normalized ring
  const uniq = new Map();
  for (const c of found) {
    const ring = c.slice(0, -1);
    const key = [...ring].sort().join('|');
    if (!uniq.has(key)) uniq.set(key, c);
  }
  return [...uniq.values()];
}

// Symbols nothing references. Entry points / routes / tests / dunder are excluded —
// the #1 way a dead-code report lies is by forgetting an entry point.
function orphans(g) {
  const out = [];
  // One pass for "what is referenced at all", then set membership per candidate. Asking
  // the store once per symbol is an N+1 that costs more than the scan it replaced.
  const referenced = A.referencedIds(g);
  for (const n of A.scanOrphanCandidates(g)) {
    if (n.kind === 'file' || n.kind === 'constant' || n.kind === 'route') continue;
    if (n.route) continue;
    if (/^(main|__init__|__main__|setup|handler|lambda_handler)$/.test(n.name)) continue;
    if (n.name.startsWith('__') && n.name.endsWith('__')) continue;
    if (/test/i.test(n.file)) continue;
    if ((n.decorators || []).length) continue; // DI/route/registry — never call it dead
    // Counting only `calls` reported every ABC and every module-scope singleton as dead —
    // including one with 36 verified call sites. See REFERENCE_EDGES above for why
    // `contains` must never count.
    if (referenced.has(n.id)) continue;
    // A class whose methods are used is not dead, whatever references the class itself.
    if (n.kind === 'class') {
      const prefix = `sym:${n.file}#${n.qualname}.`;
      let methodUsed = false;
      for (const id of referenced) {
        if (String(id).startsWith(prefix)) { methodUsed = true; break; }
      }
      if (methodUsed) continue;
    }
    out.push({ id: n.id, name: n.qualname, file: n.file, line: n.line, loc: n.loc, kind: n.kind });
  }
  return out.sort((a, b) => (b.loc || 0) - (a.loc || 0));
}

function hotspots(g, limit = 20) {
  const fanInOf = A.fanInMap(g);
  return A.scanWithComplexity(g)
    .filter((n) => n.complexity && n.kind !== 'file')
    .map((n) => {
      const fanIn = fanInOf.get(n.id) || 0;
      return {
        id: n.id, name: n.qualname, file: n.file, line: n.line,
        complexity: n.complexity, loc: n.loc,
        fanIn,
        // complexity x log2(fan-in): a 2-line helper called 400 times is stable
        // infrastructure, not a hotspot — the old linear form ranked it #1 in the repo.
        // Complexity is what makes a change go wrong; fan-in only scales the consequence.
        risk: Math.round(n.complexity * (1 + Math.log2(1 + fanIn)) * 10) / 10
      };
    })
    .sort((a, b) => b.risk - a.risk)
    .slice(0, limit);
}

function routes(g) {
  return (g._db ? g.routeNodes() : Object.values(g.nodes).filter((n) => n.route))
    .map((n) => ({ id: n.id, method: n.route.method, path: n.route.path, handler: n.qualname, file: n.file, line: n.line }));
}

// Symbols with no test referencing them by name.
function untested(g) {
  // This one genuinely touches every node twice, so it materialises once and indexes in
  // memory rather than issuing a lookup per call edge.
  // Two different needs, so two different reads: a name for EVERY call target (id -> name
  // is two columns), and full projected rows only for the symbols that could be reported.
  const byId = A.nameIndex(g);
  // A Set, not an array: `testFiles.includes(...)` inside a loop over every call edge is
  // quadratic, and on a repo with many test files it dominated the whole query.
  const testFiles = new Set(A.filePaths(g).filter((p) => /test/i.test(p)));
  const testedNames = new Set();
  for (const e of A.callPairs(g)) {
    const from = byId.get(e.from);
    if (from && from.file && testFiles.has(from.file)) {
      const to = byId.get(e.to);
      if (to) testedNames.add(to.name);
      else if (e.unresolved) testedNames.add(e.unresolved);
    }
  }
  return A.scanUntestedCandidates(g)
    .filter((n) => n.kind !== 'file' && n.kind !== 'constant' && !/test/i.test(n.file || ''))
    .filter((n) => !testedNames.has(n.name))
    .map((n) => ({ id: n.id, name: n.qualname, file: n.file, line: n.line, complexity: n.complexity, loc: n.loc }))
    .sort((a, b) => (b.complexity || 0) - (a.complexity || 0));
}

// Architectural layers inferred from top-level directories, plus who imports whom.
/**
 * Cross-boundary import flow.
 *
 * A TEST IMPORTING THE CODE IT TESTS IS NOT A LAYERING VIOLATION, it is the definition of
 * a test — and it was previously counted as one. This repo's own top flow was
 * `tests/unit -> .claude/hooks` at 83, so every project carried a permanent "violation"
 * that no amount of good architecture could ever clear. A metric that can never reach
 * zero teaches people to ignore it, and O4 is the obligation that then goes unread.
 *
 * Worse, it was a live false positive: making imports resolve for the first time (the
 * src-layout fix) made a project's test imports newly visible, and O4 reported `layers
 * 0 -> 1` — new structural debt, from adding no production code at all.
 *
 * Test flows are still returned and still displayed, tagged `test`, because a test
 * directory importing another test directory is worth seeing. They are excluded from the
 * count O4 compares.
 */
function layers(g) {
  const layerOf = (p) => p.split('/').slice(0, 2).join('/');
  const map = new Map();
  // `imports` edges always run file -> file, so a file-node lookup table is enough and
  // costs one query instead of two per edge.
  const files = new Map(A.scanNodes(g).filter((n) => n.kind === 'file').map((n) => [n.id, n]));
  for (const e of A.edgePairs(g, 'imports')) {
    const a = files.get(e.from), b = files.get(e.to);
    if (!a || !b) continue;
    const la = layerOf(a.path), lb = layerOf(b.path);
    if (la === lb) continue;
    const key = `${la} -> ${lb}`;
    const prev = map.get(key);
    // Tagged by the SOURCE only, and the code has to actually say that. The first version
    // read `isTestFile(a) && !isTestFile(b)`, which contradicted this comment and put
    // TEST-TO-TEST flows in the production bucket -- `tests/unit -> tests/corpus`, a suite
    // importing its own fixtures, counted as architectural debt.
    //
    // Source-only is the right rule in both directions: a test importing anything is
    // scaffolding, and a PRODUCTION file importing a test helper is a real finding that
    // stays counted (its source is not a test).
    const kind = isTestFile(a.path) ? 'test' : 'production';
    map.set(key, { count: (prev ? prev.count : 0) + 1, kind });
  }
  return [...map.entries()]
    .map(([edge, v]) => ({ edge, count: v.count, kind: v.kind }))
    .sort((a, b) => b.count - a.count);
}

/** The flows O4 compares: production architecture only. */
function productionLayers(g) {
  return layers(g).filter((l) => l.kind !== 'test');
}

function summary(g) {
  const byLang = {};
  const byFidelity = {};
  const all = A.scanNodes(g);
  for (const n of all) {
    if (n.kind !== 'file') continue;
    byLang[n.language] = (byLang[n.language] || 0) + 1;
    byFidelity[n.fidelity] = (byFidelity[n.fidelity] || 0) + 1;
  }
  const kinds = {};
  for (const n of all) kinds[n.kind] = (kinds[n.kind] || 0) + 1;
  return { ...g.stats, byLang, byFidelity, kinds, generated: g.generated };
}

module.exports = {
  buildGraph, load, save, indexPath, walk, summary,
  findSymbols, callers, callees, blastRadius, cycles, orphans, hotspots, routes, untested,
  layers, productionLayers, isTestFile, TEST_PATH,
  edgesFrom, edgesTo, detectPython, SCHEMA_VERSION, INDEX_DIR, indexDir, rootExists,
  // A loaded graph holds an open database handle for the life of the process. A CLI just
  // exits; anything longer-lived (tests, hooks in a watch loop, a future daemon) must be
  // able to let go — on Windows an open handle blocks deleting the index.
  closeAll: store.closeAll,
  // Indexed accessors, so consumers never have to reach for `g.nodes` — which on a
  // database-backed graph materialises every node and reintroduces the cost the store
  // exists to remove. These work on both an in-memory and a stored graph.
  getNode:     (g, id) => A.node(g, id),
  allNodes:    (g) => A.nodes(g),
  nodesOfKind: (g, kind) => A.nodesOfKind(g, kind),
  nodesInFile: (g, file) => (g._db ? g.nodesInFile(file) : Object.values(g.nodes).filter((n) => n.file === file)),
  fileHashes:  (g) => (g._db ? g.fileHashes() : Object.fromEntries(
    Object.entries(g.files || {}).map(([p, r]) => [p, r.hash])))
};
