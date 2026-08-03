// read.js — the graph handle you get back from load().
//
// It looks exactly like the old JSON graph object (`.nodes`, `.edges`, `.files`,
// `.semantic`, `.features`, `.stats`, `.root`) so nothing downstream had to change. The
// difference is that those four collections are LAZY: touching `.nodes` materialises every
// node, and on a large repo that is precisely the cost this migration exists to avoid.
//
// So the handle also exposes indexed accessors — getNode, edgesTo, edgesFrom, nodesByKind,
// fanIn — and the query layer uses ONLY those. The lazy properties are a compatibility
// shim for code that has not been converted yet, not the intended path. `materialised`
// reports whether anything fell back to them, which is how we can tell the difference
// between "converted" and "appears to work".

'use strict';

const db = require('./db.js');

function parse(json) {
  return json === null || json === undefined ? null : JSON.parse(json);
}

/** Define a property that computes once on first access, then behaves like plain data. */
function lazy(obj, name, compute) {
  Object.defineProperty(obj, name, {
    configurable: true,
    enumerable: true,
    get() {
      const value = compute();
      Object.defineProperty(obj, name, { value, writable: true, enumerable: true, configurable: true });
      return value;
    },
    set(value) {
      Object.defineProperty(obj, name, { value, writable: true, enumerable: true, configurable: true });
    }
  });
}

/**
 * Open a stored graph. Returns null when the file is absent, unreadable, or written by a
 * different schema version — all three mean "no usable index", and the caller rebuilds.
 * Repairing a version mismatch in place would be guesswork, and the graph is cheap to
 * rebuild; a half-migrated index is a confidently wrong one.
 */
