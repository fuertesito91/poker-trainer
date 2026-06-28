/* =====================================================
   Poker Trainer — Headless test runner (Node)
   Loads app.js in a sandbox with minimal DOM/localStorage
   stubs, then runs the test suite. Exits non-zero on failure.
   Usage: node tests/run.js
   ===================================================== */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// Minimal browser-ish stubs so app.js evaluates without a DOM.
const noop = () => {};
const localStorageStub = (() => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
})();

const sandbox = {
  console,
  Math,
  Date,
  JSON,
  document: {
    addEventListener: noop,
    getElementById: () => null,
    querySelector: () => null,
    body: { classList: { toggle: noop, add: noop, remove: noop } },
  },
  window: { addEventListener: noop },
  navigator: {},
  localStorage: localStorageStub,
};
sandbox.globalThis = sandbox;

const context = vm.createContext(sandbox);

// Order matters: harness defines __TEST__, app.js defines game logic,
// tests.js runs the assertions.
for (const file of ['tests/harness.js', 'app.js', 'tests/tests.js']) {
  const code = read(file);
  vm.runInContext(code, context, { filename: file });
}

const results = sandbox.__TEST__.results;
let out = '';
for (const c of results.cases) {
  if (c.ok) {
    out += `  ✓ ${c.name}\n`;
  } else {
    out += `  ✗ ${c.name}\n      ${c.error}\n`;
  }
}
process.stdout.write(out);
process.stdout.write(`\n${results.passed} passed, ${results.failed} failed\n`);
process.exit(results.failed > 0 ? 1 : 0);
