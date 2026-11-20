// engine/solver.js: schedule, firstPageTick, solve on a test-local scenario, the authoring tool (spec.md "engine/solver.js").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  APP_DIR, engine, mod, scenario, rawScenario, clone, validateRaw, drive, firstPage, scenarioFile, SHIPPED_IDS,
} from './helpers.js';

const SOLVE_TOOL = path.join(APP_DIR, 'tests', 'tools', 'solve.js');
const A = { id: 'a', node: 'x' }; const B = { id: 'b', node: 'y' }; const C = { id: 'c', node: null };

test('schedule puts action k at firstPage + gap*k with a default gap of 2', async () => {
  const { schedule } = await mod('engine/solver');
  assert.deepEqual(schedule(8, [A, B, C]), [{ t: 8, id: 'a', node: 'x' }, { t: 10, id: 'b', node: 'y' }, { t: 12, id: 'c', node: null }]);
  assert.deepEqual(schedule(6, [A, B], 3), [{ t: 6, id: 'a', node: 'x' }, { t: 9, id: 'b', node: 'y' }]);
  assert.deepEqual(schedule(7, []), []);
  assert.deepEqual(schedule(0, [A], 5), [{ t: 0, id: 'a', node: 'x' }]);
  const input = [A, B];
  schedule(8, input);
  assert.deepEqual(input, [A, B], 'the path is not mutated');
});

test('firstPageTick is the tick of the first severity 1-2 alert in a no-action run, equal to what the engine reports', async () => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  for (const seed of [0, 1, 77, 4294967295]) {
    const fp = E.solver.firstPageTick(sc, seed);
    assert.ok(Number.isInteger(fp));
    const s = drive(E, sc, seed, [], { stopTick: fp + 3 });
    assert.equal(s.firstPageTick, fp);
    const before = drive(E, sc, seed, [], { stopTick: fp - 1 });
    assert.equal(E.eng.firingAlerts(before).filter((a) => a.severity <= 2).length, 0, 'no page one tick earlier');
    assert.ok(E.eng.firingAlerts(drive(E, sc, seed, [], { stopTick: fp })).some((a) => a.severity <= 2));
  }
});

async function derived(mutate) {
  const raw = clone(rawScenario('cache-stampede'));
  mutate(raw);
  const r = await validateRaw(raw);
  assert.ok(r.ok, r.ok ? '' : r.errors.map((e) => `${e.field}: ${e.message}`).join(' | '));
  return r.scenario;
}

test('solve finds the single resolving fix on a test-local scenario and reports the engine-measured time and cost', async () => {
  const E = await engine();
  const sc = await derived(() => {});
  const sol = E.solver.solve(sc);
  assert.deepEqual(sol.path.map((p) => ({ id: p.id, node: p.node })), [{ id: 'add-ttl-jitter', node: 'cache' }]);
  const done = drive(E, sc, sc.seed, E.solver.schedule(E.solver.firstPageTick(sc, sc.seed), sol.path));
  assert.equal(done.status, 'resolved');
  assert.equal(sol.summary.timeToMitigate, done.resolvedTick);
  assert.equal(sol.summary.cost, 1);
  assert.ok(Number.isInteger(sol.explored) && sol.explored >= 1);
});

test('solve gives path null and summary null when nothing resolves (no fix has effects)', async () => {
  const E = await engine();
  const sc = await derived((raw) => { delete raw.actions['add-ttl-jitter'].effects; });
  const sol = E.solver.solve(sc);
  assert.equal(sol.path, null);
  assert.equal(sol.summary, null);
  assert.ok(Number.isInteger(sol.explored));
});

test('solve is deterministic and honours the seed option', async () => {
  const E = await engine();
  const sc = await scenario('cache-stampede');
  const a = E.solver.solve(sc);
  const b = E.solver.solve(sc);
  assert.deepEqual(a, b);
  const other = E.solver.solve(sc, { seed: 1 });
  assert.deepEqual(other.path.map((p) => p.id), ['add-ttl-jitter']);
});

test('solve maxDepth limits the path length: a two-step scenario has no depth-1 solution', async () => {
  const E = await engine();
  const sc = await scenario('queue-backlog');
  const shallow = E.solver.solve(sc, { maxDepth: 1 });
  assert.ok(shallow.path === null || shallow.path.length === 1);
  const full = E.solver.solve(sc);
  assert.equal(full.path.length, 2);
  assert.ok(shallow.path === null || shallow.summary.timeToMitigate > full.summary.timeToMitigate, 'the single step resolves strictly later than the pair');
});

test('solve never repeats a (fix, node) pair and keeps paths within the budget', async () => {
  const E = await engine();
  for (const id of ['split-brain', 'cascading-failure']) {
    const sc = await scenario(id);
    const sol = E.solver.solve(sc);
    const keys = sol.path.map((p) => `${p.id}@${p.node}`);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(sol.summary.cost <= sc.budget);
  }
});

test('tests/tools/solve.js prints the path and optimalSummary of a scenario file as JSON', () => {
  const file = scenarioFile('cache-stampede');
  const r = spawnSync(process.execPath, [SOLVE_TOOL, file], { cwd: APP_DIR, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  const want = rawScenario('cache-stampede');
  assert.deepEqual(out.optimalSummary, want.optimalSummary);
  assert.deepEqual(out.path.map((p) => ({ id: p.id, node: p.node })), want.optimalPath);
  assert.ok(SHIPPED_IDS.length === 10);
});
