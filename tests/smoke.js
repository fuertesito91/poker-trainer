/* =====================================================
   Smoke test: drive the real render() / renderLessons()
   through a minimal DOM shim to catch runtime errors in
   the view layer without a full browser. Node-only.
   ===================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

// Minimal element: supports the properties/methods the app touches.
function makeEl(id) {
  const el = {
    id,
    _html: '',
    style: {},
    classList: { toggle() {}, add() {}, remove() {} },
    dataset: {},
    hidden: false,
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
    textContent: '',
    value: '',
    addEventListener() {},
    querySelectorAll() { return []; },
    appendChild() {},
  };
  return el;
}

const elements = new Map();
const getEl = (id) => {
  if (!elements.has(id)) elements.set(id, makeEl(id));
  return elements.get(id);
};

const documentStub = {
  _domHandlers: {},
  getElementById: getEl,
  querySelector: () => null,
  addEventListener(type, fn) { (this._domHandlers[type] ||= []).push(fn); },
  body: { classList: { toggle() {}, add() {}, remove() {} } },
};

const localStorageStub = (() => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
})();

const sandbox = {
  console, Math, Date, JSON,
  document: documentStub,
  window: { addEventListener() {} },
  navigator: {},
  localStorage: localStorageStub,
  confirm: () => true,
  // Worker / Blob intentionally omitted so EquityWorker.init() no-ops headlessly.
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), ctx, { filename: 'app.js' });
const run = (code) => vm.runInContext(code, ctx);

let failed = 0;
function step(name, code) {
  try { run(code); console.log(`  ✓ ${name}`); }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

step('init (DOMContentLoaded) runs',
  // app.js registered its init via document.addEventListener('DOMContentLoaded').
  `document._domHandlers['DOMContentLoaded'].forEach(fn => fn());`);
step('start a hand and render',
  `game.startNewHand(); render();`);
step('player checks/calls without throwing',
  `if (game.waitingForAction) game.playerAction('call'); render();`);
step('open lessons and render',
  `Lessons.show();`);
step('run a drill for every lesson without throwing', `
  for (let i = 0; i < LESSONS.length; i++) Lessons.completed.add(LESSONS[i].id);
  for (let i = 0; i < LESSONS.length; i++) {
    Lessons.goto(i);
    Lessons.startDrill();
    Lessons.answerDrill(Lessons.activeDrill.correct);
  }
`);
step('open scenarios and answer each', `
  Scenarios.show();
  for (let i = 0; i < SCENARIOS.length; i++) {
    Scenarios.goto(i);
    Scenarios.answer(Scenarios.options(SCENARIOS[i])[0]);
  }
`);
step('close lessons', `Lessons.hide();`);
step('replay a recorded hand', `
  game.startNewHand({ seed: 555, button: 0 });
  // drive to completion so a history entry with a seed exists
  let guard = 0;
  while (game.street !== 'idle' && game.street !== 'gameover' && guard++ < 100) {
    if (game.waitingForAction) game.playerAction('call'); else break;
  }
  const h = game.handHistory[game.handHistory.length - 1];
  if (h) game.replayHand(h.seed, h.button);
  render();
`);
step('open coach chat (unconfigured) without throwing', `
  BrainConfig.provider = 'none';
  Coach.show();
  Coach.hide();
`);
step('render settings for each provider', `
  for (const p of ['none','openai','anthropic','ollama']) {
    BrainConfig.provider = p;
    Settings.show();
  }
  Settings.hide();
`);
step('buildGameContext + contextToText on live game', `
  game.startNewHand({ seed: 9, button: 0 });
  const c = buildGameContext(game);
  const t = contextToText(c);
  if (typeof t !== 'string' || !t.length) throw new Error('empty context text');
`);
step('bet badges render across a hand without throwing', `
  {
    game.startNewHand({ seed: 21, button: 0 });
    // renderBetBadge is exercised via renderTable() inside render().
    let badgeGuard = 0;
    while (game.street !== 'idle' && game.street !== 'gameover' && game.street !== 'showdown' && badgeGuard++ < 100) {
      render();
      if (game.waitingForAction) game.playerAction('call'); else break;
    }
    render();
  }
`);
step('raise controls (typed amount + quick sizes) render and a raise applies', `
  {
    game.startNewHand({ seed: 5, button: 0 });
    // Drive to a state where the player can act, then render controls (which
    // builds the number input + quick-size buttons) and perform a raise.
    let g = 0;
    while (g++ < 50 && !(game.waitingForAction && game.toAct === 'player')) {
      if (game.street === 'idle' || game.street === 'gameover' || game.street === 'showdown') break;
      if (game.waitingForAction) game.playerAction('check'); else break;
    }
    render();
    if (game.waitingForAction && game.toAct === 'player') {
      const before = game.pot;
      game.playerAction('raise', game.currentBet + BIG_BLIND * 4);
      render();
      if (game.pot <= before) throw new Error('raise did not increase the pot');
    }
  }
`);

console.log(`\n${failed ? failed + ' smoke failures' : 'smoke OK'}`);
process.exit(failed ? 1 : 0);
