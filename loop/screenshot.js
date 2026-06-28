/* =====================================================
   Render key app states to PNG via headless Chrome.
   Builds a self-contained harness page that loads the
   target copy's index.html DOM + app.js, runs a state's
   setup script, then screenshots.
   ===================================================== */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const cfg = require('./config');

// Pull the <body> of the app's index.html so screenshots use the REAL markup
// (minus the service-worker script). We then inject app.js + a setup snippet.
function buildHarness(appDir, setupJs) {
  const indexHtml = fs.readFileSync(path.join(appDir, 'index.html'), 'utf8');
  const bodyMatch = indexHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let body = bodyMatch ? bodyMatch[1] : '';
  // Drop the existing script tags (we re-add app.js ourselves, skip the SW reg).
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<link rel="stylesheet" href="style.css"></head>
<body>
${body}
<script src="app.js"></script>
<script>
  // Run after the app's own DOMContentLoaded init has executed.
  window.addEventListener('load', () => {
    try { ${setupJs || 'render && render();'} } catch (e) { document.title = 'SETUP_ERROR: ' + e.message; }
  });
</script>
</body></html>`;
}

// Capture one state. Returns { ok, file, error }.
function capture(appDir, serverUrl, state, outFile) {
  return new Promise((resolve) => {
    const harnessName = `__harness_${state.id}.html`;
    const harnessPath = path.join(appDir, harnessName);
    fs.writeFileSync(harnessPath, buildHarness(appDir, state.setup));

    const url = `${serverUrl}/${harnessName}`;
    const args = [
      '--headless', '--disable-gpu', '--hide-scrollbars',
      `--window-size=${state.width || 1300},${state.height || 900}`,
      '--virtual-time-budget=2500',           // let render + a worker tick settle
      `--screenshot=${outFile}`,
      url,
    ];
    execFile(cfg.chrome, args, { timeout: 30000 }, (err) => {
      try { fs.unlinkSync(harnessPath); } catch (_) {}
      if (err) return resolve({ ok: false, error: String(err) });
      if (!fs.existsSync(outFile) || fs.statSync(outFile).size < 1000) {
        return resolve({ ok: false, error: 'screenshot missing or empty (render likely failed)' });
      }
      resolve({ ok: true, file: outFile });
    });
  });
}

// Capture all configured states into `destDir/<prefix><stateId>.png`.
async function captureAll(appDir, serverUrl, destDir, prefix = '') {
  fs.mkdirSync(destDir, { recursive: true });
  const results = [];
  for (const state of cfg.states) {
    const out = path.join(destDir, `${prefix}${state.id}.png`);
    const r = await capture(appDir, serverUrl, state, out);
    results.push({ state, ...r });
  }
  return results;
}

module.exports = { capture, captureAll, buildHarness };
