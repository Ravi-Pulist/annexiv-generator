// chain.js — linking records so an edit cannot hide, and localising it when one happens.
//
// Normative spec: docs/00-canonicalisation.md, sections "Hashing" and "Verification".
//
// THE DESIGN DECISION THAT MATTERS: the two checks are kept SEPARATE, and neither is derived
// from the other.
//
//   * `hash` is recomputed from the record's own content. A mismatch means THIS record was
//     edited after it was written.
//   * `prev_hash` is compared against the previous record's STORED hash. A mismatch means a
//     record was inserted, removed, or reordered AROUND this point.
//
// Collapsing them into one pass — recomputing forward and comparing against what the chain
// "should" be — is tempting and much worse: a single edited record poisons every subsequent
// link, so the report says "everything from 1,471 onward is broken" when the truth is "one
// row was edited at 1,471." An incident report that cannot distinguish one edit from four
// thousand is not an incident report.
//
// AND VERIFICATION NEVER STOPS AT THE FIRST BREAK. "The chain broke at 1,471" and "the chain
// broke at 1,471 and again at 4,002" are different incidents with different explanations —
// one looks like a bad restore, two look like someone editing rows.

'use strict';

const crypto = require('crypto');
const { canonicalise, CanonicalError } = require('./canonical.js');

const HASH_ALGO = 'sha256';
const HASH_PREFIX = `${HASH_ALGO}:`;
const SCHEMA_VERSION = 1;

/** Fields every record carries, whatever its `kind`. `hash` is added by sealing. */
const ENVELOPE_FIELDS = ['seq', 'prev_hash', 'ts', 'tenant', 'plane', 'policy_sha', 'corr_id', 'kind', 'schema', 'body'];

/**
 * The digest of a record, excluding its own `hash` member and nothing else.
 *
 * `prev_hash` IS included — that inclusion is the entire difference between a chain and a
 * pile of independent digests.
 */
function hashRecord(record) {
  const { hash, ...rest } = record; // eslint-disable-line no-unused-vars
  const digest = crypto.createHash(HASH_ALGO).update(canonicalise(rest), 'utf8').digest('hex');
  return HASH_PREFIX + digest;
}

/** Return a copy carrying its computed `hash`. Does not mutate the input. */
function sealRecord(record) {
  return { ...record, hash: hashRecord(record) };
}

/**
 * Build the next record for a chain.
 *
 * @param prev the previous SEALED record, or null to start a chain
 * @param fields everything except seq / prev_hash / schema / hash
 */
function nextRecord(prev, fields) {
  if (prev !== null && typeof prev.seq !== 'number') {
    throw new Error('previous record has no seq — pass null to start a chain');
  }
  return sealRecord({
    seq: prev === null ? 0 : prev.seq + 1,
    // Explicit null at seq 0, never an omitted key: absent-vs-null is a canonicalisation
    // divergence, and a schema should not contain one by design (R6).
    prev_hash: prev === null ? null : prev.hash,
    schema: SCHEMA_VERSION,
    ...fields
  });
}

/** One problem found in one record. */
function makeBreak(index, seq, reason, detail) {
  return { index, seq, reason, detail };
}

/**
 * Walk a chain and report everything wrong with it.
 *
 * @returns {{verdict: 'VALID'|'BROKEN'|'UNSUPPORTED', breaks: Array, count: number,
 *            head: string|null, unsupported: Array}}
 *
 * `UNSUPPORTED` is a first-class outcome and is NOT a failure. A verifier meeting a hash
 * prefix or schema version it does not implement cannot judge the chain — and reporting
 * "invalid" there would be the same error the predicate refuses to make when it returns
 * INCONCLUSIVE rather than guessing. Saying "I cannot determine this" is the honest answer
 * and it is auditable; a confident wrong answer is neither.
 */
