'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const SERVER = path.join(__dirname, '..', 'src', 'server.js');
const CORE_BODY = '{"message":"Hello World! Welcome to the API."}';
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ho-')), 'hello.json');

// Spawns `node src/server.js` with PORT=0. opts.env entries override defaults; a null value deletes the variable.
async function startServer(dataFile, opts = {}) {
  const env = { ...process.env, PORT: '0', DATA_FILE: dataFile, HELLO_SIGNING_SECRET: 'test', HELLO_RATE_LIMIT: '1000' };
  for (const [k, v] of Object.entries(opts.env || {})) { if (v === null) delete env[k]; else env[k] = String(v); }
  const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`server did not print "listening on <port>" within 5s; stderr: ${stderr}`)); }, 5000);
    child.stdout.on('data', (c) => {
      stdout += c;
      const m = /listening on (\d+)/.exec(stdout);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited early (${code}); stderr: ${stderr}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, url, body, raw, headers = {}) => {
    const hasBody = body !== undefined || raw !== undefined;
    const res = await fetch(base + url, {
      method, redirect: 'manual',
      headers: { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...headers },
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  // Raw http request: exact path (e.g. "//x"), exact headers, tolerant of early close.
  const rawRequest = (method, p, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers, agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      const done = () => { let json = null; try { json = JSON.parse(text); } catch { /* */ } resolve({ status: res.statusCode, headers: res.headers, text, body: json }); };
      res.on('end', done);
      res.on('close', done);
    });
    req.on('error', (e) => { if (!req.res) reject(e); });
    if (body !== undefined) req.write(body);
    req.end();
  });
  const stop = () => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve({ code: child.exitCode, signal: child.signalCode });
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.kill('SIGTERM');
  });
  return { call, rawRequest, stop, child, base, port, stdout: () => stdout, stderr: () => stderr };
}

const withServer = async (fn, opts = {}) => {
  const file = opts.file || tmpFile();
  const s = await startServer(file, opts);
  try { await fn(s, file); } finally { await s.stop(); }
};

const LANGS = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'sv', 'ja', 'sw'];
const TONES = ['formal', 'pirate', 'shakespearean', 'corporate'];
const hello = (s, body, query = '') => s.call('POST', `/hello${query}`, body);

module.exports = { startServer, withServer, tmpFile, CORE_BODY, LANGS, TONES, hello, SERVER };
