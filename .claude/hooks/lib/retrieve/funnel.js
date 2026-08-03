// funnel.js — retrieval: exact matches seed, the graph expands, fusion ranks, a budget packs.
//
// THE SPLIT OF DUTIES, WHICH IS THE WHOLE DESIGN: lexical search finds CANDIDATES, the
// graph DECIDES. Similarity — lexical or vector — cannot tell you a function has no
// callers, that two modules import each other, or that a route reaches the database
// without passing auth. Those are graph properties, and they are what an agent about to
// change code actually needs. So ranking never runs on text score alone: every candidate
// is expanded through real edges, and the expansion is what most of the score comes from.
//
// WHY THERE IS A CLASSIFIER IN FRONT: most agent queries are symbol-shaped
// (`TokenStore.verify`, a stack frame, a changed-file set), and those want exhaustive
// exact lookup, not ranking. Routing them past the fuzzy tiers is why this can stay fast
// and why the industry's move away from embeddings for code worked — the common case
// never needed them.
//
// THE BUDGET IS HARD, NOT ADVISORY. Frontier models degrade non-uniformly as input grows
// and fall off sharply well before their context limit, so returning more than was asked
// for is not generosity, it is harm. When results are dropped the caller is TOLD how many.

'use strict';

const G = require('../code-graph.js');

const DEFAULTS = {
  budgetTokens: 6000,
  expandDepth: 2,
  rrfK: 60,
  // Ordered by STRENGTH OF EVIDENCE, and the order is the whole point:
  //   exact    — the name you asked for. Nothing outranks it.
  //   lexical  — your words appear in this symbol's name, signature or docstring.
  //   graph    — this is *adjacent to* something that matched.
  //
  // Getting this backwards (graph above lexical) is not a small mis-tuning: it lets a
  // neighbour with no textual connection to the query outrank a direct hit. Measured on a
  // 50-query golden set it pushed `blastRadius` from rank 1 to rank 21 for a query that
  // quotes its own docstring, and dropped recall@5 to 38%.
  // `spans` sits below lexical and above graph, deliberately. A span hit means "your
  // words appear in a region of this file" — roughly lexical-strength evidence, but at
  // FILE granularity rather than symbol, so it is less precise and must not outrank a
  // symbol-name match. It is a separate RRF input rather than being folded into `lexical`
  // so the two can be weighted, and credited, independently.
  weights: { exact: 1.0, lexical: 0.75, semantic: 0.55, spans: 0.5, graph: 0.4 },
  // Expansion is context, not an answer. A candidate reached ONLY by traversal is damped
  // so it surfaces beneath the things that actually matched rather than displacing them.
  expansionOnlyDamping: 0.35,
  // PageRank is a tie-breaker, never a co-equal term — RRF increments are ~0.016, so an
  // unscaled centrality score simply replaces the ranking with "most-connected first".
  pageRankWeight: 0.15,
  maxCandidates: 200
};

// Typed edge weights. A test that covers a symbol is a strong relation because "show me
// the tests" is the most common follow-up to "show me the function"; sibling methods that
// merely share a file are weak evidence and must not crowd out real callers.
const EDGE_WEIGHT = {
  calls: 1.0,
  inherits: 0.9,
  exposes: 0.8,
  covers: 1.0,
  imports: 0.6,
  contains: 0.3
};

// ─── stage 0: classify ──────────────────────────────────────────────────────

