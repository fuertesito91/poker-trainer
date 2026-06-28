/* =====================================================
   Builder/Evaluator loop orchestrator.

   For each iteration:
     1. screenshot BEFORE states
     2. builder proposes ONE improvement (constrained edits)
     3. apply edits to the working copy
     4. GATE: run the test suite (must pass) AND re-render
        every state (must still render) — else REVERT
     5. screenshot AFTER states
     6. evaluator scores BEFORE vs AFTER -> keep | revert
     7. keep => snapshot becomes the new baseline; revert =>
        restore the pre-iteration files

   Kept changes accumulate in loop/.work, are copied back into
   the app, and committed to a fresh branch. A markdown report
   with screenshots + scores is written to loop/runs/<ts>/.
   Nothing is pushed; you review and merge.

   Usage:
     ANTHROPIC_API_KEY=... node loop/run.js
     LOOP_ITERATIONS=3 node loop/run.js          # fewer iterations
     node loop/run.js --dry-run                  # no LLM/no API key:
        exercises the harness (server, screenshots, test gate) only
   ===================================================== */
const fs = require('fs');
const path = require('path');
const { execFile, execSync, spawn } = require('child_process');
const cfg = require('./config');
const shot = require('./screenshot');

const DRY = process.argv.includes('--dry-run');

const log = (...a) => console.log('[loop]', ...a);
const ts = () => new Date().toISOString().replace(/[:.]/g, '-');

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function cpDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (['node_modules', '.git', 'loop'].includes(e.name)) continue;
    const s = path.join(src, e.name), d = path.join(dest, e.name);
    if (e.isDirectory()) cpDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Snapshot/restore just the editable files (cheap revert).
function snapshotEditable() {
  const snap = {};
  for (const f of cfg.EDITABLE) snap[f] = fs.readFileSync(path.join(cfg.workDir, f), 'utf8');
  return snap;
}
function restoreEditable(snap) {
  for (const f of cfg.EDITABLE) fs.writeFileSync(path.join(cfg.workDir, f), snap[f]);
}

// Static server over the working copy.
function startServer() {
  const bin = path.join(cfg.ROOT, 'node_modules', '.bin', 'live-server');
  const args = [`--port=${cfg.server.port}`, '--no-browser', '--quiet', cfg.workDir];
  const proc = spawn(bin, args, { stdio: 'ignore' });
  return proc;
}

// Run the app's test suite against the working copy. Resolves true if green.
function runTests() {
  return new Promise((resolve) => {
    execFile('npm', ['test'], { cwd: cfg.workDir, timeout: 120000 }, (err, stdout) => {
      const out = (stdout || '') + '';
      resolve(!err && /0 failed/.test(out) && /smoke OK/.test(out));
    });
  });
}

