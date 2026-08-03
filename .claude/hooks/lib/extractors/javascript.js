// javascript.js — heuristic symbol extraction for JS/TS.
//
// FIDELITY WARNING, stated in the data and not just here: Node ships no exposed parser
// and RMAD has zero dependencies, so this is a scanner, not a parser. It mis-reads
// `def`-like tokens inside template literals, deeply nested closures, and clever
// metaprogramming. Every node it emits carries `fidelity: "heuristic"` so consumers can
// weigh it accordingly — Python gets `fidelity: "ast"` from a real parser.
//
// This is the honest position: an approximate graph that admits it is approximate is
// useful; one that pretends to be exact produces confident advice about code that
// doesn't exist. If JS fidelity ever matters as much as Python's, the fix is a real
// parser (tree-sitter/acorn), not a longer regex.

const crypto = require('crypto');

const STRIP_BLOCK = /\/\*[\s\S]*?\*\//g;
const STRIP_LINE = /(^|[^:])\/\/.*$/gm;

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

function endLineOfBlock(src, openIdx) {
  // Walk braces from the first { after openIdx. Good enough for well-formed code.
  const start = src.indexOf('{', openIdx);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return lineOf(src, i);
    }
  }
  return null;
}

function parseParams(raw) {
  if (!raw || !raw.trim()) return [];
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of raw) {
    if ('([{<'.includes(ch)) depth++;
    if (')]}>'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => {
    const s = p.trim();
    const eq = s.indexOf('=');
    const decl = eq === -1 ? s : s.slice(0, eq);
    const def = eq === -1 ? null : s.slice(eq + 1).trim();
    const colon = decl.indexOf(':');
    const name = (colon === -1 ? decl : decl.slice(0, colon)).trim().replace(/^\.\.\./, '');
    const annotation = colon === -1 ? null : decl.slice(colon + 1).trim();
    return {
      name,
      annotation,
      default: def,
      kind: s.startsWith('...') ? 'rest' : 'positional'
    };
  }).filter((p) => p.name);
}

function complexityOf(body) {
  const m = body.match(/\b(if|for|while|case|catch|&&|\|\||\?\.|\?)\b|\?\?/g);
  return 1 + (m ? m.length : 0);
}

function extract(path, src) {
  const hash = crypto.createHash('sha1').update(src).digest('hex');
  const clean = src.replace(STRIP_BLOCK, (m) => m.replace(/[^\n]/g, ' ')).replace(STRIP_LINE, '$1');
  const symbols = [];
  const imports = [];

  // ── imports ──
  const importRe = /^\s*import\s+(?:([\w*{}\s,]+)\s+from\s+)?['"]([^'"]+)['"]/gm;
  for (let m; (m = importRe.exec(clean));) {
    imports.push({ module: m[2], name: (m[1] || '').trim() || null, line: lineOf(clean, m.index), relative: m[2].startsWith('.') ? 1 : 0 });
  }
  const requireRe = /(?:const|let|var)\s+([\w{}\s,:]+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (let m; (m = requireRe.exec(clean));) {
    imports.push({ module: m[2], name: m[1].trim(), line: lineOf(clean, m.index), relative: m[2].startsWith('.') ? 1 : 0 });
  }

  // ── classes ──
  const classRe = /^\s*(export\s+)?(?:default\s+)?class\s+(\w+)(?:\s+extends\s+([\w.]+))?/gm;
  for (let m; (m = classRe.exec(clean));) {
    const line = lineOf(clean, m.index);
    symbols.push({
      kind: 'class', name: m[2], qualname: m[2], line,
      end_line: endLineOfBlock(clean, m.index) || line,
      bases: m[3] ? [m[3]] : [], exported: Boolean(m[1]), decorators: [], doc: null,
      loc: (endLineOfBlock(clean, m.index) || line) - line + 1
    });
  }

  // ── functions: declarations, arrow consts, methods ──
  const fnRe = /^\s*(export\s+)?(?:default\s+)?(async\s+)?function\s*\*?\s*(\w+)\s*\(([^)]*)\)/gm;
  for (let m; (m = fnRe.exec(clean));) {
    const line = lineOf(clean, m.index);
    const end = endLineOfBlock(clean, m.index) || line;
    symbols.push({
      kind: 'function', name: m[3], qualname: m[3], line, end_line: end,
      is_async: Boolean(m[2]), exported: Boolean(m[1]), args: parseParams(m[4]),
      returns: null, decorators: [], route: null, doc: null,
      complexity: complexityOf(clean.slice(m.index, clean.indexOf('\n', m.index) + 400)),
      calls: [], loc: end - line + 1
    });
  }

  const arrowRe = /^\s*(export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*[^=]+)?=\s*(async\s+)?\(([^)]*)\)\s*(?::\s*[^=]+)?=>/gm;
  for (let m; (m = arrowRe.exec(clean));) {
    const line = lineOf(clean, m.index);
    const end = endLineOfBlock(clean, m.index) || line;
    symbols.push({
      kind: 'function', name: m[2], qualname: m[2], line, end_line: end,
      is_async: Boolean(m[3]), exported: Boolean(m[1]), args: parseParams(m[4]),
      returns: null, decorators: [], route: null, doc: null,
      complexity: 1, calls: [], loc: Math.max(1, end - line + 1)
    });
  }

  // ── express-style routes ──
  const routeRe = /\b(?:app|router)\.(get|post|put|patch|delete|use)\(\s*['"]([^'"]+)['"]/g;
  for (let m; (m = routeRe.exec(clean));) {
    symbols.push({
      kind: 'route', name: `${m[1].toUpperCase()} ${m[2]}`, qualname: `${m[1].toUpperCase()} ${m[2]}`,
      line: lineOf(clean, m.index), end_line: lineOf(clean, m.index),
      route: { method: m[1].toUpperCase(), path: m[2] }, loc: 1
    });
  }

  // ── call edges (file-level; heuristic cannot attribute to an enclosing symbol reliably) ──
  const callRe = /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g;
  const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'require', 'import']);
  const calls = [];
  for (let m; (m = callRe.exec(clean));) {
    if (!KEYWORDS.has(m[1])) calls.push({ callee: m[1], line: lineOf(clean, m.index) });
  }

  // Attribute calls to the nearest enclosing symbol by line range.
  for (const c of calls) {
    const owner = symbols
      .filter((s) => s.line <= c.line && (s.end_line || s.line) >= c.line && s.kind !== 'class')
      .sort((a, b) => b.line - a.line)[0];
    if (owner) {
      owner.calls = owner.calls || [];
      owner.calls.push(c);
    }
  }

  return {
    path, language: /\.tsx?$/.test(path) ? 'typescript' : 'javascript',
    fidelity: 'heuristic', hash, doc: null,
    loc: src.split('\n').length, imports, symbols
  };
}

module.exports = { extract, parseParams };
