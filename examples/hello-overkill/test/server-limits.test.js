'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const SERVER = path.join(__dirname, '..', 'src', 'server.js');
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-s-')), 'd.json');

function run(env) {
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, DATA_FILE: tmp(), HELLO_SIGNING_SECRET: 'x', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const o = { out: '', err: '', child };
  child.stdout.on('data', (c) => { o.out += c; });
  child.stderr.on('data', (c) => { o.err += c; });
  o.exit = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
  o.ready = new Promise((resolve) => {
    const t = setInterval(() => { const m = /listening on (\d+)\nopen http:\/\/localhost:(\d+)\/\n/.exec(o.out); if (m) { clearInterval(t); resolve(Number(m[1])); } }, 10);
    child.on('exit', () => { clearInterval(t); resolve(null); });
  });
  return o;
}

test('prints listening line then open hint with the real bound port', async () => {
  const s = run({ PORT: '0' });
  const port = await s.ready;
  assert.ok(port > 0);
  assert.equal(s.out, `listening on ${port}\nopen http://localhost:${port}/\n`);
  s.child.kill('SIGTERM');
  assert.deepEqual(await s.exit, { code: 0, signal: null });
});

test('an invalid PORT exits 1 with a message and never listens', async () => {
  for (const PORT of ['70000', 'abc', '-1']) {
    const s = run({ PORT });
    assert.equal((await s.exit).code, 1);
    assert.match(s.err, /invalid PORT/);
    assert.ok(!s.out.includes('listening'));
  }
});

test('a port already in use logs "port <n> in use" and exits 1', async () => {
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, r));
  const { port } = blocker.address();
  try {
    const s = run({ PORT: String(port) });
    assert.equal((await s.exit).code, 1);
    assert.ok(s.err.includes(`port ${port} in use`));
  } finally { blocker.close(); }
});

test('SIGTERM exits 0 promptly even with a keep-alive connection open', async () => {
  const s = run({ PORT: '0' });
  const port = await s.ready;
  const agent = new http.Agent({ keepAlive: true });
  await new Promise((resolve, reject) => http.get({ port, host: '127.0.0.1', path: '/healthz', agent }, (res) => { res.resume(); res.on('end', resolve); }).on('error', reject));
  const t = Date.now();
  s.child.kill('SIGTERM');
  assert.deepEqual(await s.exit, { code: 0, signal: null });
  assert.ok(Date.now() - t < 3000);
  agent.destroy();
});

test('SIGINT also exits 0', async () => {
  const s = run({ PORT: '0' });
  await s.ready;
  s.child.kill('SIGINT');
  assert.deepEqual(await s.exit, { code: 0, signal: null });
});

test('a client that never finishes its headers is cut off by the 5 s headers timeout', async () => {
  const s = run({ PORT: '0' });
  const port = await s.ready;
  const started = Date.now();
  const closed = await new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.write('GET /healthz HTTP/1.1\r\nHost: x\r\n'));
    sock.on('data', () => {});
    sock.on('close', () => resolve(Date.now() - started));
    sock.on('error', () => {});
  });
  assert.ok(closed >= 4000 && closed < 9000, `closed after ${closed}ms`);
  s.child.kill('SIGTERM');
  await s.exit;
});
