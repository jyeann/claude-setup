'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startServer, tmpFile } = require('../acceptance/helpers');

const SERVER = path.join(__dirname, '..', 'src', 'server.js');
const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const get = (port, p) => new Promise((resolve, reject) => {
  const r = http.get({ host: '127.0.0.1', port, path: p, agent: false }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  r.on('error', reject);
});
async function waitHealthy(port) {
  for (let i = 0; i < 100; i += 1) {
    try { return await get(port, '/healthz'); } catch { await new Promise((r) => setTimeout(r, 50)); }
  }
  throw new Error('server never became healthy');
}

test('server stays up when stdout is a closed pipe (EPIPE) and exits 0 on SIGTERM', async () => {
  const port = await freePort();
  // stdout goes to `head -n 1`, which exits after the first line; the second line hits a closed pipe.
  const child = spawn('bash', ['-c', `exec node ${SERVER} > >(head -n 1 >/dev/null)`], {
    env: { ...process.env, PORT: String(port), DATA_FILE: tmpFile(), HELLO_SIGNING_SECRET: 'test' }, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  const exited = new Promise((r) => child.once('exit', (code, signal) => r({ code, signal })));
  try {
    assert.equal(await waitHealthy(port), 200);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(child.exitCode, null, `server died: ${stderr}`);
    assert.equal(await get(port, '/healthz'), 200);
    child.kill('SIGTERM');
    assert.deepEqual(await exited, { code: 0, signal: null });
  } finally { child.kill('SIGKILL'); }
});

test('stdout and stderr have error handlers that swallow only EPIPE', () => {
  const src = require('node:fs').readFileSync(SERVER, 'utf8');
  assert.match(src, /process\.stdout, process\.stderr/);
  assert.match(src, /e\.code !== 'EPIPE'/);
});

test('server wires peers, the sla token and the read limit from the environment', async () => {
  const s = await startServer(tmpFile(), { env: { HELLO_SLA_TOKEN: 'tok-tok-tok-tok-tok', HELLO_READ_LIMIT: '2' } }); // harness:allow-secret
  try {
    assert.equal((await s.call('GET', '/api/sla')).status, 401);
    assert.equal((await s.call('GET', '/api/sla', undefined, undefined, { authorization: 'Bearer tok-tok-tok-tok-tok' })).status, 200);
    assert.equal((await s.call('GET', '/api/weather')).status, 429);
    assert.equal((await s.call('GET', '/healthz')).status, 200);
  } finally { await s.stop(); }
});

test('shutdown ends open streams and exits 0', async () => {
  const s = await startServer(tmpFile());
  let stopping = null;
  await new Promise((resolve, reject) => {
    const r = http.get({ host: '127.0.0.1', port: s.port, path: '/api/stream', agent: false }, (res) => {
      res.on('data', () => { if (!stopping) stopping = s.stop(); });
      res.on('end', resolve);
      res.on('close', resolve);
      res.on('error', resolve);
    });
    r.on('error', (e) => (e.code === 'ECONNRESET' ? resolve() : reject(e)));
  });
  assert.equal((await stopping).code, 0);
});

test('HELLO_STREAM_HEARTBEAT_MS drives the heartbeat comment', async () => {
  const s = await startServer(tmpFile(), { env: { HELLO_STREAM_HEARTBEAT_MS: '50' } });
  try {
    const text = await new Promise((resolve, reject) => {
      const r = http.get({ host: '127.0.0.1', port: s.port, path: '/api/stream', agent: false }, (res) => {
        let t = '';
        res.on('data', (c) => { t += c; if (t.includes(': hb')) { res.destroy(); resolve(t); } });
      });
      r.on('error', (e) => (e.code === 'ECONNRESET' ? undefined : reject(e)));
      setTimeout(() => reject(new Error('no heartbeat within 3s')), 3000).unref();
    });
    assert.ok(text.includes(': hb\n\n'));
  } finally { await s.stop(); }
});

test('invalid HELLO_STREAM_HEARTBEAT_MS warns on stderr and the server still starts', async () => {
  const s = await startServer(tmpFile(), { env: { HELLO_STREAM_HEARTBEAT_MS: '5' } });
  try {
    assert.match(s.stderr(), /invalid HELLO_STREAM_HEARTBEAT_MS, using 15000/);
  } finally { await s.stop(); }
});

test('server exits 1 with a message when HELLO_SLA_TOKEN is shorter than 16 characters in production', async () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, [SERVER], { env: { ...process.env, NODE_ENV: 'production', PORT: '0', HELLO_SLA_TOKEN: 'short', HELLO_SIGNING_SECRET: 'x'.repeat(32), DATA_FILE: tmpFile() }, encoding: 'utf8', timeout: 5000 });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /HELLO_SLA_TOKEN must be at least 16 characters/);
});
