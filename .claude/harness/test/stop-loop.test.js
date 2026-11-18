'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { decideStop, failureSignature, tailOutput } = require('../lib/stop-loop');

const base = {
  active: true, iteration: 0, maxIterations: 5, stallLimit: 3,
  lastSignature: null, stallCount: 0, status: 'running', history: [],
};
const fail = (output = 'FAIL: 1 test failed') => ({ pass: false, output, timedOut: false });
const pass = { pass: true, output: 'ok', timedOut: false };

test('allows stopping when no run is active', () => {
  const d = decideStop({ ...base, active: false }, fail());
  assert.equal(d.decision, 'allow');
});

test('allows stopping and deactivates when verification passes', () => {
  const d = decideStop(base, pass);
  assert.equal(d.decision, 'allow');
  assert.equal(d.nextState.active, false);
  assert.equal(d.nextState.status, 'passed');
});

test('blocks with the failure tail and advances the iteration', () => {
  const d = decideStop(base, fail('line1\nAssertionError: expected 201'));
  assert.equal(d.decision, 'block');
  assert.match(d.reason, /AssertionError: expected 201/);
  assert.match(d.reason, /iteration 1 of 5/i);
  assert.equal(d.nextState.iteration, 1);
  assert.equal(d.nextState.active, true);
});

test('does not mutate the input state', () => {
  const frozen = Object.freeze({ ...base, history: Object.freeze([]) });
  assert.doesNotThrow(() => decideStop(frozen, fail()));
});

test('halts when the iteration cap is reached', () => {
  const d = decideStop({ ...base, iteration: 5 }, fail());
  assert.equal(d.decision, 'allow');
  assert.equal(d.nextState.status, 'halted-max-iterations');
  assert.equal(d.nextState.active, false);
});

test('circuit breaker halts after stallLimit identical failures in a row', () => {
  let state = base;
  const outcomes = [];
  for (let i = 0; i < 3; i += 1) {
    const d = decideStop(state, fail('same failure took 12ms'));
    outcomes.push(d.decision);
    state = d.nextState;
  }
  assert.deepEqual(outcomes, ['block', 'block', 'allow']);
  assert.equal(state.status, 'halted-stalled');
});

test('progress resets the stall counter', () => {
  let state = decideStop(base, fail('error A')).nextState;
  state = decideStop(state, fail('error A')).nextState;
  assert.equal(state.stallCount, 1);
  state = decideStop(state, fail('error B')).nextState;
  assert.equal(state.stallCount, 0);
});

test('failureSignature ignores timings and counts', () => {
  assert.equal(failureSignature('failed in 12.5ms, 3 tests'), failureSignature('failed in 99ms, 7 tests'));
  assert.notEqual(failureSignature('error A'), failureSignature('error B'));
});

test('a timeout is reported to the agent and counts as a failure', () => {
  const d = decideStop(base, { pass: false, output: '', timedOut: true });
  assert.equal(d.decision, 'block');
  assert.match(d.reason, /timed out/i);
});

test('tailOutput keeps the end and caps the size', () => {
  const long = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
  const tail = tailOutput(long, 20, 500);
  assert.ok(tail.length <= 500);
  assert.match(tail, /line 499/);
  assert.doesNotMatch(tail, /line 0\b/);
});

test('failureSignature ignores temp paths, uuids and hex ids', () => {
  const a = 'ENOENT /tmp/todo-AbC123/nested/todos.json id 3f2a9c1e-77b4-4d1e-9a10-0123456789ab';
  const b = 'ENOENT /tmp/todo-ZyX987/nested/todos.json id 9d8c7b6a-1111-2222-3333-ba9876543210';
  assert.equal(failureSignature(a), failureSignature(b));
});

test('a block message carries a short task reminder, not the whole spec, so retries do not re-bill it', () => {
  const d = decideStop({ ...base, task: `# Spec\n${'long detail '.repeat(500)}` }, fail('AssertionError: expected 201'));
  assert.equal(d.decision, 'block');
  assert.ok(d.reason.length < 5000, `reason was ${d.reason.length} chars`);
  assert.match(d.reason, /Task: # Spec/);
  assert.match(d.reason, /AssertionError: expected 201/);
  assert.match(decideStop({ ...base, task: 'short task' }, fail()).reason, /Task: short task\n/);
});

test('the retry message keeps enough of the verify output for several failing assertions', () => {
  const lines = Array.from({ length: 60 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n');
  const d = decideStop(base, fail(lines));
  assert.match(d.reason, /line 59/);
  assert.match(d.reason, /line 10 /);
});
