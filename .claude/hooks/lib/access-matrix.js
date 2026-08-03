// access-matrix.js
// Per-agent path boundary enforcement
// Used by path-enforcer.js to determine if a tool call is allowed
//
// PATH CONTRACT (this was the framework's most expensive bug — read before editing):
// Claude Code's Read/Write/Edit tools deliver ABSOLUTE paths. Every pattern below is
// project-root-relative. Matching an absolute path against a relative pattern with
// startsWith() silently broke enforcement in BOTH directions: every agent was denied its
// own directory (nothing matched `src/`), while `.env` became writable (the literal
// pattern `.env` never matched `/abs/repo/.env`). 383 tests passed throughout, because
// not one of them used an absolute path.
//
// So: isAllowed() now resolves every path to a project-relative POSIX path FIRST
// (which also collapses `../` traversal), then matches. matchGlob() is pure glob
// matching and expects an ALREADY-NORMALIZED relative path — call isAllowed(), not
// matchGlob(), unless you know exactly what you are doing.

const path = require('path');

// Secrets are blocked for EVERY agent, including unknown ones. Per-agent `blocked` lists
// are additive to this, not a replacement for it — previously an agent whose own blocked
// list omitted `.env` (i.e. most of them) could write it, because only DEFAULT_ACCESS
// carried the secret patterns and named agents never inherited them.
// Templates are the opposite of secrets: they exist to be read, and they carry
// placeholders by definition. Blocking them stopped a security reviewer from auditing
// `.env.example` for committed credentials — i.e. the guard prevented the exact check it
// exists to make possible. Anything matching these is exempt from the secret patterns.
const SECRET_EXEMPT = [
  '**/.env.example',
  '**/.env.sample',
  '**/.env.template',
  '**/.env.dist',
  '**/*.key.example',
  '**/*.pem.example'
];

const GLOBAL_BLOCKED = [
  '**/.env*', // .env, .env.local, .envrc — all of them, at any depth
  '**/*.key',
  '**/*.pem',
  '**/*.p12',
  '**/*.pfx',
  '**/id_rsa*',
  '**/credentials*',
  '**/.aws/**',
  '**/.ssh/**'
];

// ─── RMAD-20: compile the matrix down to the harness's own permission layer ──
//
// Every guard in this framework is a hook — RMAD's own JavaScript, advisory to a
// COOPERATING process. `.claude/settings.json` carried `hooks` and `statusLine` and no
// `permissions` block at all, so 100% of enforcement sat above the harness and none inside
// it. Claude Code's `permissions.deny` is evaluated before a tool runs and cannot be talked
// out of by the model, so the secret paths belong there too.
//
// THIS DOES NOT REPLACE THE HOOKS. A deny rule addresses one tool and one path; it cannot
// express "this agent may not write here", cross-file data flow, or a Bash pipeline that
// exfiltrates. It is a second layer UNDER the first, not a substitute — and it is the only
// part of the enforcement story that survives a jailbroken prompt.
//
// Syntax verified 2026-07-28 against code.claude.com/docs/en/settings, which documents
// Read(./.env), Read(./.env.*), Read(./secrets/**), and that deny is checked before allow.

const PERMISSION_TOOLS = ['Read', 'Edit', 'Write'];

/** '**' + '/x*' becomes both the root form and the nested form. */
function toPermissionPaths(glob) {
  const g = String(glob);
  if (g.startsWith('**/')) {
    const tail = g.slice(3);
    return [`./${tail}`, `./**/${tail}`];
  }
  return [g.startsWith('./') ? g : `./${g}`];
}

/**
 * Deny rules implied by GLOBAL_BLOCKED, sorted so the output is stable — a diff then means
 * the set changed rather than that it was re-ordered.
 *
 * Emits both the root and nested form of every pattern. For a DENY list a rule that
 * matches nothing costs nothing, while a missing rule is a hole, so the superset is the
 * safe direction to err in.
 */
