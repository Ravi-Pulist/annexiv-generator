// plane.js — RMAD as a producer on the build plane. PLAT-08.
//
// The predicate has always computed a verdict and then let it evaporate: `residual()`
// returns a rich object, `task residual` prints it, and nothing durable survives except
// rows in a rebuildable index. That is fine for a tool and useless as an audit trail —
// which is the gap RMAD-19 named and deferred.
//
// THE PATH IS THE ONE RMAD-19 PRE-SPECIFIED. Its own text: "if it is revisited, the change
// is a path split: `.planning/index/` stays ignored, `.planning/evidence/` becomes
// committable with a JSONL mirror. The schema already separates the two cleanly." This is
// that change, executed where it said it would go.
//
// WHY THE CONTRACT IS VENDORED RATHER THAN DEPENDED ON. RMAD ships with zero npm
// dependencies and that property is cited in the platform spec, the benchmark scoring, and
// every supply-chain conversation a bank opens with. A package dependency to get 400 lines
// of hashing would trade a load-bearing claim for convenience. The copies under plane/ are
// byte-identical to RMAD-platform/node/src and a test asserts it — the same drift guard
// that caught templates/ shipping without a module, applied to the thing whose whole value
// is that two independent implementations agree.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const writer = require('./plane/writer.js');
const codeGraph = require('../code-graph.js');

const EVIDENCE_SUBDIR = 'evidence';

/**
 * Where this project's chains live — DERIVED from where the index lives, never hardcoded.
 *
 * THE LANDMINE THIS AVOIDS, found by the e2e suite the first time this shipped.
 * `indexDir()` chooses its location by asking whether `.planning/` exists: an
 * RMAD-installed project gets `.planning/index/`, a foreign repo gets `.rmad/index/`. So
 * ANY code that creates `.planning/` for any reason silently relocates the index.
 *
 * The first version of this module wrote to a hardcoded `.planning/evidence/`. On a
 * foreign repo that created `.planning/` as a side effect of recording a verdict, which
 * flipped `indexDir()` mid-session — every subsequent command then looked for the index
 * in a directory it had never been written to and reported "No index". Eight e2e steps
 * failed, none of them about evidence.
 *
 * Deriving the base from `indexDir()` rather than repeating its predicate means the two
 * cannot drift apart, and evidence lands beside the index in both modes:
 * `.planning/evidence/` for an installed project — the path RMAD-19 pre-specified — and
 * `.rmad/evidence/` for a portable one.
 */
function evidenceDir(root) {
  return path.join(root, path.dirname(codeGraph.indexDir(root)), EVIDENCE_SUBDIR);
}

/**
 * The policy digest carried by every record.
 *
 * There is no policy kernel yet (PLAT-09). Rather than invent a placeholder that would
 * later be indistinguishable from a real one, this hashes whatever governs behaviour
 * TODAY — the settings file — and labels the scheme. When PLAT-09 lands, the scheme name
 * changes and old records remain honestly attributable to what actually governed them.
 */
function policySha(root) {
  const p = path.join(root, '.claude', 'settings.json');
  try {
    return 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16);
  } catch {
    return 'sha256:none';
  }
}

/** RFC 3339, UTC, second precision — the envelope's `ts` format. */
function nowTs() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Tenant identity.
 *
 * RMAD is single-tenant per checkout, so the tenant IS the project. Reading it from
 * PROJECT.md rather than inventing an id keeps the record meaningful to whoever reads the
 * chain later; `local` is the honest fallback rather than a generated uuid nobody can
 * resolve back to anything.
 */
function tenantOf(root) {
  try {
    const m = fs.readFileSync(path.join(root, 'PROJECT.md'), 'utf8').match(/^#\s+(.+)$/m);
    if (m) return m[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
  } catch { /* fall through */ }
  return 'local';
}

/**
 * Record a verdict.
 *
 * NOTE WHAT IS NOT WRITTEN. `residual()` returns obligation objects carrying reasons and
 * symbol lists; those name source. What crosses into the chain is the verdict, the
 * residual, the denominator, and the obligation IDs — enough for a third party to
 * reconstruct the decision, not enough to reconstruct the code. The writer refuses
 * anything else, which is the point of enforcing at the write rather than trusting callers.
 */
function recordVerdict(root, res, opts = {}) {
  return writer.append(evidenceDir(root), 'build', {
    ts: nowTs(),
    tenant: opts.tenant || tenantOf(root),
    policy_sha: opts.policySha || policySha(root),
    corr_id: opts.corrId || `verdict-${res.commit || 'worktree'}-${res.taskId || 'none'}`,
    kind: 'verdict',
    body: {
      task_id: res.taskId || null,
      commit: res.commit || null,
      verdict: res.verdict,
      residual: res.R,
      // The denominator travels with the verdict. RMAD-16's whole point: "2 of 6
      // evaluated" is a different claim from "passed", and a chain that records only the
      // verdict would strip exactly the qualifier that makes it honest.
      evaluated_num: res.evaluated,
      evaluated_den: res.applicable,
      unsatisfied: res.unsatisfied || [],
      inconclusive: res.inconclusive || [],
      kind_of_task: res.kind || null
    }
  });
}

/** Record one loop attempt — FDE-01's ledger, made durable. */
function recordLoopAttempt(root, { taskId, tier, attempt, outcome, tokensIn, tokensOut, wallMs, decision, corrId }, opts = {}) {
  return writer.append(evidenceDir(root), 'build', {
    ts: nowTs(),
    tenant: opts.tenant || tenantOf(root),
    policy_sha: opts.policySha || policySha(root),
    corr_id: corrId || `loop-${taskId}`,
    kind: 'loop_attempt',
    body: {
      task_id: taskId || null,
      tier: tier || null,
      attempt: attempt || 0,
      outcome: outcome || 'unknown',
      decision: decision || null,
      tokens_in: Number.isInteger(tokensIn) ? tokensIn : 0,
      tokens_out: Number.isInteger(tokensOut) ? tokensOut : 0,
      wall_ms: Number.isInteger(wallMs) ? wallMs : 0
    }
  });
}

/** Verify this project's chains. Returns the writer's verdict shape. */
function verify(root) {
  return writer.verifyAll(evidenceDir(root));
}

/** Has anything been recorded yet? Distinguishes "clean" from "empty". */
function exists(root) {
  return fs.existsSync(writer.chainFile(evidenceDir(root), 'build'))
    || fs.existsSync(writer.chainFile(evidenceDir(root), 'serve'));
}

module.exports = {
  recordVerdict, recordLoopAttempt, verify, exists,
  evidenceDir, policySha, tenantOf, nowTs, EVIDENCE_SUBDIR,
  DeniedFieldError: writer.DeniedFieldError
};
