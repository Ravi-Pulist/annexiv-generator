// db.js — the SQLite handle behind the code graph.
//
// WHY THIS EXISTS: the graph used to be one JSON file, read whole and queried with
// Array.filter. On the framework's own 15.8k-LOC self-index that is a 1.5 MB parse per
// CLI invocation and ~2.8M comparisons for `hotspots`. Extrapolated to 1M LOC it is a
// ~100 MB parse and ~12 BILLION comparisons — the index becomes the bottleneck it exists
// to remove. Every query in queries.js is the SAME algorithm as before; the only thing
// that changed is that edge lookups go through an index instead of scanning an array.
//
// WHY node:sqlite AND NOT AN npm PACKAGE: it ships with Node >= 22, so the graph store
// adds ZERO dependencies to a CLI whose whole value proposition is that you can npx it
// into any repo. The cost is the engine floor, which is why package.json says >=22.
//
// ORDERING IS A CORRECTNESS PROPERTY, NOT A DETAIL. `cycles()` is a DFS whose output
// depends on adjacency order; every sorted query relies on JS's stable sort to break ties
// by insertion order. So nodes and edges both carry a `seq` and EVERY read orders by it.
// Drop that and the queries still "work" while quietly returning different answers than
// the JSON implementation did — which is exactly the class of silent drift this index is
// supposed to eliminate.

'use strict';

const fs = require('fs');
const path = require('path');

// node:sqlite is stable in behaviour but still emits an ExperimentalWarning in Node 22.
// A CLI that prints a Node internals warning on every invocation trains users to ignore
// warnings, so this suppresses exactly that one string and nothing else.
const _emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const text = typeof warning === 'string' ? warning : (warning && warning.message) || '';
  if (text.includes('SQLite is an experimental feature')) return;
  return _emitWarning.call(process, warning, ...rest);
};

let DatabaseSync = null;
let unavailable = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  unavailable = err.message;
}

// 2 -> 3: added symbols_fts (the lexical tier) plus the language / has_decorators /
// unresolved columns. An index written by an older version is missing tables the query
// layer prepares statements against, so it is treated as absent and rebuilt rather than
// migrated in place — the graph is cheap to rebuild and a half-migrated index answers
// confidently from data it does not have.
// 8 -> 9: RMAD-R2 added span_chunks + spans_fts, indexing the 62.8% of lines that sit
// inside no symbol span. Structural tables are dropped and rebuilt on a bump, so an
// existing index is simply rebuilt — no migration path is needed or wanted.
const SCHEMA_VERSION = 9;
const DB_FILE = 'graph.db';

// ─── schema ─────────────────────────────────────────────────────────────────
//
// `props` holds the kind-specific fields (args, decorators, bases, route, ...) as JSON.
// Anything on a hot path gets a real column and an index; everything else rides in props.
// The split is deliberate: promoting a field to a column later is a migration, but
// indexing something nothing queries is dead weight in every row.

const DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS files (
  path      TEXT PRIMARY KEY,
  seq       INTEGER NOT NULL,
  hash      TEXT NOT NULL,
  doc_json  TEXT NOT NULL          -- the extractor document, reused verbatim on incremental builds
);

CREATE TABLE IF NOT EXISTS nodes (
  id         TEXT PRIMARY KEY,
  seq        INTEGER NOT NULL,     -- insertion order: the tiebreaker every sorted query relies on
  kind       TEXT NOT NULL,
  name       TEXT,
  qualname   TEXT,
  qualname_lc TEXT,                -- findSymbols() is a lowercase substring match
  file       TEXT,
  path       TEXT,                 -- file nodes only
  line       INTEGER,
  end_line   INTEGER,
  loc        INTEGER,
  fidelity   TEXT,
  language   TEXT,                 -- file nodes only
  complexity INTEGER,
  has_route  INTEGER NOT NULL DEFAULT 0,
  -- Only the COUNT is ever tested ("is it decorated?" — DI/route/registry, never dead),
  -- so the flag lives in a column and the decorator list stays in props. Whole-graph
  -- scans can then answer from columns alone and skip parsing 350k JSON blobs.
  has_decorators INTEGER NOT NULL DEFAULT 0,
  props      TEXT NOT NULL         -- JSON: the node verbatim, for exact round-trip
);
CREATE INDEX IF NOT EXISTS nodes_seq   ON nodes(seq);
CREATE INDEX IF NOT EXISTS nodes_kind  ON nodes(kind);
CREATE INDEX IF NOT EXISTS nodes_file  ON nodes(file);
CREATE INDEX IF NOT EXISTS nodes_name  ON nodes(name);
CREATE INDEX IF NOT EXISTS nodes_qlc   ON nodes(qualname_lc);
CREATE INDEX IF NOT EXISTS nodes_route ON nodes(has_route) WHERE has_route = 1;

