'use strict';
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const dns = require('node:dns');

const MAX_PEERS = 8;
const TIMEOUT_MS = 1500;
const MAX_BYTES = 65536;
const CODES = new Set(['timeout', 'refused', 'blocked_address', 'too_large', 'redirect', 'bad_status', 'bad_content_type', 'bad_json', 'bad_shape', 'network']);
const CONTROL = /[\p{Cc}\p{Cf}]/gu;

function coded(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

// Allowlist parser. Invalid entries are dropped with a warning naming the index only.
// Private hosts are kept (they fail with blocked_address at fetch time) unless allowPrivate, which only adds a warning.
function parsePeers(envValue, { allowPrivate = false, warn = console.warn } = {}) {
  if (typeof envValue !== 'string' || !envValue.trim()) return [];
  const out = [];
  envValue.split(',').forEach((raw, i) => {
    const entry = raw.trim();
    if (!entry) return;
    let u;
    try { u = new URL(entry); } catch { warn(`HELLO_PEERS entry ${i} ignored: invalid URL`); return; }
    const ok = (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password &&
      u.pathname === '/' && !u.search && !u.hash && !entry.includes('?') && !entry.includes('#');
    if (!ok) { warn(`HELLO_PEERS entry ${i} ignored: must be a bare http(s) origin`); return; }
    if (!out.includes(u.origin)) out.push(u.origin);
  });
  if (out.length > MAX_PEERS) {
    warn(`HELLO_PEERS: only the first ${MAX_PEERS} peers are used`);
    out.length = MAX_PEERS;
  }
  for (const o of out) {
    const h = new URL(o);
    if (h.protocol === 'http:' && !isLoopbackHost(h.hostname)) warn(`HELLO_PEERS: ${o} uses plain http; visitor names are sent unencrypted`);
  }
  if (allowPrivate && out.length) warn('HELLO_PEERS_ALLOW_PRIVATE is on: private and loopback peers are allowed');
  return out;
}

function isLoopbackHost(h) {
  const host = h.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost') return true;
  const o = parseV4(host);
  if (o) return o[0] === 127;
  const g = net.isIP(host) === 6 ? parseV6(host) : null;
  return !!g && g.slice(0, 7).every((x) => x === 0) && g[7] === 1;
}

function v4Private(a, b, c) {
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // 192.0.0.0/24, 192.0.2.0/24
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15
    (a === 198 && b === 51 && c === 100) || // 198.51.100.0/24
    (a === 203 && b === 0 && c === 113); // 203.0.113.0/24
}

function parseV4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((x) => x <= 255) ? o : null;
}

function parseV6(s) {
  let a = s.toLowerCase();
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (dotted) {
    const o = parseV4(dotted[2]);
    if (!o) return null;
    a = `${dotted[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const g = [...head, ...Array(fill).fill('0'), ...tail];
  if (g.length !== 8 || !g.every((x) => /^[0-9a-f]{1,4}$/.test(x))) return null;
  return g.map((x) => parseInt(x, 16));
}

// Fails closed: anything that is not a valid IP counts as private.
function isPrivateAddress(ip) {
  if (typeof ip !== 'string') return true;
  const s = ip.split('%')[0];
  const kind = net.isIP(s);
  if (kind === 4) { const o = parseV4(s); return o ? v4Private(o[0], o[1], o[2]) : true; }
  if (kind !== 6) return true;
  const g = parseV6(s);
  if (!g) return true;
  const embedded = () => v4Private(g[6] >> 8, g[6] & 255, g[7] >> 8);
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return embedded(); // mapped, compatible, ::, ::1
  if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) return embedded(); // SIIT ::ffff:0:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return embedded(); // NAT64
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true; // 64:ff9b:1::/48 local-use NAT64
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo 2001::/32
  if (g[0] === 0x2002) return v4Private(g[1] >> 8, g[1] & 255, g[2] >> 8); // 6to4
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8
  return false;
}

function isPlain(o) {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return false;
  const p = Object.getPrototypeOf(o);
  return p === Object.prototype || p === null;
}

function validateHealth(json) {
  return isPlain(json) && Object.hasOwn(json, 'ok') && json.ok === true;
}

// Returns a fresh whitelisted object, or null when the shape is wrong.
function validatePeerHello(json) {
  if (!isPlain(json) || !Object.hasOwn(json, 'greeting') || typeof json.greeting !== 'string') return null;
  if (json.greeting.length > 4096) return null;
  const greeting = json.greeting.replace(CONTROL, '');
  if (greeting.length < 1 || greeting.length > 300) return null;
  const out = { greeting };
  for (const k of ['visit', 'streak']) {
    if (!Object.hasOwn(json, k) || json[k] === undefined) continue;
    const v = json[k];
    if (!Number.isInteger(v) || v < 1 || v > 1000000) return null;
    out[k] = v;
  }
  return out;
}

function headerOf(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  for (const k of Object.keys(headers)) if (k.toLowerCase() === name) return String(headers[k]);
  return '';
}

function errCode(e) {
  return e && CODES.has(e.code) ? e.code : 'network';
}

// Fetch and parse one peer JSON response; throws coded errors only.
async function callJson(fetchPeer, req) {
  const r = await fetchPeer(req);
  if (!r || typeof r.status !== 'number') throw coded('network');
  if (r.status >= 300 && r.status < 400) throw coded('redirect');
  if (r.status !== 200) throw coded('bad_status');
  if (!headerOf(r.headers, 'content-type').toLowerCase().startsWith('application/json')) throw coded('bad_content_type');
  const text = typeof r.text === 'string' ? r.text : '';
  if (text.length > MAX_BYTES) throw coded('too_large');
  try { return JSON.parse(text); } catch { throw coded('bad_json'); }
}

function createFederation({ peers = [], fetchPeer, now = Date.now, ttlMs = 5000 } = {}) {
  const list = Array.isArray(peers) ? peers.slice(0, MAX_PEERS) : [];
  let cache = null;
  let inflight = null;

  async function one(origin, build, accept) {
    const t0 = now();
    try {
      const json = await callJson(fetchPeer, build(origin));
      const v = accept(json);
      if (v === null) throw coded('bad_shape');
      return { origin, ok: true, latencyMs: Math.max(0, now() - t0), ...v };
    } catch (e) {
      return { origin, ok: false, error: errCode(e), latencyMs: Math.max(0, now() - t0) };
    }
  }

  async function runHealth() {
    const checkedAt = new Date(now()).toISOString();
    const results = await Promise.all(list.map((o) => one(o, (origin) => ({
      url: `${origin}/healthz`, method: 'GET', headers: { 'user-agent': 'hello-overkill-federation', accept: 'application/json' },
      timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES,
    }), (j) => (validateHealth(j) ? {} : null))));
    const up = results.filter((r) => r.ok).length;
    return { configured: true, summary: { total: results.length, up, down: results.length - up }, checkedAt, peers: results };
  }

  return {
    configured: list.length > 0,
    async health() {
      if (list.length === 0) return { configured: false, summary: { total: 0, up: 0, down: 0 }, peers: [] };
      if (cache && now() - cache.at < ttlMs && now() >= cache.at) return cache.value;
      if (!inflight) {
        inflight = runHealth().then((value) => { cache = { at: now(), value }; return value; })
          .finally(() => { inflight = null; });
      }
      return inflight;
    },
    async hello({ name, language, tone } = {}) {
      if (list.length === 0) return { configured: false, summary: { total: 0, ok: 0, failed: 0 }, results: [] };
      const body = JSON.stringify({ name, language, tone });
      const results = await Promise.all(list.map((o) => one(o, (origin) => ({
        url: `${origin}/hello`, method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'hello-overkill-federation', 'x-hello-federation': '1' },
        body, timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES,
      }), validatePeerHello)));
      const ok = results.filter((r) => r.ok).length;
      return { configured: true, summary: { total: results.length, ok, failed: results.length - ok }, results };
    },
  };
}

// Real transport: vets every resolved address, then connects to the vetted IP only (pinned lookup).
function defaultFetchPeer({ allowPrivate = false, lookup = dns.promises.lookup } = {}) {
  return async function fetchPeer(opts = {}) {
    const timeoutMs = opts.timeoutMs || TIMEOUT_MS;
    // Overall deadline on a ref'd timer (AbortSignal.timeout is unref'd and cannot keep a pending call alive).
    const ctl = new AbortController();
    const deadline = setTimeout(() => ctl.abort(), timeoutMs);
    try { return await attempt(opts, ctl.signal, timeoutMs); } finally { clearTimeout(deadline); }
  };

  async function attempt({ url, method = 'GET', headers = {}, body, maxBytes = MAX_BYTES } = {}, signal, timeoutMs) {
    const aborted = new Promise((_, rej) => {
      signal.addEventListener('abort', () => rej(coded('timeout')), { once: true });
    });
    aborted.catch(() => {});
    let u;
    try { u = new URL(url); } catch { throw coded('network'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw coded('network');
    const host = u.hostname.replace(/^\[|\]$/g, '');

    let addrs;
    if (net.isIP(host)) addrs = [{ address: host, family: net.isIP(host) }];
    else {
      try { addrs = await Promise.race([lookup(host, { all: true }), aborted]); } catch (e) {
        throw e && e.code === 'timeout' ? e : coded('network');
      }
    }
    if (!Array.isArray(addrs) || addrs.length === 0) throw coded('network');
    if (!allowPrivate && addrs.some((a) => isPrivateAddress(a.address))) throw coded('blocked_address');
    const pin = addrs[0];
    const pinnedLookup = (_h, opts, cb) => {
      const done = typeof opts === 'function' ? opts : cb;
      const all = opts && typeof opts === 'object' && opts.all;
      if (all) done(null, [{ address: pin.address, family: pin.family || net.isIP(pin.address) }]);
      else done(null, pin.address, pin.family || net.isIP(pin.address));
    };

    return new Promise((resolve, reject) => {
      let settled = false;
      let req;
      const finish = (err, val) => {
        if (settled) return;
        settled = true;
        if (err) { if (req) req.destroy(); reject(err); } else resolve(val);
      };
      const reqHeaders = { ...headers };
      if (body !== undefined) reqHeaders['content-length'] = Buffer.byteLength(body);
      const mod = u.protocol === 'https:' ? https : http;
      req = mod.request({
        hostname: host, port: u.port || undefined, path: u.pathname + u.search, method, headers: reqHeaders,
        agent: false, lookup: pinnedLookup, signal,
      }, (res) => {
        const status = res.statusCode;
        if (status >= 300 && status < 400) { finish(coded('redirect')); return; }
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) { finish(coded('too_large')); return; }
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > maxBytes) { finish(coded('too_large')); return; }
          chunks.push(c);
        });
        res.on('end', () => finish(null, { status, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', () => finish(coded(signal.aborted ? 'timeout' : 'network')));
        res.on('aborted', () => finish(coded(signal.aborted ? 'timeout' : 'network')));
      });
      req.setTimeout(timeoutMs, () => finish(coded('timeout')));
      req.on('error', (e) => {
        if (signal.aborted) finish(coded('timeout'));
        else finish(coded(e && e.code === 'ECONNREFUSED' ? 'refused' : 'network'));
      });
      aborted.catch(() => finish(coded('timeout')));
      req.end(body);
    });
  }
}

module.exports = { parsePeers, isPrivateAddress, createFederation, validateHealth, validatePeerHello, defaultFetchPeer, CODES };
