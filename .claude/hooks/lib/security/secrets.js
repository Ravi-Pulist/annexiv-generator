// secrets.js — the card boundary: nothing with a live credential in it enters the index.
//
// WHY INDEXING CREATES A RISK THAT DID NOT EXIST: a hardcoded key in a comment is already
// one grep away in the repo, so scanning is not about the repo — it is about the COPY.
// The index is a second artefact with different handling: it is written to a database
// file, it may be picked up by a backup tool, an editor sync, or a CI cache, and it can
// be shipped to a team server. Whatever lands in it inherits none of the repo's
// protections automatically. So the value is redacted here, at the point where text
// leaves the source and becomes an index entry, and the key NAME is kept because
// "there is a credential at this line" is exactly what a reviewer needs to know.
//
// THIS IS DEFENCE IN DEPTH, NOT A GUARANTEE. Detection is pattern plus entropy, and both
// miss things. It is deliberately biased toward redacting a harmless string over storing
// a live one: a false positive costs a slightly worse search result, a false negative
// costs a credential in a file nobody thought to encrypt.

'use strict';

const fs = require('fs');
const path = require('path');

const REDACTED = '[REDACTED]';

// Named patterns, so a finding can say WHAT it thinks it found rather than just "secret".
// Ordered most-specific first: a GitHub token should be reported as one, not as generic
// high entropy.
const PATTERNS = [
  ['aws-access-key-id',   /\b(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g],
  ['github-token',        /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g],
  ['slack-token',         /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g],
  ['stripe-key',          /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ['openai-key',          /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g],
  ['anthropic-key',       /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g],
  ['google-api-key',      /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['private-key-block',   /-----BEGIN[ A-Z]*PRIVATE KEY-----/g],
  ['jwt',                 /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
  ['connection-string',   /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]+@[^\s/]+/gi],
  // Assignment forms: `api_key = "..."`, `"password": "..."`, `DB_PASSWORD = "..."`.
  //
  // The leading boundary is `(?:^|[^A-Za-z0-9])` and NOT `\b`. `_` is a word character, so
  // `\b` never matches inside `DB_PASSWORD` / `TWILIO_AUTH_TOKEN` / `MY_API_KEY` — which is
  // the dominant convention for credential constants, and precisely the form that was
  // slipping through while the bare `password = "..."` control case passed.
  ['assigned-credential', /(?:^|[^A-Za-z0-9])(?:api[_-]?key|secret|passwd|password|token|credential|auth|access[_-]?key|private[_-]?key|client[_-]?secret)\s*[:=]\s*["'`]([^"'`\n]{8,})["'`]/gi]
];

// Placeholders. Redacting these teaches people the scanner cries wolf, which is how a
// scanner gets turned off.
// Anchored, so it must describe the WHOLE candidate. `[\w-]+` rather than `\w+` because
// the commonest placeholder of all is hyphenated ("your-api-key-here") and a scanner that
// flags it is a scanner that gets switched off.
const PLACEHOLDER = /^(?:x{3,}|\*{3,}|\.{3,}|<[^>]+>|\$\{[^}]+\}|%\([^)]+\)s|\{\{?[^}]+\}?\}|(?:your|my|the|some|insert|add|put)[_-][\w-]+|[\w-]*(?:placeholder|changeme|change-me|example|dummy|sample|redacted|goes-here|here)[\w-]*|test|none|null|undefined|true|false|localhost|password|secret|token|abc123|foo|bar)$/i;

/** Shannon entropy in bits per character — high for random keys, low for prose and code. */
function entropy(s) {
  if (!s) return 0;
  const freq = new Map();
  for (const c of s) freq.set(c, (freq.get(c) || 0) + 1);
  let e = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    e -= p * Math.log2(p);
  }
  return e;
}

/**
 * Does this look like a random credential rather than an identifier?
 * Long, mixed-alphabet, high entropy, and not a recognisable code token.
 */
function looksRandom(s) {
  if (!s || s.length < 24 || s.length > 512) return false;
  if (PLACEHOLDER.test(s)) return false;
  if (/\s/.test(s)) return false;
  // Identifiers and paths are long but structured; entropy alone flags them otherwise.
  //
  // NO /i FLAG. With it, `[a-z0-9]` also matched uppercase, so "this is a snake_case
  // identifier, not a secret" silently described any run of [A-Za-z0-9] joined by _ or - —
  // which is the exact shape of every modern prefixed token: `github_pat_11ABC...`,
  // `npm_aBcDeF...`, `hf_...`, `GOCSPX-...`, `xapp-1-A012...`. All of them were exempted
  // here and never reached the entropy check below.
  if (/^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$/.test(s)) return false;
  if (/^(?:[.~]?\/|[A-Za-z]:\\)/.test(s)) return false;
  if (/^https?:\/\//i.test(s) && !/:[^@/]+@/.test(s)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(s)).length;

  // A pure-hex blob has only two character classes and can never reach `>= 3`, so 32-hex
  // API keys and HMACs were unreachable by the entropy backstop.
  //
  // The fix is DELIBERATELY not "lower the threshold to 2": a 40-hex string is far more
  // often a git SHA quoted in a comment than a credential, and flagging every commit
  // reference is how a scanner gets muted. Those cases are caught by the
  // `assigned-credential` pattern above instead, which requires an actual credential
  // keyword — so `AUTH_TOKEN = "<hex>"` is redacted while `see commit da39a3ee...` is not.
  // Bare hex is only treated as random when it is long enough that a SHA is unlikely.
  const pureHex = /^[0-9a-f]+$/i.test(s);
  if (pureHex) return s.length >= 48 && entropy(s) >= 3.5;

  return classes >= 3 && entropy(s) >= 4.0;
}

/**
 * Find credentials in a string.
 * Returns [{ kind, match, index }] — never the surrounding text, so a finding can be
 * logged without logging the thing it found.
 */
function scan(text) {
  if (!text || typeof text !== 'string') return [];
  const hits = [];
  const covered = [];
  const overlaps = (i, len) => covered.some(([a, b]) => i < b && i + len > a);

  for (const [kind, re] of PATTERNS) {
    re.lastIndex = 0;
    for (let m; (m = re.exec(text));) {
      const value = m[1] !== undefined ? m[1] : m[0];
      if (m[1] !== undefined && PLACEHOLDER.test(value)) continue;
      const idx = m[1] !== undefined ? m.index + m[0].lastIndexOf(value) : m.index;
      if (overlaps(idx, value.length)) continue;
      covered.push([idx, idx + value.length]);
      hits.push({ kind, match: value, index: idx });
    }
  }

  // Entropy sweep for anything the named patterns did not recognise.
  //
  // The charset is "anything that is not a delimiter" rather than base64: a generated
  // password full of punctuation is exactly the case no named pattern covers, and
  // restricting to [A-Za-z0-9+/=_-] made the backstop blind to it. looksRandom() is what
  // keeps the false-positive rate down, not a narrow alphabet.
  const tokenRe = /[^\s"'`,;(){}[\]<>]{24,}/g;
  for (let m; (m = tokenRe.exec(text));) {
    if (overlaps(m.index, m[0].length)) continue;
    if (!looksRandom(m[0])) continue;
    covered.push([m.index, m.index + m[0].length]);
    hits.push({ kind: 'high-entropy', match: m[0], index: m.index });
  }

  return hits.sort((a, b) => a.index - b.index);
}

/**
 * Replace every detected credential with a marker, keeping length information out of it.
 * The surrounding text — the key name, the function, the comment — is preserved, because
 * that is the part that makes the index useful and the finding actionable.
 */
function redact(text) {
  const hits = scan(text);
  if (!hits.length) return { text, redactions: [] };
  let out = '';
  let cursor = 0;
  for (const h of hits) {
    out += text.slice(cursor, h.index) + REDACTED;
    cursor = h.index + h.match.length;
  }
  out += text.slice(cursor);
  return { text: out, redactions: hits.map((h) => ({ kind: h.kind })) };
}

/** Redact in place across the fields of a symbol card that carry free text. */
function redactCard(card) {
  const out = { ...card };
  const found = [];
  for (const field of ['doc', 'signature', 'text']) {
    if (typeof out[field] === 'string') {
      const r = redact(out[field]);
      out[field] = r.text;
      found.push(...r.redactions);
    }
  }
  if (found.length) out.redactions = found;
  return out;
}

// ─── .indexignore ───────────────────────────────────────────────────────────
//
// Same syntax as .gitignore, and it excludes a path from ALL THREE tiers. A path the
// user has excluded must not reappear through lexical search because only the vector
// tier was taught about it.

function compileIgnore(patterns) {
  const rules = [];
  for (const raw of patterns) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const negate = line.startsWith('!');
    if (negate) line = line.slice(1);
    const dirOnly = line.endsWith('/');
    if (dirOnly) line = line.slice(0, -1);
    const anchored = line.startsWith('/');
    if (anchored) line = line.slice(1);

    // `**/` must be able to match ZERO directories.
    //
    // Compiling each segment and re-joining with a literal '/' turned `**/keys.js` into
    // `.*/keys\.js`, which REQUIRES a slash — so the single most idiomatic gitignore form
    // silently failed to exclude the top-level file it was written for. `**/*.pem` did not
    // ignore `server.pem`; `**/secrets/**` did not ignore `secrets/a.js`. The user got no
    // warning; the only symptom was a protected file quietly appearing in the index.
    const segs = line.split('/');
    let body = '';
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (seg === '**') {
        // Consumes its own trailing separator, and may match nothing at all.
        body += '(?:[^/]+/)*';
        continue;
      }
      body += seg
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');
      if (i < segs.length - 1 && segs[i + 1] !== '**') body += '/';
    }

    const prefix = anchored ? '^' : '(?:^|/)';
    const suffix = '(?:/|$)';
    // Case-INSENSITIVE: Windows and macOS default to case-insensitive filesystems, so
    // `secrets/` and `Secrets/` are the same directory and must be excluded alike.
    rules.push({ re: new RegExp(prefix + body + suffix, 'i'), negate });
  }
  return rules;
}

function loadIgnore(root) {
  const file = path.join(root, '.indexignore');
  let patterns = [];
  try {
    if (fs.existsSync(file)) patterns = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  } catch { /* unreadable ignore file is the same as none */ }
  const rules = compileIgnore(patterns);
  return {
    /** Last matching rule wins, so a negation can re-include a subtree. */
    ignores(relPath) {
      let hit = false;
      for (const r of rules) if (r.re.test(relPath)) hit = !r.negate;
      return hit;
    },
    count: rules.length
  };
}

module.exports = { scan, redact, redactCard, entropy, looksRandom, loadIgnore, compileIgnore, REDACTED };
