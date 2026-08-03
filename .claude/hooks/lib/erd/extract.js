// extract.js — derive the data model from code, and never pretend to be more sure than it is.
//
// AN ERD FROM SOURCE IS A CLAIM, AND CLAIMS COME AT FOUR CONFIDENCES:
//   certain    declared — a Prisma relation, a Django ForeignKey, a SQL REFERENCES clause
//   inferred   reconstructed from application-level joins the schema never declared
//   heuristic  a naming convention: `user_id` next to a `users` table
//   absent     schemaless stores, JSON columns, dynamic tables — invisible to static reading
//
// The whole design rests on never mixing them. An ERD that draws a naming guess with the
// same weight as a declared foreign key is exactly the "confident lie that looks like
// documentation" this project refuses elsewhere, and it is worse than no diagram because
// a diagram gets screenshotted into a design doc and outlives its caveats.
//
// So every entity, column and relationship carries its confidence and the file:line that
// produced it, the Mermaid export defaults to `certain` only, and the evidence table is
// emitted alongside the diagram rather than instead of it.

'use strict';

const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build',
  '.next', 'coverage', 'vendor', '.planning', '.rmad', 'site-packages']);

function walk(root, rel = '', out = []) {
  let entries;
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      // Must match code-graph.js's rule, INCLUDING the `.claude` exception. These two
      // walkers had diverged: this one skipped every dotted directory, so the ERD was
      // blind to anything under .claude/ and reported a single "entity" scraped from a
      // test fixture string while missing seventeen real CREATE TABLE statements. Two
      // implementations of "which files count" will drift again — see the review notes.
      if (SKIP_DIRS.has(e.name) || (e.name.startsWith('.') && e.name !== '.claude')) continue;
      walk(root, r, out);
    } else out.push(r);
  }
  return out;
}

const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;
const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/** Rails/Django/most ORMs pluralise table names; matching needs both forms. */
function nameVariants(s) {
  const base = snake(s);
  const v = new Set([base, s, s.toLowerCase()]);
  v.add(base.endsWith('s') ? base.slice(0, -1) : `${base}s`);
  if (base.endsWith('y')) v.add(`${base.slice(0, -1)}ies`);
  if (base.endsWith('ies')) v.add(`${base.slice(0, -3)}y`);
  return [...v];
}

// ─────────────────────────────────────────────────────────────────────────────

class Model {
  constructor() {
    this.entities = new Map();
    this.relationships = [];
    this.sources = new Set();
  }

  entity(name, { source, confidence, at, table }) {
    const key = name;
    if (!this.entities.has(key)) {
      this.entities.set(key, { name, table: table || snake(name), columns: [], source, confidence, at });
    }
    return this.entities.get(key);
  }

  column(entityName, col) {
    const e = this.entities.get(entityName);
    if (!e) return;
    if (!e.columns.some((c) => c.name === col.name)) e.columns.push(col);
  }

  relate(rel) {
    const dup = this.relationships.find((r) =>
      r.from === rel.from && r.to === rel.to && r.kind === rel.kind && r.label === rel.label);
    if (!dup) this.relationships.push(rel);
  }
}

// ─── Prisma — declarative and complete ──────────────────────────────────────

