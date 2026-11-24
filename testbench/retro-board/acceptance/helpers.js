'use strict';
// HTTP-only test helpers. Spawns `node src/server.js` and talks to it over HTTP.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const SERVER = path.join(__dirname, '..', 'src', 'server.js');
const APP_DIR = path.join(__dirname, '..');

const newClientId = () => crypto.randomBytes(16).toString('base64url'); // 22 chars
const tmpDataDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'retro-'));
const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.on('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

// call(method, path, body, {clientId, headers, raw}) -> {status, body, text, headers}
//  - body: JS value, sent as JSON with content-type application/json
//  - raw: string/Buffer sent verbatim instead of JSON.stringify(body)
//  - clientId: X-Client-Id value; default is the server's own random id; null sends none
//  - headers: extra headers (lowercase names win); a null/undefined value removes a header
//  - result.headers is a plain object with lowercase names
function makeCall(port, defaultClientId) {
  return (method, urlPath, body, opts = {}) => new Promise((resolve, reject) => {
    const { clientId, headers: extra = {}, raw } = opts;
    const payload = raw !== undefined ? Buffer.from(raw) : body !== undefined ? Buffer.from(JSON.stringify(body)) : null;
    const headers = {};
    const cid = clientId === undefined ? defaultClientId : clientId;
    if (cid !== null) headers['x-client-id'] = cid;
    if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = String(payload.length); }
    for (const [k, v] of Object.entries(extra)) {
      if (v === null || v === undefined) delete headers[k.toLowerCase()]; else headers[k.toLowerCase()] = v;
    }
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, body: parsed, text, headers: res.headers });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(payload || undefined);
  });
}

// Start the server. opts: {dataDir, env}. Resolves once the ready line is printed.
async function startServer(opts = {}) {
  const dataDir = opts.dataDir || tmpDataDir();
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    cwd: APP_DIR,
    env: { ...process.env, ...(opts.env || {}), PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  let exitInfo = null;
  const stopped = new Promise((resolve) => {
    child.once('exit', (code, signal) => { exitInfo = { code, signal }; resolve(exitInfo); });
  });
  const ready = `Retro board running at http://localhost:${port}`;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`server did not print "${ready}" within 8s. stderr: ${stderr}`)); }, 8000);
    const check = () => { if (stdout.includes(ready)) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', check);
    stopped.then((info) => { clearTimeout(timer); reject(new Error(`server exited early (code ${info.code}, signal ${info.signal}). stderr: ${stderr}`)); });
  });
  const stop = async () => {
    if (exitInfo) return exitInfo;
    child.kill('SIGTERM');
    const killer = setTimeout(() => child.kill('SIGKILL'), 5000);
    const info = await stopped;
    clearTimeout(killer);
    return info;
  };
  return {
    call: makeCall(port, newClientId()), stop, stopped, base: `http://127.0.0.1:${port}`, port, dataDir,
    child, logs: () => ({ stdout, stderr }),
  };
}

// Stop `server` and start a new one on the same dataDir (new port).
async function restart(server, opts = {}) {
  await server.stop();
  return startServer({ ...opts, dataDir: server.dataDir });
}

// Run fn(server, ctx) with a fresh server and a fresh temp DATA_DIR, then clean up.
// ctx.restart() stops the server and starts another on the same DATA_DIR, updates ctx.server and returns it.
// A fresh server per test also keeps each test clear of the per-IP rate limits.
async function withServer(fn, opts = {}) {
  const ctx = { server: await startServer(opts) };
  ctx.restart = async (o) => { ctx.server = await restart(ctx.server, o); return ctx.server; };
  try {
    return await fn(ctx.server, ctx);
  } finally {
    await ctx.server.stop();
    if (!opts.dataDir) fs.rmSync(ctx.server.dataDir, { recursive: true, force: true });
  }
}

// Convenience wrappers. All return the raw call result plus parsed extras.
async function createBoard(server, title = 'Sprint 12', clientId) {
  const res = await server.call('POST', '/api/boards', { title }, { clientId });
  const b = res.body || {};
  return { res, p: b.participantToken, f: b.facilitatorToken, view: b.board };
}

async function addCard(server, p, column, text, clientId) {
  const res = await server.call('POST', `/api/boards/${p}/cards`, { column, text }, { clientId });
  const cards = (res.body && res.body.cards) || [];
  res.card = cards.length ? cards[cards.length - 1] : undefined; // newest card (view is in id order)
  return res;
}

const vote = (server, p, id, clientId) => server.call('PUT', `/api/boards/${p}/cards/${id}/vote`, undefined, { clientId });
const unvote = (server, p, id, clientId) => server.call('DELETE', `/api/boards/${p}/cards/${id}/vote`, undefined, { clientId });
const getBoard = (server, p, clientId) => server.call('GET', `/api/boards/${p}`, undefined, { clientId });
const getFacBoard = (server, p, f, clientId) => server.call('GET', `/api/boards/${p}/f/${f}`, undefined, { clientId });
const setClosed = (server, p, f, closed, clientId) => server.call('PUT', `/api/boards/${p}/f/${f}/closed`, { closed }, { clientId });

module.exports = {
  startServer, restart, withServer, newClientId, tmpDataDir, createBoard, addCard, vote, unvote,
  getBoard, getFacBoard, setClosed,
};
