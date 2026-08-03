// mermaid.js — the diagram, and the evidence table that has to travel with it.
//
// A Mermaid ERD cannot carry provenance: there is nowhere in the syntax to say "this
// relationship is a guess from a column name". So it is emitted as a PAIR — the diagram
// for reading, and an evidence table giving every element its confidence and the
// file:line that produced it. Ship the diagram alone and the caveats are lost the first
// time someone screenshots it into a design document.
//
// Default export is `certain` only. Inferred and heuristic relationships are real and
// often the interesting ones, but they are opt-in, dashed, and labelled — a hypothesis
// drawn like a fact is the failure mode this whole module is arranged to avoid.

'use strict';

// Mermaid cardinality tokens. The left symbol describes the LEFT entity's participation.
//   |o  zero or one     ||  exactly one     }o  zero or more    }|  one or more
const CARD = {
  '1:1': { l: '||', r: '||' },
  '1:N': { l: '||', r: 'o{' },
  'N:1': { l: '}o', r: '||' },
  'M:N': { l: '}o', r: 'o{' }
};

/** Optionality is real information the schema declares — do not throw it away. */
function leftToken(rel) {
  const c = CARD[rel.kind] || CARD['N:1'];
  if (rel.kind === '1:1' && rel.fromOptional) return '|o';
  if (rel.kind === 'N:1' && rel.fromOptional) return '}o';
  return c.l;
}
function rightToken(rel) {
  const c = CARD[rel.kind] || CARD['N:1'];
  if (rel.kind === '1:N' && rel.toOptional) return 'o{';
  if (rel.kind === '1:1' && rel.toOptional) return 'o|';
  return c.r;
}

// Mermaid identifiers must not contain dots or dashes.
const safe = (n) => String(n).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
const safeType = (t) => String(t || 'unknown').replace(/[^A-Za-z0-9_]/g, '_').slice(0, 24) || 'unknown';

function attrLine(c) {
  const flags = [c.pk ? 'PK' : null, c.unique && !c.pk ? 'UK' : null].filter(Boolean).join(',');
  const note = [c.nullable === false ? 'not null' : null, c.confidence !== 'certain' ? c.confidence : null]
    .filter(Boolean).join(', ');
  return `        ${safeType(c.type)} ${safe(c.name).toLowerCase()}${flags ? ' ' + flags : ''}` +
    (note ? ` "${note}"` : '');
}

/**
 * @param {object} model  output of erd/extract.derive()
 * @param {object} opts   { confidence: 'certain'|'all', attributes: boolean, maxEntities }
 */
function toMermaid(model, opts = {}) {
  const want = opts.confidence === 'all'
    ? new Set(['certain', 'inferred', 'heuristic'])
    : new Set(['certain']);
  const rels = model.relationships.filter((r) => want.has(r.confidence));

  // Past roughly 25 entities a Mermaid ERD stops being readable, so the honest move is to
  // narrow to what the requested relationships actually touch rather than emit a hairball.
  const max = opts.maxEntities || 25;
  let entities = model.entities;
  let narrowed = false;
  if (entities.length > max) {
    const involved = new Set(rels.flatMap((r) => [r.from, r.to]));
    const kept = entities.filter((e) => involved.has(e.name));
    if (kept.length && kept.length < entities.length) { entities = kept.slice(0, max); narrowed = true; }
    else entities = entities.slice(0, max);
  }
  const names = new Set(entities.map((e) => e.name));
  const shown = rels.filter((r) => names.has(r.from) && names.has(r.to));

  const out = ['erDiagram'];
  for (const r of shown) {
    const label = (r.label || 'relates').replace(/[^A-Za-z0-9_ ]/g, '_');
    const mark = r.confidence === 'certain' ? label : `${label} (${r.confidence})`;
    out.push(`    ${safe(r.from)} ${leftToken(r)}--${rightToken(r)} ${safe(r.to)} : "${mark}"`);
  }
  if (opts.attributes !== false) {
    for (const e of entities) {
      if (!e.columns.length) continue;
      out.push(`    ${safe(e.name)} {`);
      for (const c of e.columns.slice(0, 20)) out.push(attrLine(c));
      if (e.columns.length > 20) out.push(`        more ${e.columns.length - 20}_more_columns`);
      out.push('    }');
    }
  }
  return {
    diagram: out.join('\n'),
    shownEntities: entities.length,
    shownRelationships: shown.length,
    narrowed,
    omittedEntities: model.entities.length - entities.length,
    omittedRelationships: model.relationships.length - shown.length
  };
}

/** The reading artefact: diagram first, then the caveats that make it safe to act on. */
function toMarkdown(model, opts = {}) {
  const m = toMermaid(model, opts);
  const L = [];
  L.push(`# Data Model${opts.title ? ` — ${opts.title}` : ''}`);
  L.push('');
  L.push(`> Derived from source on ${opts.date || new Date().toISOString().slice(0, 10)} · ` +
    `${model.entities.length} entities, ${model.relationships.length} relationships ` +
    `(${model.counts.certain || 0} certain, ${model.counts.inferred || 0} inferred, ${model.counts.heuristic || 0} heuristic)`);
  L.push(`> Sources read: ${model.sources.join(', ') || 'none found'}`);
  if (opts.confidence !== 'all' && (model.counts.heuristic || model.counts.inferred)) {
    L.push('>');
    L.push(`> **${(model.counts.heuristic || 0) + (model.counts.inferred || 0)} non-declared relationship(s) are hidden.** ` +
      'Re-run with `--confidence all` to include them, dashed and labelled.');
  }
  L.push('');
  L.push('```mermaid');
  L.push(m.diagram);
  L.push('```');
  if (m.narrowed || m.omittedEntities) {
    L.push('');
    L.push(`*Showing ${m.shownEntities} of ${model.entities.length} entities — a Mermaid ERD stops being readable past ~25.*`);
  }

  L.push('');
  L.push('## Evidence');
  L.push('');
  L.push('Mermaid cannot carry provenance, so it lives here. Nothing below is a diagram element you should trust more than its confidence says.');
  L.push('');
  L.push('| Element | Kind | Confidence | Evidence |');
  L.push('|---|---|---|---|');
  for (const e of model.entities) {
    L.push(`| \`${e.name}\` | entity | ${e.confidence} | ${e.at} (${e.source}) |`);
  }
  for (const r of model.relationships) {
    const opt = r.fromOptional ? ' optional' : '';
    L.push(`| \`${r.from}\` → \`${r.to}\` | ${r.kind}${opt} | ${r.confidence} | ${r.evidence}${r.declaredFk ? '' : ' — **no declared FK**'} |`);
  }

  L.push('');
  L.push('## What this cannot see');
  L.push('');
  for (const lim of model.limits) L.push(`- ${lim}`);
  return L.join('\n');
}

module.exports = { toMermaid, toMarkdown, CARD };
