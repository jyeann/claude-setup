// core/routes.js and core/testmode.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, parseSeed, SEED_ERROR } from '../public/js/core/routes.js';
import { parse, bannerText } from '../public/js/core/testmode.js';

test('parseRoute maps the fixed routes', () => {
  assert.deepEqual(parseRoute('#/'), { name: 'first' });
  assert.deepEqual(parseRoute(''), { name: 'first' });
  assert.deepEqual(parseRoute('#'), { name: 'first' });
  assert.deepEqual(parseRoute('/'), { name: 'first' });
  assert.deepEqual(parseRoute(undefined), { name: 'first' });
  assert.deepEqual(parseRoute('#/incidents'), { name: 'board' });
  assert.deepEqual(parseRoute('#/data'), { name: 'data' });
  assert.deepEqual(parseRoute('#/about'), { name: 'about' });
});

test('parseRoute maps play and debrief routes with a validated id', () => {
  assert.deepEqual(parseRoute('#/play/cache-stampede'), { name: 'play', id: 'cache-stampede' });
  assert.deepEqual(parseRoute('#/debrief/retry-storm'), { name: 'debrief', id: 'retry-storm' });
  assert.deepEqual(parseRoute('#/play/' + 'a'.repeat(40)), { name: 'play', id: 'a'.repeat(40) });
  for (const h of ['#/play/' + 'a'.repeat(41), '#/play/', '#/play', '#/play/UPPER', '#/play/../etc', '#/play/a/b', '#/debrief/', '#/debrief/a b', '#/nope', '#/incidents/x/y', '#/Incidents', '#/incidents/', '#/play/<script>']) {
    assert.deepEqual(parseRoute(h), { name: 'notfound' }, h);
  }
});

test('parseRoute only accepts a query on play routes', () => {
  for (const h of ['#/incidents?x=1', '#/data?seed=1', '#/about?a', '#/debrief/retry-storm?seed=1']) assert.deepEqual(parseRoute(h), { name: 'notfound' }, h);
});

test('parseRoute reads ?seed= on play routes, with a boundary at 4294967295', () => {
  assert.deepEqual(parseRoute('#/play/cache-stampede?seed=77'), { name: 'play', id: 'cache-stampede', seed: 77 });
  assert.equal(parseRoute('#/play/cache-stampede?seed=0').seed, 0);
  assert.equal(parseRoute('#/play/cache-stampede?seed=4294967295').seed, 4294967295);
  assert.equal(parseRoute('#/play/cache-stampede?seed=0000000077').seed, 77);
  assert.equal(parseRoute('#/play/cache-stampede?x=1&seed=5').seed, 5);
  assert.equal(parseRoute('#/play/cache-stampede?seed=5&seed=6').seed, 5);
  assert.deepEqual(parseRoute('#/play/cache-stampede?x=1'), { name: 'play', id: 'cache-stampede' });
  assert.deepEqual(parseRoute('#/play/cache-stampede?'), { name: 'play', id: 'cache-stampede' });
  for (const bad of ['4294967296', '-1', 'abc', '1.5', '12345678901', '', '1e3', '%31', ' 1']) {
    const r = parseRoute(`#/play/cache-stampede?seed=${bad}`);
    assert.equal(r.seedError, SEED_ERROR, bad);
    assert.equal('seed' in r, false, bad);
    assert.equal(r.id, 'cache-stampede');
  }
  assert.equal(parseRoute('#/play/cache-stampede?seed').seedError, SEED_ERROR);
});

test('parseSeed validates strings only', () => {
  assert.deepEqual(parseSeed('77'), { ok: true, seed: 77 });
  assert.deepEqual(parseSeed('4294967295'), { ok: true, seed: 4294967295 });
  assert.deepEqual(parseSeed('4294967296'), { ok: false, error: SEED_ERROR });
  assert.deepEqual(parseSeed(77), { ok: false, error: SEED_ERROR });
  assert.deepEqual(parseSeed(null), { ok: false, error: SEED_ERROR });
  assert.deepEqual(parseSeed('1'.repeat(11)), { ok: false, error: SEED_ERROR });
});

const DEFAULTS = { active: false, speed: 1, paused: false, pauseAt: null, failAt: null };

test('testmode.parse returns the defaults unless the flag is exactly true', () => {
  for (const flag of [false, undefined, null, 1, 'true', 0]) assert.deepEqual(parse(flag, '?speed=16&paused=1&pause-at=5&fail-at=3'), DEFAULTS);
  assert.deepEqual(parse(true, ''), DEFAULTS);
  assert.deepEqual(parse(true, undefined), DEFAULTS);
  assert.deepEqual(parse(true, 42), DEFAULTS);
  assert.notEqual(parse(false, ''), parse(false, ''), 'fresh object each call');
});

test('testmode.parse speed accepts only 1,2,4,8,16,32,64', () => {
  for (const s of [1, 2, 4, 8, 16, 32, 64]) {
    const r = parse(true, `?speed=${s}`);
    assert.equal(r.speed, s);
    assert.equal(r.active, true);
  }
  for (const s of ['3', '0', '128', '1.5', 'abc', '', '-2', '16x', '010']) {
    const r = parse(true, `?speed=${s}`);
    assert.equal(r.speed, 1, s);
    assert.equal(r.active, false, s);
  }
  assert.equal(parse(true, 'speed=8').speed, 8, 'leading question mark is optional');
});

test('testmode.parse paused is exactly 1; pause-at and fail-at are integers 0..600', () => {
  assert.equal(parse(true, '?paused=1').paused, true);
  assert.equal(parse(true, '?paused=1').active, true);
  for (const v of ['0', 'true', '2', '']) assert.equal(parse(true, `?paused=${v}`).paused, false, v);
  for (const v of [0, 1, 60, 600]) {
    assert.equal(parse(true, `?pause-at=${v}`).pauseAt, v);
    assert.equal(parse(true, `?fail-at=${v}`).failAt, v);
    assert.equal(parse(true, `?fail-at=${v}`).active, true);
  }
  for (const v of ['601', '-1', '1.5', 'x', '', '1e2', '99999', '1000']) {
    assert.equal(parse(true, `?pause-at=${v}`).pauseAt, null, v);
    assert.equal(parse(true, `?fail-at=${v}`).failAt, null, v);
  }
  const all = parse(true, '?speed=8&&pause-at=60&fail-at=12&paused=1&speed=2&junk');
  assert.deepEqual(all, { active: true, speed: 8, paused: true, pauseAt: 60, failAt: 12 });
});

test('bannerText describes active test parameters and is empty otherwise', () => {
  assert.equal(bannerText(parse(true, '?speed=16')), 'Test mode: speed 16x.');
  assert.equal(bannerText(parse(true, '?speed=1&paused=1&pause-at=60')), 'Test mode: speed 1x, paused, pause at 60 s.');
  assert.equal(bannerText(parse(true, '?pause-at=0')), 'Test mode: speed 1x, pause at 0 s.');
  assert.equal(bannerText(parse(false, '?speed=16')), '');
  assert.equal(bannerText(parse(true, '')), '');
  assert.equal(bannerText(null), '');
});