CREATE TABLE IF NOT EXISTS edges (
  seq        INTEGER PRIMARY KEY,  -- rowid alias == insertion order
  from_id    TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  type       TEXT NOT NULL,
  resolved   INTEGER NOT NULL DEFAULT 1,
  resolution TEXT,
  line       INTEGER,
  unresolved TEXT,                 -- the name we declined to link; untested() reads it
  props      TEXT NOT NULL
);
-- The two indexes the whole migration exists for. Without edges_rev, blast radius,
-- callers() and fan-in are table scans, which is the O(V x E) problem restated.
CREATE INDEX IF NOT EXISTS edges_fwd ON edges(from_id, type);
CREATE INDEX IF NOT EXISTS edges_rev ON edges(to_id, type);
CREATE INDEX IF NOT EXISTS edges_ty  ON edges(type);

-- Tier 2, the lexical index.
--
-- Standalone rather than external-content: the writer replaces the whole graph in one
-- transaction, so shadow-table triggers would be pure overhead and one more thing to
-- drift. The terms column carries each identifier BOTH whole and split
-- (getUserId -> "getUserId get User Id"), because code search needs exact-token match and
-- part match at once, and a tokenizer tuned for one loses the other.
CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
  node_id UNINDEXED,
  qualname,
  terms,
  signature,
  doc,
  tokenize = "unicode61 remove_diacritics 2 tokenchars '_$'"
);

