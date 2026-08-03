// domain-pack.js — read a domain pack's manifest and derive the data-guard config from it.
//
// THE DEFECT THIS FIXES, and it shipped in every project the installer ever created.
//
// `rmad init --domain healthcare` selected healthcare SKILLS and then copied
// `.data-guard-config.json` verbatim out of templates/. The installer never wrote that file
// at all. Whatever config happened to be sitting in the framework's own working tree became
// the template — and that was `supply-chain`.
//
// So a healthcare project was scaffolded with `pricing-data` and `trade-secrets` detectors
// and NO PHI detectors: no MRN, no date of birth, no ICD-10. The guard whose entire job is
// to stop protected health information leaking was configured to protect wholesale margins.
// It ran, `doctor` reported HEALTHY, and it guarded the wrong asset class in silence — the
// same failure shape as a check that returns success without doing its job.
//
// Worse still, the config it did install carries the bare words `formula` and `recipe` as
// blocking trade-secret markers. That is the exact pattern set documented in data-guard.js
// as having hard-blocked a commit message, a maths utility, a cooking app, and twice its own
// bug report. Every new project inherited a known false-positive cascade.
//
// WHY A HAND-ROLLED YAML READER. The framework has zero dependencies and that is a load-
// bearing property — `npx rmad` into any repo must not drag a parser in. The manifests are
// machine-generated with a fixed shape, so this reads that shape exactly and REFUSES
// anything it does not recognise rather than guessing. A silently mis-parsed security
// pattern is worse than an absent one.

'use strict';

const fs = require('fs');
const path = require('path');

/** Strip surrounding quotes from a scalar. */
const unquote = (s) => String(s).trim().replace(/^["']|["']$/g, '');

/** `["a", "b"]` -> ['a','b'] */
function parseInlineList(raw) {
  const inner = String(raw).trim().replace(/^\[|\]$/g, '');
  if (!inner.trim()) return [];
  return inner.split(',').map(unquote).filter(Boolean);
}

/**
 * Extract `sensitive_data.patterns` from a pack manifest.
 *
 * Deliberately narrow: it walks the `patterns:` list under `sensitive_data:` and reads only
 * the keys the guard understands. The block is `sensitive_data`, NOT `data_guard` — a first
 * pass guessed the latter and silently produced zero patterns for every shipped pack, which
 * is precisely the failure mode this module exists to end. It was caught by running the
 * parser against all six packs instead of one. An unknown key is ignored rather than passed through, because
 * data-guard treats an unrecognised field as absent and would silently drop the pattern's
 * teeth.
 */
/** `sensitive_data.classification` — e.g. "phi", "pci". Null when the pack omits it. */
function parseClassification(yamlText) {
  const lines = String(yamlText).split(/\r?\n/);
  const i = lines.findIndex((l) => /^sensitive_data\s*:/.test(l));
  if (i === -1) return null;
  for (let j = i + 1; j < lines.length; j++) {
    if (/^\S/.test(lines[j])) break;
    const m = lines[j].match(/^\s+classification\s*:\s*(.+)$/);
    if (m) return unquote(m[1]);
  }
  return null;
}

function parsePatterns(yamlText) {
  const lines = String(yamlText).split(/\r?\n/);

  // Find `sensitive_data:` at column 0, then its `patterns:` child.
  let i = lines.findIndex((l) => /^sensitive_data\s*:/.test(l));
  if (i === -1) return [];
  let start = -1;
  for (let j = i + 1; j < lines.length; j++) {
    if (/^\S/.test(lines[j])) break;                 // left the sensitive_data block
    if (/^\s+patterns\s*:/.test(lines[j])) { start = j + 1; break; }
  }
  if (start === -1) return [];

  const out = [];
  let cur = null;
  for (let j = start; j < lines.length; j++) {
    const line = lines[j];
    if (!line.trim()) continue;
    if (/^\S/.test(line)) break;                      // next top-level key
    const itemStart = line.match(/^(\s*)-\s+(\w+)\s*:\s*(.*)$/);
    if (itemStart) {
      if (cur) out.push(cur);
      cur = {};
      applyKey(cur, itemStart[2], itemStart[3]);
      continue;
    }
    const kv = line.match(/^\s+(\w+)\s*:\s*(.*)$/);
    if (kv && cur) applyKey(cur, kv[1], kv[2]);
    else if (!kv && cur === null) break;               // shape we do not recognise
  }
  if (cur) out.push(cur);
  return out.filter((p) => p.name);
}

// The manifests use snake_case; data-guard reads camelCase. Translating here is the whole
// reason a pattern could look present and do nothing: `field_names` is not `fieldNames`, and
// data-guard would treat the pattern as having no fields to match.
function applyKey(obj, key, rawValue) {
  const value = String(rawValue ?? '').trim();
  switch (key) {
    case 'name': obj.name = unquote(value); break;
    case 'description': obj.description = unquote(value); break;
    case 'regex': obj.regex = unquote(value); break;
    case 'value_regex': obj.valueRegex = unquote(value); break;
    case 'path_regex': obj.pathRegex = unquote(value); break;
    case 'detector': obj.detector = unquote(value); break;
    case 'severity': obj.severity = unquote(value); break;
    case 'action': obj.action = unquote(value); break;
    case 'field_names':
    case 'fieldNames':
      obj.fieldNames = parseInlineList(value); break;
    default: break;                                    // unknown keys are dropped, not guessed
  }
}

/** Where a pack's manifest lives, given a directory holding domain-packs/. */
function manifestPath(packsDir, domain) {
  return path.join(packsDir, String(domain), 'manifest.yaml');
}

/**
 * Build the data-guard config for a domain.
 *
 * Returns { config, source } where source is 'pack' | 'fallback'. The caller MUST report
 * which one it got: a project silently running on a fallback is how this defect stayed
 * invisible in the first place.
 */
function dataGuardConfigFor(packsDir, domain) {
  const file = manifestPath(packsDir, domain);
  let patterns = [];
  let classification = null;
  try {
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8');
      patterns = parsePatterns(text);
      classification = parseClassification(text);
    }
  } catch { /* unreadable manifest falls through to the fallback below */ }

  if (!patterns.length) {
    // No pack, or a pack that declares nothing. Ship a minimal, universally-true config
    // rather than another domain's — which is the bug being fixed.
    return {
      source: 'fallback',
      config: {
        $comment: `No data_guard patterns found for domain "${domain}". This is a minimal ` +
          'fallback, NOT another domain\'s configuration. Add patterns to the pack manifest.',
        domain: String(domain),
        exfiltration: { enabled: true },
        patterns: []
      }
    };
  }

  return {
    source: 'pack',
    config: {
      $comment: `Generated by rmad init from domain-packs/${domain}/manifest.yaml. ` +
        'Edit the manifest and re-run init, or edit this file directly for project-specific detectors.',
      domain: String(domain),
      classification: classification || 'unspecified',
      exfiltration: { enabled: true },
      patterns
    }
  };
}

module.exports = { dataGuardConfigFor, parsePatterns, parseClassification, manifestPath, parseInlineList };
