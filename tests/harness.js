/* =====================================================
   Poker Trainer — Tiny test harness
   Zero-dependency. Works both in the browser (tests.html)
   and in Node (tests/run.js). Collects results into
   globalThis.__TEST_RESULTS__.
   ===================================================== */
(function (root) {
  const results = { passed: 0, failed: 0, cases: [] };
  let currentSuite = '';

  function suite(name) { currentSuite = name; }

  function test(name, fn) {
    const label = currentSuite ? `${currentSuite} › ${name}` : name;
    try {
      fn();
      results.passed++;
      results.cases.push({ name: label, ok: true });
    } catch (err) {
      results.failed++;
      results.cases.push({ name: label, ok: false, error: err.message });
    }
  }

  function eq(actual, expected, msg) {
    if (actual !== expected) {
      throw new Error(`${msg || 'expected equal'} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    }
  }

  function ok(cond, msg) {
    if (!cond) throw new Error(msg || 'expected truthy');
  }

  function approx(actual, expected, tol, msg) {
    if (Math.abs(actual - expected) > tol) {
      throw new Error(`${msg || 'expected approx'} — got ${actual}, expected ${expected} ±${tol}`);
    }
  }

  root.__TEST__ = { suite, test, eq, ok, approx, results };
})(typeof globalThis !== 'undefined' ? globalThis : this);
