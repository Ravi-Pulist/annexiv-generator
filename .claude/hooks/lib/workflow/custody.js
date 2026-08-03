// custody.js — P3. "Where did these weights come from, and can you prove they weren't modified?"
//
// That is a question a bank's security team asks, and having the answer pre-built is a
// differentiator against anyone running `ollama pull` in production. It is also the lowest
// priced SKU in the ladder and the one with an invoice and no product.
//
// TWO THINGS THIS PINS, AND THEY ARE DIFFERENT.
//
// 1. IDENTITY. A model NAME is not an identity. An endpoint can stay "healthy" while its
//    effective identity changes underneath through weights, tokenizer, quantisation,
//    inference engine, kernels, caching, routing or hardware — and within-provider drift
//    has been measured at a scale comparable to cross-provider difference. So the register
//    contracts against a CHECKPOINT HASH, and `verify` re-hashes the artifact on disk.
//
// 2. LICENCE. Verified BEFORE a model enters a shelf, mechanically, by a field — not by
//    recollection at deployment time. Sarvam-1 (2B) is non-commercial while its siblings
//    are Apache-2.0; Llama's community licence carries a user threshold, mandatory
//    attribution and an EU restriction. Those are the kind of facts that are obvious when
//    you read them and invisible six months later.
//
// THE REGISTER REFUSES RATHER THAN GUESSES. An unknown licence is not assumed permissive,
// and it is not assumed restrictive either — it is refused until someone states the answer
// explicitly, having read the terms. A tool that guessed would be worse than no tool,
// because its confidence would be indistinguishable from knowledge.

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const codeGraph = require('../code-graph.js');

const REGISTER_SUBDIR = 'custody';
const REGISTER_FILE = 'register.json';
const DEFAULT_INTERVAL_DAYS = 90; // the quarterly re-check the SKU is sold on

/**
 * Licence policy.
 *
 * `spdx: true` means the id is a valid SPDX identifier and may go in a CycloneDX
 * `license.id`. Anything else MUST use `license.name` — putting a non-SPDX string in `id`
 * produces a BOM that fails validation, which is the opposite of what a bill of materials
 * is for.
 *
 * `commercial: false` is a hard refusal. `commercial: 'conditional'` is permitted but the
 * conditions travel with the entry and into the BOM, because "you may use this
 * commercially" and "you may use this commercially if you display our name and stay under
 * a user threshold" are different answers to the same question.
 */
const LICENCE_POLICY = {
  'Apache-2.0': { spdx: true, commercial: true },
  'MIT': { spdx: true, commercial: true },
  'BSD-3-Clause': { spdx: true, commercial: true },
  'BSD-2-Clause': { spdx: true, commercial: true },
  'CC-BY-4.0': { spdx: true, commercial: true },
  'CC0-1.0': { spdx: true, commercial: true },
  'CC-BY-SA-4.0': { spdx: true, commercial: true, note: 'share-alike: derivatives inherit the licence' },
  'CC-BY-NC-4.0': { spdx: true, commercial: false, note: 'NonCommercial — may not be used in a paid deployment' },
  'CC-BY-NC-SA-4.0': { spdx: true, commercial: false, note: 'NonCommercial' },
  'CC-BY-NC-ND-4.0': { spdx: true, commercial: false, note: 'NonCommercial, NoDerivatives' },
  'GPL-3.0-only': { spdx: true, commercial: true, note: 'copyleft — check distribution obligations for an appliance SKU' },
  'AGPL-3.0-only': { spdx: true, commercial: true, note: 'network copyleft — a hosted service must offer source' },
  // Non-SPDX vendor terms. Named, never given an SPDX id.
  'llama-community': {
    spdx: false, commercial: 'conditional',
    note: 'Meta Llama Community Licence: user-count threshold, mandatory "Built with Llama" attribution, EU restriction on multimodal. Not OSI-approved.'
  },
  'gemma-terms': { spdx: false, commercial: 'conditional', note: 'Google Gemma Terms: use restrictions apply; not OSI-approved.' },
  'sarvam-nc': { spdx: false, commercial: false, note: 'Sarvam-1 (2B) is NON-COMMERCIAL. Its 30B/105B siblings are Apache-2.0 — do not infer from the family.' }
};

function registerDir(root) {
  // Beside the index and the evidence chain, for the reason plane.js documents: creating
  // `.planning/` in a repo that lacks one relocates the index.
  return path.join(root, path.dirname(codeGraph.indexDir(root)), REGISTER_SUBDIR);
}
function registerPath(root) { return path.join(registerDir(root), REGISTER_FILE); }

