#!/usr/bin/env node
'use strict';
// Records the cost of a finished subagent (tokens, time, tool calls) from its own transcript. This is the only
// source of cost for agents the host moved to the background. Observation only: it never blocks.
const { readEvent, projectDirOf } = require('../lib/hook-io');
const { logSubagentFinal } = require('../lib/trace');
const { summarizeTranscript } = require('../lib/subagent-usage');

try {
  const event = readEvent();
  // Internal agents (prompt suggestions, side questions) fire this event too, with an empty agent_type.
  if (event.agent_id && event.agent_type) logSubagentFinal(projectDirOf(event), event, summarizeTranscript(event.agent_transcript_path));
} catch { /* tracing is best-effort */ }
