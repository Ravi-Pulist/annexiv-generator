// egress.js — destination control at the tool boundary. RMAD-11, the half that fits.
//
// WHY THIS EXISTS. RMAD-11 as specified is kernel sandboxing — Seatbelt, bubblewrap,
// Windows Sandbox — and it is architectural: it changes how every tool call executes.
// The spec itself names a cheaper partial worth doing first, and this is it. The "lethal
// trifecta" is private data + untrusted content + external communication. path-enforcer
// fences the first. data-guard catches the second reaching the third *as a payload*.
// Nothing looked at the third on its own: where a tool call is allowed to talk to.
//
// WHAT THIS IS NOT — and the distinction matters more here than anywhere else in the
// codebase. This is NOT a sandbox and must never be described as one. It reads the text
// of a tool call and reasons about the hostnames it can see. A shell can defeat that with
// a variable, a base64 blob, or a script written elsewhere; a compromised process can
// simply open a socket without asking. What it does is make an UNDECLARED destination
// visible and expensive, which is the realistic failure mode: an agent helpfully curling
// a paste site because that was the shortest path to the answer.
//
// DESIGN BIAS, inherited from bash-guard and paid for once already: false positives are
// worse than false negatives. A guard that blocks `npm install` is switched off by
// lunchtime, and a switched-off guard enforces nothing. Hence three things:
//
//   1. The default mode is `warn`, not `enforce`. RMAD reports what it WOULD have denied
//      and lets you read the list before you turn the key. That report is also the only
//      honest route to the survey's N2=5, which requires a *published denylist failure
//      rate* — you cannot publish a rate you never measured.
//   2. The default allowlist ships the package ecosystem. A policy that breaks dependency
//      installation is not a security control, it is an outage.
//   3. Local destinations are allowed by default. Talking to your own dev server is not
//      egress.
//
// THE INCONCLUSIVE RULE. `curl "$URL"` has a destination this module cannot read. It is
// tempting to allow it — nothing visible is wrong — but that is precisely the shape that
// makes a scanner useless. An unreadable destination is reported as `unresolvable` and,
// under `enforce`, denied. This is the same stance the completion predicate takes: absent
// evidence is not evidence of absence.

const LOCAL_HOST_RE = /^(?:localhost|.*\.local|.*\.internal|.*\.test|.*\.localhost|.*\.example|.*\.invalid)$/i;

// Ranges that are not the internet. Loopback, RFC1918, link-local, CGNAT, and the
// unspecified address. An agent reaching 192.168.1.10 is talking to the lab, not the world.
function isLocalIp(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  if (p[0] === 127 || p[0] === 0 || p[0] === 10) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 169 && p[1] === 254) return true;
  if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
  return false;
}

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function isLocal(host) {
  const h = String(host || '').toLowerCase();
  if (!h) return false;
  if (h === '::1' || h === '[::1]') return true;
  if (IPV4_RE.test(h)) return isLocalIp(h);
  return LOCAL_HOST_RE.test(h);
}

// The package ecosystem plus the handful of hosts a development agent legitimately needs.
// Shipped as the DEFAULT so the first run of `enforce` does not brick the toolchain. It is
// a starting point to edit, not a claim about what is safe: anything here can read what
// you send it.
const DEFAULT_ALLOW = [
  // JavaScript
  'registry.npmjs.org', '*.npmjs.org', 'registry.yarnpkg.com', 'nodejs.org', '*.nodejs.org',
  // Python
  'pypi.org', '*.pypi.org', 'files.pythonhosted.org',
  // Rust / Go / Java / Ruby
  'crates.io', 'static.crates.io', 'proxy.golang.org', 'sum.golang.org',
  'repo.maven.apache.org', 'rubygems.org', '*.rubygems.org',
  // Source hosting
  'github.com', '*.github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com',
  'codeload.github.com', 'gitlab.com', '*.gitlab.com', 'bitbucket.org',
  // The model vendor this harness runs on
  'api.anthropic.com', 'anthropic.com', '*.anthropic.com'
];