function fromPrisma(model, rel, src) {
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  for (let m; (m = modelRe.exec(src));) {
    const [, name, body] = m;
    const at = `${rel}:${lineOf(src, m.index)}`;
    model.sources.add('prisma');
    model.entity(name, { source: 'prisma', confidence: 'certain', at });

    for (const line of body.split('\n')) {
      const f = line.match(/^\s*(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/);
      if (!f) continue;
      const [, fname, ftype, isList, optional, attrs] = f;
      if (/^(@@|\/\/)/.test(line.trim())) continue;

      if (model.entities.has(ftype) || /^[A-Z]/.test(ftype)) {
        // A field whose type is another model IS the relationship.
        const relAttr = attrs.match(/@relation\(([^)]*)\)/);
        const fkFields = relAttr && relAttr[1].match(/fields:\s*\[([^\]]*)\]/);
        const hasFk = Boolean(fkFields);

        // Cardinality on the FK-holding side is N:1, not 1:1 — MANY posts point at one
        // user. It collapses to 1:1 only when the foreign key column itself is @unique,
        // which is exactly how Prisma expresses a one-to-one. Reading every scalar
        // relation as 1:1 silently turns every parent-child link into a pairing.
        let kind;
        if (isList) kind = '1:N';
        else if (hasFk) {
          const fkName = fkFields[1].split(',')[0].trim();
          const fkDecl = new RegExp(`^\\s*${fkName}\\s+\\S+[^\\n]*$`, 'm').exec(body);
          kind = fkDecl && /@unique\b/.test(fkDecl[0]) ? '1:1' : 'N:1';
        } else kind = '1:1';

        model.relate({
          from: name, to: ftype, kind,
          fromOptional: Boolean(optional), toOptional: false,
          label: fname, confidence: 'certain', evidence: `${rel}:${lineOf(src, m.index)}`,
          declaredFk: hasFk
        });
        continue;
      }
      model.column(name, {
        name: fname, type: ftype + (isList ? '[]' : ''),
        nullable: Boolean(optional),
        pk: /@id\b/.test(attrs), unique: /@unique\b/.test(attrs),
        confidence: 'certain', at: `${rel}:${lineOf(src, m.index)}`
      });
    }
  }
}

// ─── Django ─────────────────────────────────────────────────────────────────

