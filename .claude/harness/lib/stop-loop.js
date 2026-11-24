'use strict';
const crypto = require('node:crypto');
const { clusterFailures, diagnosisPrompt, normaliseFailure, REPORT_FILE } = require('./failure-cluster');

const TAIL_LINES = 70;
const TAIL_CHARS = 5000;

function tailOutput(output, maxLines = TAIL_LINES, maxChars = TAIL_CHARS) {
  const tail = output.split('\n').slice(-maxLines).join('\n');
  return tail.length > maxChars ? tail.slice(-maxChars) : tail;
}

function failureSignature(output) {
  const normalised = normaliseFailure(tailOutput(output));
  return crypto.createHash('sha1').update(normalised).digest('hex').slice(0, 12);
}

const finish = (state, patch) => ({ ...state, ...patch, active: false });

const MINUTE_MS = 60_000;

// How many distinct tests fail, or null when the output cannot be parsed (then progress is not judged).
function countFailing(output) {
  const clusters = clusterFailures(output);
  return clusters.length === 0 ? null : clusters.reduce((n, c) => n + c.count, 0);
}

// No-progress = the number of failing tests has not dropped below its best for N failing iterations.
function trackProgress(state, failing) {
  if (failing === null) return { bestFailing: state.bestFailing ?? null, sinceImprovement: state.sinceImprovement ?? 0 };
  const best = state.bestFailing ?? null;
  if (best === null || failing < best) return { bestFailing: failing, sinceImprovement: 0 };
  return { bestFailing: best, sinceImprovement: (state.sinceImprovement ?? 0) + 1 };
}

// Owner gates (#24): pipeline.js exits 3 and ends its report with this line while a gate label is missing on
// the spec issue. Only the pipeline can report it, so a test that prints the line cannot end a build early.
const WAIT_EXIT = 3;
const WAIT_LINE = /^waiting for owner: spec issue #(\d+) needs label (spec-approved|accepted)$/;
const PIPELINE_COMMAND = /(?:^|[\s/'"])pipeline\.js(?=[\s'"]|$)/;

function ownerWait(state, result) {
  if (!result || result.code !== WAIT_EXIT || !PIPELINE_COMMAND.test(String(state.verifyCommand ?? ''))) return null;
  const line = String(result.output ?? '').trimEnd().split('\n').at(-1).trim();
  const m = WAIT_LINE.exec(line);
  return m ? { line, gate: m[2], spec: Number(m[1]) } : null;
}

// The first stop at a gate is held once so the agent tells the owner what to review; the next stop at the
// same gate ends the turn. The run stays active and costs no iteration, so the owner's label is all it takes
// for the next stop to move on.
function waitAtGate(state, wait) {
  const nextState = { ...state, status: 'waiting-for-owner', waitNotified: wait.line };
  const waiting = { gate: wait.gate, spec: wait.spec };
  if (state.waitNotified === wait.line) return { decision: 'allow', reason: wait.line, nextState, waiting };
  const reason = [
    wait.line,
    `The pipeline is at the owner gate "${wait.gate}". End the turn now: in your final message tell the owner to review spec issue #${wait.spec} and add the label ${wait.gate} when it is right.`,
    'Never add the label yourself and do not start the next phase; the run continues by itself once the label is there.',
  ].join('\n');
  return { decision: 'block', reason, nextState };
}

function decideStop(givenState, result, options = {}) {
  if (!givenState.active) return { decision: 'allow', reason: '', nextState: givenState };
  const wait = givenState.diagnosing ? null : ownerWait(givenState, result);
  if (wait) return waitAtGate(givenState, wait);
  const { waitNotified, ...rest } = givenState;
  const state = rest.status === 'waiting-for-owner' ? { ...rest, status: 'running' } : rest;

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
  const failing = countFailing(result.output);
  const progress = trackProgress(state, failing);
  const history = [...state.history, { iteration: state.iteration, pass: false, signature, failing }];

  const halt = (status, reason) => {
    const patch = { history, stallCount, lastSignature: signature, ...progress };
    if (state.diagnose === false) return { decision: 'allow', reason, nextState: finish(state, { status, ...patch }) };
    const prompt = diagnosisPrompt({ haltStatus: status, clusters: clusterFailures(result.output), outputTail: tailOutput(result.output) });
    return { decision: 'block', reason: `${reason}\n\n${prompt}`, nextState: { ...state, ...patch, diagnosing: status } };
  };
  if (state.iteration >= state.maxIterations) return halt('halted-max-iterations', `Halted: reached the ${state.maxIterations}-iteration cap.`);
  if (state.maxMinutes && state.startedAt && options.now !== undefined && options.now - state.startedAt > state.maxMinutes * MINUTE_MS) {
    return halt('halted-time', `Halted: the ${state.maxMinutes} minute time budget is spent.`);
  }
  if (stallCount + 1 >= state.stallLimit) return halt('halted-stalled', `Halted: the same failure repeated ${state.stallLimit} times; a human should look.`);

  if (state.noProgressLimit && progress.sinceImprovement >= state.noProgressLimit) {
    return halt('halted-no-progress', `Halted: the number of failing tests has not improved for ${state.noProgressLimit} iterations.`);
  }

  const iteration = state.iteration + 1;
  const nextState = { ...state, iteration, history, stallCount, lastSignature: signature, ...progress };
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
