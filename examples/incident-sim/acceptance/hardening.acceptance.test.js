// Server startup, environment variables and scenario loading (spec.md "Startup output", "Scenario loading", SC9, Hardening rows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  APP_DIR, SCEN_DIR, SHIPPED_IDS, scenarioFile, scenarioDir, tempDir, variantJson, startServer, runToExit, ipv6Available, sleep,
} from './helpers.js';

const CS = () => fs.readFileSync(scenarioFile('cache-stampede'));
const loader = () => import(pathToFileURL(path.join(APP_DIR, 'src', 'scenarios-load.js')).href);
const fmtLine = (e) => `scenario error: scenarios/${e.file}: field "${e.field}": ${e.message}`;

// ------------------------------------------------------------------ PORT
test('PORT must be an integer from 0 to 65535, otherwise stderr message and exit 1', async () => {
  for (const v of ['65536', '-1', '1.5', 'abc', '3000abc', ' 3000', '3000 ', '1e3', '0x10', '99999999999999999999', '+80', '8 0']) {
    const r = await runToExit({ env: { PORT: v } });
    assert.equal(r.code, 1, `PORT=${JSON.stringify(v)}`);
    assert.ok(r.stderr.includes('PORT must be an integer from 0 to 65535'), `PORT=${JSON.stringify(v)}: ${r.output}`);
    assert.ok(!/running at/.test(r.stdout), 'no ready line');
  }
});

test('PORT=0 picks any free port and the ready line shows the actual port', async () => {
  const s = await startServer({ env: { PORT: '0' } });
  try {
    assert.ok(s.port > 0);
    assert.equal((await s.call('GET', '/')).status, 200);
  } finally { await s.stop(); }
});

test('an empty PORT means 3000 (ready on 3000, or "Port 3000 is in use" when something else holds it)', async () => {
  try {
    const s = await startServer({ env: { PORT: '' } });
    try { assert.equal(s.port, 3000); } finally { await s.stop(); }
  } catch (e) {
    assert.match(e.message, /Port 3000 is in use/);
  }
});

test('a port that is taken exits 1 with "Port <N> is in use"', async () => {
  const a = await startServer();
  try {
    const r = await runToExit({ env: { PORT: String(a.port) } });
    assert.equal(r.code, 1);
    assert.ok(r.stderr.includes(`Port ${a.port} is in use`), r.output);
  } finally { await a.stop(); }
});

// ------------------------------------------------------------------ HOST
test('HOST must be loopback: 0.0.0.0, ::, LAN and DNS names exit 1 with the exact message', async () => {
  for (const v of ['0.0.0.0', '::', '10.0.0.1', '192.168.1.5', 'example.com', '127.0.0.2.evil.com', '[::1]']) {
    const r = await runToExit({ env: { HOST: v } });
    assert.equal(r.code, 1, `HOST=${v}`);
    assert.ok(r.stderr.includes('HOST must be a loopback address; exposing incident-sim needs a security review'), `HOST=${v}: ${r.output}`);
    assert.ok(!/running at/.test(r.stdout), 'no ready line');
  }
});

test('HOST=127.0.0.1 and HOST=localhost start and answer', async () => {
  for (const host of ['127.0.0.1', 'localhost']) {
    const s = await startServer({ env: { HOST: host } });
    try {
      const r = await s.call('GET', '/');
      assert.equal(r.status, 200, host);
      assert.match(s.logs().stdout, /^Incident Simulator running at http:\/\/localhost:\d+$/m);
    } finally { await s.stop(); }
  }
});

test('HOST=::1 starts and prints "localhost" in the ready line (or fails cleanly where IPv6 loopback is missing)', async () => {
  if (await ipv6Available()) {
    const s = await startServer({ env: { HOST: '::1' } });
    try {
      const r = await s.call('GET', '/', { host: `[::1]:${s.port}` });
      assert.equal(r.status, 200);
      assert.match(s.logs().stdout, /^Incident Simulator running at http:\/\/localhost:\d+$/m);
    } finally { await s.stop(); }
  } else {
    const r = await runToExit({ env: { HOST: '::1' } });
    assert.notEqual(r.code, 0);
    assert.ok(!/Cannot find module/.test(r.output), 'fails because IPv6 loopback is missing, not because the server file is missing');
  }
});

// ------------------------------------------------------------------ signals
test('SIGINT and SIGTERM close the server and exit 0', async () => {
  for (const sig of ['SIGINT', 'SIGTERM']) {
    const s = await startServer();
    const info = await s.stop(sig);
    assert.equal(info.code, 0, sig);
    assert.equal(info.signal, null, sig);
  }
});

