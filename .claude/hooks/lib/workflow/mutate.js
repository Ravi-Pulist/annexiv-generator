// mutate.js — mutation operators, and the harness that runs them. RMAD-05.
//
// WHY: STING (arXiv 2604.01518) found that 77% of SWE-bench Verified instances have at
// least one surviving mutant, and that strengthening the suites drops top-10 agents by
// 4.2–9.0%. The oracle is the weak link, not the agent. A framework whose central claim is
// verified completion cannot take its own test suite on trust, so this scores the suite
// the same way — by breaking the code and seeing whether anything notices.
//
// SCOPE, STATED PRECISELY: a mutation score without a denominator is marketing. Every
// report here carries the sample size, and sampling is the default because running a full
// suite per mutant is expensive.
//
// ZERO DEPENDENCIES. The operators are textual edits at offsets the scanner already knows,
// applied to a COPY of the file, with the original restored in a finally block.

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Operators chosen because each one changes BEHAVIOUR rather than syntax: a test that
// passes against them was not testing the thing it appears to test.
const OPERATORS = [
  { id: 'boundary',   find: /([^<>=!])<=/g,      make: (m, p1) => `${p1}<`,  label: '<= to <' },
  { id: 'boundary',   find: /([^<>=!])>=/g,      make: (m, p1) => `${p1}>`,  label: '>= to >' },
  { id: 'boundary',   find: /([^<>=!])<([^=])/g, make: (m, p1, p2) => `${p1}<=${p2}`, label: '< to <=' },
  { id: 'equality',   find: /([^!<>=])===/g,     make: (m, p1) => `${p1}!==`, label: '=== to !==' },
  { id: 'equality',   find: /!==/g,              make: () => '===',           label: '!== to ===' },
  { id: 'logical',    find: /&&/g,               make: () => '||',            label: '&& to ||' },
  { id: 'logical',    find: /\|\|/g,             make: () => '&&',            label: '|| to &&' },
  { id: 'arithmetic', find: /([\w)\]])\s\+\s/g,  make: (m, p1) => `${p1} - `, label: '+ to -' },
  { id: 'return',     find: /return true;/g,     make: () => 'return false;', label: 'return true to false' },
  { id: 'return',     find: /return false;/g,    make: () => 'return true;',  label: 'return false to true' }
];

const lineAt = (src, index) => src.slice(0, index).split('\n').length;

/** Every mutation this file admits, as { index, length, replacement, operator, line }. */
function mutantsFor(src) {
  const out = [];
  const code = stripCommentsAndStrings(src);
  for (const op of OPERATORS) {
    const re = new RegExp(op.find.source, 'g');
    let m;
    while ((m = re.exec(code)) !== null) {
      // Mutating inside a comment or a string literal changes nothing executable and would
      // inflate the survivor count with mutants no test could ever kill.
      out.push({
        index: m.index,
        length: m[0].length,
        replacement: op.make(...m),
        operator: op.id,
        label: op.label,
        line: lineAt(src, m.index)
      });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

/**
 * Blank out comments and string bodies so offsets stay valid but their contents cannot
 * match an operator. Deliberately simple: it does not need to parse, only to avoid
 * proposing mutants that are not code.
 */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const blank = (n) => ' '.repeat(n);
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const end = src.indexOf('\n', i); const stop = end === -1 ? src.length : end;
      out += blank(stop - i); i = stop; continue;
    }
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2); const stop = end === -1 ? src.length : end + 2;
      out += blank(stop - i); i = stop; continue;
    }
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) { if (src[j] === '\\') j++; j++; }
      out += blank(Math.min(j + 1, src.length) - i); i = j + 1; continue;
    }
    out += ch; i++;
  }
  return out;
}

/** Deterministic sample: same file, same n, same mutants — so a score is reproducible. */
function sample(mutants, n) {
  if (!n || n >= mutants.length) return mutants;
  const step = mutants.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(mutants[Math.floor(i * step)]);
  return out;
}

// Run the oracle once, with no mutation applied.
//
// WHY THIS EXISTS — it is the defect that produced a 100% score in 0.18 seconds. `npm` on
// Windows is npm.cmd, and spawnSync with shell:false cannot launch it: res.error is ENOENT
// and res.status is null. `null !== 0` read as "the oracle noticed", so all 15 mutants were
// scored killed by an oracle that never executed. A mutation harness that reports a perfect
// score when its own runner is broken is precisely the reward-hack it exists to detect.
//
// So the oracle is now proved to RUN and to PASS on clean code before a single mutant is
// applied. If it cannot start, the number is undefined, not 100.
function checkOracle(root, command, args, timeoutMs) {
  const res = spawnSync(command, args, {
    cwd: root, encoding: 'utf8', timeout: timeoutMs || 120000, shell: false
  });
  if (res.error) {
    const msg = String(res.error.message || '');
    if (/ENOENT/i.test(msg)) {
      return {
        ok: false, reason: 'notfound',
        detail: `cannot execute '${command}' — it was not found as an executable.\n` +
          '  On Windows, npm/npx/yarn are .cmd shims and cannot be spawned directly.\n' +
          `  Use the interpreter instead, e.g.  -- node --test tests/`
      };
    }
    if (/ETIMEDOUT|timed out/i.test(msg)) {
      return { ok: false, reason: 'timeout', detail: `the oracle timed out on CLEAN code after ${timeoutMs || 120000}ms — raise --timeout` };
    }
    return { ok: false, reason: 'error', detail: `the oracle failed to run: ${msg}` };
  }
  if (res.status !== 0) {
    return {
      ok: false, reason: 'red',
      detail: `the oracle exits ${res.status} on UNMUTATED code — the suite is already failing.\n` +
        '  Every mutant would score as killed by a failure that has nothing to do with it.'
    };
  }
  return { ok: true };
}

/**
 * Apply one mutant, run the oracle, restore. The restore is in a finally block because a
 * mutation harness that can leave a file mutated is a harness nobody will run twice.
 *
 * Returns { killed, timedOut, status, ran }. `ran: false` means the oracle did not execute
 * — that mutant is INCONCLUSIVE and must not be counted as killed. checkOracle() should
 * make this unreachable, but a runner that can silently convert "did not run" into "passed"
 * is how the 100%-in-0.18s result happened, so the distinction is kept at this level too.
 */
function runMutant(root, file, mutant, command, args, timeoutMs) {
  const abs = path.join(root, file);
  const original = fs.readFileSync(abs, 'utf8');
  const mutated = original.slice(0, mutant.index) + mutant.replacement +
    original.slice(mutant.index + mutant.length);
  try {
    fs.writeFileSync(abs, mutated);
    const res = spawnSync(command, args, {
      cwd: root, encoding: 'utf8', timeout: timeoutMs || 120000, shell: false
    });
    // A timeout counts as killed: an infinite loop is a behaviour change the suite
    // detected, however unpleasantly. A spawn FAILURE is not a detection at all.
    const timedOut = !!res.error && /ETIMEDOUT|timed out/i.test(String(res.error.message));
    if (res.error && !timedOut) {
      return { killed: false, timedOut: false, status: null, ran: false, error: String(res.error.message) };
    }
    return { killed: timedOut || res.status !== 0, timedOut, status: res.status, ran: true };
  } finally {
    fs.writeFileSync(abs, original);
  }
}

module.exports = { OPERATORS, mutantsFor, stripCommentsAndStrings, sample, runMutant, checkOracle };
