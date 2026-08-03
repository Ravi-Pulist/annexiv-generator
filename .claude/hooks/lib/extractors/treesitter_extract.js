#!/usr/bin/env node
// treesitter_extract.js — real-parser symbol extraction for the RMAD code graph.
//
// Reads {root, files:[{rel,lang}], grammarDir} as JSON on stdin, writes one JSON
// document per file to stdout. Invoked by extractors/treesitter.js, exactly the way
// python_ast.py is invoked by extractors/python.js — same contract, same batching, same
// honest failure mode.
//
// WHY A CHILD PROCESS AND NOT AN IMPORT: web-tree-sitter initialises asynchronously and
// buildGraph() is synchronous, called from hooks and a CLI that must stay fast to start.
// Isolating it in a child keeps the optional dependency genuinely optional — if
// web-tree-sitter or the grammars are missing, this exits non-zero and the caller falls
// back to the heuristic scanner instead of the whole index failing.
//
// WHY IT REPLACES A REGEX SCANNER: the old JS/TS path mis-read multi-line signatures,
// generics, JSX and `function` inside template literals, and it silently emitted NO
// call receivers and NO constructor bindings. Those two fields are what the resolver
// uses to decide whether `x.get()` is your method or a dict lookup — without them every
// JS call edge was either a guess or a refusal. Parsing exactly is not cosmetic here;
// it is the difference between a call graph and a rumour.
//
// FIDELITY MEANS THE PARSE, NOT THE COVERAGE. Every symbol emitted here is labelled
// `ast` because tree-sitter parsed it exactly. How much of a language this file knows
// how to WALK varies — JS/TS is thorough, the others cover the common shapes. That is a
// coverage limit, not an accuracy one: what is emitted is right, and what is missed is
// simply absent rather than wrong.

'use strict';

const fs = require('fs');
const path = require('path');

// ─── language configuration ─────────────────────────────────────────────────
//
// A node-type table rather than per-language .scm query files. tree-sitter grammars name
// the constructs we care about consistently enough that one walker plus a small table
// covers eight languages; eight sets of query files would be eight things to keep in
// sync with the graph schema.

const LANGS = {
  javascript: {
    wasm: 'tree-sitter-javascript.wasm',
    classes: ['class_declaration', 'class'],
    functions: ['function_declaration', 'generator_function_declaration'],
    methods: ['method_definition'],
    lambdas: ['arrow_function', 'function_expression'],
    params: ['formal_parameters'],
    decision: ['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement',
      'switch_case', 'catch_clause', 'ternary_expression', 'binary_expression'],
    comment: 'comment'
  },
  typescript: {
    wasm: 'tree-sitter-typescript.wasm',
    classes: ['class_declaration', 'abstract_class_declaration', 'class'],
    functions: ['function_declaration', 'generator_function_declaration', 'function_signature'],
    methods: ['method_definition', 'method_signature', 'abstract_method_signature'],
    lambdas: ['arrow_function', 'function_expression'],
    interfaces: ['interface_declaration'],
    params: ['formal_parameters'],
    decision: ['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement',
      'switch_case', 'catch_clause', 'ternary_expression', 'binary_expression'],
    comment: 'comment'
  },
  tsx: { extends: 'typescript', wasm: 'tree-sitter-tsx.wasm' },
  python: {
    wasm: 'tree-sitter-python.wasm',
    classes: ['class_definition'],
    functions: ['function_definition'],
    params: ['parameters'],
    decision: ['if_statement', 'for_statement', 'while_statement', 'except_clause',
      'conditional_expression', 'boolean_operator'],
    comment: 'comment'
  },
  go: {
    wasm: 'tree-sitter-go.wasm',
    classes: ['type_declaration'],
    functions: ['function_declaration'],
    methods: ['method_declaration'],
    params: ['parameter_list'],
    decision: ['if_statement', 'for_statement', 'expression_switch_statement', 'type_switch_statement',
      'select_statement', 'binary_expression'],
    comment: 'comment'
  },
  java: {
    wasm: 'tree-sitter-java.wasm',
    classes: ['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration'],
    methods: ['method_declaration', 'constructor_declaration'],
    params: ['formal_parameters'],
    decision: ['if_statement', 'for_statement', 'enhanced_for_statement', 'while_statement',
      'do_statement', 'switch_label', 'catch_clause', 'ternary_expression', 'binary_expression'],
    comment: ['line_comment', 'block_comment', 'comment']
  },
  ruby: {
    wasm: 'tree-sitter-ruby.wasm',
    classes: ['class', 'module'],
    functions: ['method', 'singleton_method'],
    params: ['method_parameters', 'parameters'],
    decision: ['if', 'unless', 'while', 'until', 'for', 'when', 'rescue', 'conditional'],
    comment: 'comment'
  },
  rust: {
    wasm: 'tree-sitter-rust.wasm',
    classes: ['struct_item', 'enum_item', 'trait_item', 'impl_item'],
    functions: ['function_item'],
    params: ['parameters'],
    decision: ['if_expression', 'for_expression', 'while_expression', 'loop_expression',
      'match_arm', 'binary_expression'],
    comment: ['line_comment', 'block_comment', 'comment']
  },
  csharp: {
    wasm: 'tree-sitter-c_sharp.wasm',
    classes: ['class_declaration', 'interface_declaration', 'struct_declaration', 'record_declaration'],
    methods: ['method_declaration', 'constructor_declaration'],
    params: ['parameter_list'],
    decision: ['if_statement', 'for_statement', 'foreach_statement', 'while_statement', 'do_statement',
      'switch_section', 'catch_clause', 'conditional_expression', 'binary_expression'],
    comment: 'comment'
  }
};

