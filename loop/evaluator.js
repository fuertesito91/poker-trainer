/* =====================================================
   Evaluator: a vision LLM compares BEFORE vs AFTER
   screenshots (plus the change summary) and scores the
   UX/UI, returning a keep/revert verdict.
   ===================================================== */
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const { call, textBlock, imageBlock, parseJSON } = require('./llm');

const EVAL_SYSTEM = `You are a meticulous product designer reviewing a single UI change to a poker TRAINER web app. You are shown BEFORE and AFTER screenshots of the same states plus a description of the change.

Score the AFTER vs the BEFORE on a 1-10 scale for each of:
- visual_hierarchy, legibility, spacing_layout, affordance_clarity, learning_clarity, aesthetics

Then decide keep or revert. Output ONLY JSON:
{
  "scores": { "visual_hierarchy": n, "legibility": n, "spacing_layout": n, "affordance_clarity": n, "learning_clarity": n, "aesthetics": n },
  "overall": n,            // 1-10 overall AFTER quality
  "delta": n,              // -5..+5, how much better (or worse) AFTER is vs BEFORE
  "verdict": "keep" | "revert",
  "reason": "1-2 sentences",
  "regressions": ["any visual breakage you can see, or empty"]
}

Be strict: if the change made things worse, broke layout, reduced contrast, or added clutter, choose "revert". Only "keep" a genuine improvement with delta > 0 and no regressions.`;

// `pairs` = [{ stateLabel, before, after }]. Returns the parsed verdict.
async function evaluate({ plan, pairs }) {
  const content = [
    textBlock(
      `Change under review: "${plan.title}".\nRationale given by the builder: ${plan.rationale || '(none)'}\n\n` +
      `Below are BEFORE/AFTER screenshot pairs for each state. Judge the visual + UX impact.`),
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
