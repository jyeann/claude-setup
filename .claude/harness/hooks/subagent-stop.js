#!/usr/bin/env node
'use strict';
// Records the end of a helper agent (#86) so the Stop hook knows it is no longer running. Observation only:
// it never blocks a subagent from stopping.
const { readEvent, projectDirOf } = require('../lib/hook-io');
const { logAgentEnd, recordHookError } = require('../lib/trace');

try {
  const event = readEvent();
  if (event.agent_id) logAgentEnd(projectDirOf(event), event.session_id, event.agent_id, 'SubagentStop');
} catch (err) {
  recordHookError('subagent-stop', err);
}
