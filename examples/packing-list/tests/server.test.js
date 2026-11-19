'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const SERVER = path.join(__dirname, '..', 'src', 'server.js');

function run(env, opts = {}) {
  const child = spawn(process.execPath, [SERVER], { cwd: opts.cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = { stdout: '', stderr: '' };
  child.stdout.on('data', (c) => { out.stdout += c; });
  child.stderr.on('data', (c) => { out.stderr += c; });
  const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
  const waitFor = (re) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${re}: ${out.stdout} ${out.stderr}`)), 8000);
    const check = () => { if (re.test(out.stdout + out.stderr)) { clearTimeout(t); resolve(); } };
    child.stdout.on('data', check); child.stderr.on('data', check); check();
  });
  return { child, out, exited, waitFor };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'server-'));

test('PORT=0 prints exactly one line with the real port, and SIGTERM exits 0', async () => {
  const dir = tmp();
  const p = run({ PORT: '0', DATA_FILE: path.join(dir, 'l.json') });
  await p.waitFor(/Packing list running at http:\/\/localhost:\d+\n/);
  assert.match(p.out.stdout, /^Packing list running at http:\/\/localhost:[1-9]\d*\n$/);
  assert.equal(p.out.stderr, '');
  p.child.kill('SIGTERM');
  assert.deepEqual(await p.exited, { code: 0, signal: null });
});

test('SIGINT exits 0 too', async () => {
  const p = run({ PORT: '0', DATA_FILE: path.join(tmp(), 'l.json') });
  await p.waitFor(/running at/);
  p.child.kill('SIGINT');
  assert.equal((await p.exited).code, 0);
});

test('a relative DATA_FILE is resolved against the current directory', async () => {
  const dir = tmp();
  const p = run({ PORT: '0', DATA_FILE: 'rel/lists.json' }, { cwd: dir });
  await p.waitFor(/running at http:\/\/localhost:(\d+)/);
  const port = /localhost:(\d+)/.exec(p.out.stdout)[1];
  const res = await fetch(`http://127.0.0.1:${port}/api/lists`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"Rel"}' });
  assert.equal(res.status, 201);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'rel', 'lists.json'), 'utf8')).schema, 1);
  p.child.kill('SIGTERM');
  await p.exited;
});

test('a non-loopback HOST prints that host and a LAN warning on stderr', async () => {
  const p = run({ PORT: '0', HOST: '0.0.0.0', DATA_FILE: path.join(tmp(), 'l.json') });
  await p.waitFor(/running at/);
  assert.match(p.out.stdout, /^Packing list running at http:\/\/0\.0\.0\.0:\d+\n$/);
  assert.match(p.out.stderr, /network/i);
  p.child.kill('SIGTERM');
  await p.exited;
});

test('a port in use prints "Port <N> is in use, set PORT" and exits 1', async () => {
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
  const port = blocker.address().port;
  try {
    const p = run({ PORT: String(port), DATA_FILE: path.join(tmp(), 'l.json') });
    const info = await p.exited;
    assert.equal(info.code, 1);
    assert.equal(p.out.stderr, `Port ${port} is in use, set PORT\n`);
    assert.equal(p.out.stdout, '');
  } finally { blocker.close(); }
});

test('an invalid PORT exits 1 with a message', async () => {
  const p = run({ PORT: 'abc', DATA_FILE: path.join(tmp(), 'l.json') });
  assert.equal((await p.exited).code, 1);
  assert.match(p.out.stderr, /Invalid PORT/);
});

test('a corrupt data file is moved aside at boot and the server still starts', async () => {
  const dir = tmp();
  const file = path.join(dir, 'l.json');
  fs.writeFileSync(file, 'not json');
  const p = run({ PORT: '0', DATA_FILE: file });
  await p.waitFor(/running at/);
  assert.equal(fs.readdirSync(dir).filter((n) => n.startsWith('l.json.corrupt-')).length, 1);
  assert.equal(p.out.stderr.trim().split('\n').length, 1);
  p.child.kill('SIGTERM');
  await p.exited;
});

test('list ids are never written to the logs', async () => {
  const p = run({ PORT: '0', DATA_FILE: path.join(tmp(), 'l.json') });
  await p.waitFor(/running at http:\/\/localhost:(\d+)/);
  const port = /localhost:(\d+)/.exec(p.out.stdout)[1];
  const res = await fetch(`http://127.0.0.1:${port}/api/lists`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"Quiet"}' });
  const { id } = await res.json();
  await fetch(`http://127.0.0.1:${port}/l/${id}`);
  p.child.kill('SIGTERM');
  await p.exited;
  assert.ok(!(p.out.stdout + p.out.stderr).includes(id));
});

test('server enforces timeouts on time and caps connections', () => {
  const { createApp } = require('../src/server');
  const dir = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'srv-'));
  const { server } = createApp({ dataFile: require('node:path').join(dir, 'l.json') });
  assert.equal(server.connectionsCheckingInterval, 1000);
  assert.equal(server.maxConnections, 1000);
});