// ------------------------------------------------------------------ SCENARIOS_DIR
test('SCENARIOS_DIR that is missing or not a directory exits 1 with "Cannot read SCENARIOS_DIR <path>"', async () => {
  const t = tempDir();
  try {
    const missing = path.join(t.base, 'nope');
    const file = path.join(t.base, 'a-file');
    fs.writeFileSync(file, 'x');
    for (const p of [missing, file]) {
      const r = await runToExit({ env: { SCENARIOS_DIR: p } });
      assert.equal(r.code, 1, p);
      assert.ok(r.stderr.includes(`Cannot read SCENARIOS_DIR ${p}`), `${p}: ${r.output}`);
      assert.ok(!/running at/.test(r.stdout));
    }
  } finally { t.cleanup(); }
});

test('the default scenarios folder is relative to the app root, not the working directory', async () => {
  const s = await startServer({ cwd: os.tmpdir() });
  try {
    assert.match(s.logs().stdout, /^Loaded 10 scenarios\.$/m);
    assert.equal((await s.call('GET', '/scenarios/cache-stampede.json')).status, 200);
  } finally { await s.stop(); }
});

test('SCENARIOS_DIR may be a symlink to a folder (it is realpath-ed)', async () => {
  const d = scenarioDir({ 'cache-stampede.json': CS() });
  const t = tempDir();
  try {
    const link = path.join(t.base, 'linked-scenarios');
    fs.symlinkSync(d.dir, link);
    const s = await startServer({ scenariosDir: link });
    try {
      assert.match(s.logs().stdout, /^Loaded 1 scenario\.$/m);
      assert.deepEqual((await s.call('GET', '/scenarios/index.json')).body.valid, ['cache-stampede']);
    } finally { await s.stop(); }
  } finally { t.cleanup(); d.cleanup(); }
});

// ------------------------------------------------------------------ SC9: three bad files
const sc9Files = () => ({
  'cache-stampede.json': CS(),
  'no-root-cause.json': variantJson('cache-stampede', 'no-root-cause', (o) => { delete o.rootCause; }),
  'bad-action.json': variantJson('cache-stampede', 'bad-action', (o) => { o.optimalPath[0].id = 'reboot-everything'; }),
  'bad-guide.json': variantJson('cache-stampede', 'bad-guide', (o) => { o.guideUrl = 'https://example.com/x'; }),
});

test('SC9: three invalid files keep the server up, print "scenario error:" lines before the ready line and list the errors in index.json', async () => {
  const d = scenarioDir(sc9Files());
  try {
    const s = await startServer({ scenariosDir: d.dir });
    try {
      const out = s.logs().stdout;
      const lines = out.split('\n');
      const errLines = lines.filter((l) => l.startsWith('scenario error: '));
      assert.ok(errLines.length >= 3, out);
      const readyAt = lines.findIndex((l) => l.startsWith('Incident Simulator running'));
      assert.ok(lines.slice(0, readyAt).filter((l) => l.startsWith('scenario error: ')).length === errLines.length, 'every error line comes before the ready line');
      assert.equal(lines[readyAt + 1], 'Loaded 1 scenario.');
      assert.ok(errLines.includes('scenario error: scenarios/no-root-cause.json: field "rootCause": missing. Expected: a non-empty string.'));
      assert.ok(errLines.includes('scenario error: scenarios/bad-guide.json: field "guideUrl": "https://example.com/x" is not allowed. Expected: a URL starting with https://bytebytego.com/guides/.'));
      assert.ok(errLines.some((l) => l.startsWith('scenario error: scenarios/bad-action.json: field "optimalPath[0].id": unknown action "reboot-everything". Expected: one of ')));
      const order = errLines.map((l) => /^scenario error: scenarios\/([^:]+):/.exec(l)[1]);
      assert.deepEqual(order, [...order].sort(), 'files in name order');
      const idx = await s.call('GET', '/scenarios/index.json');
      assert.deepEqual(idx.body.valid, ['cache-stampede']);
      assert.ok(idx.body.errors.length >= 3);
      for (const e of idx.body.errors) assert.deepEqual(Object.keys(e).sort(), ['field', 'file', 'message']);
      const byFile = (f) => idx.body.errors.filter((e) => e.file === f);
      assert.deepEqual(byFile('no-root-cause.json'), [{ file: 'no-root-cause.json', field: 'rootCause', message: 'missing. Expected: a non-empty string.' }]);
      assert.deepEqual(byFile('bad-guide.json').map((e) => e.field), ['guideUrl']);
      assert.equal(byFile('bad-action.json')[0].field, 'optimalPath[0].id');
      assert.equal(byFile('bad-action.json').length >= 1, true);
      assert.equal((await s.call('GET', '/')).status, 200);
      assert.equal((await s.call('GET', '/scenarios/cache-stampede.json')).status, 200);
      for (const id of ['no-root-cause', 'bad-action', 'bad-guide']) assert.equal((await s.call('GET', `/scenarios/${id}.json`)).status, 404, id);
      assert.equal(s.exited(), null);
    } finally { await s.stop(); }
  } finally { d.cleanup(); }
});