function readGraph(file) {
  const conn = db.open(file, { create: false });
  if (!conn) return null;
  if (!db.schemaOk(conn)) { db.close(conn); return null; }

  const meta = db.getMeta(conn);
  let stats;
  try {
    stats = JSON.parse(meta.stats || '{}');
  } catch {
    db.close(conn);
    return null;
  }

  const g = {
    schema: Number(meta.graph_schema),
    root: meta.root,
    generated: meta.generated,
    durationMs: Number(meta.durationMs),
    stats
  };

  // ── prepared statements: one parse each, reused for the process lifetime ──
  const q = {
    node:        conn.prepare('SELECT props FROM nodes WHERE id = ?'),
    allNodes:    conn.prepare('SELECT props FROM nodes ORDER BY seq'),
    nodesByKind: conn.prepare('SELECT props FROM nodes WHERE kind = ? ORDER BY seq'),
    nodesInFile: conn.prepare('SELECT props FROM nodes WHERE file = ? ORDER BY seq'),
    routeNodes:  conn.prepare('SELECT props FROM nodes WHERE has_route = 1 ORDER BY seq'),
    // COALESCE, not a bare column: the JSON implementation matched on `(n.qualname || '')`,
    // so a node with no qualname still matches the empty query. `NULL LIKE '%%'` is NULL,
    // which would silently drop those rows and make findSymbols('') disagree with itself.
    findLike:    conn.prepare("SELECT props FROM nodes WHERE kind != 'file' AND COALESCE(qualname_lc,'') LIKE ? ESCAPE '\\' ORDER BY seq"),
    namesById:   conn.prepare('SELECT id, name FROM nodes'),
    allEdges:    conn.prepare('SELECT props FROM edges ORDER BY seq'),
    edgesByType: conn.prepare('SELECT props FROM edges WHERE type = ? ORDER BY seq'),
    from:        conn.prepare('SELECT props FROM edges WHERE from_id = ? ORDER BY seq'),
    fromType:    conn.prepare('SELECT props FROM edges WHERE from_id = ? AND type = ? ORDER BY seq'),
    to:          conn.prepare('SELECT props FROM edges WHERE to_id = ? ORDER BY seq'),
    toType:      conn.prepare('SELECT props FROM edges WHERE to_id = ? AND type = ? ORDER BY seq'),
    fanIn:       conn.prepare("SELECT COUNT(*) c FROM edges WHERE to_id = ? AND type = 'calls' AND resolved = 1"),
    refTo:       conn.prepare(`SELECT 1 FROM edges
                                WHERE to_id = ? AND resolved = 1
                                  AND type IN ('calls','inherits','exposes') LIMIT 1`),
    refPrefix:   conn.prepare(`SELECT 1 FROM edges
                                WHERE resolved = 1 AND type IN ('calls','inherits','exposes')
                                  AND to_id GLOB ? LIMIT 1`),
    // One query instead of one-per-candidate. orphans() asks "is this referenced?" for
    // every symbol in the repo; issuing a statement each time is an N+1 that made the
    // indexed path SLOWER than the array scan it replaced.
    refAll:      conn.prepare(`SELECT DISTINCT to_id FROM edges
                                WHERE resolved = 1 AND type IN ('calls','inherits','exposes')`),
    // Column-only projections. Whole-graph scans need six fields, not the whole node, and
    // JSON.parse over every row is what made untested() slower than the array scan.
    nodeCols:    conn.prepare(`SELECT id, kind, name, qualname, file, path, line, loc,
                                      language, fidelity, complexity, has_route, has_decorators
                                 FROM nodes ORDER BY seq`),
    // Pre-filtered sweeps. Projecting 350k rows into JS objects so JS can throw most of
    // them away is the dominant cost of a whole-graph query; the WHERE clauses below
    // mirror the caller's own filter exactly, and the parity suite proves they match.
    hotspotCols: conn.prepare(`SELECT id, kind, name, qualname, file, path, line, loc,
                                      language, fidelity, complexity, has_route, has_decorators
                                 FROM nodes
                                WHERE kind != 'file' AND complexity IS NOT NULL AND complexity != 0
                                ORDER BY seq`),
    orphanCols:  conn.prepare(`SELECT id, kind, name, qualname, file, path, line, loc,
                                      language, fidelity, complexity, has_route, has_decorators
                                 FROM nodes
                                WHERE kind NOT IN ('file','constant','route')
                                  AND has_route = 0 AND has_decorators = 0
                                ORDER BY seq`),
    untestedCols: conn.prepare(`SELECT id, kind, name, qualname, file, path, line, loc,
                                      language, fidelity, complexity, has_route, has_decorators
                                 FROM nodes
                                WHERE kind NOT IN ('file','constant')
                                ORDER BY seq`),
    // untested() needs a name for EVERY call target, including ones it will not report.
    // Two columns beats a projected object per node.
    nameIndex:   conn.prepare('SELECT id, name, file FROM nodes'),
    testFiles:   conn.prepare("SELECT path FROM nodes WHERE kind = 'file'"),
    fanInAll:    conn.prepare(`SELECT to_id, COUNT(*) c FROM edges
                                WHERE type = 'calls' AND resolved = 1 GROUP BY to_id`),
    callCols:    conn.prepare(`SELECT from_id, to_id, unresolved FROM edges
                                WHERE type = 'calls' ORDER BY seq`),
    typeCols:    conn.prepare('SELECT from_id, to_id FROM edges WHERE type = ? ORDER BY seq'),
    // Tier 2. bm25() is negative-better in SQLite, so it is negated here and every
    // consumer can treat score as "higher is more relevant" like the other tiers.
    // RMAD-R2. Spans carry one searchable column, so bm25 needs no field weights here.
    // Returns the PARENT file id, not the chunk id: a raw line range is precise and
    // unusable, so retrieval hands back the enclosing file (small-to-big).
    spansFts:    conn.prepare(`SELECT s.parent_id AS node_id, s.id AS chunk_id, s.line, s.end_line,
                                      -bm25(spans_fts) AS score
                                 FROM spans_fts JOIN span_chunks s ON s.id = spans_fts.chunk_id
                                WHERE spans_fts MATCH ? ORDER BY score DESC LIMIT ?`),
    fts:         conn.prepare(`SELECT node_id, -bm25(symbols_fts, 8.0, 4.0, 2.0, 1.0) AS score,
                                      qualname, terms, signature, doc
                                 FROM symbols_fts WHERE symbols_fts MATCH ?
                                ORDER BY score DESC LIMIT ?`),
    fileMeta:    conn.prepare('SELECT path, hash FROM files ORDER BY seq'),
    fileDoc:     conn.prepare('SELECT doc_json FROM files WHERE path = ?'),
    allFiles:    conn.prepare('SELECT path, hash, doc_json FROM files ORDER BY seq'),
    allSem:      conn.prepare('SELECT node_id, json FROM semantic ORDER BY seq'),
    allFeat:     conn.prepare('SELECT key, json FROM features ORDER BY seq')
  };

  const rows = (stmt, ...args) => stmt.all(...args).map((r) => parse(r.props));

  g._db = conn;
  g._materialised = new Set();

  // ── indexed accessors: the path every query should take ──
  Object.defineProperties(g, {
    getNode:     { value: (id) => { const r = q.node.get(id); return r ? parse(r.props) : undefined; } },
    nodesIter:   { value: () => rows(q.allNodes) },
    nodesByKind: { value: (kind) => rows(q.nodesByKind, kind) },
    nodesInFile: { value: (file) => rows(q.nodesInFile, file) },
    routeNodes:  { value: () => rows(q.routeNodes) },
    edgesIter:   { value: () => rows(q.allEdges) },
    edgesOfType: { value: (type) => rows(q.edgesByType, type) },
    outEdges:    { value: (id, type) => (type ? rows(q.fromType, id, type) : rows(q.from, id)) },
    inEdges:     { value: (id, type) => (type ? rows(q.toType, id, type) : rows(q.to, id)) },
    fanIn:       { value: (id) => q.fanIn.get(id).c },
    hasReference:{ value: (id) => Boolean(q.refTo.get(id)) },
    // Bulk forms — one statement each, for the queries that sweep the whole graph.
    referencedIds: { value: () => new Set(q.refAll.all().map((r) => r.to_id)) },
    fanInAll:      { value: () => { const m = new Map(); for (const r of q.fanInAll.all()) m.set(r.to_id, r.c); return m; } },
    nodeCols:      { value: () => q.nodeCols.all().map(shapeNodeRow) },
    hotspotCols:   { value: () => q.hotspotCols.all().map(shapeNodeRow) },
    orphanCols:    { value: () => q.orphanCols.all().map(shapeNodeRow) },
    untestedCols:  { value: () => q.untestedCols.all().map(shapeNodeRow) },
    nameIndex:     { value: () => { const m = new Map(); for (const r of q.nameIndex.all()) m.set(r.id, r); return m; } },
    filePaths:     { value: () => q.testFiles.all().map((r) => r.path) },
    callPairs:     { value: () => q.callCols.all() },
    typePairs:     { value: (t) => q.typeCols.all(t) },
    // GLOB rather than LIKE: symbol ids contain `_` and `%` far more often than `*`/`?`,
    // and escaping GLOB's two metacharacters is less error-prone than escaping LIKE's.
    hasReferenceWithPrefix: { value: (p) => Boolean(q.refPrefix.get(`${globEscape(p)}*`)) },
    fileHashes:  { value: () => { const o = {}; for (const r of q.fileMeta.all()) o[r.path] = r.hash; return o; } },
    fileDoc:     { value: (p) => { const r = q.fileDoc.get(p); return r ? parse(r.doc_json) : null; } },
    findByQualnameSubstring: { value: (s) => rows(q.findLike, `%${likeEscape(String(s).toLowerCase())}%`) },
    ftsSearch: { value: (query, limit = 50) => {
      const expr = ftsQuery(query);
      if (!expr) return [];
      let rows;
      try {
        rows = q.fts.all(expr, Math.max(limit, 120));
      } catch {
        // A malformed MATCH expression is a bad query, not a broken index. Returning
        // nothing lets the funnel fall through to its other tiers instead of failing.
        return [];
      }
      return rerankByCoverage(query, rows).slice(0, limit);
    } },
    // RMAD-R2. Search the lines no symbol covers.
    //
    // Several chunks in one file collapse to a single candidate — the file — keeping the
    // BEST score. Without the collapse a file with many matching spans would occupy the
    // whole result set and crowd out every other file, which is the failure mode overlap
    // was rejected to avoid.
    spansSearch: { value: (query, limit = 50) => {
      const expr = ftsQuery(query);
      if (!expr) return [];
      let rows;
      try {
        rows = q.spansFts.all(expr, Math.max(limit, 120) * 3);
      } catch {
        // No span tier (an index built before schema 9), or a malformed MATCH. Either way
        // the funnel falls through to its other tiers rather than failing.
        return [];
      }
      const best = new Map();
      for (const r of rows) {
        const prev = best.get(r.node_id);
        if (!prev || r.score > prev.score) best.set(r.node_id, r);
      }
      return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
    } },
    symbolNames: { value: () => { const m = new Map(); for (const r of q.namesById.all()) m.set(r.id, r.name); return m; } },
    close:       { value: () => db.close(conn) }
  });

  // ── lazy compatibility shims ──
  const note = (what) => g._materialised.add(what);

  lazy(g, 'nodes', () => {
    note('nodes');
    const out = {};
    for (const n of rows(q.allNodes)) out[n.id] = n;
    return out;
  });
  lazy(g, 'edges', () => { note('edges'); return rows(q.allEdges); });
  lazy(g, 'files', () => {
    note('files');
    const out = {};
    for (const r of q.allFiles.all()) out[r.path] = { hash: r.hash, doc: parse(r.doc_json) };
    return out;
  });
  lazy(g, 'semantic', () => {
    const out = {};
    for (const r of q.allSem.all()) out[r.node_id] = parse(r.json);
    return out;
  });
  lazy(g, 'features', () => {
    const out = {};
    for (const r of q.allFeat.all()) out[r.key] = parse(r.json);
    return out;
  });

  return g;
}

