'use strict';
// Helper agents still running (#86): a session must not end its turn while background agents it started are
// still working. What can be known from the hooks: a background Agent call returns at once with status
// async_launched and an agentId (recorded by post-tool.js), and the SubagentStop hook or a successful TaskStop
// marks its end. A helper is running when its launch has no end record in the same session's trace.
const { readSession, recordHookError } = require('./trace');

// A lost end record (a crash, a killed process) must not hold sessions forever: older launches no longer count.
const MAX_AGE_MS = 4 * 60 * 60_000;

function runningHelpers(events, now = Date.now(), maxAgeMs = MAX_AGE_MS) {
  const ended = new Set(events.filter((e) => e.type === 'agent-end' && e.id).map((e) => e.id));
  return events.filter((e) => e.type === 'agent' && e.background === true && e.id && !ended.has(e.id) && now - (e.ts ?? 0) <= maxAgeMs);
}

function holdReason(helpers) {
  const list = helpers.map((h) => `${h.agent ?? 'agent'} (${h.task || h.id})`).join('; ');
  return [
    `${helpers.length} helper agent(s) you started are still running: ${list}.`,
    'Wait for them before ending the turn: their results arrive as notifications; integrate them and then finish.',
    'If a helper is no longer needed, stop it with TaskStop. This hold happens once per stop attempt.',
  ].join(' ');
}

// The reason to hold this stop, or null. Never holds on the stop hook's own continuation (stop_hook_active),
// and never on its own error: that is logged and the turn may end.
function holdForHelpers(projectDir, event, { now = Date.now(), readEvents = readSession } = {}) {
  if (event.stop_hook_active || !event.session_id) return null;
  try {
    const helpers = runningHelpers(readEvents(projectDir, event.session_id), now);
    return helpers.length ? holdReason(helpers) : null;
  } catch (err) {
    recordHookError('helpers', err, projectDir);
    return null;
  }
}

module.exports = { runningHelpers, holdForHelpers, MAX_AGE_MS };
