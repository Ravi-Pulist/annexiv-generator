// canonical.js — structure to bytes, identically in every language that reads the chain.
//
// Normative spec: docs/00-canonicalisation.md. This file implements it; where the two
// disagree, this file is wrong.
//
// WHY THIS IS HAND-ROLLED rather than `JSON.stringify(v, Object.keys(v).sort())`. Four
// reasons, each one a divergence that would surface as a false tamper alert:
//
//   1. Sorting. `Array.prototype.sort()` on strings IS UTF-16 code-unit order, so JS gets
//      R2 right by accident. Python's `sorted()` compares code points and gets it WRONG for
//      astral keys. Relying on a default that is correct in one language and incorrect in
//      the other is how the two implementations drift apart while both look reasonable.
//   2. Escaping. `JSON.stringify` escapes lone surrogates as \udXXX and, since ES2019, emits
//      well-formed output — but it is a large surface defined by a language spec that is not
//      RFC 8785, and it escapes nothing we can point an auditor at. Twenty lines we control
//      beats a builtin we merely hope agrees.
//   3. Numbers. `JSON.stringify(1e21)` is "1e+21". The restricted profile forbids floats
//      precisely so this never has to be reasoned about — but the check must be OURS,
//      because the builtin will happily serialise what the profile rejects.
//   4. Normalisation. No serialiser normalises Unicode. R4 requires it.
//
// THE REFUSAL IS THE POINT. Every function here throws on input outside the profile rather
// than coercing it. A canonicaliser that quietly rounds a float has produced bytes nobody
// can reproduce, and the failure surfaces later as "the chain is broken" — the most
// expensive possible place to learn about it.

'use strict';

const MAX_SAFE = 9007199254740991; // 2^53 - 1

/** Thrown for anything the restricted profile does not represent. */
class CanonicalError extends Error {
  constructor(reason, message, path) {
    super(path ? `${message} (at ${path})` : message);
    this.name = 'CanonicalError';
    this.reason = reason; // FLOAT | RANGE | TYPE | DUPLICATE_KEY | CYCLE
    this.path = path || '$';
  }
}

// The escapes R4 mandates, and no others. Forward slash is absent deliberately: escaping it
// is legal JSON and non-conforming here, and it is the single most common gratuitous escape.
const ESCAPES = {
  0x08: '\\b',
  0x09: '\\t',
  0x0a: '\\n',
  0x0c: '\\f',
  0x0d: '\\r',
  0x22: '\\"',
  0x5c: '\\\\'
};

/**
 * R4 — quote and escape a string. Iterates UTF-16 code units, not code points: a surrogate
 * pair passes through as its two units and re-encodes to the correct UTF-8 on output, so
 * astral characters need no special case.
 */
function encodeString(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const cu = s.charCodeAt(i);
    const esc = ESCAPES[cu];
    if (esc !== undefined) {
      out += esc;
    } else if (cu < 0x20) {
      // Lowercase hex, fixed width. Mixed case here is a silent divergence.
      out += '\\u' + cu.toString(16).padStart(4, '0');
    } else {
      out += s[i];
    }
  }
  return out + '"';
}

/**
 * R2 — compare by UTF-16 code unit as unsigned 16-bit integers.
 *
 * JS string `<` already does this, but it is spelled out so the Python implementation has
 * something to mirror line for line rather than a comment saying "same as JS".
 */
