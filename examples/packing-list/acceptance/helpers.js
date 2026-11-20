'use strict';
// HTTP-only test helpers. Spawns `node src/server.js` and talks to it over HTTP.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');

const APP_DIR = path.join(__dirname, '..');
const SERVER = path.join(APP_DIR, 'src', 'server.js');

const tmpDataDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'packing-'));
const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.on('error', reject);
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
});

// call(method, path, body, {headers, raw}) -> {status, body, text, headers}
//  - body: JS value, sent as JSON with content-type application/json
//  - raw: string/Buffer sent verbatim instead of JSON.stringify(body)
//  - headers: extra headers (lowercase names win); a null/undefined value removes a header
//  - result.headers is a plain object with lowercase names; result.body is parsed JSON or null
function makeCall(port) {
  return (method, urlPath, body, opts = {}) => new Promise((resolve, reject) => {
    const { headers: extra = {}, raw } = opts;
    const payload = raw !== undefined ? Buffer.from(raw) : body !== undefined ? Buffer.from(JSON.stringify(body)) : null;
    const headers = {};
    if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = String(payload.length); }
    for (const [k, v] of Object.entries(extra)) {
      if (v === null || v === undefined) delete headers[k.toLowerCase()]; else headers[k.toLowerCase()] = v;
    }
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, agent: false, timeout: 8000 }, (res) => {
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
    req.on('timeout', () => req.destroy(new Error(`request ${method} ${urlPath} timed out`)));
    req.on('error', reject);
    req.end(payload || undefined);
  });
}

// Start the server. opts: {dataDir, dataFile, env, port}. Resolves once the ready line is printed.
// Fails fast with a clear message when src/server.js is missing or the process exits early.
async function startOnce(opts = {}) {
  if (!fs.existsSync(SERVER)) throw new Error('src/server.js not found');
  const dataDir = opts.dataDir || tmpDataDir();
  const dataFile = opts.dataFile || path.join(dataDir, 'lists.json');
  const port = opts.port || await freePort();
  const child = spawn(process.execPath, [SERVER], {
    cwd: APP_DIR,
    env: { ...process.env, ...(opts.env || {}), PORT: String(port), DATA_FILE: dataFile },
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
  const ready = `Packing list running at http://localhost:${port}`;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`server did not print "${ready}" within 8s. stderr: ${stderr}`)); }, 8000);
    const check = () => { if (stdout.includes(ready)) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', check);
    stopped.then((info) => { clearTimeout(timer); reject(new Error(`server exited before ready (code ${info.code}, signal ${info.signal}). stderr: ${stderr}`)); });
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
    call: makeCall(port), stop, stopped, base: `http://127.0.0.1:${port}`, port, dataDir, dataFile,
    child, logs: () => ({ stdout, stderr }),
  };
}

// Picking a free port and binding it are two steps, so a parallel process can take the port in between.
// Without an explicit port, retry with a new port (up to 5 attempts) when the server reports "is in use".
async function startServer(opts = {}) {
  if (opts.port) return startOnce(opts);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await startOnce(opts);
    } catch (err) {
      if (attempt >= 5 || !/is in use/.test(String(err && err.message))) throw err;
    }
  }
}

// Stop `server` and start a new one on the same data file (new port).
async function restart(server, opts = {}) {
  await server.stop();
  return startServer({ ...opts, dataDir: server.dataDir, dataFile: server.dataFile });
}

// Run fn(server, ctx) with a fresh server and temp DATA_FILE, then clean up.
// ctx.restart() stops the server and starts another on the same data file, updates ctx.server and returns it.
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

// Convenience wrappers.
async function createList(server, name = 'Lisbon weekend') {
  const res = await server.call('POST', '/api/lists', { name });
  return { res, id: res.body && res.body.id, view: res.body };
}
async function addItem(server, id, text) {
  const res = await server.call('POST', `/api/lists/${id}/items`, { text });
  const items = (res.body && res.body.items) || [];
  res.item = items.length ? items[items.length - 1] : undefined; // newest item is last
  return res;
}
const setTicked = (server, id, itemId, ticked) => server.call('PUT', `/api/lists/${id}/items/${itemId}/ticked`, { ticked });
const removeItem = (server, id, itemId) => server.call('DELETE', `/api/lists/${id}/items/${itemId}`);
const getList = (server, id) => server.call('GET', `/api/lists/${id}`);

module.exports = {
  startServer, restart, withServer, tmpDataDir, freePort, createList, addItem, setTicked, removeItem, getList,
};
