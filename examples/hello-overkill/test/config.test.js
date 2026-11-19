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
    peers: '', allowPrivatePeers: false, readLimit: 120, fedLimit: 10, fedGlobalLimit: 30, slaToken: undefined, production: false, timeMachineStreaks: true, chaosSeed: undefined, streamHeartbeatMs: 15000,
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

for (const [name, fallback] of [['HELLO_READ_LIMIT', 120], ['HELLO_FED_LIMIT', 10], ['HELLO_FED_GLOBAL_LIMIT', 30]]) {
  const key = { HELLO_READ_LIMIT: 'readLimit', HELLO_FED_LIMIT: 'fedLimit', HELLO_FED_GLOBAL_LIMIT: 'fedGlobalLimit' }[name];
  test(`falls back to ${fallback} with one warning for invalid ${name}`, () => {
    for (const v of ['0', '100001', 'x', '-5', '', '1.5']) {
      const { cfg, w } = run({ [name]: v, HELLO_SIGNING_SECRET: 'x' });
      assert.equal(cfg[key], fallback, v);
      assert.deepEqual(w, [`invalid ${name}, using ${fallback}`], v);
    }
  });
  test(`accepts ${name} from 1 to 100000 without warnings`, () => {
    for (const v of ['1', '100000', '77']) {
      const { cfg, w } = run({ [name]: v, HELLO_SIGNING_SECRET: 'x' });
      assert.equal(cfg[key], Number(v));
      assert.deepEqual(w, []);
    }
  });
}

test('HELLO_SLA_TOKEN: short tokens throw in production and only warn elsewhere; empty counts as unset', () => {
  for (const t of ['a', 'x'.repeat(15)]) {
    assert.throws(() => loadConfig({ NODE_ENV: 'production', HELLO_SIGNING_SECRET: 'x'.repeat(32), HELLO_SLA_TOKEN: t }, () => {}), /HELLO_SLA_TOKEN/, t);
    const warns = [];
    assert.equal(loadConfig({ HELLO_SIGNING_SECRET: 'x', HELLO_SLA_TOKEN: t }, (m) => warns.push(m)).slaToken, t);
    assert.equal(warns.filter((m) => /HELLO_SLA_TOKEN/.test(m)).length, 1, t);
  }
  assert.equal(loadConfig({ HELLO_SIGNING_SECRET: 'x', HELLO_SLA_TOKEN: 'x'.repeat(16) }, () => {}).slaToken, 'x'.repeat(16));
  assert.equal(loadConfig({ HELLO_SIGNING_SECRET: 'x', HELLO_SLA_TOKEN: '' }, () => {}).slaToken, undefined);
});

test('production flag follows NODE_ENV', () => {
  assert.equal(loadConfig({ NODE_ENV: 'production', HELLO_SIGNING_SECRET: 'x'.repeat(32) }, () => {}).production, true);
  assert.equal(run({ HELLO_SIGNING_SECRET: 'x' }).cfg.production, false);
});

test('accepts HELLO_RATE_LIMIT of exactly 1 and rejects 0', () => {
  const ok = run({ HELLO_RATE_LIMIT: '1', HELLO_SIGNING_SECRET: 'x' });
  assert.equal(ok.cfg.rateLimit, 1);
  assert.deepEqual(ok.w, []);
  const bad = run({ HELLO_RATE_LIMIT: '0', HELLO_SIGNING_SECRET: 'x' });
  assert.equal(bad.cfg.rateLimit, 10);
  assert.deepEqual(bad.w, ['invalid HELLO_RATE_LIMIT, using 10']);
});

test('HELLO_CHAOS_SEED: unset or empty is silent, digits are used, anything else warns and is ignored', () => {
  for (const env of [{}, { HELLO_CHAOS_SEED: '' }]) {
    const { cfg, w } = run({ ...env, HELLO_SIGNING_SECRET: 'x' });
    assert.equal(cfg.chaosSeed, undefined);
    assert.deepEqual(w, []);
  }
  assert.equal(run({ HELLO_CHAOS_SEED: '42', HELLO_SIGNING_SECRET: 'x' }).cfg.chaosSeed, 42);
  for (const v of ['abc', '-1', '12345678901', '1.5']) {
    const { cfg, w } = run({ HELLO_CHAOS_SEED: v, HELLO_SIGNING_SECRET: 'x' });
    assert.equal(cfg.chaosSeed, undefined, v);
    assert.deepEqual(w, ['invalid HELLO_CHAOS_SEED, ignoring'], v);
  }
});