function compilePermissionDenies(patterns) {
  const src = patterns || GLOBAL_BLOCKED;
  const { safe, skipped } = partitionByExemption(src);
  const out = new Set();
  for (const p of safe) {
    for (const target of toPermissionPaths(p)) {
      for (const tool of PERMISSION_TOOLS) out.add(`${tool}(${target})`);
    }
  }
  return Object.assign([...out].sort(), { skipped });
}

/**
 * Which GLOBAL_BLOCKED patterns can safely become deny rules, and which cannot.
 *
 * `permissions.deny` has no "except" clause — deny beats allow, unconditionally. But
 * SECRET_EXEMPT exists for a reason: `.env.example` is meant to be readable, because
 * blocking it stopped a security reviewer from auditing it for committed credentials, i.e.
 * the guard prevented the exact check it exists to enable.
 *
 * So a blocked pattern that could also match an exempt path CANNOT be compiled down. It
 * stays with the hooks, which can express the exemption. Compiling it anyway would trade a
 * real capability for a partial one and call it hardening.
 */
function partitionByExemption(patterns) {
  // A concrete sample path for each exemption, so overlap is tested rather than reasoned
  // about: '**/*.key.example' -> 'x.key.example'.
  const samples = SECRET_EXEMPT.map((e) =>
    String(e).replace(/^\*\*\//, '').replace(/\*/g, 'x'));

  const safe = [];
  const skipped = [];
  for (const p of patterns) {
    const clash = samples.find((s) => matchGlob(s, p));
    if (clash) skipped.push({ pattern: p, because: clash });
    else safe.push(p);
  }
  return { safe, skipped };
}

const DEFAULT_ACCESS = {
  readable: ['**/*'],
  writable: ['**/*'],
  blocked: []
};

const ACCESS_MATRIX = {
  'atlas-orchestrator': {
    readable: ['**/*'],
    writable: [
      '.planning/skill-config.yaml',
      'CLAUDE.md',
      '.claude/hooks/.data-guard-config.json',
      '.claude/skills/',   // installs domain-pack skills (flat) during orchestration
      '.claude/agents/'    // maintains each agent's `skills:` preload list
    ],
    blocked: ['src/', 'tests/']
  },
  'maya-analyst': {
    readable: ['.planning/', 'docs/', '.research/'],
    writable: ['.planning/spec/requirements/', '.planning/research/'],
    blocked: ['src/', 'tests/']
  },
  'winston-architect': {
    readable: ['**/*'],
    writable: ['.planning/architecture/', '.planning/architecture/adr/'],
    blocked: []
  },
  'nadia-pm': {
    readable: ['.planning/', 'docs/'],
    writable: ['.planning/spec/prd/', '.planning/roadmap/'],
    blocked: ['src/', 'tests/']
  },
  'derek-sm': {
    readable: ['.planning/', 'docs/'],
    writable: ['.planning/sprints/'],
    blocked: ['src/', 'tests/']
  },
  'soren-backend': {
    readable: ['.planning/sprints/*/stories/', 'src/', 'tests/', 'docs/api/'],
    writable: ['src/', 'tests/', '.planning/sprints/*/stories/'],
    blocked: ['.planning/architecture/', '.planning/requirements/']
  },
  'milo-frontend': {
    readable: ['.planning/sprints/*/stories/', 'src/frontend/', 'src/shared/', 'tests/', 'docs/'],
    writable: ['src/frontend/', 'src/shared/types/', 'tests/frontend/', '.planning/sprints/*/stories/'],
    blocked: ['src/backend/', 'src/services/', '.planning/architecture/']
  },
  'lena-integration': {
    readable: ['.planning/sprints/*/stories/', 'src/', 'tests/', 'docs/'],
    writable: ['src/integrations/', 'src/adapters/', 'tests/integration/', '.planning/sprints/*/stories/'],
    blocked: ['.planning/architecture/', '.planning/requirements/']
  },
  'anya-data': {
    readable: ['.planning/sprints/*/stories/', 'src/', 'tests/', 'docs/'],
    writable: ['src/data/', 'src/models/', 'src/schemas/', 'tests/data/', '.planning/sprints/*/stories/'],
    blocked: ['.planning/architecture/', '.planning/requirements/']
  },
  'ravi-devops': {
    readable: ['.planning/', 'src/', 'tests/', 'docs/', 'infra/', '.github/'],
    writable: ['infra/', '.github/workflows/', 'docker/', 'scripts/', '.planning/sprints/*/stories/'],
    blocked: ['src/backend/', 'src/frontend/']
  },
  'quinn-qa': {
    readable: ['**/*'],
    writable: ['.planning/reviews/'],
    blocked: []
  },
  'tara-blackbox': {
    readable: ['.planning/requirements/', '.planning/sprints/*/stories/', 'docs/api/', 'docs/user-guides/', 'tests/e2e/'],
    writable: ['tests/e2e/', '.planning/test-reports/'],
    // The index is blocked for the same reason src/** is. It is a DERIVED COPY of the
    // source — every symbol, signature, docstring and route — so reading it is reading
    // the source through one level of indirection. Without this, `cat .planning/index/
    // graph.db` or even `strings` on it defeated the entire black-box premise, and the
    // Bash guard checks reads against the blocked list only, so nothing else stopped it.
    blocked: ['src/**', 'lib/**', 'internal/**', '.env*', 'config/', '.planning/architecture/',
      '.planning/index/**', '.rmad/**']
  },
  'vera-compliance': {
    readable: ['**/*'],
    writable: ['.planning/compliance/'],
    blocked: []
  },
  'kai-security': {
    readable: ['**/*'],
    writable: ['.planning/security/'],
    blocked: []
  },
  'rex-researcher': {
    readable: ['.planning/', 'docs/', '.research/'],
    writable: ['.research/', '.planning/research/'],
    blocked: ['src/', 'tests/']
  },
  'sage-techwriter': {
    readable: ['**/*'],
    writable: ['docs/'],
    blocked: []
  }
};

// Map loose agent references to canonical matrix ids:
// "soren-backend" → itself, "Soren" → "soren-backend", "Atlas" → "atlas-orchestrator".
// Unknown names return as given (getAgentAccess then applies DEFAULT_ACCESS).
function normalizeAgentId(agentName) {
  if (!agentName) return agentName;
  const lower = String(agentName).trim().toLowerCase();
  if (ACCESS_MATRIX[lower]) return lower;
  const byFirstName = Object.keys(ACCESS_MATRIX).find((id) => id.split('-')[0] === lower);
  if (byFirstName) return byFirstName;

  // A NEAR MISS on a known id must resolve to that id, not fall through to DEFAULT_ACCESS.
  //
  // Unknown agent types keeping default access is deliberate — Claude Code's built-ins
  // (general-purpose, Explore, Plan) are the operator's own hands, not fenced RMAD roles.
  // But `tara-blackbox/`, `tara blackbox` and `Tara_Blackbox` are none of those things:
  // they are a fenced role whose id arrived slightly mangled, and returning them unchanged
  // silently converted the narrowest role in the matrix into an unfenced one. A rename, a
  // domain-pack agent, or one typo in an agent's frontmatter was enough.
  //
  // Fail toward the FENCED interpretation: strip everything that is not a letter or digit
  // and try again. A genuinely unknown id still has no canonical form to find.
  const squashed = lower.replace(/[^a-z0-9]/g, '');
  if (!squashed) return lower;
  const byShape = Object.keys(ACCESS_MATRIX).find((id) => id.replace(/[^a-z0-9]/g, '') === squashed);
  return byShape || lower;
}

function getAgentAccess(agentName) {
  return ACCESS_MATRIX[normalizeAgentId(agentName)] || DEFAULT_ACCESS;
}

// An agent RMAD actually knows about. Unknown types (Claude Code's built-ins:
// general-purpose, Explore, Plan, ...) get DEFAULT_ACCESS and are treated as the
// operator's own hands rather than as a fenced RMAD role.
function isKnownAgent(agentName) {
  return Object.prototype.hasOwnProperty.call(ACCESS_MATRIX, normalizeAgentId(agentName));
}

// Resolve any path — absolute, relative, or traversal-laden — to a project-relative
// POSIX path. path.resolve() collapses `../`, which is what closes the
// `src/../.planning/architecture/adr.md` bypass and the
// `tests/../../../../Windows/System32/drivers/etc/hosts` escape.
function normalizePath(filePath, projectRoot) {
  const root = path.resolve(projectRoot || process.cwd());
  const abs = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(root, filePath);
  const rel = path.relative(root, abs).split(path.sep).join('/');
  // path.relative returns an absolute path across Windows drives (E:\ -> C:\),
  // and a `..`-prefixed path anywhere else outside the root.
  const outside = rel === '..' || rel.startsWith('../') || path.isAbsolute(rel) || rel === '';
  return { abs, rel, outside };
}

// Compile a glob to an anchored RegExp.
//   'src/'                       -> src, and everything beneath it
//   'src'                        -> src, and everything beneath it (NOT 'srcfoo')
//   '.planning/sprints/*/stories/' -> one segment for *, then everything beneath
//   '**/*.key'                   -> a.key, x/y/a.key
//   '**/*' | '**'                -> everything
// Boundary semantics: a pattern always matches the path itself OR anything under it.
function globToRegExp(pattern) {
  let p = String(pattern).replace(/\\/g, '/').replace(/^\.\//, '');
  // `src/**` means "src and everything under it" — including the directory itself.
  // Leaving the `/**` on would produce ^src/.* , which fails to match the bare `src`,
  // so `grep -r "token" src/` slipped past a `blocked: ['src/**']` boundary.
  if (p.endsWith('/**')) p = p.slice(0, -3);
  if (p.endsWith('/')) p = p.slice(0, -1);

  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        if (p[i + 2] === '/') {
          re += '(?:[^/]+/)*'; // '**/' — zero or more directory segments
          i += 2;
        } else {
          re += '.*'; // trailing '**'
          i += 1;
        }
      } else {
        re += '[^/]*'; // '*' — within a single segment
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '(?:/.*)?$');
}

const _globCache = new Map();
function compileGlob(pattern) {
  let re = _globCache.get(pattern);
  if (!re) {
    re = globToRegExp(pattern);
    _globCache.set(pattern, re);
  }
  return re;
}

// Pure glob match. `relPath` MUST already be project-relative and POSIX-separated —
// isAllowed() guarantees that. Passing an absolute path here will not match relative
// patterns, which is the bug this whole file was rewritten to kill.
function matchGlob(relPath, pattern) {
  return compileGlob(pattern).test(String(relPath).replace(/\\/g, '/').replace(/^\.\//, ''));
}

// Blocked-list check only — no writable/readable allowlist. Used by the Bash guard,
// where enforcing full allowlists on every path-shaped token in a shell command would
// produce constant false positives (`npm test`, `git commit -m "fix src/x"`), and a
// security hook that cries wolf gets disabled, after which it protects nothing.
// Blocked patterns are unambiguous enough to enforce on a best-effort token scan.
function isBlocked(agentName, filePath, projectRoot) {
  const rules = getAgentAccess(agentName);
  const { abs, rel, outside } = normalizePath(filePath, projectRoot);
  const subject = outside ? path.basename(abs).replace(/\\/g, '/') : rel;
  for (const pattern of [...GLOBAL_BLOCKED, ...(rules.blocked || [])]) {
    if (matchGlob(subject, pattern)) {
      return { blocked: true, pattern, reason: `${agentName} cannot access ${rel || abs} (blocked: ${pattern})` };
    }
  }
  return { blocked: false };
}

function isAllowed(agentName, filePath, operation, projectRoot) {
  const rules = getAgentAccess(agentName);
  const known = isKnownAgent(agentName);
  const { abs, rel, outside } = normalizePath(filePath, projectRoot);

  // Outside the project we have no relative path to reason about, so secrets are matched
  // on the basename — `/somewhere/else/.env` is still `.env`.
  //
  // But the basename ALONE is not enough: `**/.ssh/**` and `**/.aws/**` describe a
  // DIRECTORY, and the only place those directories exist is outside the repo — which is
  // exactly when the subject was being collapsed to a basename. The result was that both
  // patterns could never fire: `~/.ssh/authorized_keys`, `~/.aws/config`, `~/.npmrc` and
  // `~/.git-credentials` were all readable. Both forms are matched now.
  const subject = outside ? path.basename(abs).replace(/\\/g, '/') : rel;
  const subjects = outside ? [subject, abs.replace(/\\/g, '/')] : [subject];
  const hits = (pattern) => subjects.some((s) => matchGlob(s, pattern));

  // 1. Blocked wins over everything. Global secret patterns apply to every agent,
  //    including unknown ones; per-agent blocks are additive — except for templates,
  //    which exist to be read (see SECRET_EXEMPT).
  //
  // The exemption is evaluated PER PATTERN and on the BASENAME, and both halves matter:
  //
  //   * Per pattern — this used to select `exempt ? rules.blocked : [...GLOBAL_BLOCKED,
  //     ...]`, so a single `.env.example` match also switched off `**/*.key`, `**/*.pem`,
  //     `**/id_rsa*`, `**/.aws/**` and `**/.ssh/**`. A template is a reason to read THAT
  //     file, never a reason to stop guarding every other secret.
  //   * On the basename — compiled globs end `(?:/.*)?$`, so `**/.env.example` also
  //     matched `.env.example/id_rsa`. Any directory named `.env.example` or
  //     `x.key.example` became a namespace with no secret guard inside it at all.
  const base = path.basename(subject);
  const isTemplate = SECRET_EXEMPT.some((p) => matchGlob(base, p.replace(/^\*\*\//, '')));
  for (const pattern of [...GLOBAL_BLOCKED, ...(rules.blocked || [])]) {
    if (!hits(pattern)) continue;
    // A template is exempt only from the GLOBAL secret patterns. An agent's own blocked
    // list is a scoping decision and is never waived.
    if (isTemplate && GLOBAL_BLOCKED.includes(pattern)) continue;
    return {
      allowed: false,
      reason: `${agentName} cannot access ${rel || abs} (blocked: ${pattern})`
    };
  }

  // 2. A known RMAD agent has no business outside the repo it was scoped to.
  //    Unknown types keep working (scratchpads, temp dirs) — they are not fenced roles,
  //    and the global secret block above still covers them.
  if (outside && known) {
    return {
      allowed: false,
      reason: `${agentName} cannot ${operation} ${abs} — outside the project root`
    };
  }

  if (operation === 'write') {
    const canWrite = (rules.writable || []).some((p) => matchGlob(subject, p));
    if (!canWrite) {
      return {
        allowed: false,
        reason: `${agentName} cannot write to ${rel || abs}. Writable: ${(rules.writable || []).join(', ')}`
      };
    }
  }

  if (operation === 'read') {
    const readable = rules.readable || [];
    const unrestricted = readable.includes('**/*') || readable.includes('**');
    if (!unrestricted && !readable.some((p) => matchGlob(subject, p))) {
      return {
        allowed: false,
        reason: `${agentName} cannot read ${rel || abs}. Readable: ${readable.join(', ')}`
      };
    }
  }

  return { allowed: true, reason: 'ok' };
}

module.exports = {
  compilePermissionDenies, toPermissionPaths, partitionByExemption, PERMISSION_TOOLS,
  ACCESS_MATRIX,
  DEFAULT_ACCESS,
  GLOBAL_BLOCKED,
  SECRET_EXEMPT,
  getAgentAccess,
  isKnownAgent,
  isAllowed,
  isBlocked,
  matchGlob,
  globToRegExp,
  normalizePath,
  normalizeAgentId
};
