/* =====================================================
   Evaluator: a vision LLM compares BEFORE vs AFTER
   screenshots (plus the change summary) and scores the
   UX/UI, returning a keep/revert verdict.
   ===================================================== */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { call, textBlock, imageBlock, parseJSON } = require('./llm');

const EVAL_SYSTEM = `You are an exacting, award-winning product designer AND a poker instructor reviewing one UI change to a poker TRAINER web app. Judge it against an ABSOLUTE BAR: the best, most beautiful and most didactic poker-learning app you can imagine (think a premium, modern, design-led product — not a hobby project). The current app is competent but generic; we are explicitly trying to escape "bog-standard". You are shown BEFORE and AFTER screenshots plus a description of the change.

WHAT YOU REWARD (priority order), scored against that world-class bar:
1. LEARNABILITY (40%) — does the AFTER help a beginner understand poker faster? Visual teaching aids (equity meters, pot-odds gauges, outs grids, hand-strength ladders, board annotation), clearer odds/outs maths made visible, intuition-building, lower cognitive load.
2. CREATIVITY & VISUAL APPEAL (35%) — is the AFTER genuinely distinctive, premium and delightful, with a clear art direction (cohesive palette, depth/texture, refined cards & chips, elegant typography, character)? Generic, default-looking, or timid results score LOW even if technically clean.
3. CLARITY & USABILITY (25%) — legibility, hierarchy, contrast, no clutter.

SCORING — rate the AFTER 1-10 on each (10 = world-class):
- learnability, creativity, visual_appeal, clarity, usability

Then output ONLY JSON:
{
  "scores": { "learnability": n, "creativity": n, "visual_appeal": n, "clarity": n, "usability": n },
  "overall": n,            // 1-10 vs a WORLD-CLASS poker trainer (be stingy: a generic dark UI is ~4-5)
  "delta": n,              // -5..+5, how much better (or worse) AFTER is vs BEFORE
  "verdict": "keep" | "revert",
  "reason": "1-2 sentences naming the learnability and/or creative impact (or why it falls short)",
  "regressions": ["any visual breakage, lost readability, or broken layout, or empty"]
}

JUDGING RULES (be demanding):
- Hold a HIGH bar. A change that is merely "fine", safe, or incremental — a nudged size/color/spacing with no real teaching gain and no distinctive creative leap — is NOT good enough: give delta 0 and REVERT. We want ambitious, transformative changes.
- Strongly reward bold, cohesive, tasteful redesigns and genuinely new teaching visuals. A big, striking change that stays legible and unbroken should score high — do not penalize it merely for being a large change.
- Revert anything that breaks layout, hurts readability/contrast, hides information, looks unfinished, or adds clutter.
- Only "keep" when the AFTER is a clear, ambitious improvement (delta >= 2 ideally; never keep delta <= 0) with no regressions.`;

// `pairs` = [{ stateLabel, before, after }]. Returns the parsed verdict.
async function evaluate({ plan, pairs }) {
  const content = [
    textBlock(
      `Change under review: "${plan.title}".\nRationale given by the builder: ${plan.rationale || '(none)'}\n\n` +
      `Below are BEFORE/AFTER screenshot pairs for each state. Judge primarily on LEARNABILITY (does it teach poker better?) and CREATIVITY / VISUAL APPEAL (is it more distinctive and beautiful, not generic?), then clarity & usability.`),
  ];
  for (const p of pairs) {
    content.push(textBlock(`State: ${p.stateLabel} — BEFORE:`));
    content.push(imageBlock(p.before));
    content.push(textBlock(`State: ${p.stateLabel} — AFTER:`));
    content.push(imageBlock(p.after));
  }
  content.push(textBlock('Now output the JSON verdict.'));

  const reply = await call(EVAL_SYSTEM, content);
  const verdict = parseJSON(reply);
  if (!verdict.verdict) throw new Error('evaluator returned no verdict');
  return verdict;
}

module.exports = { evaluate };