test('an all-invalid folder serves valid:[] with the errors, prints "Loaded 0 scenarios." and still answers /', async () => {
  const d = scenarioDir({ 'no-root-cause.json': variantJson('cache-stampede', 'no-root-cause', (o) => { delete o.rootCause; }), 'bad-guide.json': variantJson('cache-stampede', 'bad-guide', (o) => { o.guideUrl = 'https://example.com/x'; }) });
  try {
    const s = await startServer({ scenariosDir: d.dir });
    try {
      assert.match(s.logs().stdout, /^Loaded 0 scenarios\.$/m);
      const idx = await s.call('GET', '/scenarios/index.json');
      assert.deepEqual(idx.body.valid, []);
      assert.equal(idx.body.errors.length, 2);
      assert.equal((await s.call('GET', '/')).status, 200);
    } finally { await s.stop(); }
  } finally { d.cleanup(); }
});

test('an empty folder gives valid:[] and "Loaded 0 scenarios."; one valid file gives "Loaded 1 scenario."', async () => {
  const empty = scenarioDir({});
  try {
    const s = await startServer({ scenariosDir: empty.dir });
    try {
      assert.match(s.logs().stdout, /^Loaded 0 scenarios\.$/m);
      assert.deepEqual((await s.call('GET', '/scenarios/index.json')).body, { valid: [], errors: [] });
    } finally { await s.stop(); }
  } finally { empty.cleanup(); }
  const one = scenarioDir({ 'cache-stampede.json': CS() });
  try {
    const s = await startServer({ scenariosDir: one.dir });
    try { assert.match(s.logs().stdout, /^Loaded 1 scenario\.$/m); } finally { await s.stop(); }
  } finally { one.cleanup(); }
});

test('no hot reload: files added, edited or removed after boot change nothing; exact boot bytes are served', async () => {
  const d = scenarioDir({ 'cache-stampede.json': CS() });
  try {
    const s = await startServer({ scenariosDir: d.dir });
    try {
      const before = await s.call('GET', '/scenarios/cache-stampede.json');
      fs.writeFileSync(path.join(d.dir, 'late.json'), variantJson('cache-stampede', 'late'));
      fs.writeFileSync(path.join(d.dir, 'cache-stampede.json'), '{"edited":true}');
      await sleep(100);
      assert.equal((await s.call('GET', '/scenarios/late.json')).status, 404);
      const after = await s.call('GET', '/scenarios/cache-stampede.json');
      assert.ok(after.buffer.equals(before.buffer));
      assert.ok(after.buffer.equals(CS()));
      fs.rmSync(path.join(d.dir, 'cache-stampede.json'));
      assert.ok((await s.call('GET', '/scenarios/cache-stampede.json')).buffer.equals(CS()));
      assert.deepEqual((await s.call('GET', '/scenarios/index.json')).body.valid, ['cache-stampede']);
    } finally { await s.stop(); }
  } finally { d.cleanup(); }
});

// ------------------------------------------------------------------ loadScenarios
test('loadScenarios on the shipped folder returns the 10 scenarios with exact bytes and an index of the sorted ids', async () => {
  const { loadScenarios } = await loader();
  const r = await loadScenarios(SCEN_DIR);
  assert.deepEqual(r.errors, []);
  assert.deepEqual([...r.scenarios.map((s) => s.id)].sort(), [...SHIPPED_IDS].sort());
  for (const s of r.scenarios) {
    assert.ok(Buffer.isBuffer(s.bytes));
    assert.ok(s.bytes.equals(fs.readFileSync(scenarioFile(s.id))), s.id);
    assert.equal(s.scenario.id, s.id);
  }
  assert.deepEqual(r.index, { valid: [...SHIPPED_IDS].sort(), errors: [] });
});