async function main() {
  log(DRY ? 'DRY RUN (no LLM calls)' : `live run, ${cfg.ITERATIONS} iterations, model ${cfg.llm.model}`);
  if (!DRY && !cfg.llm.apiKey) {
    console.error('ANTHROPIC_API_KEY not set. Use --dry-run to test the harness, or export the key.');
    process.exit(1);
  }

  // Fresh working copy of the app.
  rmrf(cfg.workDir);
  cpDir(cfg.ROOT, cfg.workDir);
  // The working copy needs node_modules for `npm test` + live-server; symlink it.
  try { fs.symlinkSync(path.join(cfg.ROOT, 'node_modules'), path.join(cfg.workDir, 'node_modules'), 'dir'); }
  catch (_) { /* fall back: tests run from ROOT bin via absolute path below */ }

  const runDir = path.join(cfg.outDir, ts());
  fs.mkdirSync(runDir, { recursive: true });
  const serverUrl = `http://127.0.0.1:${cfg.server.port}`;

  const server = startServer();
  await new Promise(r => setTimeout(r, 1500));   // let the server come up

  const history = [];        // kept improvements
  const iterationLog = [];

  try {
    // Lazy-require LLM modules so --dry-run works with no key/deps issues.
    const builder = DRY ? null : require('./builder');
    const evaluator = DRY ? null : require('./evaluator');

    for (let i = 1; i <= (DRY ? 1 : cfg.ITERATIONS); i++) {
      log(`──── iteration ${i} ────`);
      const iterDir = path.join(runDir, `iter-${String(i).padStart(2, '0')}`);
      fs.mkdirSync(iterDir, { recursive: true });

      // 1. BEFORE screenshots.
      const before = await shot.captureAll(cfg.workDir, serverUrl, iterDir, 'before_');
      const beforeOk = before.every(r => r.ok);
      log(`before screenshots: ${beforeOk ? 'ok' : 'FAILED'}`);

      if (DRY) {
        // Exercise the test gate too, then stop.
        const green = await runTests();
        log(`dry-run test gate: ${green ? 'green' : 'RED'}`);
        iterationLog.push({ i, dryRun: true, beforeOk, testsGreen: green });
        break;
      }

      const snap = snapshotEditable();

      // 2. Builder proposes.
      let plan;
      try {
        plan = await builder.propose({ shotDir: iterDir, history });
        log(`builder: "${plan.title}"`);
      } catch (e) {
        log(`builder failed: ${e.message}`); iterationLog.push({ i, error: 'builder: ' + e.message }); continue;
      }

      // 3. Apply edits.
      const { applied, failures } = builder.applyEdits(plan);
      log(`applied ${applied}/${plan.edits.length} edits` + (failures.length ? ` (${failures.length} rejected)` : ''));
      if (applied === 0) { restoreEditable(snap); iterationLog.push({ i, title: plan.title, kept: false, reason: 'no edits applied', failures }); continue; }

      // 4. GATE: tests + render.
      const green = await runTests();
      if (!green) {
        log('GATE FAIL: tests red -> revert');
        restoreEditable(snap);
        iterationLog.push({ i, title: plan.title, kept: false, reason: 'tests failed', failures });
        continue;
      }
      // 5. AFTER screenshots (doubles as the render gate).
      const after = await shot.captureAll(cfg.workDir, serverUrl, iterDir, 'after_');
      if (!after.every(r => r.ok)) {
        log('GATE FAIL: render broke -> revert');
        restoreEditable(snap);
        iterationLog.push({ i, title: plan.title, kept: false, reason: 'render failed', failures });
        continue;
      }

      // 6. Evaluator.
      const pairs = cfg.states.map(s => ({
        stateLabel: s.label,
        before: path.join(iterDir, `before_${s.id}.png`),
        after: path.join(iterDir, `after_${s.id}.png`),
      }));
      let verdict;
      try {
        verdict = await evaluator.evaluate({ plan, pairs });
      } catch (e) {
        log(`evaluator failed: ${e.message} -> revert (safe default)`);
        restoreEditable(snap);
        iterationLog.push({ i, title: plan.title, kept: false, reason: 'evaluator error: ' + e.message });
        continue;
      }
      log(`evaluator: ${verdict.verdict} (overall ${verdict.overall}, delta ${verdict.delta}) — ${verdict.reason}`);

      // 7. Keep or revert.
      if (verdict.verdict === 'keep' && verdict.delta > 0 && (!verdict.regressions || !verdict.regressions.length)) {
        history.push({ title: plan.title, rationale: plan.rationale, verdict });
        iterationLog.push({ i, title: plan.title, kept: true, verdict, edits: plan.edits.length });
      } else {
        restoreEditable(snap);
        iterationLog.push({ i, title: plan.title, kept: false, reason: 'evaluator: ' + verdict.verdict, verdict });
      }
    }
  } finally {
    try { server.kill(); } catch (_) {}
  }

  // Write the report + a visual gallery (before/after for every attempt).
  writeReport(runDir, history, iterationLog);
  try {
    execSync(`node ${path.join(__dirname, 'gallery.js')} "${runDir}"`, { stdio: 'inherit' });
  } catch (_) { /* gallery is best-effort */ }

  // Persist kept changes back to the app on a fresh branch (no push).
  if (!DRY && history.length) {
    for (const f of cfg.EDITABLE) {
      fs.copyFileSync(path.join(cfg.workDir, f), path.join(cfg.ROOT, f));
    }
    const branch = `${cfg.branchPrefix}-${ts()}`;
    try {
      execSync(`git checkout -b ${branch}`, { cwd: cfg.ROOT, stdio: 'inherit' });
      execSync(`git add ${cfg.EDITABLE.join(' ')}`, { cwd: cfg.ROOT, stdio: 'inherit' });
      execSync(`git commit -m "loop: ${history.length} kept UX/UI improvement(s)\n\n${history.map(h => '- ' + h.title).join('\n')}"`, { cwd: cfg.ROOT, stdio: 'inherit' });
      log(`kept ${history.length} change(s) committed to branch ${branch} (not pushed). Report: ${runDir}/report.md`);
    } catch (e) {
      log(`git branch/commit step skipped: ${e.message}. Changes are in your working tree.`);
    }
  } else if (!DRY) {
    log('No improvements were kept this run.');
  }

  log('done. Report: ' + path.join(runDir, 'report.md'));
}

function writeReport(runDir, history, iterationLog) {
  const rel = (p) => path.relative(runDir, p);
  let md = `# UX/UI Builder–Evaluator run\n\n`;
  md += `Date: ${new Date().toISOString()}\n\nModel: ${cfg.llm.model}\n\n`;
  md += `Kept ${history.length} improvement(s).\n\n## Iterations\n\n`;
  for (const it of iterationLog) {
    if (it.dryRun) { md += `- Iteration ${it.i}: DRY RUN — before screenshots ${it.beforeOk ? 'ok' : 'failed'}, test gate ${it.testsGreen ? 'green' : 'red'}\n`; continue; }
    if (it.error) { md += `- Iteration ${it.i}: error — ${it.error}\n`; continue; }
    const v = it.verdict;
    md += `- Iteration ${it.i}: **${it.kept ? 'KEPT' : 'reverted'}** — ${it.title || '(no plan)'}` +
          (it.reason ? ` _(${it.reason})_` : '') +
          (v ? ` — overall ${v.overall}, delta ${v.delta}` : '') + `\n`;
  }
  md += `\n## Kept improvements\n\n`;
  history.forEach((h, i) => {
    md += `${i + 1}. **${h.title}** — ${h.rationale || ''} (delta ${h.verdict.delta}, overall ${h.verdict.overall})\n`;
  });
  md += `\n## Screenshots\n\nEach iteration folder contains before_*.png / after_*.png for the captured states.\n`;
  fs.writeFileSync(path.join(runDir, 'report.md'), md);
  fs.writeFileSync(path.join(runDir, 'log.json'), JSON.stringify({ history, iterationLog }, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
