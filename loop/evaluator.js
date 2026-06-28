/* =====================================================
   Evaluator: a vision LLM compares BEFORE vs AFTER
   screenshots (plus the change summary) and scores the
   UX/UI, returning a keep/revert verdict.
   ===================================================== */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { call, textBlock, imageBlock, parseJSON } = require('./llm');

const EVAL_SYSTEM = `You are an award-winning product designer AND a poker instructor, reviewing one UI change to a poker TRAINER web app. The app's purpose is to TEACH people Texas Hold'em — so a change is only valuable if it makes the app teach better and/or look genuinely more beautiful and distinctive. You are shown BEFORE and AFTER screenshots plus a description of the change.

WHAT YOU REWARD (in priority order):
1. LEARNABILITY (weight 40%) — does the AFTER help a beginner understand poker faster? Clearer odds/outs explanations, better visual teaching aids (e.g. highlighting winning cards, illustrating outs, showing pot-odds maths visually), guidance that builds intuition, reduced cognitive load on the learning content. This matters most.
2. CREATIVITY & VISUAL APPEAL (weight 35%) — is the AFTER more original, polished and delightful? Reward a distinctive, premium "real poker room" aesthetic: rich felt/table textures, refined card and chip styling, considered color and depth, elegant typography, cohesive theming. PENALIZE generic, bland, default-looking Bootstrap-ish results.
3. CLARITY & USABILITY (weight 25%) — legibility, hierarchy, affordances, spacing, no clutter.

SCORING — rate the AFTER 1-10 on each:
- learnability, creativity, visual_appeal, clarity, usability

Then output ONLY JSON:
{
  "scores": { "learnability": n, "creativity": n, "visual_appeal": n, "clarity": n, "usability": n },
  "overall": n,            // 1-10 weighted overall quality of the AFTER
  "delta": n,              // -5..+5, how much better (or worse) AFTER is vs BEFORE
  "verdict": "keep" | "revert",
  "reason": "1-2 sentences naming the learnability and/or creative impact",
  "regressions": ["any visual breakage, lost readability, or broken layout, or empty"]
}

JUDGING RULES:
- A change that is merely "fine" or "standard" with no real teaching or creative gain is NOT good enough — give it delta 0 and revert. We are explicitly trying to escape a bog-standard UI.
- Strongly reward bold, tasteful creative leaps and anything that visibly improves how the game TEACHES. A striking, cohesive redesign of a component should score high even if it's a big visual change, AS LONG AS it stays legible and nothing is broken.
- Revert anything that breaks layout, hurts readability/contrast, hides information, or adds clutter.
- Only "keep" when delta > 0 and there are no regressions.`;

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
