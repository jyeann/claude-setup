// HTTP-only test helpers. Spawns `node src/server.js` and talks to it over node:http.
// Ported from the wiki helpers with the spec.md "Interface" changes: ready line, lock name, tmp names,
// CONSTELLATION_SAMPLES=off by default (a test that wants seeding passes env.CONSTELLATION_SAMPLES: undefined).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export const APP_DIR = path.resolve(import.meta.dirname, '..');
export const SERVER = path.join(APP_DIR, 'src', 'server.js');
export const PUBLIC_DIR = path.join(APP_DIR, 'public');
export const WIKI_DIR = path.resolve(APP_DIR, '..', 'wiki');
export const UX_MD = path.resolve(APP_DIR, '..', '..', 'docs', 'product', 'constellation', 'ux.md');
export const READY_RE = /^Constellation running at http:\/\/localhost:(\d+)$/m;
export const LOCK_NAME = '.constellation.lock';
export const SIDECAR_NAME = '.constellation-sky.json';
export const DAY = 86400000;
export const BUCKET = 600000;

export const sha32 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32);

// A temp folder holding `vault/` (VAULT_DIR) next to sibling files outside the vault.
// create:false leaves vault/ missing so the server must create it.
export function sandbox({ create = true } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'constellation-')));
  const vault = path.join(base, 'vault');
  if (create) fs.mkdirSync(vault);
  return { base, vault, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

// Vault entries without dot entries (.constellation.lock, sidecar, tmp files), sorted.
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
  delete env.HOST; delete env.PORT; delete env.VAULT_DIR; delete env.CONSTELLATION_SAMPLES;
  // Sample seeding is off unless a test asks for it: pass env: { CONSTELLATION_SAMPLES: undefined } (or any value but "off").
  Object.assign(env, { VAULT_DIR: sb.vault, PORT: '0', CONSTELLATION_SAMPLES: 'off' }, opts.env || {});
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

// Start the server and resolve once the ready line is printed. server.readyMs is the time from spawn to the ready line.
export async function startServer(opts = {}) {
  const t0 = performance.now();
  const l = launch(opts);
  const connectHost = opts.env && opts.env.HOST === '::1' ? '::1' : '127.0.0.1';
  const waitMs = opts.readyTimeoutMs ?? 20000;
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      l.child.kill('SIGKILL');
      reject(new Error(`server did not print the ready line within ${waitMs} ms. stdout: ${l.logs().stdout} stderr: ${l.logs().stderr}`));
    }, waitMs);
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
  const readyMs = performance.now() - t0;
  const server = {
    ...l, port, connectHost, readyMs, vault: l.sb.vault, base: l.sb.base,
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
export const renameNote = (server, title, to) => server.call('POST', `${enc(title)}/rename`, { title: to });

// Detect a case-insensitive temp filesystem.
export function caseInsensitiveFs() {
  const sb = sandbox();
  try {
    fs.writeFileSync(path.join(sb.base, 'CaseProbe'), 'x');
    return fs.existsSync(path.join(sb.base, 'caseprobe'));
  } finally { sb.cleanup(); }
}

// ------------------------------------------------------------------ sky helpers
export async function getSky(server, opts) {
  const res = await server.call('GET', '/api/sky', undefined, opts);
  if (res.status !== 200 && !(opts && opts.allowStatus)) throw new Error(`GET /api/sky gave ${res.status}: ${res.text.slice(0, 300)}`);
  return res;
}

// Sky body only (parsed).
export const skyOf = async (server) => (await getSky(server)).body;

// Map title -> [x, y] for the lit stars.
export function starMap(sky) {
  const m = new Map();
  sky.stars.title.forEach((t, i) => m.set(t, [sky.stars.x[i], sky.stars.y[i]]));
  return m;
}
export function unlitMap(sky) {
  const m = new Map();
  sky.unlit.title.forEach((t, i) => m.set(t, [sky.unlit.x[i], sky.unlit.y[i]]));
  return m;
}
export const indexOfTitle = (sky, title) => sky.stars.title.indexOf(title);

// Run fn() and, if the 10 minute `now` bucket rolled over while it ran (two compared responses differ in `now`), run it once more.
export async function retryOnRollover(fn) {
  try { return await fn(); } catch (e) {
    if (e && e.rollover) return fn();
    throw e;
  }
}
export function rolloverGuard(a, b) {
  if (a.now !== b.now) { const e = new Error('now bucket rolled over'); e.rollover = true; throw e; }
}

// The sidecar as a parsed object (null when absent).
export const readSidecarJson = (server) => {
  try { return JSON.parse(fs.readFileSync(server.file(SIDECAR_NAME), 'utf8')); } catch { return null; }
};
export const sidecarBytes = (vault) => {
  try { return fs.readFileSync(path.join(vault, SIDECAR_NAME)); } catch { return null; }
};
export const sidecarText = (obj) => `${JSON.stringify(obj)}\n`;

// ------------------------------------------------------------------ spec constants (spec.md "Samples")
const SAMPLE_HEAD = '---\nsample: true\n---\n\n';
const sample = (title, body, bytes, revision) => ({ title, body: SAMPLE_HEAD + body, bytes, revision });
export const SAMPLES = [
  sample('Start here', 'Welcome to your sky. Each note is a star, and links join stars into constellations.\n\n- [[How the sky works]]\n- [[Writing a note]]\n- [[Links and unlit stars]]\n- [[Your vault]]\n', 197, '37d88bda884d2da0cfadc6eca7207095'),
  sample('How the sky works', 'Newer notes are warm and bright. Older ones cool toward blue. Notes with many links are larger. Drag to pan, scroll or pinch to zoom, press 0 to see everything. Next: [[Links and unlit stars]]. Back to [[Start here]].\n', 240, '2fff4f6ac27197b085609cf5fef0dcae'),
  sample('Writing a note', 'Choose New star, give it a title, and write. Put a title in double square brackets to link to another note. Next: [[Your vault]]. Back to [[Start here]].\n', 176, 'd5879e0e7d5348649893f87c6ac53bbf'),
  sample('Links and unlit stars', 'A link to a note that does not exist yet appears as a hollow star. Click it to write that note. Back to [[Start here]].\n', 142, '8bac9942e5ac216c2b4929a0e7ffaee2'),
  sample('Your vault', 'Every star is a plain .md file in the vault folder. Edit them anywhere. Back to [[Start here]].\n', 118, '0c1dcdd15fc65f14eb4a458a95799066'),
];
export const SAMPLE_TITLES = SAMPLES.map((s) => s.title);
export const sampleBytes = (title) => Buffer.from(SAMPLES.find((s) => s.title === title).body, 'utf8');
export const writeSamples = (vault, titles = SAMPLE_TITLES) => {
  for (const t of titles) fs.writeFileSync(path.join(vault, `${t}.md`), sampleBytes(t));
};

// ------------------------------------------------------------------ reference formulas (spec.md, implemented independently of src/)
export const titleKeyOf = (t) => t.normalize('NFC').trim().toLowerCase();
export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function brightnessRef(ageDays, backlinks) {
  const r = Math.min(1, Math.max(0, 1 - ageDays / 90));
  const B = Math.min(1, Math.log2(1 + backlinks) / Math.log2(17));
  return Math.max(0.30, 0.60 * r + 0.40 * B);
}
export const round3 = (v) => Math.round(v * 1000) / 1000;
export const round2 = (v) => Math.round(v * 100) / 100;

// spec.md "Base point": hashPoint(seed, salt = 0)
export function hashPoint(seed, salt = 0) {
  for (let s = salt; ; s++) {
    const H = crypto.createHash('sha256').update(`constellation/v1\u0000${seed}\u0000${String(s)}`, 'utf8').digest();
    for (let k = 0; k < 4; k++) {
      const a = H.readUInt32BE(8 * k);
      const b = H.readUInt32BE(8 * k + 4);
      const u = a / 4294967296 * 2 - 1;
      const v = b / 4294967296 * 2 - 1;
      if (u * u + v * v <= 1) return [u * 3000, v * 3000];
    }
  }
}
export const hashPoint2 = (seed) => hashPoint(seed).map(round2);

// A small deterministic generator (mulberry32).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad2 = (i) => String(i).padStart(2, '0');
const pad4 = (i) => String(i).padStart(4, '0');
export { pad2, pad4 };

// G(n, l): n notes `<prefix>00`.. and l random links between distinct notes, as { notes: Map<title, content> }.
export function genVault(n, l, seed, prefix = 'N') {
  const rnd = mulberry32(seed);
  const titles = Array.from({ length: n }, (_, i) => `${prefix}${pad2(i)}`);
  const links = titles.map(() => []);
  for (let k = 0; k < l; k++) {
    const a = Math.floor(rnd() * n);
    let b = Math.floor(rnd() * n);
    if (b === a) b = (b + 1) % n;
    links[a].push(titles[b]);
  }
  const notes = new Map();
  titles.forEach((t, i) => notes.set(t, `Note ${t}.\n${links[i].map((x) => `See [[${x}]].`).join('\n')}\n`));
  return { titles, notes };
}
export function writeNotes(vault, notes, order) {
  const entries = [...notes.entries()];
  if (order === 'reverse') entries.reverse();
  for (const [title, content] of entries) fs.writeFileSync(path.join(vault, `${title}.md`), content);
}
export function wipeNotes(vault) {
  for (const name of fs.readdirSync(vault)) if (name.endsWith('.md')) fs.rmSync(path.join(vault, name), { recursive: true, force: true });
}

// All backticked tokens in the first column of the data-testid table of ux.md.
export function uxTestIds() {
  const lines = fs.readFileSync(UX_MD, 'utf8').split('\n');
  const start = lines.findIndex((l) => /^#+\s*data-testid table\s*$/i.test(l.trim()));
  if (start === -1) throw new Error('ux.md has no "data-testid table" heading');
  const ids = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^#{1,3}\s/.test(line)) break;
    if (!line.startsWith('|')) continue;
    const first = line.split('|')[1] || '';
    for (const m of first.matchAll(/`([^`]+)`/g)) ids.push(m[1]);
  }
  return [...new Set(ids)];
}

export const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
