// append.js — writing into a chain, with the deny rules enforced AT THE WRITE.
//
// PLAT-08 acceptance criterion 3: no passage text, prompt text or raw identifier reaches
// the evidence plane. That is enforced here rather than in review, because a review step
// runs when someone remembers and a write path runs every time.
//
// THE DESIGN RULE: this module knows what a record may CONTAIN, and refuses anything else.
// It does not sanitise, redact or truncate. A record carrying a field nobody declared is a
// record whose producer misunderstood the boundary, and quietly trimming it would hide the
// misunderstanding while shipping the rest — which is how a deny-by-default schema decays
// into a suggestion. Refuse, name the field, and let the producer fix it.
//
// Each plane owns its own file (docs/01-record-envelope.md). There is no lock and no
// broker because there is no shared writer: `seq` is allocated per file, and a file has
// exactly one plane appending to it.

'use strict';

const fs = require('fs');
const path = require('path');
const { sealRecord, verifyJsonl, parseJsonl, SCHEMA_VERSION } = require('./chain.js');

const PLANES = ['build', 'serve'];
const FILE_FOR = { build: 'build.jsonl', serve: 'serve.jsonl' };

/**
 * The `kind` registry, per plane. An unknown kind is refused at the write.
 *
 * A verifier meeting an unknown kind reports UNSUPPORTED and moves on — it cannot judge
 * what it does not implement. A WRITER has no such excuse: it is the author, and a typo'd
 * kind that only surfaces years later at audit time is exactly the failure this registry
 * exists to prevent.
 */
const KINDS = {
  build: ['obligation', 'verdict', 'coverage', 'override', 'approval', 'cost', 'loop_attempt', 'custody'],
  serve: ['query', 'retrieval', 'consent', 'guardrail', 'citation', 'answer', 'cost']
};

/**
 * Fields that must never reach the evidence plane, matched on the KEY.
 *
 * Everything here is either source, or a derived work close enough to source that shipping
 * it would recreate the corpus in the one place the architecture promises there is none.
 * The embedding-inversion reasoning applies to answers and passages exactly as it does to
 * vectors: an answer over clinical or financial records IS those records, rearranged.
 */
const DENIED_KEYS = new Set([
  // source and derived-source
  'source', 'source_text', 'code', 'snippet', 'docstring', 'signature',
  'embedding', 'embeddings', 'vector', 'vectors',
  // the serve plane's temptations
  'passage', 'passage_text', 'chunk_text', 'text', 'content', 'prompt', 'prompt_text',
  'system_prompt', 'messages', 'answer', 'answer_text', 'completion', 'response',
  // raw identifiers — the audit record must not carry the data it protects
  'aadhaar', 'aadhaar_number', 'pan', 'ssn', 'mrn', 'npi', 'abha', 'abha_number',
  'pmjay_id', 'patient_name', 'name', 'email', 'phone', 'dob', 'date_of_birth',
  'account_number', 'card_number'
]);

/**
 * Key SHAPES that are denied regardless of name.
 *
 * `*_text` catches the field a producer invents next week. Deny-by-default only works if
 * it also denies the thing nobody has thought of yet — an enumerated list alone ages into
 * a list of the leaks somebody already had.
 */
const DENIED_PATTERNS = [/_text$/, /^raw_/, /_raw$/, /_plaintext$/];

class DeniedFieldError extends Error {
  constructor(field, at) {
    super(`field "${field}" may not enter the evidence plane (at ${at})`);
    this.name = 'DeniedFieldError';
    this.field = field;
    this.path = at;
  }
}

/** Walk a record and refuse the first denied key found, with its path. */
function assertNoDeniedFields(value, at = 'body') {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoDeniedFields(v, `${at}[${i}]`));
    return;
  }
  for (const [key, v] of Object.entries(value)) {
    const lower = key.toLowerCase();
    if (DENIED_KEYS.has(lower) || DENIED_PATTERNS.some((re) => re.test(lower))) {
      throw new DeniedFieldError(key, at);
    }
    assertNoDeniedFields(v, `${at}.${key}`);
  }
}

function chainFile(dir, plane) {
  if (!PLANES.includes(plane)) throw new Error(`unknown plane "${plane}" — expected build or serve`);
  return path.join(dir, FILE_FOR[plane]);
}

/** The last sealed record in a chain, or null for an empty/absent file. */
function tail(file) {
  if (!fs.existsSync(file)) return null;
  const { records } = parseJsonl(fs.readFileSync(file, 'utf8'));
  return records.length ? records[records.length - 1] : null;
}

/**
 * Append one record.
 *
 * @param dir     the tenant/project evidence directory
 * @param plane   'build' | 'serve'
 * @param fields  { ts, tenant, policy_sha, corr_id, kind, body }
 * @returns the sealed record as written
 */
function append(dir, plane, fields) {
  const file = chainFile(dir, plane);

  for (const req of ['ts', 'tenant', 'policy_sha', 'corr_id', 'kind', 'body']) {
    if (fields[req] === undefined) throw new Error(`missing required field "${req}"`);
  }
  if (!KINDS[plane].includes(fields.kind)) {
    throw new Error(`kind "${fields.kind}" is not registered for the ${plane} plane (expected one of: ${KINDS[plane].join(', ')})`);
  }
  if (fields.plane !== undefined && fields.plane !== plane) {
    throw new Error(`record declares plane "${fields.plane}" but is being written to the ${plane} chain`);
  }
  assertNoDeniedFields(fields.body);

  const prev = tail(file);
  const record = sealRecord({
    seq: prev === null ? 0 : prev.seq + 1,
    // Explicit null at seq 0 rather than an omitted key: absent-vs-null is a
    // canonicalisation divergence, and a schema should not contain one by design.
    prev_hash: prev === null ? null : prev.hash,
    ts: fields.ts,
    tenant: fields.tenant,
    plane,
    policy_sha: fields.policy_sha,
    corr_id: fields.corr_id,
    kind: fields.kind,
    schema: SCHEMA_VERSION,
    body: fields.body
  });

  fs.mkdirSync(dir, { recursive: true });
  // Appended as one write of one line. A partial line is a MALFORMED_LINE the verifier
  // reports by number — recoverable — whereas rewriting the file to insert a record would
  // put the whole history at risk of a truncated write.
  fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
  return record;
}

/** Verify one plane's chain. */
function verify(dir, plane) {
  const file = chainFile(dir, plane);
  if (!fs.existsSync(file)) return { verdict: 'VALID', breaks: [], unsupported: [], count: 0, head: null, absent: true };
  return verifyJsonl(fs.readFileSync(file, 'utf8'));
}

/**
 * Verify every chain under a tenant directory.
 *
 * Returns per-plane results plus the heads an operator would publish externally. Both
 * heads are needed: per-plane chains mean two anchors, which is the stated cost of not
 * having a shared writer.
 */
function verifyAll(dir) {
  const planes = {};
  let worst = 'VALID';
  for (const plane of PLANES) {
    const r = verify(dir, plane);
    planes[plane] = r;
    if (r.verdict === 'BROKEN') worst = 'BROKEN';
    else if (r.verdict === 'UNSUPPORTED' && worst === 'VALID') worst = 'UNSUPPORTED';
  }
  return {
    verdict: worst,
    planes,
    heads: { build: planes.build.head, serve: planes.serve.head }
  };
}

module.exports = {
  append, verify, verifyAll, chainFile, tail,
  assertNoDeniedFields, DeniedFieldError,
  PLANES, FILE_FOR, KINDS, DENIED_KEYS, DENIED_PATTERNS
};
