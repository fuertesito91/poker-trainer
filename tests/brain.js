/* =====================================================
   AI Coach Brain tests — context building, provider
   request shaping (mocked fetch), graceful fallback,
   and config persistence. Node-only; loads app.js in a
   sandbox with stubbed DOM/localStorage/fetch.
   ===================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

const noop = () => {};
const localStorageStub = (() => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
})();

// Controllable fetch mock.
let fetchCalls = [];
let nextFetchResponse = null;
function fetchMock(url, opts) {
  fetchCalls.push({ url, opts });
  if (nextFetchResponse instanceof Error) return Promise.reject(nextFetchResponse);
  const r = nextFetchResponse || { ok: true, json: {} };
  return Promise.resolve({
    ok: r.ok,
    status: r.status || (r.ok ? 200 : 500),
    json: async () => r.json,
    text: async () => JSON.stringify(r.json || {}),
  });
}

const sandbox = {
  console, Math, Date, JSON,
  document: { addEventListener: noop, getElementById: () => null, querySelector: () => null, body: { classList: { toggle: noop } } },
  window: { addEventListener: noop },
  navigator: {},
  localStorage: localStorageStub,
  fetch: fetchMock,
  Promise,
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), ctx, { filename: 'app.js' });
const run = (code) => vm.runInContext(code, ctx);

let failed = 0, passed = 0;
function test(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { passed++; console.log(`  ✓ ${name}`); },
    (e) => { failed++; console.log(`  ✗ ${name}\n      ${e.message}`); }
  );
}
function ok(c, m) { if (!c) throw new Error(m || 'expected truthy'); }
function eq(a, b, m) { if (a !== b) throw new Error(`${m || 'eq'} — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }

(async () => {
  // ── Context building ──
  await test('buildGameContext serializes ground truth from a spot', () => {
    run(`
      globalThis.__g = (function(){
        const g = new PokerGame();
        g.startNewHand({ seed: 123, button: 0 });
        return g;
      })();
      globalThis.__ctx = buildGameContext(__g);
    `);
    const c = sandbox.__ctx;
    ok(Array.isArray(c.yourHand) && c.yourHand.length === 2, 'has 2 hole cards');
    ok(c.engine && typeof c.engine.equityPct === 'number', 'engine equity present');
    ok(typeof c.pot === 'number', 'pot present');
    ok(['preflop', 'flop', 'turn', 'river'].includes(c.street), 'valid street');
  });

  await test('contextToText marks engine numbers authoritative', () => {
    run(`globalThis.__txt = contextToText(buildGameContext(__g));`);
    const t = sandbox.__txt;
    ok(/authoritative/i.test(t), 'mentions authoritative');
    ok(/win equity:/i.test(t), 'includes equity line');
  });

  // ── Brain configured/unconfigured ──
  await test('Brain unconfigured by default; explainDecision falls back to template', async () => {
    run(`BrainConfig.provider = 'none'; BrainConfig.apiKey = '';`);
    eq(run(`Brain.isConfigured()`), false, 'not configured');
    const res = await run(`Brain.explainDecision(__g, 'call', { verdict: 'good', text: 'Template tip.' })`);
    eq(res.text, 'Template tip.', 'returns template text');
    eq(res.source, 'template', 'source=template');
  });

  // ── OpenAI request shaping ──
  await test('OpenAI provider shapes a correct chat/completions request', async () => {
    fetchCalls = [];
    nextFetchResponse = { ok: true, json: { choices: [{ message: { content: 'Because pot odds.' } }] } };
    run(`BrainConfig.provider = 'openai'; BrainConfig.apiKey = 'sk-test'; BrainConfig.model = ''; BrainConfig.baseUrl = '';`);
    eq(run(`Brain.isConfigured()`), true, 'configured with key');
    const reply = await run(`Brain._call([{ role:'user', content:'why?' }])`);
    eq(reply, 'Because pot odds.', 'parses OpenAI response');
    const call = fetchCalls[0];
    ok(/\/chat\/completions$/.test(call.url), 'hits chat/completions');
    eq(call.opts.headers['Authorization'], 'Bearer sk-test', 'bearer auth header');
    const body = JSON.parse(call.opts.body);
    eq(body.messages[0].role, 'system', 'system prompt first');
    ok(body.model.length > 0, 'model defaulted');
  });

  // ── Anthropic request shaping ──
  await test('Anthropic provider uses x-api-key and parses content blocks', async () => {
    fetchCalls = [];
    nextFetchResponse = { ok: true, json: { content: [{ text: 'Fold is fine.' }] } };
    run(`BrainConfig.provider = 'anthropic'; BrainConfig.apiKey = 'ak-test'; BrainConfig.model = ''; BrainConfig.baseUrl = '';`);
    const reply = await run(`Brain._call([{ role:'user', content:'hi' }])`);
    eq(reply, 'Fold is fine.', 'parses anthropic content');
    const call = fetchCalls[0];
    ok(/\/messages$/.test(call.url), 'hits /messages');
    eq(call.opts.headers['x-api-key'], 'ak-test', 'x-api-key header');
    ok(call.opts.headers['anthropic-version'], 'version header present');
    const body = JSON.parse(call.opts.body);
    ok(typeof body.system === 'string' && body.system.length, 'system passed top-level');
  });

  // ── Ollama needs no key ──
  await test('Ollama is considered configured without a key', () => {
    run(`BrainConfig.provider = 'ollama'; BrainConfig.apiKey = '';`);
    eq(run(`Brain.isConfigured()`), true, 'ollama needs no key');
  });

  // ── Graceful fallback on network error ──
  await test('explainDecision falls back to template on provider error', async () => {
    nextFetchResponse = new Error('network down');
    run(`BrainConfig.provider = 'openai'; BrainConfig.apiKey = 'sk-test';`);
    const res = await run(`Brain.explainDecision(__g, 'fold', { verdict: 'bad', text: 'Fallback tip.' })`);
    eq(res.text, 'Fallback tip.', 'uses fallback');
    eq(res.source, 'template', 'source=template on error');
    ok(res.error, 'error captured');
    nextFetchResponse = null;
  });

  // ── Config persistence ──
  await test('BrainConfig saves and reloads from localStorage', () => {
    run(`
      BrainConfig.provider = 'anthropic';
      BrainConfig.apiKey = 'persist-me';
      BrainConfig.level = 'advanced';
      BrainConfig.save();
      // wipe in-memory then reload
      BrainConfig.provider = 'none'; BrainConfig.apiKey = ''; BrainConfig.level = 'beginner';
      BrainConfig.load();
    `);
    eq(run(`BrainConfig.provider`), 'anthropic', 'provider persisted');
    eq(run(`BrainConfig.apiKey`), 'persist-me', 'key persisted');
    eq(run(`BrainConfig.level`), 'advanced', 'level persisted');
  });

  // ── Chat requires config ──
  await test('Brain.chat rejects when unconfigured', async () => {
    run(`BrainConfig.provider = 'none'; BrainConfig.apiKey = '';`);
    let threw = false;
    try { await run(`Brain.chat([{role:'user',content:'hi'}], __g)`); }
    catch (e) { threw = true; }
    ok(threw, 'throws without provider');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