// Match an allowlist entry against a host.
//   "github.com"    matches github.com AND api.github.com   (apex + subdomains)
//   "*.github.com"  matches api.github.com but NOT github.com (subdomains only)
// The dot boundary is the whole point: without it "npmjs.org" would match "evilnpmjs.org",
// which is the classic allowlist bypass and would make this module worse than nothing.
function matchesEntry(host, entry) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  const e = String(entry || '').toLowerCase().trim().replace(/\.$/, '');
  if (!h || !e) return false;
  if (e.startsWith('*.')) {
    const base = e.slice(2);
    return h.endsWith('.' + base);
  }
  return h === e || h.endsWith('.' + e);
}

function inList(host, list) {
  return (Array.isArray(list) ? list : []).some((e) => matchesEntry(host, e));
}

// ── Destination extraction ──────────────────────────────────────────────────
//
// Deliberately narrow. This does NOT try to find every hostname mentioned anywhere in a
// command: a URL in a comment, an error message, or a git commit body is not a call. It
// looks for destinations in argument position of a command that actually makes one, which
// keeps the report readable enough that someone will act on it.

const NET_COMMANDS = new Set([
  'curl', 'wget', 'nc', 'ncat', 'netcat', 'telnet', 'scp', 'sftp', 'ftp', 'rsync',
  'ssh', 'git', 'npm', 'pnpm', 'yarn', 'pip', 'pip3', 'cargo', 'go', 'gem', 'bundle',
  'docker', 'gh', 'aws', 'gcloud', 'az', 'kubectl', 'http', 'https', 'httpie', 'wget2'
]);

// Subcommands that reach the network. `git status` does not; `git push` does. Listing the
// reaching ones (rather than assuming every invocation reaches) keeps the noise down.
const NET_SUBCOMMANDS = {
  git: new Set(['clone', 'fetch', 'pull', 'push', 'remote', 'ls-remote', 'submodule']),
  npm: new Set(['install', 'i', 'ci', 'publish', 'audit', 'update', 'add', 'exec', 'dlx', 'pack']),
  pnpm: new Set(['install', 'i', 'add', 'update', 'publish', 'dlx']),
  yarn: new Set(['install', 'add', 'up', 'publish', 'dlx']),
  docker: new Set(['pull', 'push', 'run', 'build', 'login']),
  pip: new Set(['install', 'download', 'wheel', 'index', 'search']),
  pip3: new Set(['install', 'download', 'wheel', 'index', 'search']),
  cargo: new Set(['build', 'run', 'test', 'check', 'install', 'update', 'fetch', 'publish', 'add', 'doc']),
  go: new Set(['mod', 'get', 'install', 'build', 'run', 'test']),
  gem: new Set(['install', 'update', 'push', 'fetch']),
  bundle: new Set(['install', 'update', 'add', 'exec'])
};

// Commands whose destination is real and knowable but lives in configuration rather than
// in the call text: .npmrc, .git/config, the docker daemon.
//
// WHERE THE LINE IS, and why it is not "everything with a config file". These are the
// commands whose ordinary use is INBOUND — fetching dependencies, cloning — plus git and
// docker, whose outbound use is the daily development loop and whose remotes are one
// `git remote -v` away from visible. Blocking those would end the guard's useful life.
//
// Cloud and infrastructure CLIs are deliberately NOT here. `aws s3 cp secrets.json
// s3://bucket/`, `gh api`, `kubectl cp` all have configured endpoints too, and all of them
// are outbound data movement to somewhere this module cannot name. Those stay
// `unresolvable`: visible in warn, refused under enforce. That is the whole point of
// having the category.
const CONFIGURED_ENDPOINT_COMMANDS = new Set([
  'git', 'docker', 'npm', 'pnpm', 'yarn', 'pip', 'pip3', 'cargo', 'go', 'gem', 'bundle'
]);

