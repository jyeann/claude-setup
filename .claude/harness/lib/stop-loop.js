'use strict';
const crypto = require('node:crypto');
const { clusterFailures, diagnosisPrompt, normaliseFailure, REPORT_FILE } = require('./failure-cluster');

const TAIL_LINES = 40;
const TAIL_CHARS = 4000;

function tailOutput(output, maxLines = TAIL_LINES, maxChars = TAIL_CHARS) {
  const tail = output.split('\n').slice(-maxLines).join('\n');
  return tail.length > maxChars ? tail.slice(-maxChars) : tail;
}

function failureSignature(output) {
  const normalised = normaliseFailure(tailOutput(output));
  return crypto.createHash('sha1').update(normalised).digest('hex').slice(0, 12);
}

const finish = (state, patch) => ({ ...state, ...patch, active: false });

function decideStop(state, result, options = {}) {
  if (!state.active) return { decision: 'allow', reason: '', nextState: state };

  // Second stop after a diagnosis turn: end the run with the status that triggered it. Bounded: one turn only.
  if (state.diagnosing) {
    const written = options.diagnosisWritten === true;
    const nextState = finish(state, { status: state.diagnosing, diagnosing: null, diagnosis: written ? 'written' : 'missing' });
    const note = written ? `Diagnosis written to ${REPORT_FILE}.` : 'No diagnosis was written.';
    return { decision: 'allow', reason: `Halted (${state.diagnosing}). ${note}`, nextState };
  }

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

  const halt = (status, reason) => {
    const patch = { history, stallCount, lastSignature: signature };
    if (state.diagnose === false) return { decision: 'allow', reason, nextState: finish(state, { status, ...patch }) };
    const prompt = diagnosisPrompt({ haltStatus: status, clusters: clusterFailures(result.output), outputTail: tailOutput(result.output) });
    return { decision: 'block', reason: `${reason}\n\n${prompt}`, nextState: { ...state, ...patch, diagnosing: status } };
  };
  if (state.iteration >= state.maxIterations) return halt('halted-max-iterations', `Halted: reached the ${state.maxIterations}-iteration cap.`);
  if (stallCount + 1 >= state.stallLimit) return halt('halted-stalled', `Halted: the same failure repeated ${state.stallLimit} times; a human should look.`);

  const iteration = state.iteration + 1;
  const nextState = { ...state, iteration, history, stallCount, lastSignature: signature };
  // The full spec goes in once; repeating it on every iteration only grows the context.
  const taskLine = state.task
    ? (state.iteration === 0
      ? `Task: ${state.task}`
      : `Task: unchanged since the first message of this run${state.taskFile ? ` (spec: ${state.taskFile})` : ''}.`)
    : '';
  const why = result.timedOut ? 'The verify command timed out.' : 'The verify command failed.';
  const reason = [
    `Not done: ${why} (iteration ${iteration} of ${state.maxIterations})`,
    `Verify command: ${state.verifyCommand}`,
    taskLine,
    'Fix the failures below, then try to finish again. Do not edit the verify command, the acceptance tests, or the harness files.',
    '--- verify output (tail) ---',
    tailOutput(result.output),
  ].filter(Boolean).join('\n');
  return { decision: 'block', reason, nextState };
}

module.exports = { decideStop, failureSignature, tailOutput };
