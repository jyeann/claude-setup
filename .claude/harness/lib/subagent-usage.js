'use strict';
// Cost of a finished subagent, read from the subagent's own transcript (the SubagentStop hook event gives its
// path as `agent_transcript_path`). This is how a run that the host moved to the background gets a cost: the
// PostToolUse event for such a run carries no usage (status "async_launched"), but SubagentStop fires when it ends.
// The transcript is JSON lines. An assistant message is written once per content block, all with the same
// message.id and the same usage, so usage is counted once per message id (the last record wins).
// Tokens are the sum of input, output, cache-creation and cache-read tokens over every API request of the run:
// the same four categories the host's own `totalTokens` adds, but over the whole run, not the final request.
// The transcript format is the host's and is not a documented contract: anything not found stays null.
const fs = require('node:fs');

const MAX_BYTES = 64 * 1024 * 1024;
const n = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : 0);

function summarizeTranscript(file) {
  let text;
  try {
    if (typeof file !== 'string' || !file.endsWith('.jsonl') || fs.statSync(file).size > MAX_BYTES) return null;
    text = fs.readFileSync(file, 'utf8');
  } catch { return null; }
  const usageById = new Map();
  const toolIds = new Set();
  const models = [];
  let first = null;
  let last = null;
  let anonymous = 0;
  for (const line of text.split('\n')) {
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    const ts = Date.parse(rec?.timestamp);
    if (Number.isFinite(ts)) { first = first === null ? ts : Math.min(first, ts); last = last === null ? ts : Math.max(last, ts); }
    if (rec?.type !== 'assistant' || typeof rec.message !== 'object' || rec.message === null) continue;
    const m = rec.message;
    if (m.usage && typeof m.usage === 'object') usageById.set(m.id ?? `anon-${anonymous++}`, m.usage);
    if (typeof m.model === 'string' && models[models.length - 1] !== m.model) models.push(m.model);
    for (const block of Array.isArray(m.content) ? m.content : []) if (block?.type === 'tool_use' && block.id) toolIds.add(block.id);
  }
  if (usageById.size === 0 && first === null) return null;
  let input = 0; let output = 0; let cacheWrite = 0; let cacheRead = 0;
  for (const u of usageById.values()) {
    input += n(u.input_tokens); output += n(u.output_tokens); cacheWrite += n(u.cache_creation_input_tokens); cacheRead += n(u.cache_read_input_tokens);
  }
  return {
    tokens: usageById.size ? input + output + cacheWrite + cacheRead : null,
    inputTokens: usageById.size ? input + cacheWrite : null, outputTokens: usageById.size ? output : null, cacheReadTokens: usageById.size ? cacheRead : null,
    durationMs: first !== null && last !== null ? last - first : null,
    toolUses: toolIds.size, models,
  };
}

module.exports = { summarizeTranscript };
