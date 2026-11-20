// HTTP-only test helpers. Spawns `node src/server.js` and talks to it over node:http.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export const APP_DIR = path.resolve(import.meta.dirname, '..');
export const SERVER = path.join(APP_DIR, 'src', 'server.js');
export const PUBLIC_DIR = path.join(APP_DIR, 'public');
export const READY_RE = /^Wiki running at http:\/\/localhost:(\d+)$/m;

export const sha32 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32);

// A temp folder holding `vault/` (VAULT_DIR) next to sibling files outside the vault.
// create:false leaves vault/ missing so the server must create it.
export function sandbox({ create = true } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-')));
  const vault = path.join(base, 'vault');
  if (create) fs.mkdirSync(vault);
  return { base, vault, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

// Vault entries without dot entries (.wiki.lock, .wiki-*.tmp), sorted.
export const listVault = (vault) => fs.readdirSync(vault).filter((n) => !n.startsWith('.')).sort();

// name -> sha256 of the bytes, for regular files in dir (dot entries skipped). For "nothing changed" checks.
export function snapshot(dir) {
  const out = {};
  for (const name of listVault(dir)) {
    const p = path.join(dir, name);
    if (fs.lstatSync(p).isFile()) out[name] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  }
  return out;
}

// Set mtime to `secondsAgo` seconds in the past (to control ordering deterministically).
export function touch(file, secondsAgo) {
  const t = new Date(Date.now() - secondsAgo * 1000);
  fs.utimesSync(file, t, t);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// call(method, path, body, opts) -> {status, headers, text, buffer, body}
//  - body: JS value, sent as JSON with content-type application/json
//  - opts.raw: string/Buffer sent verbatim (no content-type unless given in headers)
//  - opts.chunked: send with transfer-encoding chunked instead of content-length
//  - opts.headers: extra headers, lowercase names win; null/undefined removes (host: null sends no Host)
//  - default Host is localhost:<port>; result.headers has lowercase names, body is parsed JSON or null
function makeCall(server) {
  return (method, urlPath, body, opts = {}) => new Promise((resolve, reject) => {
    const { headers: extra = {}, raw, chunked = false } = opts;
    const headers = {};
    let payload = null;
    if (raw !== undefined) payload = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    else if (body !== undefined) { payload = Buffer.from(JSON.stringify(body)); headers['content-type'] = 'application/json'; }
    headers.host = `localhost:${server.port}`;
    if (payload && !chunked) headers['content-length'] = String(payload.length);
    for (const [k, v] of Object.entries(extra)) {
      if (v === null || v === undefined) delete headers[k.toLowerCase()]; else headers[k.toLowerCase()] = v;
    }
    let responded = false;
    const req = http.request({
      host: server.connectHost, port: server.port, method, path: urlPath, headers,
      agent: false, setHost: false, strictContentLength: false,
    }, (res) => {
      responded = true;
      const chunks = [];
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, buffer, body: parsed });
      };
      res.on('data', (c) => chunks.push(c));
      res.on('end', done);
      res.on('close', done);
      res.on('error', done);
    });
    // A server that answers 413 and destroys the socket may reset the upload; that is fine once we have a response.
    req.on('error', (e) => { if (!responded) reject(e); });
    if (payload && chunked) {
      for (let i = 0; i < payload.length; i += 65536) req.write(payload.subarray(i, i + 65536));
      req.end();
    } else {
      req.end(payload || undefined);
    }
  });
}

function launch(opts = {}) {
  const sb = opts.sandbox ?? sandbox({ create: opts.create ?? true });
  if (opts.setup) opts.setup(sb.vault, sb);
  const env = { ...process.env };
  delete env.HOST; delete env.PORT; delete env.VAULT_DIR;
  Object.assign(env, { VAULT_DIR: sb.vault, PORT: '0' }, opts.env || {});
  for (const k of Object.keys(env)) if (env[k] === undefined || env[k] === null) delete env[k];
  const child = spawn(process.execPath, [SERVER], { cwd: opts.cwd ?? APP_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  let exitInfo = null;
  const stopped = new Promise((resolve) => {
    child.once('exit', (code, signal) => { exitInfo = { code, signal }; resolve(exitInfo); });
  });
  const stop = async (signal = 'SIGTERM') => {
    if (exitInfo) return exitInfo;
    child.kill(signal);
    const killer = setTimeout(() => child.kill('SIGKILL'), 5000);
    const info = await stopped;
    clearTimeout(killer);
    return info;
  };
  return { sb, child, stopped, stop, logs: () => ({ stdout, stderr }), exited: () => exitInfo };
}

// Start the server and resolve once the ready line is printed.
export async function startServer(opts = {}) {
  const l = launch(opts);
  const connectHost = opts.env && opts.env.HOST === '::1' ? '::1' : '127.0.0.1';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      l.child.kill('SIGKILL');
      reject(new Error(`server did not print the ready line within 8s. stdout: ${l.logs().stdout} stderr: ${l.logs().stderr}`));
    }, 8000);
    const check = () => {
      const m = READY_RE.exec(l.logs().stdout);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    };
    l.child.stdout.on('data', check);
    l.stopped.then((info) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (code ${info.code}, signal ${info.signal}). stdout: ${l.logs().stdout} stderr: ${l.logs().stderr}`));
    });
  }).catch(async (e) => { await l.stop('SIGKILL'); if (!opts.sandbox) l.sb.cleanup(); throw e; });
  const server = {
    ...l, port, connectHost, vault: l.sb.vault, base: l.sb.base,
    file: (name) => path.join(l.sb.vault, name),
    read: (name) => fs.readFileSync(path.join(l.sb.vault, name)),
  };
  server.call = makeCall(server);
  return server;
}

// Start a server that is expected to exit on its own (bad HOST, port taken, lock). Resolves with the exit info and output.
export async function runToExit(opts = {}) {
  const l = launch(opts);
  const timer = setTimeout(() => l.child.kill('SIGKILL'), 8000);
  const info = await l.stopped;
  clearTimeout(timer);
  const { stdout, stderr } = l.logs();
  if (!opts.sandbox) l.sb.cleanup();
  return { ...info, stdout, stderr, output: stdout + stderr };
}

// Run fn(server) with a fresh server and a fresh temp vault, then clean up.
// opts: {setup(vaultDir, sandbox) runs before start, env, create:false, sandbox}
export async function withServer(fn, opts = {}) {
  const server = await startServer(opts);
  try {
    return await fn(server);
  } finally {
    await server.stop();
    if (!opts.sandbox) server.sb.cleanup();
  }
}

// Create a note through the API and assert it worked.
export async function mk(server, title, content) {
  const res = await server.call('POST', '/api/notes', content === undefined ? { title } : { title, content });
  if (res.status !== 201) throw new Error(`POST ${title} gave ${res.status}: ${res.text}`);
  return res.body;
}
export const enc = (title) => `/api/notes/${encodeURIComponent(title)}`;
export const getNote = (server, title) => server.call('GET', enc(title));
export const putNote = (server, title, content, revision) =>
  server.call('PUT', enc(title), { content }, { headers: revision === undefined ? {} : { 'if-match': `"${revision}"` } });

// Detect a case-insensitive temp filesystem.
export function caseInsensitiveFs() {
  const sb = sandbox();
  try {
    fs.writeFileSync(path.join(sb.base, 'CaseProbe'), 'x');
    return fs.existsSync(path.join(sb.base, 'caseprobe'));
  } finally { sb.cleanup(); }
}