const URL_RE = /\b([a-z][a-z0-9+.-]*):\/\/([^\s'"`<>|;&)]+)/gi;
// scp/rsync/ssh style: user@host:path — the colon is what distinguishes it from an email.
// The lookahead rejects `scheme://host` only; a single slash is the ordinary
// `user@host:/abs/path` form, and excluding it lost every absolute-path destination.
const SCP_RE = /(?:^|\s)(?:[\w.+-]+@)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+):(?!\/\/)/gi;
// Anything that can hide a destination from a static reader.
const OPAQUE_RE = /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\$\(|`|<\(/;

function hostFromUrl(rest) {
  // rest is everything after the scheme separator: [user[:pass]@]host[:port][/path...]
  const authority = String(rest).split(/[/?#]/)[0];
  const hostPort = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority;
  if (hostPort.startsWith('[')) return hostPort.slice(0, hostPort.indexOf(']') + 1).toLowerCase();
  return hostPort.split(':')[0].toLowerCase();
}

function splitStages(command) {
  return String(command).split(/(?:\|\||&&|[;|]|\n)/g).map((s) => s.trim()).filter(Boolean);
}

function commandWord(stage) {
  const toks = (stage.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((t) => t.replace(/^['"]|['"]$/g, ''));
  let i = 0;
  while (i < toks.length && (/^[a-z_][a-z0-9_]*=/i.test(toks[i]) || toks[i] === 'sudo' || toks[i] === 'env')) i++;
  const cmd = (toks[i] || '').split(/[/\\]/).pop().toLowerCase().replace(/\.exe$/, '');
  const sub = (toks[i + 1] || '').toLowerCase();
  return { cmd, sub, toks: toks.slice(i + 1) };
}

// Does this stage actually reach the network? A URL in argument position always counts —
// `python -c "urlopen('https://x')"` is a call whatever the command word says.
function stageReaches(stage, cmd, sub) {
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(stage)) return true;
  if (!NET_COMMANDS.has(cmd)) return false;
  const subs = NET_SUBCOMMANDS[cmd];
  if (!subs) return true;
  return subs.has(sub);
}

// Returns [{ host, raw, via }] — `host` is null when the destination is unreadable.
function destinationsFromCommand(command) {
  const out = [];
  const seen = new Set();
  const push = (host, raw, via) => {
    const key = `${host || '?'}|${via}|${raw}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ host, raw, via });
  };

  for (const stage of splitStages(command)) {
    const { cmd, sub } = commandWord(stage);
    if (!stageReaches(stage, cmd, sub)) continue;

    let found = 0;
    for (const m of stage.matchAll(URL_RE)) {
      const scheme = m[1].toLowerCase();
      if (scheme === 'file' || scheme === 'data') continue; // not egress
      const host = hostFromUrl(m[2]);
      if (!host) continue;
      // A URL that is really a variable — https://$HOST/x — is not a destination we read.
      if (OPAQUE_RE.test(m[0])) { push(null, m[0], cmd || 'url'); found++; continue; }
      push(host, m[0], cmd || 'url');
      found++;
    }
    for (const m of stage.matchAll(SCP_RE)) {
      push(m[1].toLowerCase(), m[0].trim(), cmd || 'scp');
      found++;
    }

    // A stage that reaches the network but shows no readable destination splits in two.
    //
    // CONFIGURED — `npm install`, `git push origin main`, `docker pull redis`. The
    // destination is real and knowable, it just lives in .npmrc / .git/config / the daemon
    // rather than in the command. Reporting these as "unknown" would fire on every install
    // and every push, and a guard that fires on every push is a guard nobody reads.
    //
    // OPAQUE — `curl $ENDPOINT`. Nothing anywhere names the destination. This is the
    // INCONCLUSIVE case and it stays inconclusive.
    if (found === 0) {
      const configured = CONFIGURED_ENDPOINT_COMMANDS.has(cmd);
      push(null, stage.slice(0, 120), configured ? `${cmd}-configured` : (cmd || 'shell'));
    }
  }
  return out;
}