// A column-projected node: enough for the whole-graph scans, and NOT a full node.
//
// TWO THINGS THIS MUST GET EXACTLY RIGHT, both learned from the parity suite failing:
//
// 1. ABSENT AND NULL ARE DIFFERENT. buildGraph writes `complexity: s.complexity || null`
//    on a symbol, so a class carries an explicit null — and file nodes have no such key
//    at all. JSON.stringify keeps the first and drops the second, so a projection that
//    collapses both to undefined changes `untested()`'s output. The shape below mirrors
//    how buildGraph constructs each kind, rather than guessing a uniform mapping.
//
// 2. `route` and `decorators` are stand-ins, because every caller asks only whether they
//    are truthy / non-empty. That is why these rows must never reach a query RESULT:
//    hotspots/orphans/untested all rebuild their output from named fields. routes(), the
//    one query that reads route.method, deliberately uses the full-node path instead.
function shapeNodeRow(r) {
  if (r.kind === 'file') {
    // Mirrors the file-node literal in buildGraph: no name/qualname/line/complexity.
    return { id: r.id, kind: 'file', path: r.path, language: r.language, fidelity: r.fidelity, loc: r.loc };
  }
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    qualname: r.qualname,
    file: r.file,
    line: r.line,
    loc: r.loc,
    fidelity: r.fidelity,
    complexity: r.complexity === null ? null : r.complexity,
    route: r.has_route ? PRESENT : null,
    decorators: r.has_decorators ? PRESENT_LIST : []
  };
}
// Sentinels: truthy, and shaped so a `.length` test behaves. Never serialised.
const PRESENT = Object.freeze({});
const PRESENT_LIST = Object.freeze(['?']);

