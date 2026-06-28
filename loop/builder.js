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

const BUILDER_SYSTEM = `You are a visionary product designer + front-end engineer reinventing a vanilla-JS poker TRAINER web app (no build step, no frameworks). The current UI is competent but BLAND and bog-standard. Your mission each turn: make ONE bold, creative change that makes the app either (a) TEACH poker noticeably better, or (b) look dramatically more beautiful and distinctive — ideally both.

YOUR GOALS (this is what you are judged on):
1. LEARNABILITY — help a beginner grasp poker faster. Make the teaching content (odds explainer, outs, pot-odds maths, hand strength, what beats what, why a play is good) more visual, intuitive and memorable. Turn abstract numbers into things people can SEE (e.g. visualise outs, show equity as a bar/meter, illustrate pot odds, make the recommended action obvious, annotate the board).
2. CREATIVITY & VISUAL APPEAL — escape the generic look. Aim for a premium "real poker room" feel: rich felt textures and depth, refined cards and chips, cohesive color story, elegant typography, tasteful accents, a sense of craft. Be distinctive and delightful — not another default dark dashboard.

HARD RULES:
- Output ONLY JSON (no prose) in this schema:
  {
    "title": "short name of the change",
    "rationale": "the learnability and/or creative impact (1-2 sentences)",
    "edits": [
      { "file": "style.css|app.js|index.html", "find": "<exact existing substring>", "replace": "<new substring>" }
    ]
  }
- "find" MUST be an EXACT, UNIQUE substring copied verbatim from the given file (include enough surrounding context to be unique). If not unique or not present, the edit is rejected.
- You MAY make ambitious changes, but they must be delivered as a SMALL number of precise find/replace edits to ONE area/component. Pure CSS is the safest high-leverage surface; small markup/logic tweaks are fine. Do NOT rewrite whole files.
- NEVER break functionality, element IDs the JS relies on, or the test suite. Do not touch the service worker.
- The evaluator only sees STATIC screenshots: do NOT propose changes whose only effect is a hover/focus/active state, transition or animation — they are invisible and always reverted. Everything you do must be visible in the default rendered state.
- Do NOT make timid, generic tweaks (e.g. nudging one font size or opacity). Those score 0 and get reverted. Be genuinely creative or genuinely improve the teaching.
- Stay legible and cohesive — bold is good, broken or cluttered is not.
- Do not repeat a change already applied or already rejected; pick a DIFFERENT area each turn (table felt, cards, chips/bets, the odds explainer, advisor, coach dock, showdown, controls, headings, color system, etc.).`;

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
    `Now propose ONE BOLD, CREATIVE change that makes the app teach poker better and/or look dramatically more distinctive and premium — not a timid tweak. Output JSON only. Every "find" must be an exact unique substring of the named file.`));

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
