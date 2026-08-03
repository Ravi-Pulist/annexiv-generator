// metrics.js — RMAD-R6. Retrieval metrics with intervals and a paired significance test.
//
// WHY THIS EXISTS. The golden-set runner reported recall@1/5/10 and MRR as bare
// percentages. Three things were missing, and each one lets a wrong conclusion look right:
//
//   1. NO INTERVAL. At n=50 the Wilson 95% CI spans roughly ±13pp. "62%" and "70%" are
//      the same measurement at that sample size, and a reader comparing two runs cannot
//      tell. A point estimate with no interval is an invitation to over-read noise.
//   2. NO PAIRED TEST. Comparing two configurations by their independent totals throws
//      away the fact that they answered the SAME queries. Paired McNemar detects an 8pp
//      move that an unpaired comparison cannot see at this n.
//   3. NO nDCG. Recall@k is blind to position inside k: an answer at rank 1 and an answer
//      at rank 5 score identically. nDCG is what distinguishes "found it" from "found it
//      first", which is the difference a user actually feels.
//
// THE HONESTY RULE that governs the whole module: every function that returns a rate also
// returns the interval around it, and `significance()` REFUSES rather than returning a
// p-value it cannot support. A harness that reports significance at n=4 is worse than one
// that reports nothing, because the number gets quoted.
//
// Zero dependencies. All of this is arithmetic.

'use strict';

// ─── Wilson score interval ──────────────────────────────────────────────────
//
// Chosen over the normal approximation deliberately. The naive interval
// p ± z*sqrt(p(1-p)/n) is badly wrong near 0 and 1 — it produces bounds outside [0,1] and
// collapses to zero width when p = 0, which would claim perfect certainty from a run where
// nothing was found. Wilson stays inside [0,1] and keeps a sensible width at the extremes.
const Z95 = 1.959963984540054;

