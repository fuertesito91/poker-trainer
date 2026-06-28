/* =====================================================
   Builder: proposes ONE concrete UX/UI improvement and
   returns constrained find/replace edits. Edits use exact
   string matches so we can apply them deterministically
   without letting the model rewrite whole files.
   ===================================================== */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { call, textBlock, imageBlock, parseJSON } = require('./llm');

const BUILDER_SYSTEM = `You are a senior front-end engineer improving a vanilla-JS poker TRAINER web app (no build step, no frameworks). You make ONE small, safe, high-impact UX/UI improvement per turn.

HARD RULES:
- Output ONLY JSON (no prose) in this schema:
  {
    "title": "short name of the improvement",
    "rationale": "why this helps UX/UI (1-2 sentences)",
    "edits": [
      { "file": "style.css|app.js|index.html", "find": "<exact existing substring>", "replace": "<new substring>" }
    ]
  }
- "find" MUST be an EXACT, UNIQUE substring copied verbatim from the given file (include enough surrounding context to be unique). If it is not unique or not present, the edit is rejected.
- Keep edits SMALL and focused on ONE improvement. Prefer CSS and small markup/logic tweaks.
- NEVER break existing functionality, IDs, or the test suite. Do not remove element IDs the JS relies on. Do not touch the service worker.
- Favor: visual hierarchy, spacing, contrast/legibility, affordances, clarity of the learning content, responsive polish, micro-interactions. Avoid risky rewrites.
- Do not re-introduce a change that a previous iteration already made; build on the current state.`;

function readFiles() {
  const out = {};
  for (const f of cfg.EDITABLE) {
    out[f] = fs.readFileSync(path.join(cfg.workDir, f), 'utf8');
  }
  return out;
}

// Build the user content: prior-improvement memory + current file snippets +
// the latest screenshots so the model can see what it's improving.
async function propose({ shotDir, history }) {
  const files = readFiles();

  const memory = history.length
    ? `Improvements already applied this run (do NOT repeat):\n` +
      history.map((h, i) => `${i + 1}. ${h.title}`).join('\n')
    : 'No improvements applied yet.';

  // Give the model the CSS in full (it's the safest, highest-leverage surface)
  // and the HTML in full; for app.js, give a trimmed view to control token use.
  const fileText =
    `=== index.html ===\n${files['index.html']}\n\n` +
    `=== style.css ===\n${files['style.css']}\n\n` +
    `=== app.js (render/UI functions are the safest to touch) ===\n` +
    files['app.js'].slice(0, 18000) + '\n…(truncated)…';

  const content = [
    textBlock(`${memory}\n\nHere are screenshots of the current UI states:`),
  ];
  for (const s of cfg.states) {
    const p = path.join(shotDir, `before_${s.id}.png`);
    if (fs.existsSync(p)) {
      content.push(textBlock(`State: ${s.label}`));
      content.push(imageBlock(p));
    }
  }
  content.push(textBlock(
    `Current source files:\n\n${fileText}\n\n` +
    `Propose ONE improvement now as JSON. Remember: every "find" must be an exact unique substring of the named file.`));

  const reply = await call(BUILDER_SYSTEM, content);
  const plan = parseJSON(reply);
  if (!plan.edits || !Array.isArray(plan.edits) || !plan.edits.length) {
    throw new Error('builder returned no edits');
  }
  return plan;
}

// Apply edits to the working copy. Returns { applied, failures }.
function applyEdits(plan) {
  const failures = [];
  let applied = 0;
  for (const edit of plan.edits) {
    if (!cfg.EDITABLE.includes(edit.file)) { failures.push(`${edit.file}: not editable`); continue; }
    const fp = path.join(cfg.workDir, edit.file);
    const src = fs.readFileSync(fp, 'utf8');
    if (typeof edit.find !== 'string' || !edit.find.length) { failures.push(`${edit.file}: empty find`); continue; }
    const idx = src.indexOf(edit.find);
    if (idx === -1) { failures.push(`${edit.file}: find not found`); continue; }
    if (src.indexOf(edit.find, idx + 1) !== -1) { failures.push(`${edit.file}: find not unique`); continue; }
    fs.writeFileSync(fp, src.slice(0, idx) + (edit.replace ?? '') + src.slice(idx + edit.find.length));
    applied++;
  }
  return { applied, failures };
}

module.exports = { propose, applyEdits, readFiles };