function classify(query) {
  const q = String(query || '').trim();
  if (!q) return 'empty';
  if (/^[A-Za-z_$][\w$]*(?:[.#][A-Za-z_$][\w$]*)+$/.test(q)) return 'qualified-symbol';
  if (/[/\\*]/.test(q) && !/\s/.test(q)) return 'path';
  if (/^\s*(?:at |File "|Traceback|[\w.]+Error|[\w.]+Exception)/.test(q)) return 'trace';
  if (/^[A-Za-z_$][\w$]*$/.test(q)) return 'symbol';
  return 'prose';
}

/** Pull identifiers out of a stack trace or error string to seed stage 1. */
function seedsFromTrace(q) {
  const out = new Set();
  for (const m of String(q).matchAll(/(?:at\s+|File\s+"[^"]*",\s+line\s+\d+,\s+in\s+)([A-Za-z_$][\w$.]*)/g)) {
    out.add(m[1]);
  }
  for (const m of String(q).matchAll(/\b([A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*)\b/g)) out.add(m[1]);
  return [...out];
}

/**
 * Compile a user-supplied glob into a regex, or return null if it cannot be.
 *
 * Every metacharacter is escaped first and only then are the glob wildcards reintroduced,
 * so nothing the user types can reach the regex engine as syntax. The final construction
 * is still wrapped: a query is input, and input must not be able to throw.
 */
function safeGlob(q) {
  try {
    const body = String(q)
      .replace(/[.+^${}()|[\]\\?]/g, '\\$&')   // `?` included — it is a quantifier in regex
      .replace(/\\\?/g, '[^/]')                // now reintroduce it as a glob single-char
      .replace(/\*\*/g, '\0')
      .replace(/\*/g, '[^/]*')
      .replace(/\0/g, '.*');
    return new RegExp(body, 'i');
  } catch {
    return null;
  }
}

// ─── stage 1: exact ─────────────────────────────────────────────────────────

function exactHits(g, query, kind) {
  const hits = [];
  const seen = new Set();
  const push = (n, why) => {
    if (!n || seen.has(n.id)) return;
    seen.add(n.id);
    hits.push({ node: n, why });
  };

  const q = String(query).trim();

  if (kind === 'path') {
    // `?` must be escaped or converted, never left raw. classify() routes anything
    // containing / \ * with no whitespace here, so `index search '?*'` compiled to
    // /?[^/]*/ and threw "Nothing to repeat" — an uncaught SyntaxError that killed the
    // process on a malformed query instead of returning no results.
    const re = safeGlob(q);
    if (!re) return hits;
    for (const f of G.nodesOfKind(g, 'file')) if (re.test(f.path)) push(f, 'path match');
    return hits;
  }

  const names = kind === 'trace' ? seedsFromTrace(q) : [q];
  for (const name of names) {
    // Exact qualname first — an exact hit must never be outranked by a substring one.
    for (const n of G.findSymbols(g, name)) {
      if (n.qualname === name || n.name === name) push(n, 'exact name');
    }
    for (const n of G.findSymbols(g, name)) push(n, 'name contains');
  }
  return hits;
}

// ─── stage 2: graph expansion ───────────────────────────────────────────────

function expand(g, seeds, depth) {
  const score = new Map();
  const reason = new Map();
  let frontier = seeds.map((s) => s.id);
  const seen = new Set(frontier);

  for (let d = 1; d <= depth && frontier.length; d++) {
    const next = [];
    for (const id of frontier) {
      const edges = [...G.edgesFrom(g, id), ...G.edgesTo(g, id)];
      for (const e of edges) {
        // An unresolved edge is a known unknown. It is excluded from expansion for the
        // same reason it is excluded from callers(): a fabricated relation ranked highly
        // is worse than a missing one, because it looks like evidence.
        if (e.resolved === false) continue;
        const w = EDGE_WEIGHT[e.type];
        if (!w) continue;
        const other = e.from === id ? e.to : e.from;
        if (!other || other.startsWith('name:') || other.startsWith('ext:')) continue;
        const add = (w / (1 + d));
        score.set(other, (score.get(other) || 0) + add);
        if (!reason.has(other)) reason.set(other, `${e.type} ${d} hop${d > 1 ? 's' : ''} from ${shortId(id)}`);
        if (!seen.has(other)) { seen.add(other); next.push(other); }
      }
    }
    frontier = next;
  }
  return { score, reason };
}

const shortId = (id) => String(id).replace(/^sym:/, '').replace(/^file:/, '');

// ─── stage 4: fusion ────────────────────────────────────────────────────────

/**
 * Reciprocal Rank Fusion. Rank-based rather than score-based on purpose: the three tiers
 * produce numbers on incomparable scales (a BM25 score and a hop-decayed graph weight
 * have no common unit), and normalising them would invent a relationship that isn't there.
 */
function rrf(rankings, k, weights) {
  const fused = new Map();
  for (const [name, list] of Object.entries(rankings)) {
    const w = weights[name] ?? 1;
    list.forEach((id, i) => {
      fused.set(id, (fused.get(id) || 0) + w / (k + i + 1));
    });
  }
  return fused;
}

// ─── stage 5: ranking ───────────────────────────────────────────────────────

/**
 * Personalised PageRank over the evidenced subgraph, seeded on what the caller is already
 * looking at. This is what answers "given N tokens, which N?" — plain relevance ranks a
 * utility function called everywhere above the one function the task is about.
 */
function personalisedRank(g, candidates, seedWeights, iterations = 12, damping = 0.85) {
  const ids = [...candidates];
  const idx = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  if (!n) return new Map();

  const out = ids.map(() => []);
  for (let i = 0; i < n; i++) {
    for (const e of G.edgesFrom(g, ids[i])) {
      if (e.resolved === false) continue;
      const j = idx.get(e.to);
      if (j !== undefined && j !== i) out[i].push(j);
    }
  }

  let total = 0;
  const seed = ids.map((id) => { const w = seedWeights.get(id) || 0; total += w; return w; });
  const teleport = total > 0 ? seed.map((w) => w / total) : ids.map(() => 1 / n);

  let rank = teleport.slice();
  for (let it = 0; it < iterations; it++) {
    const next = new Array(n).fill(0);
    let dangling = 0;
    for (let i = 0; i < n; i++) {
      if (!out[i].length) { dangling += rank[i]; continue; }
      const share = rank[i] / out[i].length;
      for (const j of out[i]) next[j] += share;
    }
    for (let i = 0; i < n; i++) {
      next[i] = (1 - damping) * teleport[i] + damping * (next[i] + dangling * teleport[i]);
    }
    rank = next;
  }
  return new Map(ids.map((id, i) => [id, rank[i]]));
}

// ─── stage 6: packing ───────────────────────────────────────────────────────

// Deliberately crude: ~4 characters per token is close enough for a budget whose job is
// to stop runaway context, and it costs nothing. A real tokenizer would be a dependency
// and a per-model assumption for a number that only needs to be approximately right.
const estimateTokens = (s) => Math.ceil(String(s || '').length / 4);

function renderSignature(n) {
  if (!n || !n.args) return n && n.name ? n.name : '';
  const args = n.args.map((a) => {
    const pre = a.kind === 'rest' ? '...' : a.kind === 'keyword-only' ? '*' : '';
    return pre + a.name + (a.annotation ? `: ${a.annotation}` : '') + (a.default ? ` = ${a.default}` : '');
  }).join(', ');
  return `${n.is_async ? 'async ' : ''}${n.name}(${args})${n.returns ? ` -> ${n.returns}` : ''}`;
}

function pack(g, ranked, budgetTokens) {
  const items = [];
  let used = 0;
  let dropped = 0;

  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i];
    const n = r.node;
    const band = i < 5 ? 'full' : i < 20 ? 'signature' : 'reference';

    const entry = {
      id: n.id,
      kind: n.kind,
      name: n.qualname || n.name || n.path,
      file: n.file || n.path,
      line: n.line ?? null,
      fidelity: n.fidelity,
      score: Math.round(r.score * 1e6) / 1e6,
      stages: r.stages,
      why: r.why,
      band
    };
    if (band !== 'reference') {
      entry.signature = renderSignature(n);
      if (n.doc) entry.doc = String(n.doc).split('\n').slice(0, band === 'full' ? 4 : 1).join(' ').slice(0, 240);
      if (n.complexity) entry.complexity = n.complexity;
    }

    const cost = estimateTokens(JSON.stringify(entry));
    if (used + cost > budgetTokens) { dropped = ranked.length - i; break; }
    used += cost;
    items.push(entry);
  }

  return { items, tokensUsed: used, dropped };
}

// ─── the funnel ─────────────────────────────────────────────────────────────

/**
 * @param {object} g      loaded graph
 * @param {string} query
 * @param {object} opts   { budgetTokens, expandDepth, focusFiles[], mentioned[], kinds[] }
 */
function find(g, query, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const t0 = Date.now();
  const kind = classify(query);

  // An empty query is not a request for everything. Substring matching on '' matches
  // every symbol in the repo, which would blow the budget and return noise ranked by
  // nothing — the caller asked a question with no content, and the honest answer is none.
  if (kind === 'empty') {
    return { query, classified: kind, items: [], total: 0, dropped: 0, tokensUsed: 0,
      budget: cfg.budgetTokens, ambiguousExcluded: 0, fidelity: {}, tookMs: Date.now() - t0 };
  }

  // ── 1 exact ──
  const exact = exactHits(g, query, kind).slice(0, cfg.maxCandidates);
  const exactIds = exact.map((h) => h.node.id);

  // ── 3 lexical (tier 2) — skipped for symbol-shaped queries that already hit ──
  let lexical = [];
  const needsLexical = kind === 'prose' || kind === 'empty' || exact.length < 5;
  if (needsLexical && g.ftsSearch) {
    lexical = g.ftsSearch(query, cfg.maxCandidates).map((r) => r.node_id);
  }

  // ── 2b span chunks (RMAD-R2) — the 62.8% of lines no symbol covers ──
  //
  // Runs under the same condition as lexical: a symbol-shaped query that already hit does
  // not need them. Each hit is returned as its enclosing FILE (small-to-big), so a match on
  // a module-level constant surfaces the file that declares it.
  let spans = [];
  if (needsLexical && cfg.spans !== false && g.spansSearch) {
    spans = g.spansSearch(query, cfg.maxCandidates).map((r) => r.node_id);
  }

  // ── 3 semantic recall (tier 3) ──
  //
  // Off unless someone ran `index embed`, and skipped entirely for symbol-shaped queries
  // that already found something — those are 100% on the deterministic tiers, so paying
  // for a vector search there buys nothing. This runs where the golden set says the
  // deterministic tiers are blind: prose whose words appear nowhere in the code.
  let semantic = [];
  const wantsSemantic = cfg.vector !== false && (kind === 'prose' || kind === 'task' || exact.length < 3);
  if (wantsSemantic && cfg.root) {
    try {
      const vector = require('./vector.js');
      semantic = vector.search(cfg.root, query, { limit: cfg.maxCandidates }).map((r) => r.node_id);
    } catch {
      // No vector tier is the normal case, not an error. Fall through to the tiers that
      // are always present rather than failing the whole query.
      semantic = [];
    }
  }

  // ── 2 graph expansion from whatever we found ──
  const seeds = exact.length
    ? exact
    : [...lexical, ...semantic, ...spans].slice(0, 10).map((id) => ({ node: G.getNode(g, id) })).filter((x) => x.node);
  const { score: graphScore, reason: graphReason } = expand(g, seeds.map((s) => s.node), cfg.expandDepth);
  const graphIds = [...graphScore.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id).slice(0, cfg.maxCandidates);

  // ── 4 fuse ──
  const fused = rrf({ exact: exactIds, graph: graphIds, lexical, semantic, spans }, cfg.rrfK, cfg.weights);
  if (!fused.size) {
    return {
      query, classified: kind, items: [], total: 0, dropped: 0, tokensUsed: 0,
      ambiguousExcluded: countAmbiguous(g, []), fidelity: {}, tookMs: Date.now() - t0
    };
  }

  // ── 5 rank ──
  // Seeds: what the caller is already looking at outranks what merely matched. The
  // multipliers are aider's, which measured materially better edit accuracy than naive
  // file inclusion — open files dominate, then explicitly mentioned identifiers.
  const seedWeights = new Map();
  const bump = (id, w) => seedWeights.set(id, (seedWeights.get(id) || 0) + w);
  for (const h of exact) bump(h.node.id, 10);
  for (const f of cfg.focusFiles || []) {
    const fn = G.getNode(g, `file:${f}`);
    if (fn) bump(fn.id, 50);
    for (const s of G.nodesInFile(g, f)) bump(s.id, 50);
  }
  for (const m of cfg.mentioned || []) {
    for (const n of G.findSymbols(g, m)) bump(n.id, 10);
  }

  // Personalisation only means something when there is something to personalise TOWARD.
  // With no focus files and no mentioned identifiers the teleport vector is uniform, and
  // uniform PageRank is just centrality — it ranks whatever is most-connected, which on
  // any codebase is the small utility functions (`open`, `write`, `nowMs`). That is the
  // opposite of relevance, so it is skipped entirely rather than applied weakly.
  const hasRealSeeds = (cfg.focusFiles || []).length > 0 || (cfg.mentioned || []).length > 0;
  const pr = hasRealSeeds ? personalisedRank(g, fused.keys(), seedWeights) : new Map();
  const prMax = Math.max(0, ...pr.values());

  const exactSet = new Set(exactIds);
  const lexicalSet = new Set(lexical);
  const spansSet = new Set(spans);
  const semanticSet = new Set(semantic);

  const ranked = [...fused.entries()]
    .map(([id, fuseScore]) => {
      const node = G.getNode(g, id);
      if (!node) return null;
      const stages = [];
      if (exactSet.has(id)) stages.push('exact');
      if (graphScore.has(id)) stages.push('graph');
      if (lexicalSet.has(id)) stages.push('lexical');
      if (spansSet.has(id)) stages.push('spans');
      if (semanticSet.has(id)) stages.push('semantic');

      // Direct evidence means the query itself touched this symbol. Everything else got
      // here by association, and association is context rather than an answer.
      const direct = exactSet.has(id) || lexicalSet.has(id) || semanticSet.has(id);
      let score = direct ? fuseScore : fuseScore * cfg.expansionOnlyDamping;
      if (prMax > 0) score += (pr.get(id) || 0) / prMax * cfg.pageRankWeight * fuseScore;

      return {
        node, score, stages,
        why: (exact.find((h) => h.node.id === id) || {}).why || graphReason.get(id) || 'lexical match'
      };
    })
    .filter(Boolean)
    .filter((r) => !cfg.kinds || cfg.kinds.includes(r.node.kind))
    .sort((a, b) => b.score - a.score);

  // ── 6 pack ──
  const packed = pack(g, ranked, cfg.budgetTokens);

  const fidelity = {};
  for (const it of packed.items) fidelity[it.fidelity] = (fidelity[it.fidelity] || 0) + 1;

  return {
    query,
    classified: kind,
    items: packed.items,
    total: ranked.length,
    dropped: packed.dropped,
    tokensUsed: packed.tokensUsed,
    budget: cfg.budgetTokens,
    // The honesty header. An agent that cannot see this concludes "nothing else calls
    // this" and is wrong — fan-in under-reports by design, and the size of what the
    // graph declined to assert travels with every answer.
    ambiguousExcluded: countAmbiguous(g, seeds.map((s) => s.node.id)),
    fidelity,
    tookMs: Date.now() - t0
  };
}

function countAmbiguous(g, seedIds) {
  if (!seedIds.length) return 0;
  let n = 0;
  for (const id of seedIds) {
    for (const e of G.edgesTo(g, id)) if (e.resolved === false) n++;
    for (const e of G.edgesFrom(g, id)) if (e.resolved === false) n++;
  }
  return n;
}

module.exports = { find, classify, rrf, personalisedRank, estimateTokens, EDGE_WEIGHT, DEFAULTS };
