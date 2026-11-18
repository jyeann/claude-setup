'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const SERVER = path.join(__dirname, '..', 'src', 'server.js');
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-')), 'links.json');
const freePort = () => new Promise((resolve, reject) => {
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  srv.on('error', reject);
});

async function startServer(dataFile) {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(port), DATA_FILE: dataFile }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not print "listening on" within 5s')), 5000);
    child.stdout.on('data', (c) => { if (String(c).includes(`listening on ${port}`)) { clearTimeout(timer); resolve(); } });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited early (${code})`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, url, body, raw) => {
    const res = await fetch(base + url, { method, redirect: 'manual', headers: body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  const stop = () => new Promise((resolve) => { child.once('exit', (code, signal) => resolve({ code, signal })); child.kill('SIGTERM'); });
  return { call, stop, child, base };
}
module.exports = { startServer, tmpFile };
