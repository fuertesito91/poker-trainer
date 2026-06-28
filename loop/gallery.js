/* =====================================================
   Build a single self-contained HTML gallery for a loop
   run: every iteration's BEFORE/AFTER screenshots side by
   side, per state, with the evaluator's verdict and reason.

   Usage:
     node loop/gallery.js                 # newest run
     node loop/gallery.js <runDir>        # a specific run folder
   Opens: <runDir>/gallery.html
   ===================================================== */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

function newestRun() {
  if (!fs.existsSync(cfg.outDir)) return null;
  const runs = fs.readdirSync(cfg.outDir)
    .map(n => path.join(cfg.outDir, n))
    .filter(p => fs.statSync(p).isDirectory())
    .sort();
  return runs.length ? runs[runs.length - 1] : null;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function build(runDir) {
  const logPath = path.join(runDir, 'log.json');
  if (!fs.existsSync(logPath)) throw new Error(`no log.json in ${runDir}`);
  const { iterationLog = [] } = JSON.parse(fs.readFileSync(logPath, 'utf8'));

  const stateIds = cfg.states.map(s => ({ id: s.id, label: s.label }));

  let cards = '';
  for (const it of iterationLog) {
    const iterDir = path.join(runDir, `iter-${String(it.i).padStart(2, '0')}`);
    const kept = it.kept === true;
    const status = it.dryRun ? 'DRY' : kept ? 'KEPT' : 'REVERTED';
    const v = it.verdict || {};
    const scores = v.scores
      ? Object.entries(v.scores).map(([k, val]) => `${k.replace(/_/g, ' ')}: <b>${val}</b>`).join(' · ')
      : '';

    // Per-state before/after rows (only render states that have files).
    let rows = '';
    for (const s of stateIds) {
      const before = path.join(iterDir, `before_${s.id}.png`);
      const after = path.join(iterDir, `after_${s.id}.png`);
      const beforeRel = fs.existsSync(before) ? path.relative(runDir, before) : null;
      const afterRel = fs.existsSync(after) ? path.relative(runDir, after) : null;
      if (!beforeRel && !afterRel) continue;
      rows += `
        <div class="state">
          <div class="state-label">${esc(s.label)}</div>
          <div class="pair">
            <figure>${beforeRel ? `<img loading="lazy" src="${beforeRel}">` : '<div class="missing">no before</div>'}<figcaption>before</figcaption></figure>
            <figure>${afterRel ? `<img loading="lazy" src="${afterRel}">` : '<div class="missing">no after (reverted before screenshot, or render failed)</div>'}<figcaption>after</figcaption></figure>
          </div>
        </div>`;
    }

    cards += `
      <section class="iter ${kept ? 'kept' : 'reverted'}">
        <header>
          <span class="badge ${kept ? 'b-kept' : 'b-rev'}">${status}</span>
          <h2>Iteration ${it.i}: ${esc(it.title || it.error || '(no plan)')}</h2>
          ${v.overall != null ? `<span class="meta">overall ${esc(v.overall)} · delta ${esc(v.delta)}</span>` : ''}
        </header>
        ${it.reason ? `<p class="reason"><b>Decision:</b> ${esc(it.reason)}</p>` : ''}
        ${v.reason ? `<p class="reason"><b>Evaluator:</b> ${esc(v.reason)}</p>` : ''}
        ${v.regressions && v.regressions.length ? `<p class="regressions"><b>Regressions:</b> ${esc(v.regressions.join('; '))}</p>` : ''}
        ${scores ? `<p class="scores">${scores}</p>` : ''}
        ${rows || '<p class="reason">No screenshots for this iteration (e.g. builder error before render).</p>'}
      </section>`;
  }

  const keptCount = iterationLog.filter(x => x.kept).length;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>Loop gallery — ${esc(path.basename(runDir))}</title>
<style>
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#13131f; color:#eee; margin:0; padding:24px; }
  h1 { font-size:1.3rem; } .sub { opacity:.6; font-size:.85rem; margin-bottom:24px; }
  .iter { border:1px solid #2a2a3d; border-radius:12px; padding:16px 18px; margin-bottom:22px; background:#1b1b2b; }
  .iter.kept { border-left:4px solid #2d9f5e; } .iter.reverted { border-left:4px solid #c0392b; }
  header { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
  header h2 { font-size:1rem; margin:0; }
  .badge { font-size:.65rem; font-weight:800; padding:2px 8px; border-radius:10px; letter-spacing:.5px; }
  .b-kept { background:#2d9f5e; color:#fff; } .b-rev { background:#c0392b; color:#fff; }
  .meta { opacity:.6; font-size:.78rem; margin-left:auto; }
  .reason { font-size:.85rem; opacity:.9; margin:6px 0; } .regressions { color:#f0a; font-size:.82rem; }
  .scores { font-size:.74rem; opacity:.7; margin:6px 0 10px; }
  .state { margin-top:12px; } .state-label { font-size:.78rem; opacity:.7; margin-bottom:6px; text-transform:uppercase; letter-spacing:.5px; }
  .pair { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  figure { margin:0; } figure img { width:100%; border:1px solid #333; border-radius:8px; display:block; }
  figcaption { text-align:center; font-size:.72rem; opacity:.6; margin-top:4px; }
  .missing { padding:30px; text-align:center; background:#222; border-radius:8px; font-size:.78rem; opacity:.5; }
</style></head><body>
  <h1>🃏 UX/UI loop gallery</h1>
  <div class="sub">${esc(path.basename(runDir))} · ${iterationLog.length} iterations · ${keptCount} kept · click images to open full size</div>
  ${cards}
  <script>document.querySelectorAll('img').forEach(i=>i.addEventListener('click',()=>window.open(i.src)));</script>
</body></html>`;

  const out = path.join(runDir, 'gallery.html');
  fs.writeFileSync(out, html);
  return out;
}

const arg = process.argv[2];
const runDir = arg ? path.resolve(arg) : newestRun();
if (!runDir) { console.error('No run found. Pass a run directory.'); process.exit(1); }
const out = build(runDir);
console.log('Gallery: ' + out);
