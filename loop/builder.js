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
- Do not repeat a change already applied or already rejected; pick a DIFFERENT area each turn (table felt, cards, chips/bets, the odds explainer, advisor, coach dock, showdown, controls, headings, color system, etc.).

ADDING NEW UI (IMPORTANT — this is how you build NEW teaching visuals so they ACTUALLY render):
A common failure is writing CSS for a new element (e.g. an "equity meter") while never adding the HTML element itself — so nothing appears and it gets reverted. To add NEW visible DOM you MUST do BOTH in the same turn:
  (1) Generate the element's HTML from JS, AND (2) style it in CSS.
The app gives you a dedicated, safe injection point for advisor/teaching visuals — the function 'advisorExtrasHTML(a)' in app.js. By default it is:
    function advisorExtrasHTML(a) {
      return ''; // EXTENSION POINT — return HTML to add a teaching visual.
    }
To add a teaching visual, REPLACE the line  return ''; // EXTENSION POINT — return HTML to add a teaching visual.
with JS that builds and returns an HTML string using the live data on 'a'. The element is injected at the TOP of the advisor card (which renders whenever the player can act on the flop/turn, and in study mode). Available fields on 'a':
  a.equity (0-100 number), a.potOddsPct (0-100), a.needed (chips to call),
  a.recommend (string), a.color ('green'|'yellow'|'red'), a.handName,
  a.range {label, pct}, a.outs {outs, draws[], outCards[] (each has .display and .color), pctTurn, pctRiver},
  a.calc {winPct, tiePct, losePct, cardsToCome, call, potBeforeCall}
Example pattern (you invent the actual design — be creative): replace the EXTENSION POINT line with something like
  const eq = Math.round(a.equity); return '<div class="equity-meter"><div class="equity-fill" style="width:'+eq+'%"></div><span>'+eq+'% to win</span></div>';
Then add the matching CSS: in style.css there is exactly one line:
    /* ===== EXTENSION STYLES (append new component rules above this exact line) ===== */
REPLACE that entire line with  <your new CSS rules>\n followed by that same exact line (so the anchor is preserved for next time). Use inline style attributes in the JS for any data-driven values (widths, colors) since CSS can't read JS values.
Rules for new DOM: keep returned HTML self-contained, escape nothing that's already numeric, never reference IDs that don't exist, and make it visible in the default state (no hover-only reveal).`;

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

  // Give the model the CSS in full (safest, highest-leverage surface) and the
  // HTML in full. For app.js, include the head (data shapes) PLUS the advisor
  // render region around the extension point, so the model can always find the
  // exact strings to target when adding new teaching DOM.
  const appjs = files['app.js'];
  const anchor = appjs.indexOf('function advisorExtrasHTML');
  let appExcerpt = appjs.slice(0, 16000) + '\n…(truncated)…\n';
  if (anchor !== -1) {
    // Grab from a bit before the extension stub through renderAdvisor's end.
    const start = Math.max(0, anchor - 400);
    const end = Math.min(appjs.length, anchor + 4500);
    appExcerpt += `\n=== app.js (advisor render + EXTENSION POINT — target these exact strings to add teaching visuals) ===\n` +
      appjs.slice(start, end) + '\n…';
  }
  const fileText =
    `=== index.html ===\n${files['index.html']}\n\n` +
    `=== style.css ===\n${files['style.css']}\n\n` +
    `=== app.js ===\n` + appExcerpt;

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
