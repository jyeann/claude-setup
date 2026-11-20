import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readConfig, ConfigError, APP_ROOT } from '../src/config.js';

// A stand-in app root with a scenarios folder, so these tests do not depend on the shipped scenarios existing.
const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'is-root-')));
fs.mkdirSync(path.join(ROOT, 'scenarios'));
process.on('exit', () => fs.rmSync(ROOT, { recursive: true, force: true }));

const cfg = (env) => readConfig(env, ROOT);
const err = (env) => { try { readConfig(env, ROOT); } catch (e) { assert.ok(e instanceof ConfigError); return e.message; } return null; };

test('defaults: port 3000, 127.0.0.1, test mode off, scenarios under the app root', () => {
  const c = cfg({});
  assert.equal(c.port, 3000);
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.bindHost, '127.0.0.1');
  assert.equal(c.testMode, false);
  assert.equal(c.scenariosDir, path.join(ROOT, 'scenarios'));
  assert.ok(path.isAbsolute(APP_ROOT));
});

test('PORT accepts 0 and 65535, empty means 3000', () => {
  assert.equal(cfg({ PORT: '0' }).port, 0);
  assert.equal(cfg({ PORT: '65535' }).port, 65535);
  assert.equal(cfg({ PORT: '' }).port, 3000);
});

test('PORT rejects anything that is not an integer from 0 to 65535', () => {
  for (const v of ['65536', '-1', '1.5', 'abc', ' 3000', '1e3', '0x10', '99999999999999999999', '+80']) {
    assert.equal(err({ PORT: v }), 'PORT must be an integer from 0 to 65535', v);
  }
});

test('HOST allows only loopback names and localhost binds 127.0.0.1', () => {
  assert.equal(cfg({ HOST: '::1' }).bindHost, '::1');
  assert.equal(cfg({ HOST: 'localhost' }).bindHost, '127.0.0.1');
  for (const v of ['0.0.0.0', '::', '[::1]', '', 'example.com']) {
    assert.equal(err({ HOST: v }), 'HOST must be a loopback address; exposing incident-sim needs a security review', v);
  }
});

test('test mode is on only for exactly 1', () => {
  assert.equal(cfg({ INCIDENT_SIM_TEST: '1' }).testMode, true);
  for (const v of ['0', 'true', '', '01', ' 1', '1 ']) assert.equal(cfg({ INCIDENT_SIM_TEST: v }).testMode, false, v);
});

test('SCENARIOS_DIR is realpath-ed; missing or non-directory gives the exact message', () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'is-cfg-')));
  try {
    fs.mkdirSync(path.join(base, 'real'));
    fs.symlinkSync(path.join(base, 'real'), path.join(base, 'link'));
    fs.writeFileSync(path.join(base, 'file'), 'x');
    assert.equal(cfg({ SCENARIOS_DIR: path.join(base, 'link') }).scenariosDir, path.join(base, 'real'));
    for (const p of [path.join(base, 'nope'), path.join(base, 'file')]) assert.equal(err({ SCENARIOS_DIR: p }), `Cannot read SCENARIOS_DIR ${p}`);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});
