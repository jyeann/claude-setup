'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const SERVER = path.join(__dirname, '..', 'src', 'server.js');

const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
  srv.on('error', reject);
});

async function startServer(dataFile) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(port), DATA_FILE: dataFile },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not print "listening on" within 5s')), 5000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes(`listening on ${port}`)) { clearTimeout(timer); resolve(); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited early (${code})`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, url, body, raw) => {
    const res = await fetch(base + url, {
      method,
      headers: body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {},
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, text };
  };
  const stop = () => new Promise((resolve) => { child.once('exit', (code, signal) => resolve({ code, signal })); child.kill('SIGTERM'); });
  return { call, stop };
}

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'todo-')), 'nested', 'todos.json');

test('POST /todos creates a todo with trimmed title, id, done=false and ISO createdAt', async () => {
  const s = await startServer(tmpFile());
  try {
    const r = await s.call('POST', '/todos', { title: '  buy milk  ' });
    assert.equal(r.status, 201);
    assert.equal(r.body.title, 'buy milk');
    assert.equal(r.body.done, false);
    assert.equal(typeof r.body.id, 'string');
    assert.ok(r.body.id.length > 0);
    assert.equal(new Date(r.body.createdAt).toISOString(), r.body.createdAt);
  } finally { await s.stop(); }
});

test('POST /todos rejects bad titles and malformed JSON with 400 and an error message', async () => {
  const s = await startServer(tmpFile());
  try {
    for (const body of [{}, { title: '' }, { title: '   ' }, { title: 5 }, { title: 'x'.repeat(201) }]) {
      const r = await s.call('POST', '/todos', body);
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 40));
      assert.equal(typeof r.body.error, 'string');
    }
    const bad = await s.call('POST', '/todos', undefined, '{not json');
    assert.equal(bad.status, 400);
    const edge = await s.call('POST', '/todos', { title: 'x'.repeat(200) });
    assert.equal(edge.status, 201);
  } finally { await s.stop(); }
});

test('GET /todos lists oldest first and filters by done', async () => {
  const s = await startServer(tmpFile());
  try {
    assert.deepEqual((await s.call('GET', '/todos')).body, []);
    const a = (await s.call('POST', '/todos', { title: 'a' })).body;
    const b = (await s.call('POST', '/todos', { title: 'b' })).body;
    await s.call('PATCH', `/todos/${b.id}`, { done: true });
    assert.deepEqual((await s.call('GET', '/todos')).body.map((t) => t.title), ['a', 'b']);
    assert.deepEqual((await s.call('GET', '/todos?done=true')).body.map((t) => t.id), [b.id]);
    assert.deepEqual((await s.call('GET', '/todos?done=false')).body.map((t) => t.id), [a.id]);
    assert.equal((await s.call('GET', '/todos?done=maybe')).status, 400);
  } finally { await s.stop(); }
});

test('GET /todos/:id returns the todo or 404', async () => {
  const s = await startServer(tmpFile());
  try {
    const created = (await s.call('POST', '/todos', { title: 'x' })).body;
    const got = await s.call('GET', `/todos/${created.id}`);
    assert.equal(got.status, 200);
    assert.deepEqual(got.body, created);
    const missing = await s.call('GET', '/todos/nope');
    assert.equal(missing.status, 404);
    assert.equal(typeof missing.body.error, 'string');
  } finally { await s.stop(); }
});

test('PATCH /todos/:id updates fields, validates input, and 404s on unknown ids', async () => {
  const s = await startServer(tmpFile());
  try {
    const t = (await s.call('POST', '/todos', { title: 'old' })).body;
    const r = await s.call('PATCH', `/todos/${t.id}`, { title: ' new ', done: true });
    assert.equal(r.status, 200);
    assert.equal(r.body.title, 'new');
    assert.equal(r.body.done, true);
    assert.equal(r.body.id, t.id);
    assert.equal(r.body.createdAt, t.createdAt);
    for (const body of [{}, { done: 'yes' }, { title: '' }, { title: 7 }]) {
      assert.equal((await s.call('PATCH', `/todos/${t.id}`, body)).status, 400, JSON.stringify(body));
    }
    assert.equal((await s.call('PATCH', '/todos/nope', { done: true })).status, 404);
  } finally { await s.stop(); }
});

test('DELETE /todos/:id returns 204 with no body, then 404', async () => {
  const s = await startServer(tmpFile());
  try {
    const t = (await s.call('POST', '/todos', { title: 'gone' })).body;
    const del = await s.call('DELETE', `/todos/${t.id}`);
    assert.equal(del.status, 204);
    assert.equal(del.text, '');
    assert.equal((await s.call('DELETE', `/todos/${t.id}`)).status, 404);
    assert.equal((await s.call('GET', `/todos/${t.id}`)).status, 404);
  } finally { await s.stop(); }
});

test('unknown routes are 404 and wrong methods on known paths are 405', async () => {
  const s = await startServer(tmpFile());
  try {
    assert.equal((await s.call('GET', '/nothing')).status, 404);
    assert.equal((await s.call('PUT', '/todos', { title: 'x' })).status, 405);
    assert.equal((await s.call('POST', '/todos/abc', { title: 'x' })).status, 405);
  } finally { await s.stop(); }
});

test('todos survive a restart and ids stay unique afterwards', async () => {
  const file = tmpFile();
  const first = await startServer(file);
  let id;
  try { id = (await first.call('POST', '/todos', { title: 'persist me' })).body.id; } finally { await first.stop(); }
  const second = await startServer(file);
  try {
    const list = (await second.call('GET', '/todos')).body;
    assert.deepEqual(list.map((t) => t.title), ['persist me']);
    const other = (await second.call('POST', '/todos', { title: 'another' })).body;
    assert.notEqual(other.id, id);
  } finally { await second.stop(); }
});

test('an empty or missing data file means an empty list', async () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
  const s = await startServer(file);
  try { assert.deepEqual((await s.call('GET', '/todos')).body, []); } finally { await s.stop(); }
});

test('the server exits with code 0 on SIGTERM (so its coverage can be collected)', async () => {
  const s = await startServer(tmpFile());
  const { code, signal } = await s.stop();
  assert.equal(signal, null, 'must handle SIGTERM instead of being killed by it');
  assert.equal(code, 0);
});