function load(root) {
  const p = registerPath(root);
  if (!fs.existsSync(p)) return { version: 1, models: [] };
  const reg = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!Array.isArray(reg.models)) throw new Error(`${REGISTER_FILE} has no models array`);
  return reg;
}

function save(root, reg) {
  fs.mkdirSync(registerDir(root), { recursive: true });
  fs.writeFileSync(registerPath(root), JSON.stringify(reg, null, 2) + '\n', 'utf8');
  return registerPath(root);
}

/** SHA-256 of a file, streamed — a 40 GB checkpoint must not be read into memory. */
function hashFile(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

/**
 * Decide whether a licence permits the intended use.
 *
 * Returns { known, commercial, spdx, note }. An unknown licence is `known: false` and the
 * caller must refuse — see the file header.
 */
function licenceVerdict(licence, declaredCommercial) {
  const known = Object.prototype.hasOwnProperty.call(LICENCE_POLICY, licence);
  if (known) {
    const p = LICENCE_POLICY[licence];
    return { known: true, commercial: p.commercial, spdx: p.spdx, note: p.note || null };
  }
  if (declaredCommercial === undefined) return { known: false, commercial: null, spdx: false, note: null };
  // Explicitly declared by someone who read the terms. Recorded AS a declaration, so the
  // register shows the difference between a policy answer and a human's assertion.
  return { known: false, commercial: declaredCommercial, spdx: false, note: 'commercial use declared by the operator, not derived from policy' };
}

/** Pin a model. Refuses a non-commercial licence and an undeclared unknown one. */
function pin(root, entry) {
  const problems = [];
  for (const f of ['id', 'name', 'licence', 'source']) {
    if (!entry[f]) problems.push(`missing --${f === 'licence' ? 'licence' : f}`);
  }
  if (!entry.sha256 && !entry.path) problems.push('one of --sha256 or --path is required — a pin without a hash pins nothing');
  if (entry.sha256 && !/^[0-9a-f]{64}$/i.test(entry.sha256)) problems.push('--sha256 must be 64 hex characters');
  if (problems.length) {
    const err = new Error(`cannot pin:\n  - ${problems.join('\n  - ')}`);
    err.problems = problems;
    throw err;
  }

  const v = licenceVerdict(entry.licence, entry.declaredCommercial);
  if (!v.known && v.commercial === null) {
    throw new Error(
      `licence "${entry.licence}" is not in the policy table, so its commercial-use status is unknown.\n` +
      '  Read the terms, then re-run with --commercial-use yes|no. The register records that as an\n' +
      '  operator declaration rather than a policy answer, so the distinction survives in the BOM.'
    );
  }
  if (v.commercial === false) {
    throw new Error(
      `licence "${entry.licence}" does NOT permit commercial use${v.note ? ` — ${v.note}` : ''}.\n` +
      '  Refused. This is the check that is meant to fire here rather than at deployment.'
    );
  }

  // Hash the artifact if a path was given; otherwise trust the supplied digest.
  let sha256 = entry.sha256 ? entry.sha256.toLowerCase() : null;
  let size = null;
  if (entry.path) {
    const abs = path.resolve(root, entry.path);
    if (!fs.existsSync(abs)) throw new Error(`--path does not exist: ${abs}`);
    const computed = hashFile(abs);
    if (sha256 && sha256 !== computed) {
      throw new Error(`the file at --path hashes to ${computed}, not the --sha256 given (${sha256})`);
    }
    sha256 = computed;
    size = fs.statSync(abs).size;
  }

  const reg = load(root);
  if (reg.models.some((m) => m.id === entry.id)) {
    throw new Error(`"${entry.id}" is already pinned. A pin is a historical fact — use a new id for a new checkpoint.`);
  }

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const record = {
    id: entry.id,
    name: entry.name,
    version: entry.version || null,
    sha256,
    size_bytes: size,
    licence: entry.licence,
    licence_is_spdx: v.spdx,
    commercial_use: v.commercial,
    licence_note: v.note,
    licence_source: v.known ? 'policy' : 'operator-declared',
    source: entry.source,
    path: entry.path || null,
    pinned_at: now,
    last_verified_at: entry.path ? now : null,
    verify_interval_days: Number.isInteger(entry.intervalDays) ? entry.intervalDays : DEFAULT_INTERVAL_DAYS
  };
  reg.models.push(record);
  save(root, reg);
  return record;
}

/**
 * Re-hash pinned artifacts and compare.
 *
 * A model with no local path is reported UNVERIFIABLE, not OK. The register knows what it
 * was told; only a re-hash knows what is on disk, and reporting an unchecked pin as intact
 * is exactly the failure the SKU exists to prevent.
 */
function verify(root, { id } = {}) {
  const reg = load(root);
  const targets = id ? reg.models.filter((m) => m.id === id) : reg.models;
  if (id && !targets.length) throw new Error(`no pinned model with id "${id}"`);

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const results = targets.map((m) => {
    if (!m.path) {
      return { id: m.id, state: 'UNVERIFIABLE', detail: 'no local path recorded — the pin cannot be checked against an artifact' };
    }
    const abs = path.resolve(root, m.path);
    if (!fs.existsSync(abs)) {
      return { id: m.id, state: 'MISSING', detail: `the pinned artifact is gone: ${abs}` };
    }
    const actual = hashFile(abs);
    if (actual !== m.sha256) {
      return {
        id: m.id, state: 'MISMATCH',
        detail: `pinned ${m.sha256}, on disk ${actual} — the artifact changed after it was pinned`,
        expected: m.sha256, actual
      };
    }
    m.last_verified_at = now;
    return { id: m.id, state: 'OK', detail: `matches ${m.sha256.slice(0, 16)}…` };
  });

  if (results.some((r) => r.state === 'OK')) save(root, reg);

  const worst = results.some((r) => r.state === 'MISMATCH' || r.state === 'MISSING') ? 'FAILED'
    : results.some((r) => r.state === 'UNVERIFIABLE') ? 'INCOMPLETE' : 'OK';
  return { verdict: worst, results, checked_at: now };
}

/** Which pins are overdue for re-verification — the quarterly re-check, computed. */
function due(root, { asOf } = {}) {
  const reg = load(root);
  const now = asOf ? new Date(asOf) : new Date();
  return reg.models.map((m) => {
    const interval = m.verify_interval_days || DEFAULT_INTERVAL_DAYS;
    if (!m.last_verified_at) {
      return { id: m.id, overdue: true, days_since: null, interval, reason: 'never verified' };
    }
    const days = Math.floor((now - new Date(m.last_verified_at)) / 86400000);
    return { id: m.id, overdue: days >= interval, days_since: days, interval, reason: days >= interval ? `${days} days since last check` : null };
  });
}

/**
 * A CycloneDX 1.6 ML-BOM.
 *
 * Field shapes verified against the published JSON schema rather than recalled:
 *   - required at top level: bomFormat, specVersion
 *   - component required: type, name; the enum value is "machine-learning-model"
 *   - hashes[].alg comes from a fixed enum — "SHA-256", with the hyphen
 *   - licenses is an ARRAY of { license: {...} }, and license.id must be a valid SPDX
 *     identifier. A vendor licence therefore goes in license.NAME; putting it in `id`
 *     produces a BOM that fails validation, which defeats the point of shipping one.
 */
function bom(root, { serial } = {}) {
  const reg = load(root);
  const components = reg.models.map((m) => {
    const licence = m.licence_is_spdx ? { id: m.licence } : { name: m.licence };
    const props = [
      { name: 'trident:commercial_use', value: String(m.commercial_use) },
      { name: 'trident:licence_source', value: m.licence_source },
      { name: 'trident:pinned_at', value: m.pinned_at }
    ];
    if (m.licence_note) props.push({ name: 'trident:licence_note', value: m.licence_note });
    if (m.last_verified_at) props.push({ name: 'trident:last_verified_at', value: m.last_verified_at });

    const c = {
      type: 'machine-learning-model',
      'bom-ref': m.id,
      name: m.name,
      licenses: [{ license: licence }],
      externalReferences: [{ type: 'distribution', url: m.source }],
      properties: props
    };
    if (m.version) c.version = m.version;
    // Only assert a hash we actually hold. An absent digest is left absent rather than
    // filled with a placeholder that would read as provenance.
    if (m.sha256) c.hashes = [{ alg: 'SHA-256', content: m.sha256 }];
    return c;
  });

  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: serial || `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      component: { type: 'application', name: reg.deployment || 'trident-deployment' },
      properties: [{ name: 'trident:models_pinned', value: String(components.length) }]
    },
    components
  };
}

module.exports = {
  pin, verify, due, bom, load, save, licenceVerdict, hashFile,
  registerPath, registerDir, LICENCE_POLICY, DEFAULT_INTERVAL_DAYS
};
