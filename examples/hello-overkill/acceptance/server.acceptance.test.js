'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { startServer, withServer, tmpFile, SERVER } = require('./helpers');

test('server prints "listening on <port>" first, then the open URL, with the real bound port', () => withServer(async (s) => {
  const lines = s.stdout().split('\n').filter(Boolean);
  assert.equal(lines[0], `listening on ${s.port}`);
  assert.ok(s.port > 0);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(s.stdout().split('\n').filter(Boolean)[1], `open http://localhost:${s.port}/`);
}));

test('SIGTERM exits with code 0', async () => {
  const s = await startServer(tmpFile());
  const { code } = await s.stop();
  assert.equal(code, 0);
});

test('SIGTERM exits promptly even with a chaos delay request in flight', async () => {
  const s = await startServer(tmpFile());
  const pending = s.call('POST', '/hello?chaos=delay').catch(() => null);
  await new Promise((r) => setTimeout(r, 200));
  const t0 = Date.now();
  const { code } = await s.stop();
  assert.equal(code, 0);
  assert.ok(Date.now() - t0 < 1500, 'did not wait for the delay');
  await pending;
});

test('without HELLO_SIGNING_SECRET the server warns on stderr and still serves', async () => {
  const s = await startServer(tmpFile(), { env: { HELLO_SIGNING_SECRET: null } });
  try {
    assert.match(s.stderr(), /WARNING: HELLO_SIGNING_SECRET not set; using a random per-process dev secret\. Certificates will read as Forged after restart\./);
    const r = await s.call('POST', '/hello', { name: 'Ada' });
    assert.equal((await s.call('POST', '/api/verify', { text: r.body.certificate.text })).body.verdict, 'Authentic');
  } finally { await s.stop(); }
});

test('with HELLO_SIGNING_SECRET set there is no dev-secret warning and the secret is never logged', async () => {
  const s = await startServer(tmpFile(), { env: { HELLO_SIGNING_SECRET: 'zq-very-unlikely-secret-9931' } }); // harness:allow-secret
  try {
    await s.call('POST', '/hello', { name: 'Ada' });
    assert.ok(!/WARNING/.test(s.stderr()));
    assert.ok(!(s.stdout() + s.stderr()).includes('zq-very-unlikely-secret-9931'));
  } finally { await s.stop(); }
});

test('an invalid HELLO_RATE_LIMIT logs a warning and falls back to 10', async () => {
  const s = await startServer(tmpFile(), { env: { HELLO_RATE_LIMIT: 'abc' } });
  try {
    assert.match(s.stderr(), /invalid HELLO_RATE_LIMIT, using 10/);
    for (let i = 0; i < 10; i += 1) assert.equal((await s.call('POST', '/hello')).status, 200);
    assert.equal((await s.call('POST', '/hello')).status, 429);
  } finally { await s.stop(); }
});

test('an out-of-range PORT makes the server exit with code 1 while a valid PORT starts', async () => {
  await withServer(async (s) => assert.equal((await s.call('GET', '/healthz')).status, 200));
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: '70000', DATA_FILE: tmpFile(), HELLO_SIGNING_SECRET: 'test' }, stdio: 'ignore' });
  const code = await new Promise((resolve) => { const t = setTimeout(() => { child.kill('SIGKILL'); resolve('timeout'); }, 5000); child.on('exit', (c) => { clearTimeout(t); resolve(c); }); });
  assert.equal(code, 1);
});

test('DATA_FILE parent directory is created on first write', async () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const file = path.join(path.dirname(tmpFile()), 'nested', 'deeper', 'hello.json');
  const s = await startServer(file);
  try {
    assert.equal((await s.call('POST', '/hello', { name: 'Ada' })).status, 200);
    assert.ok(fs.existsSync(file));
    JSON.parse(fs.readFileSync(file, 'utf8'));
  } finally { await s.stop(); }
});