-- Tier 3, the semantic index. Optional, off unless "rmad index embed" has been run.
--
-- Plain BLOB rather than a vector extension: sqlite-vec would be another dependency for a
-- tier that is off by default, and brute-force cosine over int8 is comfortable to the
-- ~50k symbols a single repo produces. The escape hatch above that is a real ANN index,
-- and the schema does not have to change for it — only the search does.
--
-- Kept in its OWN tables, not merged into nodes, because embeddings are recoverable source
-- text: they need a separate lifecycle, can be dropped wholesale without touching the
-- graph, and must never be written by anything except an explicit embed run.
CREATE TABLE IF NOT EXISTS symbol_cards (
  node_id   TEXT PRIMARY KEY,
  card_text TEXT NOT NULL,
  card_hash TEXT NOT NULL,      -- re-embed only when the card actually changed
  model     TEXT NOT NULL,
  dims      INTEGER NOT NULL,
  embedded_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cards_hash ON symbol_cards(card_hash);

CREATE TABLE IF NOT EXISTS symbol_vec (
  node_id TEXT PRIMARY KEY,
  vec     BLOB NOT NULL,        -- int8, L2-normalised before quantisation
  dims    INTEGER NOT NULL
);

-- RMAD-R2. The lines no symbol covers.
--
-- "rmad index audit" measured 62.8% of this repository's lines sitting inside no symbol
-- span, and 5 files with no symbols at all: module-level constants, regex tables, config
-- objects, top-level wiring, and the long WHY comments that carry most of the domain
-- vocabulary. A symbol-card index cannot see any of it, and no reranker recovers a chunk
-- that was never indexed — which is why the spec puts candidate generation at 24pp and
-- reranking at 12pp.
--
-- Kept in its OWN table rather than merged into nodes, for the same reason the vector
-- tables are separate: a span is not a symbol. Merging them would corrupt every count that
-- means "symbol" — census denominators, orphans, blast radius, index status.
--
-- parent_id is the small-to-big link. A span is MATCHED at its own granularity and
-- RETURNED as its enclosing file: precision from the small unit, context from the large one.
CREATE TABLE IF NOT EXISTS span_chunks (
  id         TEXT PRIMARY KEY,
  file       TEXT NOT NULL,
  parent_id  TEXT NOT NULL,      -- the file node a match hands back
  line       INTEGER NOT NULL,
  end_line   INTEGER NOT NULL,
  seq        INTEGER NOT NULL,
  language   TEXT,
  fidelity   TEXT,
  is_test    INTEGER NOT NULL DEFAULT 0,
  text       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS span_file ON span_chunks(file);
CREATE INDEX IF NOT EXISTS span_parent ON span_chunks(parent_id);

-- Same tokenizer as symbols_fts, deliberately: a query must tokenise identically against
-- both indexes or the two tiers disagree about what a term is.
CREATE VIRTUAL TABLE IF NOT EXISTS spans_fts USING fts5(
  chunk_id UNINDEXED,
  text,
  tokenize = "unicode61 remove_diacritics 2 tokenchars '_$'"
);

CREATE TABLE IF NOT EXISTS semantic (
  node_id  TEXT PRIMARY KEY,
  seq      INTEGER NOT NULL,
  json     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS features (
  key   TEXT PRIMARY KEY,
  seq   INTEGER NOT NULL,
  json  TEXT NOT NULL
);

-- ─── evidence ──────────────────────────────────────────────────────────────
--
-- APPEND-ONLY, AND DELIBERATELY NOT WIPED BY A REINDEX. The graph is derived and
-- disposable; what was observed, and when, is neither. writeGraph() clears the structural
-- tables only, so an index rebuild never erases the record of what was measured.
--
-- Three constraints below carry the honesty of the whole design, and they live in the
-- schema rather than in application code because a rule enforced by a prompt is a
-- suggestion:
--   observations.commit_sha  — evidence is bound to the code it was taken against, so a
--                              passing test three edits ago cannot satisfy anything now.
--   verdicts CHECK           — the run that produced a thing may not be the run that
--                              clears it. Self-evaluation shares the author's blind spot.
--   waivers.approver_kind    — an agent cannot approve its own exemption.

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  parent_run_id TEXT,
  agent TEXT, model TEXT, task_id TEXT,
  -- RMAD-03. Attribution is agent + model + WHICH PROMPT, and the third was missing.
  -- Digested, never stored: a prompt carries whatever the operator was working on, and
  -- the redaction pass does not cover this table. A digest proves which prompt without
  -- keeping it, and two runs of the same prompt still compare equal.
  prompt_digest TEXT,
  started_at INTEGER, ended_at INTEGER, cost_usd REAL
);

CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  tool TEXT NOT NULL,
  digest TEXT NOT NULL,
  cache_hit INTEGER NOT NULL DEFAULT 0,
  status TEXT, cost_usd REAL, created_at INTEGER,
  result_ref TEXT
);
CREATE INDEX IF NOT EXISTS actions_digest ON actions(digest);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  run_id TEXT,
  kind TEXT NOT NULL,
  subject TEXT,
  value TEXT NOT NULL,
  commit_sha TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS obs_subject ON observations(subject, commit_sha);
CREATE INDEX IF NOT EXISTS obs_kind ON observations(kind, commit_sha);

CREATE TABLE IF NOT EXISTS verdicts (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  value TEXT NOT NULL,
  confidence REAL,
  producing_run_id TEXT NOT NULL,
  refuter_run_id TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  CHECK (producing_run_id <> refuter_run_id)
);

CREATE TABLE IF NOT EXISTS waivers (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  obligation TEXT NOT NULL,
  subject_id TEXT,
  reason TEXT NOT NULL,
  approver TEXT NOT NULL,
  approver_kind TEXT NOT NULL,
  expires_commit TEXT,
  created_at INTEGER NOT NULL,
  CHECK (approver_kind IN ('human','policy'))
);
CREATE INDEX IF NOT EXISTS waivers_task ON waivers(task_id);

-- A gate override is an EVENT, not a setting. stage-gate.js used to accept any prompt
-- containing the substring "--force" and exit silently, so "do not use --force here" and
-- "I would not approve anyway" both opened the gate and left no trace. An override that
-- isn't recorded is indistinguishable from a gate that never ran.
CREATE TABLE IF NOT EXISTS overrides (
  id TEXT PRIMARY KEY,
  gate TEXT NOT NULL,           -- the command that was forced, e.g. /stage-build
  reason TEXT NOT NULL,         -- mandatory: --force-gate=<reason>
  prompt_digest TEXT NOT NULL,  -- digest, never the prompt: prompts carry source
  commit_sha TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS overrides_gate ON overrides(gate, created_at);

-- RMAD-02. Cost was the worst-scoring dimension in the audit for one reason: no figure
-- existed at all. HAL's finding is that agents "can be 100x more expensive while only
-- being 1% better", and Terminal-Bench 2.1 now publishes dollars per run — a framework
-- that cannot say what it costs cannot argue it is efficient.
--
-- THE HONESTY RULE FOR THIS TABLE: the source column says where each row's numbers came
-- from, and usd is NULL rather than 0 when nothing priced it. A zero renders as "free",
-- which is the most flattering possible lie about a cost you did not measure. The cost
-- command reports coverage — "42 of 55 turns priced" — so a partial ledger reads as partial.
CREATE TABLE IF NOT EXISTS cost_ledger (
  id            TEXT PRIMARY KEY,
  task_id       TEXT,
  session_id    TEXT,
  workflow      TEXT,
  agent         TEXT,
  model         TEXT,
  tool          TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cache_read    INTEGER,
  payload_bytes INTEGER NOT NULL DEFAULT 0,
  tool_calls    INTEGER NOT NULL DEFAULT 0,
  wall_ms       INTEGER NOT NULL DEFAULT 0,
  usd           REAL,
  source        TEXT NOT NULL,          -- transcript | derived | toolcount
  seq           INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  CHECK (source IN ('transcript','derived','toolcount'))
);
CREATE INDEX IF NOT EXISTS cost_task ON cost_ledger(task_id, seq);
CREATE INDEX IF NOT EXISTS cost_session ON cost_ledger(session_id, seq);

-- RMAD-07. Recovery efficiency is "does the residual fall, and how fast" — a question
-- about a SEQUENCE. Nothing recorded the residual over time, so every run computed R,
-- printed it, and discarded it. A trend nobody stores is a trend nobody can measure.
CREATE TABLE IF NOT EXISTS residual_log (
  id         TEXT PRIMARY KEY,
  task_id    TEXT,
  commit_sha TEXT,
  verdict    TEXT NOT NULL,
  r          REAL NOT NULL,
  evaluated  INTEGER,
  applicable INTEGER,
  obligations TEXT NOT NULL,      -- JSON: [[id, state, count], ...]
  seq        INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS residual_task ON residual_log(task_id, seq);

-- RMAD-08. Reviewer decay is measured over EXPOSURE — approval rate rising while comment
-- volume falls. Approvals lived only as a status field in artifact frontmatter, which is
-- current state and carries no history, so the curve could not be drawn at all.
--
-- Habituation at the Gate tracked 400 reviewers over 11,429 reviews: approval of AI code
-- rose 30.1% -> 36.8% while inline comments fell 22%. No framework measures this about
-- its own gates, which is why "has an approval step" scores 2 rather than 5.
CREATE TABLE IF NOT EXISTS approvals (
  id         TEXT PRIMARY KEY,
  artifact   TEXT NOT NULL,
  decision   TEXT NOT NULL,       -- approved | rejected | revision-requested
  approver   TEXT,
  latency_ms INTEGER,             -- from artifact presentation to decision, when known
  revisions  INTEGER,             -- revision requests before this decision
  seq        INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK (decision IN ('approved','rejected','revision-requested'))
);
CREATE INDEX IF NOT EXISTS approvals_seq ON approvals(seq);

-- RMAD-13. A computation nobody can watch is indistinguishable from an assertion.
-- Every competitor surfaces a chat transcript; none surfaces the derivation. This is the
-- derivation: one row per graph operation, carrying the QUESTION it asked rather than the
-- command it ran, and the obligation it feeds.
--
-- outcome distinguishes 'refused' from 'failed' on purpose. When the resolver declines to
-- guess at an ambiguous symbol that is the framework working correctly; collapsing it into
-- failure would hide the property that makes the graph trustworthy.
CREATE TABLE IF NOT EXISTS trace_steps (
  id         TEXT PRIMARY KEY,
  run_id     TEXT,
  task_id    TEXT,
  seq        INTEGER NOT NULL,
  op         TEXT NOT NULL,
  question   TEXT NOT NULL,
  args       TEXT,
  outcome    TEXT NOT NULL,
  reason     TEXT,
  feeds      TEXT,
  detail     TEXT,
  ms         INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  CHECK (outcome IN ('ok','refused','failed'))
);
CREATE INDEX IF NOT EXISTS trace_run ON trace_steps(run_id, seq);

CREATE TABLE IF NOT EXISTS baselines (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  commit_sha TEXT NOT NULL,
  oracle TEXT NOT NULL,
  pass_count INTEGER, fail_count INTEGER,
  -- The SET, not just the count. A fix that breaks test A and adds test B keeps the
  -- count level, and counting alone calls that progress.
  pass_set TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS baselines_task ON baselines(task_id, oracle);

CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  parent_id TEXT,
  title TEXT, status TEXT NOT NULL,
  owner_agent TEXT,
  scope_json TEXT,
  created_at INTEGER, updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS acceptance_criteria (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  statement TEXT NOT NULL,
  statement_hash TEXT NOT NULL,
  -- Only a human may clear this. Flipping it to 0 deletes an obligation, which is the
  -- cheapest possible way to make the residual reach zero without doing any work.
  testable INTEGER NOT NULL DEFAULT 1,
  symbols_json TEXT,
  gated_by TEXT, gated_at INTEGER
);
CREATE INDEX IF NOT EXISTS ac_task ON acceptance_criteria(task_id);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  commit_sha TEXT,
  stats_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- FDE-01. One row per loop run. The ladder is stored WITH the run rather than re-read from
-- disk at each step, so a policy edited mid-run cannot retroactively change what an earlier
-- attempt was governed by. An escalation has to stay explicable after the fact, and that
-- requires the rules it was decided under to be immutable.
CREATE TABLE IF NOT EXISTS loop_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  ladder_json TEXT NOT NULL,
  status TEXT NOT NULL,          -- open | closed
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  outcome TEXT                   -- DONE | ABSTAIN; null while open
);
CREATE INDEX IF NOT EXISTS loop_runs_task ON loop_runs(task_id, status);

-- One row per attempt. Tokens default to 0 and are never estimated: an unmeasured cost
-- rendered as a number is worse than an absent one, and self-hosted runtimes return exact
-- counts, so on our own substrate this is measured rather than inferred.
CREATE TABLE IF NOT EXISTS loop_attempts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tier_index INTEGER NOT NULL,
  attempt_no INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  wall_ms INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS loop_attempts_run ON loop_attempts(run_id, tier_index);
`;

// ─── open / close ───────────────────────────────────────────────────────────

// Structural tables owned by the graph. Evidence tables are deliberately NOT here: an
// index rebuild must never erase what was measured, and they are additive across versions.
const STRUCTURAL_TABLES = ['nodes', 'edges', 'files', 'semantic', 'features', 'symbols_fts',
  // RMAD-R2. Span chunks are DERIVED from source, so they belong with the structural
  // tables: always rebuildable, and dropped on a schema bump rather than migrated.
  'span_chunks', 'spans_fts'];

/**
 * Columns added to EVIDENCE tables after they first shipped.
 *
 * THE BUG THIS FIXES: structural tables are dropped and rebuilt on a schema bump, so they
 * always match the DDL. Evidence tables are deliberately NOT dropped — they are the only
 * copy of what was observed — and the DDL creates them with CREATE TABLE IF NOT EXISTS.
 * An existing evidence table therefore never gains a column, and the first write against
 * the new shape dies with "table runs has no column named prompt_digest".
 *
 * That was harmless while evidence could be thrown away and rebuilt. It stopped being
 * harmless the moment evidence became machine-local and permanent: there is no second copy
 * to fall back on, so a migration that cannot run is a database that cannot be written.
 *
 * ADDITIVE ONLY. SQLite's ADD COLUMN is cheap and cannot lose data. Anything that would
 * drop or retype a column belongs in a deliberate migration, not in a startup path.
 */
const EVIDENCE_COLUMNS = {
  runs: [['prompt_digest', 'TEXT']]
};

/** Add any evidence column this build expects and the database does not have. */
function migrateEvidence(db) {
  for (const [table, cols] of Object.entries(EVIDENCE_COLUMNS)) {
    let existing;
    try {
      existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
    } catch {
      continue; // table not present yet; the DDL will create it in full
    }
    if (!existing.size) continue;
    for (const [name, type] of cols) {
      if (existing.has(name)) continue;
      try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`); } catch { /* raced or unsupported */ }
    }
  }
}

