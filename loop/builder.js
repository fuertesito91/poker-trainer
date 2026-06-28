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

You have TWO ways to make a change. Output ONLY JSON (no prose).

OPTION A — "feature" (PREFERRED for new teaching visuals): build a NEW visible component reliably. You provide the JS that returns the component's HTML and the CSS that styles it; the harness installs BOTH atomically (no fragile string matching). This is the most reliable way to add an equity meter, outs overlay, pot-odds bar, etc.
  {
    "title": "...", "rationale": "...",
    "feature": {
      "js": "<JS statements that RETURN an HTML string using the live data 'a'>",
      "css": "<CSS rules for the classes used in that HTML>"
    }
  }
The "js" becomes the body of advisorExtrasHTML(a), which is injected at the TOP of the advisor card (shown when the player can act on the flop/turn and in study mode). It MUST end by returning a string (e.g. return '<div class=\\"equity-meter\\">...'). Use INLINE style attributes for any data-driven values (widths/colors). Available fields on 'a':
  a.equity (0-100 number), a.potOddsPct (0-100), a.needed (chips to call),
  a.recommend, a.color ('green'|'yellow'|'red'), a.handName,
  a.range {label, pct}, a.outs {outs, draws[], outCards[] (each .display and .color), pctTurn, pctRiver},
  a.calc {winPct, tiePct, losePct, cardsToCome, call, potBeforeCall}
Example js: "const eq=Math.round(a.equity); const c=eq>=60?'#2d9f5e':eq>=40?'#d68910':'#c0392b'; return '<div class=\\"equity-meter\\"><div class=\\"equity-fill\\" style=\\"width:'+eq+'%;background:'+c+'\\"></div><span class=\\"equity-label\\">'+eq+'% to win</span></div>';"
Example css: ".equity-meter{position:relative;height:24px;border-radius:12px;background:rgba(0,0,0,.4);margin:8px 0;overflow:hidden}.equity-fill{position:absolute;inset:0}.equity-label{position:relative;z-index:1;display:block;text-align:center;line-height:24px;font-weight:800;color:#fff}"

OPTION B — "edits" (for restyling EXISTING elements, e.g. felt, cards, chips, buttons, typography, colors):
  { "title":"...", "rationale":"...", "edits":[ { "file":"style.css|app.js|index.html", "find":"<exact unique existing substring>", "replace":"<new substring>" } ] }
- "find" must be an exact, unique substring copied verbatim (enough context to be unique). Whitespace is matched flexibly, but copy it as closely as you can.
- Edits are applied ATOMICALLY: if ANY edit fails to match, the WHOLE change is rejected and nothing is applied — so make every find/replace count.

You may include EITHER "feature" OR "edits" (or both). Prefer "feature" whenever you are adding something new and visible.

HARD RULES:
- NEVER break functionality, element IDs the JS relies on, or the test suite. Do not touch the service worker. Do not rewrite whole files.
- The evaluator only sees STATIC screenshots: nothing hover/focus/animation-only — it's invisible and always reverted. Everything must show in the default rendered state.
- No timid generic tweaks (nudging one font size/opacity) — they score 0. Be genuinely creative or genuinely improve teaching.
- Stay legible and cohesive — bold is good, broken or cluttered is not.
- Do not repeat a change already applied or already rejected; pick a DIFFERENT area each turn (table felt, cards, chips/bets, odds explainer, advisor, coach dock, showdown, controls, headings, color system, NEW teaching visuals, etc.).`;

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
  const hasFeature = plan.feature && (plan.feature.js || plan.feature.css);
  const hasEdits = Array.isArray(plan.edits) && plan.edits.length;
  if (!hasFeature && !hasEdits) throw new Error('builder returned neither a feature nor edits');
  return plan;
}

// Locate an exact substring, tolerating differences in run-length whitespace
// (the model often slightly reflows indentation). Returns {index,len} or null.
function findFlexible(src, find) {
  let idx = src.indexOf(find);
  if (idx !== -1 && src.indexOf(find, idx + 1) === -1) return { index: idx, len: find.length };
  // Whitespace-flexible: match the find as a regex where any whitespace run in
  // `find` matches any whitespace run in the source.
  const esc = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const re = new RegExp(esc);
  const m = re.exec(src);
  if (!m) return null;
  // Ensure uniqueness of the flexible match.
  const re2 = new RegExp(esc, 'g'); let count = 0; while (re2.exec(src)) count++;
  if (count !== 1) return null;
  return { index: m.index, len: m[0].length };
}

// Install a "feature": set the body of advisorExtrasHTML and append CSS, both
// via sentinels so there is NO fragile string matching. Returns true on success.
function applyFeature(feature) {
  let ok = true;
  if (feature.js) {
    const fp = path.join(cfg.workDir, 'app.js');
    let src = fs.readFileSync(fp, 'utf8');
    const re = /\/\* EXTRAS:START \*\/[\s\S]*?\/\* EXTRAS:END \*\//;
    if (!re.test(src)) return false;
    // Indent the supplied body and wrap in the sentinels.
    const body = String(feature.js).trim();
    src = src.replace(re, `/* EXTRAS:START */\n  ${body}\n  /* EXTRAS:END */`);
    fs.writeFileSync(fp, src);
  }
  if (feature.css) {
    const fp = path.join(cfg.workDir, 'style.css');
    let src = fs.readFileSync(fp, 'utf8');
    const marker = '/* EXTRAS-CSS:END */';
    if (!src.includes(marker)) return false;
    // Append the rules just before the END sentinel (accumulates across turns).
    src = src.replace(marker, `${String(feature.css).trim()}\n${marker}`);
    fs.writeFileSync(fp, src);
  }
  return ok;
}

// Apply a plan ATOMICALLY. Either everything applies or nothing does.
// Returns { applied, failures }.
function applyEdits(plan) {
  const failures = [];

  // First validate + stage edits against in-memory copies so we can abort
  // without having written anything (true atomicity).
  const staged = {};   // file -> new content
  const load = (f) => (staged[f] !== undefined ? staged[f] : fs.readFileSync(path.join(cfg.workDir, f), 'utf8'));

  if (Array.isArray(plan.edits)) {
    for (const edit of plan.edits) {
      if (!cfg.EDITABLE.includes(edit.file)) { failures.push(`${edit.file}: not editable`); continue; }
      if (typeof edit.find !== 'string' || !edit.find.length) { failures.push(`${edit.file}: empty find`); continue; }
      const src = load(edit.file);
      const hit = findFlexible(src, edit.find);
      if (!hit) { failures.push(`${edit.file}: find not found/unique`); continue; }
      staged[edit.file] = src.slice(0, hit.index) + (edit.replace ?? '') + src.slice(hit.index + hit.len);
    }
  }

  // Atomic: if any edit failed, apply NOTHING (avoid half-applied features).
  if (failures.length) return { applied: 0, failures };

  // Commit staged edits.
  let applied = 0;
  for (const f of Object.keys(staged)) { fs.writeFileSync(path.join(cfg.workDir, f), staged[f]); applied++; }

  // Then install the feature (sentinel-based; can't partially fail on matching).
  if (plan.feature && (plan.feature.js || plan.feature.css)) {
    if (applyFeature(plan.feature)) applied++;
    else failures.push('feature: extension sentinels not found');
  }

  return { applied, failures };
}

module.exports = { propose, applyEdits, applyFeature, readFiles };