function wilson(successes, n, z = Z95) {
  if (!n || n < 0) return { rate: null, low: null, high: null, halfWidth: null, n: n || 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const spread = (z / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const low = Math.max(0, centre - spread);
  const high = Math.min(1, centre + spread);
  return {
    rate: p,
    low,
    high,
    // Reported explicitly because the regression gate is defined in terms of it: a drop
    // smaller than the half-width is not a detectable drop.
    halfWidth: (high - low) / 2,
    n
  };
}

// ─── ranking metrics ────────────────────────────────────────────────────────
//
// A row is { id, rank } where rank is 1-based, or null/0 for "not found anywhere". That
// shape comes straight from the golden-set runner so the two cannot drift apart.

const found = (r, k) => Boolean(r.rank) && r.rank <= k;

function recallAtK(rows, k) {
  const hits = rows.filter((r) => found(r, k)).length;
  return wilson(hits, rows.length);
}

// Recall over the ENTIRE returned list, at any depth.
//
// RMAD-R3 makes this a guard rather than a statistic: recall@any may never regress. The
// reason is that most ranking "improvements" are reorderings, and a reordering cannot
// change recall@any. If recall@any falls, something was *dropped from the candidate set* —
// a different and much worse kind of change than a ranking regression, and one that is
// invisible in recall@5 when the ranking happens to improve at the same time.
function recallAny(rows) {
  const hits = rows.filter((r) => Boolean(r.rank)).length;
  return wilson(hits, rows.length);
}

// Mean reciprocal rank. A miss contributes 0 — the metric refuses to be flattered by a
// long tail of near-misses.
function mrr(rows) {
  if (!rows.length) return null;
  return rows.reduce((a, r) => a + (r.rank ? 1 / r.rank : 0), 0) / rows.length;
}

// nDCG@k for BINARY relevance with one accepted answer per query.
//
// With a single relevant document, DCG@k = 1/log2(rank+1) when rank <= k, and the ideal
// ranking puts it first: IDCG = 1/log2(2) = 1. So nDCG collapses to the discount itself.
// Stated here because the general formula is easy to mis-transcribe, and a silently wrong
// nDCG is indistinguishable from a real one.
//
// If a query ever carries graded relevance this function must be revisited rather than
// reused — which is what `gradedWarning` is for.
function ndcgAtK(rows, k) {
  if (!rows.length) return null;
  const sum = rows.reduce((a, r) => a + (found(r, k) ? 1 / Math.log2(r.rank + 1) : 0), 0);
  return sum / rows.length;
}

const gradedWarning =
  'nDCG here assumes ONE relevant answer per query with binary relevance. ' +
  'Graded relevance requires a real IDCG over the sorted gains.';

// ─── paired significance: exact McNemar ─────────────────────────────────────
//
// Two configurations answered the SAME queries, so the comparison is paired.
//   b = queries the baseline got and the candidate lost
//   c = queries the baseline missed and the candidate won
// Queries both got, or both missed, carry no information about the difference — which is
// precisely why the unpaired comparison is weak: it spends its sample on agreements.
//
// The exact binomial is used rather than the chi-square approximation because b+c is
// routinely under 25 here, where chi-square is not trustworthy.
function binomCoeff(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

function mcnemarExact(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  const lo = Math.min(b, c);
  let tail = 0;
  for (let i = 0; i <= lo; i++) tail += binomCoeff(n, i);
  const p = 2 * tail * Math.pow(0.5, n);
  return Math.min(1, p);
}

// The minimum number of DISCORDANT pairs below which no two-sided exact test can reach
// p < 0.05 however lopsided the split. With b+c = 5 and c = 0 the best attainable p is
// 2 * 0.5^5 = 0.0625, so 6 is the floor.
const MIN_DISCORDANT = 6;

/**
 * Compare a candidate run against a baseline over the same query ids.
 *
 * Returns { comparable, b, c, p, significant, reason }. When the evidence cannot support a
 * verdict it returns `significant: null` with a reason — never `false`, because "we could
 * not tell" and "we showed there is no difference" are different findings, and collapsing
 * them is how a sample-size limit becomes a claim.
 */
function significance(baselineRows, candidateRows, k = 5) {
  const bl = new Map(baselineRows.map((r) => [r.id, r]));
  const paired = candidateRows.filter((r) => bl.has(r.id));
  if (!paired.length) {
    return { comparable: false, significant: null,
      reason: 'no query ids in common — these two runs are not paired' };
  }
  let b = 0, c = 0, both = 0, neither = 0;
  for (const cand of paired) {
    const base = bl.get(cand.id);
    const hb = found(base, k);
    const hc = found(cand, k);
    if (hb && !hc) b++;
    else if (!hb && hc) c++;
    else if (hb && hc) both++;
    else neither++;
  }
  const discordant = b + c;
  const p = mcnemarExact(b, c);
  if (discordant < MIN_DISCORDANT) {
    return {
      comparable: true, paired: paired.length, b, c, both, neither, discordant, p,
      significant: null,
      reason: `only ${discordant} discordant pair(s); no two-sided exact test can reach ` +
              `p < 0.05 below ${MIN_DISCORDANT}. Grow the set — a sample-size limit, not a null result.`
    };
  }
  return {
    comparable: true, paired: paired.length, b, c, both, neither, discordant, p,
    significant: p < 0.05,
    reason: p < 0.05 ? `p = ${p.toFixed(4)}` : `p = ${p.toFixed(4)} — not significant at 0.05`
  };
}

// ─── the regression gate ────────────────────────────────────────────────────
//
// Two rules, deliberately asymmetric.
//
//   recall@k   may fall by up to the CI half-width. Below that a "drop" is noise, and
//              failing CI on noise trains people to ignore CI.
//   recall@any may NOT fall at all. See recallAny() for why: a fall there means candidates
//              were dropped, which no amount of reranking justifies.
function regressionGate(baseline, candidate, k = 5) {
  const failures = [];
  const bk = recallAtK(baseline, k);
  const ck = recallAtK(candidate, k);
  const drop = bk.rate - ck.rate;
  const tolerance = bk.halfWidth;
  if (drop > tolerance) {
    failures.push({
      metric: `recall@${k}`,
      baseline: bk.rate, candidate: ck.rate, drop, tolerance,
      detail: `recall@${k} fell ${(100 * drop).toFixed(1)}pp, beyond the ` +
              `${(100 * tolerance).toFixed(1)}pp CI half-width`
    });
  }
  const ba = recallAny(baseline);
  const ca = recallAny(candidate);
  if (ca.rate < ba.rate) {
    failures.push({
      metric: 'recall@any',
      baseline: ba.rate, candidate: ca.rate, drop: ba.rate - ca.rate, tolerance: 0,
      detail: 'recall@any regressed — a candidate was DROPPED from the result set, not ' +
              'merely reranked. This gate has no tolerance by design (RMAD-R3).'
    });
  }
  return { pass: failures.length === 0, failures };
}

/** Everything, for one set of rows. */
function summarise(rows, ks = [1, 5, 10]) {
  const out = { n: rows.length, mrr: mrr(rows), recallAny: recallAny(rows), recall: {}, ndcg: {} };
  for (const k of ks) {
    out.recall[k] = recallAtK(rows, k);
    out.ndcg[k] = ndcgAtK(rows, k);
  }
  return out;
}

module.exports = {
  wilson, recallAtK, recallAny, mrr, ndcgAtK, summarise,
  mcnemarExact, significance, regressionGate,
  Z95, MIN_DISCORDANT, gradedWarning
};