/**
 * Drop the structural tables when the stored schema predates this build.
 *
 * Only runs when there IS a recorded version and it differs — a fresh database has no
 * `meta` table yet and falls straight through to the DDL.
 */
function dropIfStale(db) {
  let stored = null;
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema'").get();
    stored = row ? String(row.value) : null;
  } catch {
    return; // no meta table yet: nothing to be stale
  }
  if (stored === null || stored === String(SCHEMA_VERSION)) return;
  for (const t of STRUCTURAL_TABLES) {
    try { db.exec(`DROP TABLE IF EXISTS ${t}`); } catch { /* leave the rest to the DDL */ }
  }
  try { db.exec('DELETE FROM meta'); } catch { /* recreated by the DDL */ }
}

function dbPath(root, indexDir) {
  return path.join(root, indexDir, DB_FILE);
}

function isAvailable() {
  return DatabaseSync !== null;
}

function unavailableReason() {
  return unavailable;
}

// Open connections are tracked so a host that outlives one query can release them.
//
// WHY THIS IS NOT OPTIONAL: a loaded graph keeps its connection (and its prepared
// statements) for the life of the handle, which is right for a CLI that exits and for a
// hook that runs for 50ms. It is wrong for a test runner or a daemon: on Windows an open
// handle blocks unlink, so a leaked connection turns "delete the index" into EBUSY. The
// exit hook covers the normal case; closeAll() covers everything that keeps running.
const openConnections = new Set();
let exitHookInstalled = false;