function langConfig(name) {
  const cfg = LANGS[name];
  if (!cfg) return null;
  if (cfg.extends) return { ...LANGS[cfg.extends], ...cfg };
  return cfg;
}

// ─── small helpers ──────────────────────────────────────────────────────────

const has = (list, type) => Array.isArray(list) && list.includes(type);
const txt = (n) => (n ? n.text : null);

function isComment(cfg, type) {
  const c = cfg.comment;
  return Array.isArray(c) ? c.includes(type) : c === type;
}

/** Strip comment syntax so a docstring reads as prose, matching the Python extractor. */
function cleanDoc(raw) {
  if (!raw) return null;
  const s = raw
    .replace(/^\/\*\*?/, '').replace(/\*\/$/, '')
    .replace(/^\s*\*\s?/gm, '')
    .replace(/^\/\/\s?/gm, '')
    .replace(/^#\s?/gm, '')
    .trim();
  return s || null;
}

/**
 * A JSDoc / // block immediately above a declaration is its documentation.
 *
 * It has to climb wrapper nodes first. In `/** ... *\/ export function pay() {}` the
 * comment is the previous sibling of the EXPORT STATEMENT, not of the function inside it —
 * so looking only at the function's own siblings finds nothing and silently drops the
 * docstring of essentially every exported symbol. That matters well beyond tidiness:
 * docstrings are where a searcher's words actually live, so losing them quietly guts
 * lexical and semantic recall while the index still looks complete.
 */
function leadingDoc(cfg, node) {
  let anchor = node;
  while (anchor.parent && /^(export_statement|export|decorated_definition|labeled_statement)$/.test(anchor.parent.type)) {
    anchor = anchor.parent;
  }
  // A variable declarator sits inside a declaration inside (maybe) an export.
  while (anchor.parent && /^(variable_declaration|lexical_declaration)$/.test(anchor.parent.type)) {
    anchor = anchor.parent;
    while (anchor.parent && /^(export_statement|export)$/.test(anchor.parent.type)) anchor = anchor.parent;
  }

  let prev = anchor.previousNamedSibling;
  // Decorators sit between the comment and the declaration; skip back over them.
  while (prev && /decorator|annotation|attribute/.test(prev.type)) prev = prev.previousNamedSibling;

  if (prev && isComment(cfg, prev.type) && prev.endPosition.row >= anchor.startPosition.row - 2) {
    return cleanDoc(prev.text);
  }
  return null;
}

/** Python-style docstring: first statement of a body is a bare string. */
function pyDocstring(node) {
  const body = node.childForFieldName('body');
  if (!body || !body.namedChild(0)) return null;
  const first = body.namedChild(0);
  const expr = first.type === 'expression_statement' ? first.namedChild(0) : null;
  if (expr && expr.type === 'string') {
    return cleanDoc(expr.text.replace(/^[rbuf]*("""|'''|"|')/, '').replace(/("""|'''|"|')$/, ''));
  }
  return null;
}

function complexityOf(cfg, node) {
  let n = 1;
  const walk = (x) => {
    if (has(cfg.decision, x.type)) {
      // `a && b` is a branch; `a + b` is not. Only count boolean operators.
      if (x.type === 'binary_expression' || x.type === 'boolean_operator') {
        const op = x.childForFieldName('operator');
        const o = op ? op.text : '';
        if (o === '&&' || o === '||' || o === 'and' || o === 'or' || o === '??') n++;
      } else n++;
    }
    for (let i = 0; i < x.namedChildCount; i++) walk(x.namedChild(i));
  };
  walk(node);
  return n;
}

// ─── parameters ─────────────────────────────────────────────────────────────

function paramsOf(cfg, node) {
  let plist = node.childForFieldName('parameters');
  if (!plist) {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (has(cfg.params, node.namedChild(i).type)) { plist = node.namedChild(i); break; }
    }
  }
  if (!plist) return [];
  const out = [];
  for (let i = 0; i < plist.namedChildCount; i++) {
    const p = plist.namedChild(i);
    if (isComment(cfg, p.type)) continue;
    out.push(shapeParam(p));
  }
  return out.filter((p) => p.name);
}

function shapeParam(p) {
  const t = p.type;
  let kind = 'positional';
  let name = null, annotation = null, dflt = null;

  // Explicit field access first — grammars expose name/type/value where they exist, and
  // reading fields beats pattern-matching text that varies with formatting.
  const nameNode = p.childForFieldName('name') || p.childForFieldName('pattern');
  const typeNode = p.childForFieldName('type');
  const valNode = p.childForFieldName('value') || p.childForFieldName('default_value');

  if (nameNode) name = nameNode.text;
  if (typeNode) annotation = typeNode.text.replace(/^:\s*/, '');
  if (valNode) dflt = valNode.text;

  // `...rest: string[]` parses as a required_parameter whose PATTERN is a rest_pattern,
  // so the type check below never sees it and the name arrives with its dots attached.
  // Both the marker and the name have to come off the pattern node itself.
  if (nameNode && /rest_pattern|spread/.test(nameNode.type)) kind = 'rest';
  if (name && /^(\.{3}|\*{1,2})/.test(name)) {
    kind = name.startsWith('**') ? 'keyword-only' : 'rest';
    name = name.replace(/^(\.{3}|\*{1,2})/, '');
  }

  if (/rest_pattern|rest_parameter|variadic|spread/.test(t)) kind = 'rest';
  else if (/dictionary_splat|keyword/.test(t)) kind = 'keyword-only';
  else if (/optional/.test(t)) kind = 'optional';

  if (!name) {
    // Fall back to the raw text: `...rest: T[]`, `a = 1`, `self`.
    const raw = p.text.trim();
    if (raw.startsWith('...') || raw.startsWith('*')) kind = raw.startsWith('**') ? 'keyword-only' : 'rest';
    const m = raw.replace(/^\.{3}|^\*{1,2}/, '').match(/^([A-Za-z_$][\w$]*)/);
    if (m) name = m[1];
    const eq = raw.indexOf('=');
    if (eq !== -1 && !dflt) dflt = raw.slice(eq + 1).trim();
    const colon = raw.indexOf(':');
    if (colon !== -1 && !annotation) {
      annotation = raw.slice(colon + 1, eq === -1 ? undefined : eq).trim() || null;
    }
  }
  if (dflt) dflt = String(dflt).replace(/^=\s*/, '');
  return { name, annotation: annotation || null, default: dflt || null, kind };
}

// ─── calls, with the receiver the resolver needs ────────────────────────────
//
// `payload.get(...)` must record receiver `payload`, not just the name `get`. The
// resolver refuses to link an attribute call whose receiver it cannot type — that
// refusal is what stopped 532 fabricated callers collapsing onto one method — and it
// can only refuse intelligently if the receiver is present. The old regex scanner
// emitted none, so every JS `.foo()` was unresolvable on principle.

function callsIn(node, out) {
  const walk = (x) => {
    if (x.type === 'call_expression' || x.type === 'call' || x.type === 'method_invocation' ||
        x.type === 'invocation_expression') {
      const fn = x.childForFieldName('function') || x.childForFieldName('name');
      const objField = x.childForFieldName('object');
      if (fn) {
        const raw = fn.text;
        let receiver = null;
        let name = raw;
        const prop = fn.childForFieldName('property') || fn.childForFieldName('field');
        const obj = fn.childForFieldName('object') || fn.childForFieldName('operand') || objField;
        if (prop) { name = prop.text; receiver = obj ? obj.text : null; }
        else if (raw.includes('.')) {
          const parts = raw.split('.');
          name = parts.pop();
          receiver = parts.join('.');
        }
        out.push({ callee: raw, name, receiver, line: x.startPosition.row + 1 });
      } else if (objField) {
        // Java-style: object.method(args) with a `name` field.
        const nm = x.childForFieldName('name');
        if (nm) out.push({ callee: `${objField.text}.${nm.text}`, name: nm.text, receiver: objField.text, line: x.startPosition.row + 1 });
      }
    }
    // `new Foo()` is a reference to Foo — without it, every class constructed but never
    // called by name looks dead.
    if (x.type === 'new_expression' || x.type === 'object_creation_expression') {
      const c = x.childForFieldName('constructor') || x.childForFieldName('type');
      if (c) out.push({ callee: c.text, name: c.text.split('.').pop(), receiver: null, line: x.startPosition.row + 1 });
    }
    for (let i = 0; i < x.namedChildCount; i++) walk(x.namedChild(i));
  };
  walk(node);
  return out;
}

// ─── constructor bindings ───────────────────────────────────────────────────
//
// `const svc = new Client()` at module scope, then `svc.get()` in nine other files.
// Without the binding the resolver cannot type `svc`, and Client's methods look dead.

function bindingsIn(node, scope, out) {
  const walk = (x) => {
    if (x.type === 'variable_declarator' || x.type === 'assignment' || x.type === 'assignment_expression') {
      const nameNode = x.childForFieldName('name') || x.childForFieldName('left');
      const valNode = x.childForFieldName('value') || x.childForFieldName('right');
      if (nameNode && valNode && /^[A-Za-z_$][\w$]*$/.test(nameNode.text)) {
        let ctor = null;
        if (valNode.type === 'new_expression' || valNode.type === 'object_creation_expression') {
          const c = valNode.childForFieldName('constructor') || valNode.childForFieldName('type');
          if (c) ctor = c.text;
        } else if (valNode.type === 'call_expression' || valNode.type === 'call') {
          const f = valNode.childForFieldName('function');
          // Python has no `new`: `svc = Client()` is a construction if the callee is
          // capitalised. A heuristic, and confined to naming — never to linking.
          if (f && /^[A-Z][\w$]*$/.test(f.text)) ctor = f.text;
        }
        if (ctor) out.push({ scope, var: nameNode.text, type: ctor.split('.').pop() });
      }
    }
    for (let i = 0; i < x.namedChildCount; i++) walk(x.namedChild(i));
  };
  walk(node);
  return out;
}

// ─── routes ─────────────────────────────────────────────────────────────────

const HTTP = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all']);

function routesIn(node) {
  const out = [];
  const walk = (x) => {
    if (x.type === 'call_expression' || x.type === 'call') {
      const fn = x.childForFieldName('function');
      if (fn) {
        const prop = fn.childForFieldName('property');
        const obj = fn.childForFieldName('object');
        const method = prop ? prop.text : null;
        const recv = obj ? obj.text : null;
        if (method && HTTP.has(method.toLowerCase()) && recv && /^(app|router|server|api|r)$/i.test(recv)) {
          const args = x.childForFieldName('arguments');
          const first = args && args.namedChild(0);
          if (first && (first.type === 'string' || first.type === 'template_string')) {
            const p = first.text.replace(/^['"`]|['"`]$/g, '');
            out.push({ method: method.toUpperCase(), path: p, line: x.startPosition.row + 1 });
          }
        }
      }
    }
    for (let i = 0; i < x.namedChildCount; i++) walk(x.namedChild(i));
  };
  walk(node);
  return out;
}

/** Decorator-style routes: @Get('/x') in Nest, @app.route('/x') in Flask. */
function decoratorRoute(decorators) {
  for (const d of decorators) {
    const s = String(d);

    // Flask / FastAPI / Nest: @app.get("/x"), @router.post("/x"), @Get("/x")
    const m = s.match(/^@?(?:\w+\.)?(get|post|put|patch|delete|route|head|options)\s*\(\s*['"]([^'"]+)['"]/i);
    if (m) return { method: m[1].toLowerCase() === 'route' ? 'GET' : m[1].toUpperCase(), path: m[2] };

    // Spring: @GetMapping("/x"), @PostMapping(value = "/x"), @RequestMapping("/x").
    // Without this the annotations are extracted but no route is, so a Spring controller
    // still reports zero endpoints — and endpoints are the attack surface `index routes`
    // exists to enumerate.
    const spring = s.match(/^@(Get|Post|Put|Patch|Delete|Request)Mapping\s*\(([^)]*)\)/i);
    if (spring) {
      const pathMatch = spring[2].match(/(?:value\s*=\s*)?['"]([^'"]+)['"]/);
      if (pathMatch) {
        const verb = spring[1].toLowerCase() === 'request' ? 'GET' : spring[1].toUpperCase();
        return { method: verb, path: pathMatch[1] };
      }
    }
  }
  return null;
}

function decoratorsOf(node) {
  const out = [];
  let prev = node.previousNamedSibling;
  while (prev && /decorator|attribute|annotation|marker_annotation/.test(prev.type)) {
    out.unshift(prev.text.trim());
    prev = prev.previousNamedSibling;
  }
  // Some grammars nest decorators as children instead of siblings.
  for (let i = 0; i < node.namedChildCount; i++) {
    const c = node.namedChild(i);
    if (/^(decorator|annotation|marker_annotation|attribute_list)$/.test(c.type)) out.push(c.text.trim());
    // Java (and Kotlin) put annotations inside a `modifiers` node, so neither the sibling
    // walk nor the direct-child check above ever reached them. The consequence was not
    // cosmetic: `@RestController` and `@GetMapping("/x")` both extracted with
    // `decorators: []` and `route: null`, so `routes()` reported zero routes for a Spring
    // controller and `orphans()` — whose whole guard is "decorated means DI/route/registry,
    // never call it dead" — listed both the controller and its handlers as dead code.
    if (c.type === 'modifiers') {
      for (let j = 0; j < c.namedChildCount; j++) {
        const m = c.namedChild(j);
        if (/annotation/.test(m.type)) out.push(m.text.trim());
      }
    }
  }
  return out;
}

// ─── imports ────────────────────────────────────────────────────────────────

function importsIn(node, lang) {
  const out = [];
  const walk = (x) => {
    // ES modules / TS
    if (x.type === 'import_statement' || x.type === 'import_from_statement' || x.type === 'import_declaration') {
      const src = x.childForFieldName('source') || x.childForFieldName('module_name') || x.childForFieldName('name');
      const mod = src ? src.text.replace(/^['"`]|['"`]$/g, '') : null;
      if (mod) {
        const names = [];
        for (let i = 0; i < x.namedChildCount; i++) {
          const c = x.namedChild(i);
          if (/import_clause|named_imports|dotted_name|aliased_import|import_specifier/.test(c.type)) {
            for (const id of c.text.replace(/[{}]/g, '').split(',')) {
              const n = id.trim().split(/\s+as\s+/);
              if (n[0] && n[0] !== mod) names.push({ name: n[0].trim(), alias: (n[1] || '').trim() || null });
            }
          }
        }
        // The two resolvers want the module string in different shapes, and getting this
        // wrong silently turns every relative import into an unresolved external one:
        //   python — leading dots stripped, `relative` = how many there were
        //   js/ts  — the specifier INTACT (`./other`), because resolveJsImport joins it
        //            onto the importing file's directory
        const dots = mod.startsWith('.') ? (mod.match(/^\.+/) || [''])[0].length : 0;
        const relative = lang === 'python' ? dots : (dots ? 1 : 0);
        const spec = lang === 'python' ? mod.replace(/^\.+/, '') : mod;
        if (!names.length) out.push({ module: spec, name: null, alias: null, line: x.startPosition.row + 1, relative });
        for (const n of names) out.push({ module: spec, name: n.name, alias: n.alias, line: x.startPosition.row + 1, relative });
      }
    }
    // CommonJS
    if (x.type === 'variable_declarator') {
      const v = x.childForFieldName('value');
      if (v && (v.type === 'call_expression') ) {
        const f = v.childForFieldName('function');
        if (f && f.text === 'require') {
          const a = v.childForFieldName('arguments');
          const s = a && a.namedChild(0);
          if (s && s.type === 'string') {
            const mod = s.text.replace(/^['"`]|['"`]$/g, '');
            const nm = x.childForFieldName('name');
            out.push({ module: mod, name: nm ? nm.text.replace(/[{}\s]/g, '') : null, alias: null,
              line: x.startPosition.row + 1, relative: mod.startsWith('.') ? 1 : 0 });
          }
        }
      }
    }
    // Go / Java / Rust / C#
    if (x.type === 'import_spec' || x.type === 'package_import' || x.type === 'using_directive' || x.type === 'use_declaration') {
      const t = x.text.replace(/^(import|using|use)\s+/, '').replace(/[;"']/g, '').trim();
      if (t) out.push({ module: t, name: null, alias: null, line: x.startPosition.row + 1, relative: 0 });
    }
    for (let i = 0; i < x.namedChildCount; i++) walk(x.namedChild(i));
  };
  walk(node);
  return out;
}

// ─── the walk ───────────────────────────────────────────────────────────────

function extractDoc(cfg, lang, relPath, src, tree) {
  const root = tree.rootNode;
  const symbols = [];
  const bindings = [];
  const moduleCalls = [];
  const claimed = []; // line ranges owned by a symbol, so module_calls excludes them

  const nameOf = (n) => {
    const f = n.childForFieldName('name');
    if (f) return f.text;
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i);
      if (/identifier|type_identifier|property_identifier|constant/.test(c.type)) return c.text;
    }
    return null;
  };

  const basesOf = (n) => {
    const out = [];
    const h = n.childForFieldName('superclass') || n.childForFieldName('interfaces') ||
              n.childForFieldName('superclasses') || n.childForFieldName('trait');
    if (h) {
      for (const b of h.text.replace(/^(extends|implements|:|\()\s*/, '').replace(/\)$/, '').split(',')) {
        const t = b.trim();
        if (t && t !== 'object') out.push(t);
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i);
      if (/class_heritage|superclass|base_class_clause|extends_clause/.test(c.type)) {
        for (const b of c.text.replace(/^(extends|implements|:)\s*/, '').split(',')) {
          const t = b.trim(); if (t) out.push(t);
        }
      }
    }
    return [...new Set(out)];
  };

  const isExported = (n) => {
    const p = n.parent;
    if (p && /export_statement|export/.test(p.type)) return true;
    return /\b(export|public|pub)\b/.test((n.text || '').slice(0, 40));
  };

  const mkSymbol = (n, kind, name, qualname) => {
    const start = n.startPosition.row + 1;
    const end = n.endPosition.row + 1;
    const decorators = decoratorsOf(n);
    const returns = (() => {
      const r = n.childForFieldName('return_type') || n.childForFieldName('result') || n.childForFieldName('type');
      return r ? r.text.replace(/^[:\->\s]+/, '').trim() || null : null;
    })();
    const calls = [];
    const body = n.childForFieldName('body') || n;
    callsIn(body, calls);
    claimed.push([start, end]);
    bindingsIn(body, qualname.includes('.') ? qualname.split('.')[0] : 'module', bindings);
    return {
      kind, name, qualname, line: start, end_line: end, loc: end - start + 1,
      args: kind === 'class' ? null : paramsOf(cfg, n),
      returns: kind === 'class' ? null : returns,
      decorators, bases: kind === 'class' ? basesOf(n) : [],
      route: decoratorRoute(decorators),
      doc: (lang === 'python' ? pyDocstring(n) : null) || leadingDoc(cfg, n),
      complexity: kind === 'class' ? null : complexityOf(cfg, n),
      is_async: /\basync\b/.test(n.text.slice(0, 30)),
      exported: isExported(n),
      calls
    };
  };

  const walk = (n, enclosingClass) => {
    const t = n.type;

    if (has(cfg.classes, t)) {
      const name = nameOf(n);
      if (name) {
        symbols.push(mkSymbol(n, 'class', name, name));
        for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), name);
        return;
      }
    }
    if (has(cfg.methods, t) || (enclosingClass && has(cfg.functions, t))) {
      const name = nameOf(n);
      if (name) {
        // Methods MUST be `Class.method`: the resolver derives a symbol's class by
        // splitting qualname on '.', and same-class resolution depends on it.
        symbols.push(mkSymbol(n, 'method', name, enclosingClass ? `${enclosingClass}.${name}` : name));
        return;
      }
    }
    if (has(cfg.functions, t)) {
      const name = nameOf(n);
      if (name) { symbols.push(mkSymbol(n, 'function', name, name)); return; }
    }
    // `const handler = async (req, res) => {}` — a function by any other name.
    if (t === 'variable_declarator') {
      const v = n.childForFieldName('value');
      const nm = n.childForFieldName('name');
      if (v && nm && has(cfg.lambdas, v.type) && /^[A-Za-z_$][\w$]*$/.test(nm.text)) {
        const sym = mkSymbol(v, 'function', nm.text, nm.text);
        sym.line = n.startPosition.row + 1;
        sym.doc = leadingDoc(cfg, n.parent && n.parent.parent ? n.parent.parent : n);
        symbols.push(sym);
        return;
      }
    }

    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), enclosingClass);
  };

  walk(root, null);

  // Express-style routes are calls, not declarations — emit them as route symbols the
  // way the heuristic scanner did, so `index routes` keeps working across the migration.
  for (const r of routesIn(root)) {
    const nm = `${r.method} ${r.path}`;
    symbols.push({
      kind: 'route', name: nm, qualname: nm, line: r.line, end_line: r.line, loc: 1,
      args: null, returns: null, decorators: [], bases: [],
      route: { method: r.method, path: r.path }, doc: null, complexity: null,
      is_async: false, exported: false, calls: []
    });
  }

  // Module-scope calls: `svc = Client()` at import time is a real reference. Excluding
  // them made every module-level singleton look dead.
  const allCalls = callsIn(root, []);
  const inSymbol = (line) => claimed.some(([a, b]) => line >= a && line <= b);
  for (const c of allCalls) if (!inSymbol(c.line)) moduleCalls.push(c);
  bindingsIn(root, 'module', bindings);

  const dedupBindings = [];
  const seenB = new Set();
  for (const b of bindings) {
    const k = `${b.scope}::${b.var}`;
    if (seenB.has(k)) continue;
    seenB.add(k);
    dedupBindings.push(b);
  }

  return {
    path: relPath,
    language: lang === 'tsx' ? 'typescript' : lang,
    fidelity: 'ast',
    loc: src.split('\n').length,
    doc: cleanDoc(root.namedChild(0) && isComment(cfg, root.namedChild(0).type) ? root.namedChild(0).text : null) ||
         (lang === 'python' ? pyDocstring({ childForFieldName: () => root }) : null),
    imports: importsIn(root, lang),
    symbols,
    module_calls: moduleCalls,
    bindings: dedupBindings,
    error: null
  };
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { root, files, grammarDir } = JSON.parse(input);

  let TS;
  try {
    TS = require('web-tree-sitter');
  } catch (err) {
    process.stderr.write(`web-tree-sitter not installed: ${err.message}`);
    process.exit(3);
  }

  const Parser = TS.Parser || TS;
  const Language = TS.Language || Parser.Language;
  await Parser.init();

  const cache = new Map();
  async function parserFor(lang) {
    if (cache.has(lang)) return cache.get(lang);
    const cfg = langConfig(lang);
    if (!cfg) { cache.set(lang, null); return null; }
    const wasmPath = path.join(grammarDir, cfg.wasm);
    if (!fs.existsSync(wasmPath)) { cache.set(lang, null); return null; }
    try {
      const language = await Language.load(wasmPath);
      const p = new Parser();
      p.setLanguage(language);
      cache.set(lang, { parser: p, cfg });
      return cache.get(lang);
    } catch (err) {
      process.stderr.write(`grammar ${cfg.wasm} failed: ${err.message}\n`);
      cache.set(lang, null);
      return null;
    }
  }

  const out = [];
  for (const f of files) {
    const abs = path.join(root, f.rel);
    let src;
    try {
      src = fs.readFileSync(abs, 'utf8');
    } catch (err) {
      out.push({ path: f.rel, language: f.lang, fidelity: 'unavailable', symbols: [], imports: [], error: err.message });
      continue;
    }
    const ready = await parserFor(f.lang);
    if (!ready) {
      // No grammar for this language: say so rather than emitting a guess. The caller
      // falls back to the heuristic scanner where one exists.
      out.push({ path: f.rel, language: f.lang, fidelity: 'unavailable', symbols: [], imports: [],
        error: `no tree-sitter grammar available for ${f.lang}` });
      continue;
    }
    try {
      const tree = ready.parser.parse(src);
      out.push(extractDoc(ready.cfg, f.lang, f.rel, src, tree));
      tree.delete && tree.delete();
    } catch (err) {
      out.push({ path: f.rel, language: f.lang, fidelity: 'unavailable', symbols: [], imports: [],
        error: `tree-sitter parse failed: ${err.message}` });
    }
  }

  process.stdout.write(JSON.stringify(out));
}

// This file is an executable entry point that happens to live in a library directory.
// Without this guard, `require()`ing it RUNS main(), which blocks on `for await (const
// chunk of process.stdin)` — and if stdin never closes, forever. A `node -e "require(...)"`
// invocation was found alive 99 minutes at 0.00 CPU holding its parent shell open.
//
// The production caller (treesitter.js) spawns this as a child with stdin written and
// closed, which is why 677 tests pass and this never surfaced. It only bites tooling that
// imports the module — coverage, linting, a parse check.
if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(String(err && err.stack || err));
    process.exit(1);
  });
}

module.exports = { extractDoc };
