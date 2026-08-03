// trace.js — making the derivation watchable. RMAD-13.
//
// RMAD's central claim is that completion is COMPUTED rather than asserted. A computation
// nobody can watch is indistinguishable from an assertion, so this records each graph
// operation as it runs and renders it.
//
// FOUR RULES, each load-bearing:
//
//  1. Every step records the QUESTION it asked, not just the command it ran.
//     "rmad index blast buildGraph" is a command; "what breaks if this changes" is the
//     reason it exists. The trace is for a reader who does not know the CLI.
//
//  2. `refused` is a first-class outcome, rendered distinctly from `failed`. When the
//     resolver declines to guess at an ambiguous symbol, that is the framework working.
//     Collapsing it into failure would hide the property that makes the graph worth
//     trusting.
//
//  3. Every step declares which obligation it feeds, so a reader follows
//     drift -> O4 -> residual as a chain rather than as a list of commands.
//
//  4. HTML output is self-contained. No CDN, no network. It is an audit artifact that has
//     to open in five years.

'use strict';

const store = require('../store/db.js');
const codeGraph = require('../code-graph.js');
const crypto = require('crypto');

function open(root) {
  const conn = store.open(codeGraph.indexPath(root), { create: true });
  if (!conn) throw new Error('cannot open the index store');
  return conn;
}
const newId = () => `trc_${crypto.randomBytes(8).toString('hex')}`;

/**
 * A recorder bound to one run. `step()` times the callback, classifies the outcome and
 * writes a row — so instrumenting an operation is one wrapper rather than three lines of
 * bookkeeping at every call site.
 */
