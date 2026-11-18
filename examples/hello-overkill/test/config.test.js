'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config');

const run = (env) => { const w = []; return { cfg: loadConfig(env, (m) => w.push(m)), w }; };

test('returns defaults and warns about the dev secret when env is empty', () => {
  const { cfg, w } = run({});
  assert.equal(cfg.port, 3000);
  assert.equal(cfg.dataFile, './data/hello.json');
  assert.equal(cfg.rateLimit, 10);
  assert.equal(cfg.secretIsDev, true);
  assert.match(cfg.signingSecret, /^[0-9a-f]{64}$/);
  assert.equal(w.length, 1);
  assert.match(w[0], /^WARNING: HELLO_SIGNING_SECRET not set/);
});

test('uses provided values without warnings', () => {
  const { cfg, w } = run({ PORT: '0', DATA_FILE: '/x/y.json', HELLO_RATE_LIMIT: '1000', HELLO_SIGNING_SECRET: 's3' });
  assert.deepEqual(cfg, {
    port: 0, dataFile: '/x/y.json', rateLimit: 1000, signingSecret: 's3', secretIsDev: false,
    peers: '', allowPrivatePeers: false, readLimit: 120, fedLimit: 10, slaToken: undefined, timeMachineStreaks: true, chaosSeed: undefined, streamHeartbeatMs: 15000,
  });
  assert.deepEqual(w, []);
});

test('throws on out-of-range or non-numeric PORT', () => {
  for (const p of ['65536', '-1', 'abc', '1.5', '99999999']) assert.throws(() => loadConfig({ PORT: p, HELLO_SIGNING_SECRET: 'x' }, () => {}), /invalid PORT/, p);
  assert.equal(loadConfig({ PORT: '65535', HELLO_SIGNING_SECRET: 'x' }, () => {}).port, 65535);
});

test('falls back to 10 with a warning for invalid HELLO_RATE_LIMIT', () => {
  for (const v of ['0', '100001', 'x', '-5', '']) {
    const { cfg, w } = run({ HELLO_RATE_LIMIT: v, HELLO_SIGNING_SECRET: 'x' });
    assert.equal(cfg.rateLimit, 10, v);
    assert.deepEqual(w, ['invalid HELLO_RATE_LIMIT, using 10'], v);
  }
  assert.equal(run({ HELLO_RATE_LIMIT: '100000', HELLO_SIGNING_SECRET: 'x' }).cfg.rateLimit, 100000);
});

test('dev secrets differ between loads', () => {
  assert.notEqual(run({}).cfg.signingSecret, run({}).cfg.signingSecret);
});

test('production requires a signing secret of at least 32 characters', () => {
  const bad = [undefined, '', 'short', 'x'.repeat(31)];
  for (const s of bad) assert.throws(() => loadConfig({ NODE_ENV: 'production', HELLO_SIGNING_SECRET: s }, () => {}), /HELLO_SIGNING_SECRET/);
  const cfg = loadConfig({ NODE_ENV: 'production', HELLO_SIGNING_SECRET: 'x'.repeat(32) }, () => {});
  assert.equal(cfg.secretIsDev, false);
  assert.equal(loadConfig({ NODE_ENV: 'development' }, () => {}).secretIsDev, true);
});

test('HELLO_STREAM_HEARTBEAT_MS accepts 50..60000 and falls back to 15000 with a warning otherwise', () => {
  const base = { HELLO_SIGNING_SECRET: 's' };
  for (const [v, want] of [['50', 50], ['60000', 60000], ['250', 250]]) {
    const w = [];
    assert.equal(loadConfig({ ...base, HELLO_STREAM_HEARTBEAT_MS: v }, (m) => w.push(m)).streamHeartbeatMs, want);
    assert.deepEqual(w, []);
  }
  for (const v of ['49', '60001', 'abc', '1.5', '-5', '']) {
    const w = [];
    assert.equal(loadConfig({ ...base, HELLO_STREAM_HEARTBEAT_MS: v }, (m) => w.push(m)).streamHeartbeatMs, 15000, v);
    assert.deepEqual(w, ['invalid HELLO_STREAM_HEARTBEAT_MS, using 15000']);
  }
  assert.equal(loadConfig(base, () => {}).streamHeartbeatMs, 15000);
});
