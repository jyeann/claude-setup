'use strict';
// Extra helpers for the v2 acceptance tests. Reuses helpers.js; does not modify it.
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const base = require('./helpers');

const DAY = 86400000;
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 32-bit FNV-1a over UTF-8 bytes (spec section 3).
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(str, 'utf8')) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

// The documented syllable heuristic (spec section 7), implemented independently of src/.
const EXCEPTIONS = { the: 1, fire: 1, every: 2, people: 2, poem: 2, quiet: 2 };
function countWord(raw) {
  const w = raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (EXCEPTIONS[w] !== undefined) return EXCEPTIONS[w];
  let n = (w.match(/[aeiouy]+/g) || []).length;
  if (/es$|ed$/.test(w) && /[^aeiouytd](es|ed)$/.test(w)) n -= 1;
  else if (/e$/.test(w) && !/(le|ee|ye)$/.test(w)) n -= 1;
  n += (w.match(/ia|io|ua|eo/g) || []).length;
  return Math.max(1, n);
}
const countSyllables = (text) => String(text).split(/\s+/).filter(Boolean).reduce((a, w) => a + countWord(w), 0);

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ho2-'));

// Writes a v1 store file with the given visitors (key is derived from displayName lowercased).
function seedStore(file, visitors) {
  const data = { version: 1, visitors: visitors.map((v) => ({ key: v.displayName.toLowerCase(), ...v })), certificates: [], votes: [] };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

// Parses raw SSE text into events; comment-only blocks are returned with event 'comment'.
function parseSse(text) {
  const out = [];
  for (const block of text.split('\n\n')) {
    if (!block.trim()) continue;
    const ev = { id: null, event: 'message', data: null, raw: block, comment: null };
    const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) ev.comment = line.slice(1).trim();
      else if (line.startsWith('id: ')) ev.id = line.slice(4);
      else if (line.startsWith('event: ')) ev.event = line.slice(7);
      else if (line.startsWith('data: ')) data.push(line.slice(6));
      else if (line.startsWith('retry: ')) ev.retry = line.slice(7);
    }
    if (data.length) { try { ev.data = JSON.parse(data.join('\n')); } catch { ev.data = undefined; } }
    out.push(ev);
  }
  return out;
}

// Opens GET /api/stream with a hard timeout. Resolves once headers arrive.
function sseOpen(s, { headers = {}, timeoutMs = 8000, localAddress, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: s.port, path: '/api/stream', method, headers, agent: false, localAddress });
    const hard = setTimeout(() => req.destroy(new Error('sse hard timeout')), timeoutMs);
    hard.unref();
    req.on('error', (e) => { clearTimeout(hard); reject(e); });
    req.on('response', (res) => {
      let text = '';
      let ended = false;
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('error', () => { ended = true; });
      res.on('close', () => { ended = true; });
      const api = {
        status: res.statusCode,
        headers: res.headers,
        text: () => text,
        ended: () => ended,
        events: () => parseSse(text).filter((e) => e.event === 'hello'),
        async waitFor(pred, ms = 4000) {
          const end = Date.now() + ms;
          while (Date.now() < end) { if (pred(api)) return true; await sleep(25); }
          throw new Error(`sse waitFor timed out; received so far: ${JSON.stringify(text)}`);
        },
        close() { clearTimeout(hard); res.destroy(); req.destroy(); },
      };
      resolve(api);
    });
    req.end();
  });
}

// Runs fn with an open stream and always closes it.
async function withStream(s, opts, fn) {
  const st = await sseOpen(s, opts);
  try { return await fn(st); } finally { st.close(); }
}

// A tiny controllable HTTP stub (peer impersonator). handler(req, res, body) decides everything.
async function startStub(handler) {
  const hits = [];
  const open = new Set();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      hits.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body);
    });
  });
  server.on('connection', (sock) => { open.add(sock); sock.on('close', () => open.delete(sock)); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    port, origin: `http://127.0.0.1:${port}`, hits,
    count: (p) => hits.filter((h) => h.url === p).length,
    close: () => new Promise((r) => { for (const sk of open) sk.destroy(); server.close(() => r()); }),
  };
}

const sendJson = (res, status, obj, type = 'application/json; charset=utf-8') => {
  const text = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(text) });
  res.end(text);
};

// Stub that behaves like a healthy peer.
const goodPeerHandler = (req, res) => {
  if (req.url === '/healthz') return sendJson(res, 200, { ok: true });
  return sendJson(res, 200, { greeting: 'Hola, Ada!', visit: 2, streak: 2 });
};

const FED_ENV = (peers, extra = {}) => ({ env: { HELLO_PEERS: Array.isArray(peers) ? peers.join(',') : peers, HELLO_PEERS_ALLOW_PRIVATE: '1', HELLO_READ_LIMIT: '10000', HELLO_FED_LIMIT: '1000', ...extra } });
const READ_ENV = (extra = {}) => ({ env: { HELLO_READ_LIMIT: '10000', ...extra } });

module.exports = { ...base, today, addDays, sleep, fnv1a, countWord, countSyllables, tmpDir, seedStore, parseSse, sseOpen, withStream, startStub, sendJson, goodPeerHandler, FED_ENV, READ_ENV };