function recorder(root, { runId, taskId } = {}) {
  const rid = runId || newId();
  let seq = 0;
  const steps = [];

  function write(rec) {
    const conn = open(root);
    try {
      conn.prepare(`INSERT INTO trace_steps
        (id, run_id, task_id, seq, op, question, args, outcome, reason, feeds, detail, ms, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(newId(), rid, taskId || null, rec.seq, rec.op, rec.question,
          JSON.stringify(rec.args || null), rec.outcome, rec.reason || null,
          (rec.feeds || []).join(',') || null, rec.detail || null, rec.ms, Date.now());
    } finally { store.close(conn); }
  }

  return {
    runId: rid,
    steps,
    /**
     * @param {object} meta { op, question, args, feeds }
     * @param {function} fn  returns { outcome?, reason?, detail? } or throws
     */
    step(meta, fn) {
      const t0 = Date.now();
      let rec;
      try {
        const out = fn() || {};
        rec = {
          seq: ++seq, op: meta.op, question: meta.question, args: meta.args,
          feeds: meta.feeds,
          outcome: out.outcome || 'ok', reason: out.reason || null,
          detail: out.detail || null, ms: Date.now() - t0
        };
      } catch (err) {
        rec = {
          seq: ++seq, op: meta.op, question: meta.question, args: meta.args,
          feeds: meta.feeds, outcome: 'failed', reason: err && err.message,
          detail: null, ms: Date.now() - t0
        };
      }
      steps.push(rec);
      try { write(rec); } catch { /* tracing must never break the thing it observes */ }
      return rec;
    }
  };
}

function readTrace(root, runId) {
  const conn = open(root);
  try {
    return runId
      ? conn.prepare('SELECT * FROM trace_steps WHERE run_id = ? ORDER BY seq').all(runId)
      : conn.prepare(`SELECT * FROM trace_steps WHERE run_id = (
           SELECT run_id FROM trace_steps ORDER BY created_at DESC LIMIT 1
         ) ORDER BY seq`).all();
  } finally { store.close(conn); }
}

const MARK = { ok: 'ok  ', refused: 'REF ', failed: 'FAIL' };

function toText(steps) {
  const out = [];
  out.push('');
  out.push('  WORKFLOW TRACE — what was asked, and what came back');
  out.push('');
  for (const s of steps) {
    const feeds = s.feeds ? `  -> ${s.feeds}` : '';
    out.push(`  ${String(s.seq).padStart(2)}. [${MARK[s.outcome] || s.outcome}] ${s.op}${feeds}`);
    out.push(`      Q: ${s.question}`);
    if (s.detail) out.push(`      ${s.detail}`);
    if (s.reason) out.push(`      ${s.outcome === 'refused' ? 'refused: ' : 'failed: '}${s.reason}`);
    out.push(`      ${s.ms} ms`);
  }
  const refused = steps.filter((s) => s.outcome === 'refused').length;
  const failed = steps.filter((s) => s.outcome === 'failed').length;
  out.push('');
  out.push(`  ${steps.length} step(s): ${steps.length - refused - failed} ok, ${refused} refused, ${failed} failed.`);
  if (refused) {
    out.push('  A REFUSAL is not a failure. It is the resolver declining to guess, which is');
    out.push('  the property that makes an obligation computed from this graph trustworthy.');
  }
  out.push('');
  return out.join('\n');
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Self-contained HTML. No network at render time or view time. */
function toHtml(steps, { title } = {}) {
  const rows = steps.map((s) => `
    <li class="s ${esc(s.outcome)}">
      <div class="h"><span class="n">${s.seq}</span><code>${esc(s.op)}</code>
        <span class="o">${esc(s.outcome)}</span><span class="ms">${s.ms} ms</span></div>
      <div class="q">${esc(s.question)}</div>
      ${s.detail ? `<pre>${esc(s.detail)}</pre>` : ''}
      ${s.reason ? `<div class="r">${esc(s.reason)}</div>` : ''}
      ${s.feeds ? `<div class="f">feeds ${esc(s.feeds)}</div>` : ''}
    </li>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8">
<title>${esc(title || 'RMAD workflow trace')}</title><style>
:root{--bg:#f4f7f6;--card:#fff;--ink:#0d1b1e;--mut:#5b7075;--line:#d7e2e0;
--ok:#1d7a4c;--ref:#9c6410;--fail:#a83a33}
@media(prefers-color-scheme:dark){:root{--bg:#0a1416;--card:#111f22;--ink:#e6efed;
--mut:#8ba3a6;--line:#22383c;--ok:#4cc183;--ref:#dda23f;--fail:#e8736a}}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 ui-sans-serif,system-ui,sans-serif}
.w{max-width:900px;margin:0 auto;padding:40px 20px}
h1{font-size:26px;margin:0 0 6px}.sub{color:var(--mut);margin:0 0 28px}
ul{list-style:none;padding:0;margin:0}
.s{background:var(--card);border:1px solid var(--line);border-left-width:4px;
border-radius:8px;padding:12px 15px;margin-bottom:10px}
.s.ok{border-left-color:var(--ok)}.s.refused{border-left-color:var(--ref)}
.s.failed{border-left-color:var(--fail)}
.h{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.n{font:600 12px ui-monospace,monospace;color:var(--mut)}
code{font:600 13px ui-monospace,monospace}
.o{font:700 10px ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}
.s.ok .o{color:var(--ok)}.s.refused .o{color:var(--ref)}.s.failed .o{color:var(--fail)}
.ms{margin-left:auto;font:11px ui-monospace,monospace;color:var(--mut)}
.q{color:var(--mut);margin-top:4px}
pre{font:12px/1.5 ui-monospace,monospace;background:rgba(127,127,127,.08);
padding:8px 10px;border-radius:5px;overflow-x:auto;margin:8px 0 0}
.r{margin-top:6px;font-size:13px}.s.refused .r{color:var(--ref)}.s.failed .r{color:var(--fail)}
.f{margin-top:6px;font:11px ui-monospace,monospace;color:var(--mut)}
.note{margin-top:24px;color:var(--mut);font-size:13.5px;border-left:2px solid var(--line);padding-left:14px}
</style></head><body><div class="w">
<h1>${esc(title || 'RMAD workflow trace')}</h1>
<p class="sub">${steps.length} step(s). A <strong>refusal</strong> is the resolver declining to
guess — it is rendered separately from a failure because it is the framework working.</p>
<ul>${rows}</ul>
<p class="note">Generated by <code>rmad trace</code>. Self-contained: no network at render
or view time, so it stays readable as an audit artifact.</p>
</div></body></html>`;
}

module.exports = { recorder, readTrace, toText, toHtml };