/**
 * Open (and if needed create) the graph database.
 * Returns null when node:sqlite is missing — callers fall back to JSON so an old Node
 * degrades to the previous behaviour instead of crashing.
 */
function open(file, { create = false, readonly = false } = {}) {
  if (!DatabaseSync) return null;
  if (!create && !fs.existsSync(file)) return null;
  if (create) fs.mkdirSync(path.dirname(file), { recursive: true });

  let db;
  try {
    db = new DatabaseSync(file, { readOnly: readonly && fs.existsSync(file) });
  } catch {
    return null;
  }

  try {
    // WAL lets a hook read while an index build writes. Without it the two block
    // each other and the editing experience degrades exactly when the index is useful.
    if (!readonly) {
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = NORMAL');
    }
    db.exec('PRAGMA foreign_keys = ON');
    if (create) {
      // A schema-version mismatch has to DROP, not just re-run CREATE IF NOT EXISTS.
      //
      // The DDL is entirely `IF NOT EXISTS`, so an index written by an older version was
      // correctly detected as unusable by load() — and then left in place, with its old
      // column shape, for the very next write to hit. `index build` died on a raw
      // `table nodes has no column named language`, and died again on every retry, until
      // the user worked out to delete the file by hand. Rebuilding is cheap; a rebuild
      // that cannot start is not a rebuild.
      dropIfStale(db);
      db.exec(DDL);
      // Evidence tables survive a schema bump by design, so the DDL's
      // CREATE TABLE IF NOT EXISTS leaves an old shape untouched. Add what is missing.
      migrateEvidence(db);
    }
  } catch {
    try { db.close(); } catch { /* already gone */ }
    return null;
  }

  openConnections.add(db);
  if (!exitHookInstalled) {
    exitHookInstalled = true;
    process.on('exit', closeAll);
  }
  return db;
}

function close(db) {
  if (!db) return;
  openConnections.delete(db);
  try { db.close(); } catch { /* already closed */ }
}

/** Release every open connection. Safe to call repeatedly. */
function closeAll() {
  for (const db of [...openConnections]) close(db);
}

// ─── meta ───────────────────────────────────────────────────────────────────

function getMeta(db) {
  const out = {};
  try {
    for (const r of db.prepare('SELECT key, value FROM meta').all()) out[r.key] = r.value;
  } catch {
    return out;
  }
  return out;
}

function setMeta(db, obj) {
  const stmt = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [k, v] of Object.entries(obj)) stmt.run(k, v === null || v === undefined ? null : String(v));
}

/**
 * Schema compatibility. A version mismatch is not an error and must never be repaired
 * in place by guesswork: the graph is cheap to rebuild and a half-migrated index is a
 * confidently wrong one. Callers treat `false` as "no index" and rebuild.
 */
function schemaOk(db) {
  const v = getMeta(db).schema;
  return String(v) === String(SCHEMA_VERSION);
}

module.exports = {
  open, close, closeAll, dbPath, getMeta, setMeta, schemaOk,
  isAvailable, unavailableReason,
  SCHEMA_VERSION, DB_FILE, DDL
};