test('loadScenarios applies the name rule, lstat, size, UTF-8, safe-json and validate rules and reports bare file names', async () => {
  const valid = (stem) => variantJson('cache-stampede', stem);
  const exact = Buffer.from(valid('exact'));
  const padded = Buffer.concat([exact, Buffer.alloc(65536 - exact.length, 0x20)]);
  assert.equal(padded.length, 65536);
  const big = Buffer.concat([padded, Buffer.from(' ')]);
  const d = scenarioDir({
    'Bad.json': valid('Bad'), 'a_b.json': valid('a_b'), [`${'x'.repeat(41)}.json`]: valid('x'.repeat(41)), '.hidden.json': valid('.hidden'),
    'notes.txt': 'ignore me', 'readme.md': '# hi', 'cache.json.bak': valid('cache'),
    'link.json': { symlink: scenarioFile('cache-stampede') }, 'dir.json': { dir: true },
    'big.json': big, 'exact.json': padded, 'latin1.json': Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x3a, 0x31, 0x7d]),
    'proto.json': '{"__proto__":{"polluted":true},"id":"proto"}', 'empty.json': '', 'null.json': 'null', 'array.json': '[]',
    'mismatch.json': valid('other'), 'deep.json': '['.repeat(100), 'ok-one.json': valid('ok-one'),
  });
  try {
    const { loadScenarios } = await loader();
    const r = await loadScenarios(d.dir);
    assert.deepEqual([...r.index.valid], ['exact', 'ok-one']);
    assert.deepEqual([...r.scenarios.map((s) => s.id)].sort(), ['exact', 'ok-one']);
    const files = r.errors.map((e) => e.file);
    assert.deepEqual(files, [...files].sort(), 'errors come in file name order');
    const errOf = (f) => r.errors.filter((e) => e.file === f);
    for (const f of ['Bad.json', 'a_b.json', `${'x'.repeat(41)}.json`, '.hidden.json', 'link.json', 'dir.json', 'big.json', 'latin1.json', 'proto.json', 'empty.json', 'deep.json']) {
      assert.ok(errOf(f).length >= 1, `${f} is an error`);
      assert.equal(errOf(f)[0].field, '(file)', `${f} field`);
      assert.equal(typeof errOf(f)[0].message, 'string');
    }
    assert.ok(errOf('proto.json')[0].message.includes('__proto__'));
    for (const f of ['null.json', 'array.json']) assert.deepEqual(errOf(f), [{ file: f, field: '(file)', message: 'is not a JSON object. Expected: an object with the scenario fields.' }]);
    assert.equal(errOf('mismatch.json')[0].field, 'id');
    for (const f of ['notes.txt', 'readme.md', 'cache.json.bak', 'exact.json', 'ok-one.json']) assert.equal(errOf(f).length, 0, `${f} is not an error`);
    assert.deepEqual(r.index.errors, r.errors);
    assert.equal(Object.keys(Object.prototype).length, 0);
  } finally { d.cleanup(); }
});

test('the server prints one "scenario error:" line per problem for hostile files and never serves them', async () => {
  const d = scenarioDir({
    'ok-one.json': variantJson('cache-stampede', 'ok-one'), 'Bad.json': variantJson('cache-stampede', 'Bad'), 'link.json': { symlink: scenarioFile('cache-stampede') },
    'proto.json': '{"__proto__":{"polluted":true}}', 'empty.json': '',
  });
  try {
    const s = await startServer({ scenariosDir: d.dir });
    try {
      const out = s.logs().stdout;
      const errLines = out.split('\n').filter((l) => l.startsWith('scenario error: '));
      const idx = (await s.call('GET', '/scenarios/index.json')).body;
      assert.deepEqual(errLines, idx.errors.map(fmtLine));
      assert.ok(idx.errors.length >= 4);
      assert.deepEqual(idx.valid, ['ok-one']);
      assert.match(out, /^Loaded 1 scenario\.$/m);
      for (const f of ['Bad', 'link', 'proto', 'empty']) assert.equal((await s.call('GET', `/scenarios/${f}.json`)).status, 404, f);
      assert.equal(fs.existsSync(path.join(d.dir, 'proto.json')), true);
    } finally { await s.stop(); }
  } finally { d.cleanup(); }
});

test('a file of exactly 65,536 bytes loads and one of 65,537 bytes is rejected by the server too', async () => {
  const body = Buffer.from(variantJson('cache-stampede', 'exact'));
  const d = scenarioDir({ 'exact.json': Buffer.concat([body, Buffer.alloc(65536 - body.length, 0x20)]), 'over.json': Buffer.concat([Buffer.from(variantJson('cache-stampede', 'over')), Buffer.alloc(65537 - Buffer.byteLength(variantJson('cache-stampede', 'over')), 0x20)]) });
  try {
    const s = await startServer({ scenariosDir: d.dir });
    try {
      const idx = (await s.call('GET', '/scenarios/index.json')).body;
      assert.deepEqual(idx.valid, ['exact']);
      assert.equal(idx.errors.length, 1);
      assert.equal(idx.errors[0].file, 'over.json');
      assert.equal(idx.errors[0].field, '(file)');
    } finally { await s.stop(); }
  } finally { d.cleanup(); }
});