function fromDjango(model, rel, src) {
  const classRe = /^class\s+(\w+)\s*\(\s*(?:[\w.]*\.)?(?:models\.)?Model\s*\)\s*:/gm;
  for (let m; (m = classRe.exec(src));) {
    const name = m[1];
    const start = m.index;
    const next = src.slice(start + 1).search(/^class\s/m);
    const body = next === -1 ? src.slice(start) : src.slice(start, start + 1 + next);
    const at = `${rel}:${lineOf(src, start)}`;
    model.sources.add('django');
    model.entity(name, { source: 'django', confidence: 'certain', at });

    const fieldRe = /^\s{4}(\w+)\s*=\s*models\.(\w+)\(([^\n]*)/gm;
    for (let f; (f = fieldRe.exec(body));) {
      const [, fname, ftype, fargs] = f;
      const fat = `${rel}:${lineOf(src, start + f.index)}`;
      if (/^(ForeignKey|OneToOneField|ManyToManyField)$/.test(ftype)) {
        const target = (fargs.match(/^\s*['"]?([\w.]+)['"]?/) || [])[1];
        if (!target) continue;
        const to = target.replace(/^.*\./, '').replace(/['"]/g, '');
        model.relate({
          from: name, to: to === 'self' ? name : to,
          kind: ftype === 'ManyToManyField' ? 'M:N' : ftype === 'OneToOneField' ? '1:1' : 'N:1',
          fromOptional: /null\s*=\s*True/.test(fargs), toOptional: false,
          label: fname, onDelete: (fargs.match(/on_delete\s*=\s*models\.(\w+)/) || [])[1] || null,
          confidence: 'certain', evidence: fat, declaredFk: true
        });
      } else {
        model.column(name, {
          name: fname, type: ftype,
          nullable: /null\s*=\s*True/.test(fargs),
          pk: /primary_key\s*=\s*True/.test(fargs),
          unique: /unique\s*=\s*True/.test(fargs),
          confidence: 'certain', at: fat
        });
      }
    }
  }
}

// ─── SQLAlchemy ─────────────────────────────────────────────────────────────

function fromSqlAlchemy(model, rel, src) {
  const classRe = /^class\s+(\w+)\s*\([^)]*\)\s*:/gm;
  for (let m; (m = classRe.exec(src));) {
    const name = m[1];
    const start = m.index;
    const next = src.slice(start + 1).search(/^class\s/m);
    const body = next === -1 ? src.slice(start) : src.slice(start, start + 1 + next);
    if (!/__tablename__|Column\s*\(|Mapped\[/.test(body)) continue;

    const at = `${rel}:${lineOf(src, start)}`;
    const table = (body.match(/__tablename__\s*=\s*['"]([^'"]+)['"]/) || [])[1];
    model.sources.add('sqlalchemy');
    model.entity(name, { source: 'sqlalchemy', confidence: 'certain', at, table });

    const colRe = /^\s{4}(\w+)\s*(?::\s*[^=]+)?=\s*(?:mapped_column|Column)\(([^\n]*)/gm;
    for (let c; (c = colRe.exec(body));) {
      const [, fname, cargs] = c;
      const cat = `${rel}:${lineOf(src, start + c.index)}`;
      const fk = cargs.match(/ForeignKey\(\s*['"]([\w.]+)['"]/);
      if (fk) {
        const target = fk[1].split('.')[0];
        model.relate({
          from: name, to: target, kind: /unique\s*=\s*True/.test(cargs) ? '1:1' : 'N:1',
          fromOptional: !/nullable\s*=\s*False/.test(cargs), toOptional: false,
          label: fname, confidence: 'certain', evidence: cat, declaredFk: true, targetIsTable: true
        });
      }
      model.column(name, {
        name: fname,
        type: (cargs.match(/^\s*(\w+)/) || [])[1] || 'unknown',
        nullable: !/nullable\s*=\s*False/.test(cargs) && !/primary_key\s*=\s*True/.test(cargs),
        pk: /primary_key\s*=\s*True/.test(cargs),
        unique: /unique\s*=\s*True/.test(cargs),
        confidence: 'certain', at: cat
      });
    }

    const relRe = /^\s{4}(\w+)\s*(?::\s*[^=]+)?=\s*relationship\(\s*['"]?(\w+)/gm;
    for (let r; (r = relRe.exec(body));) {
      model.relate({
        from: name, to: r[2],
        kind: /secondary\s*=/.test(body.slice(r.index, r.index + 200)) ? 'M:N' : '1:N',
        fromOptional: false, toOptional: true, label: r[1],
        confidence: 'certain', evidence: `${rel}:${lineOf(src, start + r.index)}`, declaredFk: false
      });
    }
  }
}

// ─── TypeORM / decorator ORMs ───────────────────────────────────────────────

function fromTypeOrm(model, rel, src) {
  const entityRe = /@Entity\([^)]*\)\s*(?:export\s+)?class\s+(\w+)/g;
  for (let m; (m = entityRe.exec(src));) {
    const name = m[1];
    const start = m.index;
    const next = src.slice(start + 1).search(/@Entity\(/);
    const body = next === -1 ? src.slice(start) : src.slice(start, start + 1 + next);
    const at = `${rel}:${lineOf(src, start)}`;
    model.sources.add('typeorm');
    model.entity(name, { source: 'typeorm', confidence: 'certain', at });

    const decRe = /@(Column|PrimaryGeneratedColumn|PrimaryColumn|ManyToOne|OneToMany|ManyToMany|OneToOne)\(([^)]*)\)[\s\S]{0,120}?(\w+)\s*[!?]?\s*:/g;
    for (let d; (d = decRe.exec(body));) {
      const [, dec, dargs, fname] = d;
      const dat = `${rel}:${lineOf(src, start + d.index)}`;
      if (/^(ManyToOne|OneToMany|ManyToMany|OneToOne)$/.test(dec)) {
        const target = (dargs.match(/=>\s*(\w+)/) || [])[1];
        if (!target) continue;
        model.relate({
          from: name, to: target,
          kind: dec === 'ManyToMany' ? 'M:N' : dec === 'OneToOne' ? '1:1' : dec === 'OneToMany' ? '1:N' : 'N:1',
          fromOptional: /nullable:\s*true/.test(dargs), toOptional: false,
          label: fname, confidence: 'certain', evidence: dat, declaredFk: true
        });
      } else {
        model.column(name, {
          name: fname, type: (dargs.match(/type:\s*['"](\w+)['"]/) || [])[1] || 'column',
          nullable: /nullable:\s*true/.test(dargs),
          pk: /Primary/.test(dec), unique: /unique:\s*true/.test(dargs),
          confidence: 'certain', at: dat
        });
      }
    }
  }
}

// ─── raw DDL ────────────────────────────────────────────────────────────────

function fromSql(model, rel, src) {
  const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`[]?([\w.]+)["'`\]]?\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
  for (let m; (m = tableRe.exec(src));) {
    const raw = m[1].replace(/^.*\./, '');
    const at = `${rel}:${lineOf(src, m.index)}`;
    model.sources.add('sql');
    model.entity(raw, { source: 'ddl', confidence: 'certain', at, table: raw });

    for (const line of m[2].split('\n')) {
      const t = line.trim().replace(/,$/, '');
      if (!t || /^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT|KEY|INDEX)\b/i.test(t)) {
        const fk = t.match(/FOREIGN\s+KEY\s*\(\s*["'`[]?(\w+)["'`\]]?\s*\)\s*REFERENCES\s+["'`[]?([\w.]+)["'`\]]?/i);
        if (fk) {
          model.relate({
            from: raw, to: fk[2].replace(/^.*\./, ''), kind: 'N:1',
            fromOptional: true, toOptional: false, label: fk[1],
            confidence: 'certain', evidence: at, declaredFk: true, targetIsTable: true
          });
        }
        continue;
      }
      const col = t.match(/^["'`[]?(\w+)["'`\]]?\s+([\w()]+)/);
      if (!col) continue;
      model.column(raw, {
        name: col[1], type: col[2],
        nullable: !/NOT\s+NULL/i.test(t), pk: /PRIMARY\s+KEY/i.test(t),
        unique: /UNIQUE/i.test(t), confidence: 'certain', at
      });
      const inline = t.match(/REFERENCES\s+["'`[]?([\w.]+)["'`\]]?/i);
      if (inline) {
        model.relate({
          from: raw, to: inline[1].replace(/^.*\./, ''), kind: 'N:1',
          fromOptional: !/NOT\s+NULL/i.test(t), toOptional: false, label: col[1],
          confidence: 'certain', evidence: at, declaredFk: true, targetIsTable: true
        });
      }
    }
  }
}

// ─── naming convention — the heuristic band ─────────────────────────────────

/**
 * `user_id` beside a `users` entity is probably a foreign key. Probably.
 *
 * This band exists because undeclared FKs are extremely common in real schemas, and
 * omitting them produces a diagram that is technically defensible and practically wrong.
 * It is separated, labelled, dashed in the diagram, and excluded from the default export —
 * a hypothesis presented as a hypothesis.
 */
function inferByNaming(model) {
  const byVariant = new Map();
  for (const e of model.entities.values()) {
    for (const v of nameVariants(e.table || e.name)) byVariant.set(v, e.name);
    for (const v of nameVariants(e.name)) byVariant.set(v, e.name);
  }

  for (const e of model.entities.values()) {
    for (const c of e.columns) {
      const m = c.name.match(/^(.+?)_?id$/i);
      if (!m || !m[1]) continue;
      const target = byVariant.get(snake(m[1])) || byVariant.get(m[1].toLowerCase());
      if (!target || target === e.name) continue;
      const declared = model.relationships.some((r) =>
        (r.from === e.name && r.to === target) || (r.to === e.name && r.from === target));
      if (declared) continue;
      model.relate({
        from: e.name, to: target,
        kind: c.unique ? '1:1' : 'N:1',
        fromOptional: c.nullable, toOptional: false,
        label: c.name, confidence: 'heuristic', evidence: c.at, declaredFk: false
      });
    }
  }
}

/** Resolve relationships that named a TABLE onto the entity that owns it. */
function normaliseTargets(model) {
  const byTable = new Map();
  for (const e of model.entities.values()) {
    byTable.set(e.table || snake(e.name), e.name);
    for (const v of nameVariants(e.name)) byTable.set(v, e.name);
  }
  for (const r of model.relationships) {
    if (model.entities.has(r.to)) continue;
    const hit = byTable.get(r.to) || byTable.get(snake(r.to));
    if (hit) r.to = hit;
  }
  // Drop relationships whose target never resolved: half an edge is not information.
  model.relationships = model.relationships.filter((r) =>
    model.entities.has(r.from) && model.entities.has(r.to));
}

// ─── driver ─────────────────────────────────────────────────────────────────

function derive(root, opts = {}) {
  const model = new Model();
  const scope = opts.scope ? String(opts.scope).replace(/\\/g, '/') : null;
  const files = walk(root).filter((f) => !scope || f.startsWith(scope));
  let scanned = 0;

  for (const rel of files) {
    const ext = path.extname(rel).toLowerCase();
    if (!['.prisma', '.py', '.ts', '.js', '.sql', '.rb'].includes(ext)) continue;
    let src;
    try {
      const stat = fs.statSync(path.join(root, rel));
      if (stat.size > 2 * 1024 * 1024) continue;
      src = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch { continue; }
    scanned++;

    if (ext === '.prisma') fromPrisma(model, rel, src);
    else if (ext === '.sql') fromSql(model, rel, src);
    else if (ext === '.py') {
      if (/models\.Model/.test(src)) fromDjango(model, rel, src);
      if (/Column\s*\(|mapped_column|__tablename__/.test(src)) fromSqlAlchemy(model, rel, src);
    } else if (ext === '.ts' || ext === '.js') {
      if (/@Entity\(/.test(src)) fromTypeOrm(model, rel, src);
      if (/CREATE\s+TABLE/i.test(src)) fromSql(model, rel, src);
    } else if (ext === '.rb') {
      if (/create_table/.test(src)) fromRailsSchema(model, rel, src);
    }
  }

  normaliseTargets(model);
  if (opts.inferNaming !== false) inferByNaming(model);
  normaliseTargets(model);

  const entities = [...model.entities.values()].sort((a, b) => a.name.localeCompare(b.name));
  const counts = { certain: 0, inferred: 0, heuristic: 0 };
  for (const r of model.relationships) counts[r.confidence] = (counts[r.confidence] || 0) + 1;

  return {
    entities,
    relationships: model.relationships.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    sources: [...model.sources],
    counts,
    scanned,
    // Said out loud in the artefact, because a diagram of the tables a static reader can
    // see is not the same as a diagram of the data model, and only one of those is what
    // a reader assumes they are looking at.
    limits: [
      'Schemaless stores, JSON/JSONB columns with implicit structure, and dynamically created tables are invisible to static reading.',
      'Relationships enforced only in application code appear as `heuristic` or not at all.',
      'Where migrations are the only source, the current shape is the fold of all of them — a snapshot file is preferred when one exists.'
    ]
  };
}

/** Rails schema.rb — a snapshot, so preferred over replaying migrations. */
function fromRailsSchema(model, rel, src) {
  const tRe = /create_table\s+["':]([\w]+)["']?[^\n]*do\s*\|t\|([\s\S]*?)\n\s*end/g;
  for (let m; (m = tRe.exec(src));) {
    const table = m[1];
    const at = `${rel}:${lineOf(src, m.index)}`;
    model.sources.add('rails');
    model.entity(table, { source: 'rails', confidence: 'certain', at, table });
    for (const line of m[2].split('\n')) {
      const c = line.match(/t\.(\w+)\s+["':]([\w]+)["']?(.*)$/);
      if (!c) continue;
      if (c[1] === 'references' || c[1] === 'belongs_to') {
        model.relate({
          from: table, to: c[2], kind: 'N:1', fromOptional: !/null:\s*false/.test(c[3]),
          toOptional: false, label: `${c[2]}_id`, confidence: 'certain', evidence: at,
          declaredFk: true, targetIsTable: true
        });
        continue;
      }
      model.column(table, {
        name: c[2], type: c[1], nullable: !/null:\s*false/.test(c[3]),
        pk: false, unique: /unique:\s*true/.test(c[3]), confidence: 'certain', at
      });
    }
  }
}

module.exports = { derive, nameVariants, snake };