function compareCodeUnits(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a.charCodeAt(i) - b.charCodeAt(i);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

/** R4 — NFC, applied to keys and values alike, before sorting. */
function nfc(s) {
  return s.normalize('NFC');
}

/**
 * R5 — integers only, inside the safe range. Non-integral values are refused, never rounded.
 *
 * THE CHECK IS ON VALUE, NOT ON HOST TYPE, and it has to be. JavaScript cannot distinguish
 * `1` from `1.0` — both are the double 1 — whereas Python holds them as different objects.
 * If Python refused every `float` while JS accepted the same document, the two would disagree
 * about `{"n": 1.0}`, which is perfectly representable. So both accept an integral value and
 * emit it as an integer, and both refuse a non-integral one. The profile is a property of the
 * DATA, not of whichever language happened to parse it.
 */
function encodeNumber(n, path) {
  if (!Number.isFinite(n)) {
    throw new CanonicalError('FLOAT', `not a finite number: ${n}`, path);
  }
  if (!Number.isInteger(n)) {
    throw new CanonicalError(
      'FLOAT',
      `floating-point values are outside the restricted profile: ${n} — record it as an integer in a named unit (see R5)`,
      path
    );
  }
  if (n > MAX_SAFE || n < -MAX_SAFE) {
    throw new CanonicalError(
      'RANGE',
      `integer outside +/-(2^53-1): ${n} — Python would carry this exactly and JS would not, so the profile refuses it`,
      path
    );
  }
  // Negative zero normalises to "0" rather than raising, because Python's int(-0.0) is 0 and
  // the two implementations must agree. `String(-0)` is already "0" in JS; Object.is is the
  // only way to even observe the distinction, and it is spelled out so a reader does not
  // wonder whether the case was considered.
  if (Object.is(n, -0)) return '0';
  return String(n);
}

function canonicaliseValue(v, path, seen) {
  if (v === null) return 'null';

  const t = typeof v;
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'number') return encodeNumber(v, path);
  if (t === 'string') return encodeString(nfc(v));

  if (t === 'bigint') {
    // Deliberate: BigInt has no Python counterpart inside the safe range, and silently
    // narrowing it would defeat R5's whole purpose.
    throw new CanonicalError('TYPE', 'bigint is outside the restricted profile', path);
  }
  if (t === 'undefined' || t === 'function' || t === 'symbol') {
    throw new CanonicalError('TYPE', `${t} has no JSON representation`, path);
  }

  // Objects and arrays. A cycle is a bug in the caller, and the default failure is a stack
  // overflow with no path information — which is useless when the caller is a hook.
  if (seen.has(v)) throw new CanonicalError('CYCLE', 'circular reference', path);
  seen.add(v);
  try {
    if (Array.isArray(v)) {
      // R7 — order preserved. Sorting an array here would destroy meaning.
      const parts = v.map((el, i) => canonicaliseValue(el, `${path}[${i}]`, seen));
      return '[' + parts.join(',') + ']';
    }

    if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) {
      // Date, Map, Set, class instances: each would serialise by some incidental rule.
      // Refusing them keeps the profile a data format rather than a serialisation protocol.
      throw new CanonicalError('TYPE', `only plain objects are canonicalisable, got ${v.constructor?.name}`, path);
    }

    // R4 then R2: normalise keys BEFORE sorting, or the output order depends on the input's
    // Unicode form — the exact bug normalisation exists to remove.
    const entries = [];
    const normalised = new Map();
    for (const rawKey of Object.keys(v)) {
      const key = nfc(rawKey);
      if (normalised.has(key)) {
        // Two distinct raw keys colliding under NFC is a genuine ambiguity, not a merge to
        // be guessed at.
        throw new CanonicalError(
          'DUPLICATE_KEY',
          `keys ${JSON.stringify(rawKey)} and ${JSON.stringify(normalised.get(key))} are the same key after NFC`,
          path
        );
      }
      normalised.set(key, rawKey);
      entries.push([key, v[rawKey]]);
    }
    entries.sort((a, b) => compareCodeUnits(a[0], b[0]));

    const parts = entries.map(([k, val]) =>
      encodeString(k) + ':' + canonicaliseValue(val, `${path}.${k}`, seen)
    );
    return '{' + parts.join(',') + '}';
  } finally {
    seen.delete(v);
  }
}

/**
 * Canonicalise a value to its R1–R8 text form.
 * @returns {string} the canonical text. Encode as UTF-8 to obtain the bytes that get hashed.
 */
function canonicalise(value) {
  return canonicaliseValue(value, '$', new Set());
}

/** The bytes. Separate from canonicalise() so callers cannot forget the encoding. */
function canonicalBytes(value) {
  return Buffer.from(canonicalise(value), 'utf8');
}

module.exports = { canonicalise, canonicalBytes, CanonicalError, compareCodeUnits, MAX_SAFE };