/**
 * Turn a user query into a safe FTS5 MATCH expression.
 *
 * User input reaches MATCH directly, and FTS5's query language has its own operators —
 * an unescaped `"` or a bare `NEAR` is a syntax error at best. Every term is therefore
 * quoted (which disables operator interpretation) and given a prefix wildcard, because
 * searching `tok` for `TokenStore` is the common case in code.
 */
// Words that carry no signal in a code search but match a great deal of prose. Dropping
// them sharpens BM25 rather than changing what is findable — "what breaks if I change
// this" should be answered by `breaks`/`change`, not diluted by `what`/`if`/`this`.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has', 'have', 'was', 'one',
  'our', 'out', 'day', 'get', 'use', 'how', 'its', 'who', 'did', 'yes', 'his', 'her', 'she',
  'him', 'this', 'that', 'with', 'from', 'they', 'them', 'then', 'than', 'what', 'when',
  'where', 'which', 'while', 'will', 'would', 'there', 'their', 'been', 'does', 'doing',
  'into', 'over', 'some', 'such', 'only', 'other', 'about', 'after', 'before', 'being',
  'should', 'could', 'more', 'most', 'any', 'each', 'both', 'very', 'just', 'now'
]);

/**
 * Re-rank FTS results by how much of the QUERY each one actually accounts for.
 *
 * The MATCH expression ORs its terms, so a document matching one term out of six competes
 * with one matching four — separated only by BM25, which prefers SHORT documents. The
 * result is that a three-character function called `add` outranks `langConfig` for "where
 * do I add support for another programming language", and `listFiles` outranks `cycles`
 * for "import cycles between files". Both were measured on the golden set.
 *
 * Coverage fixes it directly: matching more of what was asked is better evidence than
 * matching a little of it very densely. BM25 still orders within a coverage tier, so this
 * sharpens the ranking rather than replacing it.
 */
function rerankByCoverage(rawQuery, rows) {
  const terms = String(rawQuery || '')
    .split(/[^A-Za-z0-9_$]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t.toLowerCase()))
    .map((t) => t.toLowerCase());
  if (terms.length < 2) return rows;

  const uniq = [...new Set(terms)];
  return rows
    .map((r) => {
      const hay = `${r.qualname || ''} ${r.terms || ''} ${r.signature || ''} ${r.doc || ''}`.toLowerCase();
      let matched = 0;
      for (const t of uniq) if (hay.includes(t)) matched++;
      const coverage = matched / uniq.length;
      // Quadratic in coverage: accounting for most of a question should decisively beat
      // accounting for a fraction of it, not edge ahead by a few percent.
      return { ...r, coverage, score: r.score * (0.25 + coverage * coverage * 3) };
    })
    .sort((a, b) => b.score - a.score);
}

function ftsQuery(raw) {
  const all = String(raw || '').split(/[^A-Za-z0-9_$]+/).filter((t) => t.length > 1);
  let terms = all.filter((t) => !STOPWORDS.has(t.toLowerCase()));
  // If a query is nothing BUT stopwords, search them rather than returning nothing —
  // a worse answer beats no answer.
  if (!terms.length) terms = all;
  terms = terms.slice(0, 12);
  if (!terms.length) return null;
  return terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' OR ');
}

// LIKE treats % and _ as wildcards; a search for `get_user` must not match `getXuser`.
function likeEscape(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
// GLOB treats *, ? and [ as metacharacters.
function globEscape(s) {
  return s.replace(/[[*?]/g, (c) => `[${c}]`);
}

module.exports = { readGraph };
