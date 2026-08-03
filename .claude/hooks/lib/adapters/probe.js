// adapters/probe.js — does this backend actually keep the OpenAI contract? RMAD-23.
//
// WHY THIS EXISTS AND WHY IT IS NOT OPTIONAL: RMAD's evidence records are built from
// STRUCTURED TOOL CALLS. A backend that degrades a tool call to prose produces no evidence
// at all, so O1 starves and the predicate returns INCONCLUSIVE forever while looking
// broken. The failure is silent and total, and it is a property of the SERVING RUNTIME,
// not of the model:
//
//   - Ollama's /v1 endpoint silently discards decode options.
//   - The framework-level symptoms people report — broken streaming function-calling,
//     autoInvoke:false still auto-invoking, tool-capable models returning plain text —
//     trace to "the runtime's OpenAI-compat fidelity, not the framework."
//
// So a backend is PROBED, never trusted on configuration. What it fails, it is marked
// advisory for.
//
// EVERY CHECK TESTS THE PROTOCOL, NOT THE MODEL. A 0.5B model cannot reason, but it can
// still be asked whether the server echoed a tool schema, truncated at max_tokens, and
// returned usage counters. Conflating "the model is weak" with "the server drops fields"
// would make the probe useless on exactly the small local models it is meant to qualify.

'use strict';

const DEFAULT_TIMEOUT = 60000;

async function post(baseUrl, pathname, body, timeoutMs) {
  const url = String(baseUrl).replace(/\/+$/, '') + pathname;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs || DEFAULT_TIMEOUT);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON body is itself a finding */ }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

const TOOL = {
  type: 'function',
  function: {
    name: 'record_result',
    description: 'Record a numeric result.',
    parameters: {
      type: 'object',
      properties: { value: { type: 'number', description: 'the number' } },
      required: ['value']
    }
  }
};

/**
 * Four checks, each isolating one protocol property.
 * Returns { checks, capabilities, verdict } — never throws on a backend fault, because a
 * broken backend is a RESULT here, not an error.
 */
async function probe(baseUrl, model, { timeoutMs } = {}) {
  const checks = [];
  const add = (id, ok, detail, note) => checks.push({ id, ok, detail, note });

  // 1. Reachability and shape. A 200 with a non-JSON body is the classic proxy/WAF symptom.
  let base;
  try {
    base = await post(baseUrl, '/chat/completions', {
      model, max_tokens: 8, messages: [{ role: 'user', content: 'Say OK.' }]
    }, timeoutMs);
    add('reachable', base.status === 200 && !!base.json,
      base.status === 200 ? (base.json ? 'HTTP 200, JSON body' : 'HTTP 200 but body is not JSON')
        : `HTTP ${base.status}`,
      'a 200 with a non-JSON body usually means a proxy answered, not the model server');
  } catch (err) {
    add('reachable', false, `request failed: ${err && err.message}`);
    return finish(checks);
  }

  // 2. Usage counters. Their absence is why a cost ledger has to record NULL rather than
  //    an estimate — the honest column, not a missing feature.
  const usage = base.json && base.json.usage;
  add('usage', !!(usage && (usage.prompt_tokens != null || usage.completion_tokens != null)),
    usage ? `prompt=${usage.prompt_tokens} completion=${usage.completion_tokens}` : 'no usage object',
    'without this, cost rows carry source=toolcount and usd NULL');

  // 3. Decode options honoured. THE Ollama failure mode. max_tokens: 1 must truncate;
  //    a server that ignores it returns a full paragraph. Tests the SERVER, not the model.
  try {
    const tiny = await post(baseUrl, '/chat/completions', {
      model, max_tokens: 1, messages: [{ role: 'user', content: 'Count from one to twenty in words.' }]
    }, timeoutMs);
    const content = (((tiny.json || {}).choices || [])[0] || {}).message;
    const out = String((content && content.content) || '');
    const completion = ((tiny.json || {}).usage || {}).completion_tokens;
    // Judge by the counter when present, otherwise by length. Twenty words cannot be one token.
    const honoured = completion != null ? completion <= 2 : out.trim().split(/\s+/).length <= 2;
    add('decode-options', honoured,
      `max_tokens=1 -> ${completion != null ? `${completion} completion tokens` : `${out.length} chars`}`,
      'a server that ignores max_tokens is also ignoring temperature and seed');
  } catch (err) {
    add('decode-options', false, `request failed: ${err && err.message}`);
  }

  // 4. Structured tool calls. The one that decides whether evidence can exist at all.
  try {
    const t = await post(baseUrl, '/chat/completions', {
      model,
      max_tokens: 128,
      tools: [TOOL],
      tool_choice: 'auto',
      messages: [{ role: 'user', content: 'Record the result 42 using the record_result tool.' }]
    }, timeoutMs);
    const msg = (((t.json || {}).choices || [])[0] || {}).message || {};
    const calls = msg.tool_calls;
    const structured = Array.isArray(calls) && calls.length > 0;
    const rejected = t.status >= 400;
    add('tool-calls', structured,
      rejected ? `HTTP ${t.status} — tools rejected outright`
        : structured ? `${calls.length} structured tool_call(s)`
          : 'responded with prose instead of tool_calls',
      'RMAD builds evidence records from tool calls; prose produces none');
  } catch (err) {
    add('tool-calls', false, `request failed: ${err && err.message}`);
  }

  return finish(checks);
}

function finish(checks) {
  const by = Object.fromEntries(checks.map((c) => [c.id, c.ok]));
  const capabilities = {
    // A backend that cannot emit structured tool calls cannot produce evidence, so nothing
    // downstream may run in enforced mode against it.
    canProduceEvidence: !!by['tool-calls'],
    honoursDecodeOptions: !!by['decode-options'],
    hasUsage: !!by.usage,
    reachable: !!by.reachable
  };
  const verdict = !capabilities.reachable ? 'unreachable'
    : capabilities.canProduceEvidence && capabilities.honoursDecodeOptions ? 'qualified'
      : 'advisory';
  return { checks, capabilities, verdict };
}

module.exports = { probe, TOOL };
