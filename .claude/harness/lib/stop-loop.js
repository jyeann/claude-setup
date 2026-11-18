'use strict';
const crypto = require('node:crypto');

const TAIL_LINES = 40;
const TAIL_CHARS = 4000;

function tailOutput(output, maxLines = TAIL_LINES, maxChars = TAIL_CHARS) {
  const tail = output.split('\n').slice(-maxLines).join('\n');
  return tail.length > maxChars ? tail.slice(-maxChars) : tail;
}

// Paths, ids and numbers (timings, counts, pids) change between identical failures; strip them.
function failureSignature(output) {
  const normalised = tailOutput(output)
    .replace(/(?:\/[\w.@+-]+){2,}/g, '<path>')
    .replace(/\b[0-9a-f]{8,}(?:-[0-9a-f]{4,})*\b/gi, '<id>')
    .replace(/\d+(\.\d+)?/g, '#');
  return crypto.createHash('sha1').update(normalised).digest('hex').slice(0, 12);
}

const finish = (state, patch) => ({ ...state, ...patch, active: false });

function decideStop(state, result) {
  if (!state.active) return { decision: 'allow', reason: '', nextState: state };

  if (result.pass) {
    const nextState = finish(state, {
      status: 'passed',
      history: [...state.history, { iteration: state.iteration, pass: true }],
    });
    return { decision: 'allow', reason: 'Verification passed.', nextState };
  }

  const signature = failureSignature(result.output);
  const stallCount = signature === state.lastSignature ? state.stallCount + 1 : 0;
  const history = [...state.history, { iteration: state.iteration, pass: false, signature }];

  if (state.iteration >= state.maxIterations) {
    const nextState = finish(state, { status: 'halted-max-iterations', history, stallCount, lastSignature: signature });
    return { decision: 'allow', reason: `Halted: reached the ${state.maxIterations}-iteration cap.`, nextState };
  }
  if (stallCount + 1 >= state.stallLimit) {
    const nextState = finish(state, { status: 'halted-stalled', history, stallCount, lastSignature: signature });
    return { decision: 'allow', reason: `Halted: the same failure repeated ${state.stallLimit} times; a human should look.`, nextState };
  }

  const iteration = state.iteration + 1;
  const nextState = { ...state, iteration, history, stallCount, lastSignature: signature };
  const why = result.timedOut ? 'The verify command timed out.' : 'The verify command failed.';
  const reason = [
    `Not done: ${why} (iteration ${iteration} of ${state.maxIterations})`,
    `Verify command: ${state.verifyCommand}`,
    state.task ? `Task: ${state.task}` : '',
    'Fix the failures below, then try to finish again. Do not edit the verify command, the acceptance tests, or the harness files.',
    '--- verify output (tail) ---',
    tailOutput(result.output),
  ].filter(Boolean).join('\n');
  return { decision: 'block', reason, nextState };
}

module.exports = { decideStop, failureSignature, tailOutput };