function destinations(toolName, toolInput) {
  const ti = toolInput || {};
  const tool = String(toolName || '');
  if (tool === 'Bash') return destinationsFromCommand(ti.command || '');
  if (tool === 'WebFetch') {
    const url = String(ti.url || '');
    if (!url) return [{ host: null, raw: '(no url)', via: 'WebFetch' }];
    const m = url.match(/^([a-z][a-z0-9+.-]*):\/\/(.+)$/i);
    if (!m) return [{ host: null, raw: url.slice(0, 120), via: 'WebFetch' }];
    return [{ host: hostFromUrl(m[2]), raw: url.slice(0, 200), via: 'WebFetch' }];
  }
  if (tool === 'WebSearch') {
    // A search has no host to allowlist — the QUERY leaves the machine, and the query is
    // written by whatever the agent just read. It gets its own switch rather than being
    // silently exempt for want of a hostname to check.
    return [{ host: null, raw: String(ti.query || '').slice(0, 120), via: 'WebSearch' }];
  }
  return [];
}

// ── Policy ──────────────────────────────────────────────────────────────────

const MODES = new Set(['off', 'warn', 'enforce']);

function normalizePolicy(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const mode = MODES.has(p.mode) ? p.mode : 'warn';
  return {
    mode,
    allow: Array.isArray(p.allow) ? p.allow : DEFAULT_ALLOW.slice(),
    deny: Array.isArray(p.deny) ? p.deny : [],
    allowLocal: p.allowLocal !== false,
    allowWebSearch: p.allowWebSearch !== false,
    // Commands whose destination lives in configuration rather than in the call: a package
    // registry, a git remote, a docker daemon. On by default — turning it off means
    // `enforce` denies dependency installation and every push, which is a legitimate
    // stance for a locked-down run and a terrible one for a default.
    allowConfiguredEndpoints: p.allowConfiguredEndpoints !== false
  };
}

// One destination → one verdict. Order matters: deny beats allow, because an explicit deny
// is the only way to carve an exception out of a wildcard.
function classify(dest, policy) {
  const p = normalizePolicy(policy);
  if (dest.via === 'WebSearch') {
    return p.allowWebSearch
      ? { verdict: 'allow', reason: 'web search permitted by policy' }
      : { verdict: 'deny', reason: 'web search sends the query off-machine and allowWebSearch is false' };
  }
  if (dest.host === null) {
    if (String(dest.via).endsWith('-configured')) {
      return p.allowConfiguredEndpoints
        ? { verdict: 'allow', reason: 'destination comes from configuration (registry, remote or daemon)' }
        : { verdict: 'deny', reason: 'configured endpoint, and allowConfiguredEndpoints is false' };
    }
    return { verdict: 'unresolvable', reason: 'the destination is not readable from the call text' };
  }
  if (inList(dest.host, p.deny)) return { verdict: 'deny', reason: `${dest.host} is on the deny list` };
  if (p.allowLocal && isLocal(dest.host)) return { verdict: 'allow', reason: 'local destination' };
  if (inList(dest.host, p.allow)) return { verdict: 'allow', reason: `${dest.host} is on the allow list` };
  return { verdict: 'deny', reason: `${dest.host} is not on the allow list` };
}

// The decision for a whole tool call.
//   allow  — nothing to say
//   warn   — something would have been denied, but mode is `warn`
//   block  — mode is `enforce` and something is denied or unreadable
// `findings` is always the full list, so the caller can log what it permitted as well as
// what it stopped. That ledger is the deliverable: without it there is no failure rate.
function check(toolName, toolInput, policy) {
  const p = normalizePolicy(policy);
  const dests = destinations(toolName, toolInput);
  const findings = dests.map((d) => ({ ...d, ...classify(d, p) }));
  const bad = findings.filter((f) => f.verdict === 'deny' || f.verdict === 'unresolvable');

  if (p.mode === 'off' || !bad.length) {
    return { decision: 'allow', mode: p.mode, findings, offending: [] };
  }
  return {
    decision: p.mode === 'enforce' ? 'block' : 'warn',
    mode: p.mode,
    findings,
    offending: bad
  };
}

module.exports = {
  check, classify, destinations, destinationsFromCommand,
  normalizePolicy, matchesEntry, isLocal, inList,
  DEFAULT_ALLOW, MODES, CONFIGURED_ENDPOINT_COMMANDS
};
