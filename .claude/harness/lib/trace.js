'use strict';
// Session trace: one compact JSON line per tool call, guard block and stop, kept under .harness/traces/.
// This is the raw material for scoring. It stores a redacted, truncated summary, never full tool input
// or output, and logging can never fail a tool call (every write is best-effort).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { scanSecrets } = require('./guards');

const STATE_DIR = '.harness';
const MAX_SUMMARY = 200;
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

const harnessDir = (projectDir) => path.join(projectDir, STATE_DIR);
const tracesDir = (projectDir) => path.join(harnessDir(projectDir), 'traces');
const safeId = (id) => String(id || 'unknown').replace(/[^\w.-]/g, '_').slice(0, 80) || 'unknown';

function redact(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (scanSecrets(flat).length > 0) return '[redacted: possible secret]';
  return flat.length > MAX_SUMMARY ? `${flat.slice(0, MAX_SUMMARY)}…` : flat;
}

function summarize(event) {
  const input = event.tool_input ?? {};
  const raw = input.command ?? input.file_path ?? input.notebook_path ?? input.pattern ?? input.url ?? input.query ?? '';
  return redact(raw);
}

// Numbers and hex ids change between otherwise identical calls; strip them so repeats collapse.
function signature(tool, summary) {
  const normal = summary.replace(/[0-9a-f]{7,}/gi, '<id>').replace(/\d+/g, '#');
  return crypto.createHash('sha1').update(`${tool}\0${normal}`).digest('hex').slice(0, 12);
}

function append(projectDir, sessionId, record) {
  try {
    fs.mkdirSync(tracesDir(projectDir), { recursive: true });
    fs.appendFileSync(path.join(tracesDir(projectDir), `${safeId(sessionId)}.jsonl`), `${JSON.stringify(record)}\n`);
  } catch { /* tracing must never break a session */ }
}

function logToolEvent(projectDir, event, now = Date.now()) {
  const tool = event.tool_name ?? 'unknown';
  const summary = summarize(event);
  const failed = event.hook_event_name === 'PostToolUseFailure' || Boolean(event.tool_response?.is_error || event.tool_response?.interrupted);
  append(projectDir, event.session_id, { type: 'tool', ts: now, tool, ok: !failed, summary, sig: signature(tool, summary) });
}

function logBlocked(projectDir, event, reason, now = Date.now()) {
  const tool = event.tool_name ?? 'unknown';
  const summary = summarize(event);
  append(projectDir, event.session_id, { type: 'blocked', ts: now, tool, summary, sig: signature(tool, summary), reason: redact(reason) });
}

function logStop(projectDir, event, now = Date.now()) {
  append(projectDir, event.session_id, { type: 'stop', ts: now });
}

function recordHookError(name, err, projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd()) {
  try {
    fs.mkdirSync(harnessDir(projectDir), { recursive: true });
    fs.appendFileSync(path.join(harnessDir(projectDir), 'hook-errors.jsonl'), `${JSON.stringify({ ts: Date.now(), hook: name, error: redact(err?.message) })}\n`);
  } catch { /* nothing more to do */ }
}

function parseLines(text) {
  return text.split('\n').filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}

function readJsonl(file) {
  try { return parseLines(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

function readSessions(projectDir) {
  let files = [];
  try { files = fs.readdirSync(tracesDir(projectDir)).filter((f) => f.endsWith('.jsonl')); } catch { return []; }
  return files
    .map((f) => ({ id: f.slice(0, -'.jsonl'.length), events: readJsonl(path.join(tracesDir(projectDir), f)) }))
    .filter((s) => s.events.length > 0)
    .map((s) => ({ ...s, ts: Math.max(...s.events.map((e) => e.ts ?? 0)) }))
    .sort((a, b) => a.ts - b.ts);
}

module.exports = {
  logToolEvent, logBlocked, logStop, recordHookError, readSessions, readJsonl, harnessDir, redact, signature, EDIT_TOOLS,
};
