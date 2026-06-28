/* =====================================================
   Minimal Anthropic client (text + vision) via fetch.
   No SDK. Reads key/model from config (env-backed).
   ===================================================== */
const fs = require('fs');
const cfg = require('./config');

// `content` is an array of Anthropic content blocks (text and/or image).
// Returns the assistant's text.
async function call(system, content, { maxTokens } = {}) {
  if (!cfg.llm.apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
  const res = await fetch(`${cfg.llm.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.llm.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: cfg.llm.model,
      system,
      max_tokens: maxTokens || cfg.llm.maxTokens,
      messages: [{ role: 'user', content }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.content || []).map(b => b.text || '').join('').trim();
}

// Helpers to assemble content blocks.
const textBlock = (text) => ({ type: 'text', text });
function imageBlock(pngPath) {
  const b64 = fs.readFileSync(pngPath).toString('base64');
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64 } };
}

// Extract the first JSON object from a model response (tolerates prose/fences).
// Models frequently emit code inside JSON strings with stray control characters
// or unescaped newlines, so we try strict parse first, then a tolerant repair.
function parseJSON(text) {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no JSON object in model response');
  const slice = raw.slice(start, end + 1);

  try { return JSON.parse(slice); } catch (_) { /* fall through to repair */ }

  // Repair pass: escape raw control characters (literal newlines/tabs) that appear
  // INSIDE JSON string literals — the most common cause of "Unterminated string".
  const repaired = escapeControlCharsInStrings(slice);
  try { return JSON.parse(repaired); }
  catch (e) { throw new Error('invalid JSON from model: ' + e.message); }
}

// Walk the text tracking whether we're inside a JSON string, and replace literal
// newline/CR/tab characters with their escaped forms while inside a string.
function escapeControlCharsInStrings(s) {
  let out = '';
  let inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) { out += ch; esc = false; continue; }
    if (ch === '\\') { out += ch; esc = true; continue; }
    if (ch === '"') { inStr = !inStr; out += ch; continue; }
    if (inStr) {
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
    }
    out += ch;
  }
  return out;
}

module.exports = { call, textBlock, imageBlock, parseJSON, escapeControlCharsInStrings };