function verifyChain(records) {
  const breaks = [];
  const unsupported = [];

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const seq = typeof rec?.seq === 'number' ? rec.seq : null;

    if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) {
      breaks.push(makeBreak(i, seq, 'NOT_AN_OBJECT', 'record is not a JSON object'));
      continue;
    }

    // --- envelope completeness -------------------------------------------------------
    const missing = ENVELOPE_FIELDS.filter((f) => !(f in rec));
    if (missing.length) {
      breaks.push(makeBreak(i, seq, 'MISSING_FIELD', `absent: ${missing.join(', ')}`));
    }
    if (!('hash' in rec)) {
      breaks.push(makeBreak(i, seq, 'MISSING_FIELD', 'absent: hash'));
      continue; // nothing further can be checked about this record
    }

    // --- can we judge this record at all? --------------------------------------------
    if (typeof rec.hash !== 'string' || !rec.hash.startsWith(HASH_PREFIX)) {
      const algo = typeof rec.hash === 'string' ? rec.hash.split(':')[0] : typeof rec.hash;
      unsupported.push(makeBreak(i, seq, 'UNSUPPORTED_ALGO', `hash algorithm '${algo}' is not implemented here`));
      continue;
    }
    if (rec.schema !== SCHEMA_VERSION) {
      unsupported.push(makeBreak(i, seq, 'UNSUPPORTED_SCHEMA', `schema ${rec.schema} != ${SCHEMA_VERSION}`));
      continue;
    }

    // --- sequence -------------------------------------------------------------------
    const expectedSeq = i === 0 ? 0 : records[i - 1]?.seq + 1;
    if (seq === null) {
      breaks.push(makeBreak(i, seq, 'SEQ_INVALID', 'seq is not a number'));
    } else if (typeof expectedSeq === 'number' && seq !== expectedSeq) {
      breaks.push(
        makeBreak(i, seq, seq > expectedSeq ? 'SEQ_GAP' : 'SEQ_NOT_ASCENDING',
          `expected seq ${expectedSeq}, found ${seq}`)
      );
    }

    // --- the link -------------------------------------------------------------------
    if (i === 0) {
      if (rec.prev_hash !== null) {
        breaks.push(makeBreak(i, seq, 'PREV_MISMATCH', 'the first record must carry prev_hash: null'));
      }
    } else {
      const prevStored = records[i - 1]?.hash ?? null;
      if (rec.prev_hash !== prevStored) {
        breaks.push(
          makeBreak(i, seq, 'PREV_MISMATCH',
            `prev_hash ${String(rec.prev_hash)} does not match the preceding record's hash ${String(prevStored)} — a record was inserted, removed or reordered here`)
        );
      }
    }

    // --- the record's own integrity --------------------------------------------------
    let recomputed;
    try {
      recomputed = hashRecord(rec);
    } catch (err) {
      // A record that cannot be canonicalised cannot be verified. That is a break, but it is
      // a DIFFERENT break from a digest mismatch, and conflating them would send an operator
      // hunting for a tamper that is really a float in a body field.
      const reason = err instanceof CanonicalError ? `NOT_CANONICALISABLE_${err.reason}` : 'NOT_CANONICALISABLE';
      breaks.push(makeBreak(i, seq, reason, err.message));
      continue;
    }
    if (recomputed !== rec.hash) {
      breaks.push(
        makeBreak(i, seq, 'HASH_MISMATCH',
          `stored ${rec.hash}, recomputed ${recomputed} — this record's content was altered after it was written`)
      );
    }
  }

  const verdict = breaks.length > 0 ? 'BROKEN' : unsupported.length > 0 ? 'UNSUPPORTED' : 'VALID';
  const last = records.length ? records[records.length - 1] : null;

  return {
    verdict,
    breaks,
    unsupported,
    count: records.length,
    // The head is what mechanism 3 publishes externally. Null on a broken chain: anchoring a
    // head you cannot vouch for would launder the break into the permanent record.
    head: verdict === 'VALID' && last && typeof last.hash === 'string' ? last.hash : null
  };
}

/**
 * Parse JSONL. Malformed lines are reported with their line number rather than throwing,
 * because a truncated final write is a realistic and recoverable state, and the operator
 * needs to know WHICH line — not that "the file is bad".
 */
function parseJsonl(text) {
  const records = [];
  const malformed = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue; // blank and trailing newline are not records
    try {
      records.push(JSON.parse(line));
    } catch (err) {
      malformed.push({ line: i + 1, detail: err.message });
    }
  }
  return { records, malformed };
}

/** Verify a JSONL document. Malformed lines are breaks in their own right. */
function verifyJsonl(text) {
  const { records, malformed } = parseJsonl(text);
  const result = verifyChain(records);
  if (malformed.length) {
    result.verdict = 'BROKEN';
    result.breaks = malformed
      .map((m) => makeBreak(null, null, 'MALFORMED_LINE', `line ${m.line}: ${m.detail}`))
      .concat(result.breaks);
    result.head = null;
  }
  return result;
}

module.exports = {
  HASH_ALGO, HASH_PREFIX, SCHEMA_VERSION, ENVELOPE_FIELDS,
  hashRecord, sealRecord, nextRecord, verifyChain, parseJsonl, verifyJsonl
};
