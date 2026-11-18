'use strict';
const { createHello, CORE_BODY } = require('./hello');
const { decideChaos } = require('./chaos');
const { securityHeaders } = require('./security');
const crypto = require('node:crypto');
const { validateVerifyBody, validateVote, validateName, normalizeName } = require('./validation');
const { LANGUAGES, TONES, render, isLanguage, isTone } = require('./greetings');
const weather = require('./weather');
const timeMachine = require('./time-machine');
const haiku = require('./haiku');
const { createHub } = require('./stream');
const { createSla, withSla } = require('./sla');
const { createFederation } = require('./federation');
const { createRateLimiter } = require('./rate-limiter');
const { pickPair, leaderboard } = require('./battle');
const page = require('./page');
const { PersistError } = require('./store');

const MAX_BODY = 16 * 1024;
const SEC = securityHeaders(page.html);
const JSON_TYPE = 'application/json; charset=utf-8';
// Limiter key for a socket address: IPv4-mapped IPv6 becomes plain IPv4; other IPv6 is keyed by its /64.
function clientKey(addr) {
  if (typeof addr !== 'string' || !addr) return 'unknown';
  let a = addr.split('%')[0].toLowerCase();
  if (!a.includes(':')) return a;
  const dotted = a.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (dotted) {
    const hx = (x, y) => ((Number(x) << 8) | Number(y)).toString(16);
    a = `${dotted[1]}${hx(dotted[2], dotted[3])}:${hx(dotted[4], dotted[5])}`;
  }
  const halves = a.split('::');
  if (halves.length > 2) return addr;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array(Math.max(fill, 0)).fill('0'), ...tail];
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return addr;
  const n = groups.map((g) => parseInt(g, 16));
  if (n.slice(0, 5).every((x) => x === 0) && n[5] === 0xffff) return `${n[6] >> 8}.${n[6] & 255}.${n[7] >> 8}.${n[7] & 255}`;
  return `${n.slice(0, 4).map((x) => x.toString(16)).join(':')}::/64`;
}

const CERT_ID = /^[a-f0-9]{16}$/;

// Builds the request handler: (req, res) => Promise<void>. Never rejects.
function createRouter({
  store, limiter, voteLimiter, signer, chaos = decideChaos, now = Date.now, random = Math.random,
  hub = createHub({ now }),
  sla = createSla({ now }),
  federation = createFederation({ peers: [], fetchPeer: async () => { throw new Error('no peers'); }, now }),
  readLimiter = createRateLimiter({ limit: 120, windowMs: 60000 }),
  fedLimiter = createRateLimiter({ limit: 10, windowMs: 60000 }),
  fedGlobalLimiter = createRateLimiter({ limit: 30, windowMs: 60000 }),
  slaToken,
  production = false,
  timeMachineStreaks = true,
}) {
  const hello = createHello({ store, signer, now });
  const THEMES = Object.keys(haiku.BANKS.themes);

  function bearerOk(req) {
    const m = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
    if (!m) return false;
    const a = crypto.createHash('sha256').update(m[1]).digest();
    const b = crypto.createHash('sha256').update(String(slaToken)).digest();
    return crypto.timingSafeEqual(a, b);
  }

  // Validates optional language/tone query params; returns { language, tone } or { error }.
  function langTone(query) {
    const language = query.has('language') ? query.get('language') : 'en';
    const tone = query.has('tone') ? query.get('tone') : 'formal';
    if (!isLanguage(language)) return { error: 'unknown language' };
    if (!isTone(tone)) return { error: 'unknown tone' };
    return { language, tone };
  }

  function send(res, status, text, type = JSON_TYPE, extra = {}) {
    if (res.headersSent || res.writableEnded) return;
    res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(text), ...SEC, ...extra });
    res.end(text);
  }
  const json = (res, status, obj, extra) => send(res, status, JSON.stringify(obj), JSON_TYPE, extra);
  const err = (res, status, msg, extra) => json(res, status, { error: msg }, extra);
  const notFound = (res) => err(res, 404, 'not found');
  const methodNotAllowed = (res, allow) => err(res, 405, 'method not allowed', { allow });

  function tooMany(res, retryAfter) {
    json(res, 429, { error: "You've been greeted enough.", retryAfter }, { 'retry-after': String(retryAfter) });
  }
  function tooLarge(req, res) {
    send(res, 413, '{"error":"request body too large"}', JSON_TYPE, { connection: 'close' });
    res.on('finish', () => req.socket.destroySoon());
  }

  // Resolves to a Buffer, or null when the cap was hit (413 already sent) or the client went away.
  function readBody(req, res) {
    return new Promise((resolve) => {
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > MAX_BODY) { tooLarge(req, res); return resolve(null); }
      const chunks = [];
      let size = 0;
      let done = false;
      const finish = (v) => { if (!done) { done = true; req.removeAllListeners('data'); resolve(v); } };
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { tooLarge(req, res); req.resume(); return finish(null); }
        chunks.push(c);
      });
      req.on('end', () => finish(Buffer.concat(chunks)));
      req.on('error', () => finish(null));
      req.on('aborted', () => finish(null));
      req.on('close', () => finish(null));
    });
  }

  // Parsed JSON, or undefined for empty / non-JSON bodies.
  function parse(buf) {
    const text = buf.toString('utf8');
    if (text.trim() === '') return undefined;
    try { return JSON.parse(text); } catch { return undefined; }
  }

  function limited(res, lim, req) {
    const r = lim.check(clientKey(req.socket.remoteAddress));
    if (r.allowed) return false;
    req.resume();
    tooMany(res, r.retryAfter);
    return true;
  }

  // Fire-and-forget: a failing hub never changes the hello response.
  function publishHello(text) {
    try {
      if (text === CORE_BODY) { hub.publish({ kind: 'core' }); return; }
      const o = JSON.parse(text);
      hub.publish({ language: o.language, tone: o.tone, visit: o.visit, streak: o.streak });
    } catch { /* ignore */ }
  }

  function sendHello(res, parsed) {
    const out = hello.handle(parsed);
    if (out.status === 200) publishHello(out.text);
    send(res, out.status, out.text);
  }

  async function postHello(req, res, query) {
    const decision = chaos(query.get('chaos'), random);
    if (decision.kind === 'teapot') {
      req.resume();
      return json(res, 418, { error: 'teapot', message: 'The greeter spilled its tea (418).' });
    }
    if (decision.kind === 'delay') {
      const alive = await new Promise((resolve) => {
        const timer = setTimeout(() => { res.off('close', onClose); resolve(true); }, decision.ms);
        timer.unref();
        const onClose = () => { clearTimeout(timer); resolve(false); };
        res.once('close', onClose);
      });
      if (!alive) return undefined;
    }
    const buf = await readBody(req, res);
    if (buf === null) return undefined;
    return sendHello(res, parse(buf));
  }

  async function dispatch(req, res) {
    const target = req.url || '';
    if (!target.startsWith('/') || target.startsWith('//')) return notFound(res);
    const q = target.indexOf('?');
    let path = q === -1 ? target : target.slice(0, q);
    const query = new URLSearchParams(q === -1 ? '' : target.slice(q + 1));
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    const method = req.method;

    const only = (m) => { if (method === m) return true; req.resume(); methodNotAllowed(res, m); return false; };

    if (path === '/') {
      if (only('GET')) send(res, 200, page.html, 'text/html; charset=utf-8');
      return undefined;
    }
    if (path === '/healthz') {
      if (only('GET')) json(res, 200, { ok: true });
      return undefined;
    }
    if (path === '/hello') {
      if (limited(res, limiter, req)) return undefined;
      if (method !== 'POST') { req.resume(); return send(res, 200, CORE_BODY); }
      return postHello(req, res, query);
    }
    if (path === '/api/catalogue') {
      if (only('GET')) json(res, 200, { languages: LANGUAGES, tones: TONES, defaults: { language: 'en', tone: 'formal' } });
      return undefined;
    }
    if (path.startsWith('/api/certificates/')) {
      if (!only('GET')) return undefined;
      const id = path.slice('/api/certificates/'.length);
      const c = CERT_ID.test(id) ? store.getCertificate(id) : null;
      if (!c) return err(res, 404, 'certificate not found');
      return json(res, 200, { id: c.id, name: c.name, greeting: c.greeting, language: c.language, date: c.date, signature: c.signature, text: signer.toText(c) });
    }
    if (path === '/api/verify') {
      if (!only('POST')) return undefined;
      const buf = await readBody(req, res);
      if (buf === null) return undefined;
      const body = parse(buf);
      const e = validateVerifyBody(body);
      if (e) return err(res, 400, e);
      return json(res, 200, signer.verifyText(body.text));
    }
    if (path === '/api/battle') {
      if (only('GET')) json(res, 200, pickPair(random));
      return undefined;
    }
    if (path === '/api/battle/vote') {
      if (!only('POST')) return undefined;
      if (limited(res, voteLimiter, req)) return undefined;
      const buf = await readBody(req, res);
      if (buf === null) return undefined;
      const body = parse(buf);
      const e = validateVote(body);
      if (e) return err(res, 400, e);
      try { store.vote(body.choice); } catch (e) { if (e instanceof PersistError) return err(res, 500, 'could not save'); throw e; }
      return json(res, 200, { ok: true, leaderboard: leaderboard(store.votes()) });
    }
    if (path === '/api/leaderboard') {
      if (only('GET')) json(res, 200, { leaderboard: leaderboard(store.votes()) });
      return undefined;
    }
    if (path === '/api/weather') return weatherRoute(req, res, query, only);
    if (path === '/api/stream') {
      if (!only('GET')) return undefined;
      if (limited(res, readLimiter, req)) return undefined;
      const r = hub.subscribe(res, { ip: clientKey(req.socket.remoteAddress), lastEventId: req.headers['last-event-id'], headers: SEC });
      if (r === 'ok') return undefined;
      return err(res, 503, 'too many streams', { 'retry-after': '5' });
    }
    if (path === '/api/sla') {
      if (!only('GET')) return undefined;
      if (limited(res, readLimiter, req)) return undefined;
      if ((slaToken || production) && !(slaToken && bearerOk(req))) return err(res, 401, 'unauthorized', { 'www-authenticate': 'Bearer' });
      return json(res, 200, sla.snapshot({ streamsOpen: hub.size() }));
    }
    if (path === '/api/time-machine') return timeMachineRoute(req, res, query, only);
    if (path === '/api/haiku') return haikuRoute(req, res, only);
    if (path === '/api/federation') {
      if (!only('GET')) return undefined;
      if (limited(res, readLimiter, req)) return undefined;
      return json(res, 200, await federation.health());
    }
    if (path === '/api/federation/hello') {
      if (!only('GET')) return undefined;
      if (limited(res, fedLimiter, req)) return undefined;
      const nameErr = validateName(query.has('name') ? query.get('name') : undefined);
      if (nameErr) return err(res, 400, nameErr);
      const lt = langTone(query);
      if (lt.error) return err(res, 400, lt.error);
      // Shared across all clients: peers rate-limit by our single IP. Checked before any peer is contacted.
      const g = fedGlobalLimiter.check('global');
      if (!g.allowed) return tooMany(res, g.retryAfter);
      return json(res, 200, await federation.hello({ name: normalizeName(query.get('name')), language: lt.language, tone: lt.tone }));
    }
    return notFound(res);
  }

  function weatherRoute(req, res, query, only) {
    if (!only('GET')) return undefined;
    if (limited(res, readLimiter, req)) return undefined;
    const p = weather.normalizePlace(query.has('place') ? query.get('place') : undefined);
    if (!p) return err(res, 400, 'place must be 1-40 characters');
    const today = weather.utcDate(now());
    const date = query.has('date') ? query.get('date') : today;
    const lo = weather.utcDate(Date.parse(`${today}T00:00:00Z`) - 86400000);
    const hi = weather.utcDate(Date.parse(`${today}T00:00:00Z`) + 86400000);
    const ms = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
    const real = Number.isFinite(ms) && weather.utcDate(ms) === date;
    if (!real || date < lo || date > hi) return err(res, 400, 'date out of range');
    let name;
    if (query.has('name')) {
      const e = validateName(query.get('name'));
      if (e) return err(res, 400, e);
      name = normalizeName(query.get('name'));
    }
    const lt = langTone(query);
    if (lt.error) return err(res, 400, lt.error);
    const f = weather.forecast({ date, place: p.place });
    const greeting = weather.weatherGreeting({ forecast: f, greeting: render(lt.language, lt.tone, name === undefined ? 'World' : name) });
    return json(res, 200, {
      date: f.date, place: f.place, seed: f.seed, condition: f.condition, tempC: f.tempC, windKph: f.windKph,
      chanceOfWarmRegards: f.chanceOfWarmRegards, warmthIndex: f.warmthIndex, forecast: f.forecast, greeting, simulated: true,
    });
  }

  function timeMachineRoute(req, res, query, only) {
    if (!only('GET')) return undefined;
    if (limited(res, readLimiter, req)) return undefined;
    const pd = timeMachine.parseDate(query.has('date') ? query.get('date') : undefined, weather.utcDate(now()));
    if (pd.error) return err(res, 400, pd.error);
    let name;
    if (query.has('name')) {
      const e = validateName(query.get('name'));
      if (e) return err(res, 400, e);
      name = normalizeName(query.get('name'));
    }
    const lt = langTone(query);
    if (lt.error) return err(res, 400, lt.error);
    const era = timeMachine.eraFor(Number(pd.date.slice(0, 4)));
    const greeting = timeMachine.greetingFor({ date: pd.date, name, language: lt.language, tone: lt.tone });
    if (!era || greeting === null) return err(res, 500, 'internal error');
    let streak = null;
    if (name !== undefined && timeMachineStreaks) {
      const s = timeMachine.streakOn({ visitor: store.peekVisitor(name), date: pd.date });
      streak = { name, status: s.status, dayOfStreak: s.dayOfStreak, streakLength: s.streakLength };
    }
    return json(res, 200, { date: pd.date, era: era.name, greeting, language: lt.language, tone: lt.tone, streak });
  }

  async function haikuRoute(req, res, only) {
    if (!only('POST')) return undefined;
    if (limited(res, readLimiter, req)) return undefined;
    const buf = await readBody(req, res);
    if (buf === null) return undefined;
    const body = parse(buf);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return err(res, 400, 'name is required');
    const nameErr = validateName(body.name);
    if (nameErr) return err(res, 400, nameErr);
    const theme = body.theme === undefined ? 'morning' : body.theme;
    if (typeof theme !== 'string' || !THEMES.includes(theme)) return err(res, 400, 'unknown theme');
    const syl = body.syllables;
    if (syl !== undefined && !(Number.isInteger(syl) && syl >= 1 && syl <= 6)) return err(res, 400, 'syllables must be an integer 1-6');
    const out = haiku.makeHaiku({ name: normalizeName(body.name), theme, syllables: syl });
    if (out === null) return json(res, 422, { error: 'name cannot be scanned into a haiku', hint: 'try the syllables field or a shorter name' });
    const ok = out && Array.isArray(out.haiku) && out.haiku.length === 3 && out.haiku.every((l) => typeof l === 'string' && l.length > 0);
    if (!ok) return err(res, 500, 'internal error');
    return json(res, 200, { name: out.name, theme: out.theme, haiku: out.haiku, syllables: out.syllables, verified: out.verified, nameSyllables: out.nameSyllables, limit: out.limit });
  }

  async function routerHandler(req, res) {
    try {
      if ((req.url || '').startsWith('/api/')) res.setHeader('cache-control', 'no-store');
      await dispatch(req, res);
    } catch {
      if (!res.headersSent) err(res, 500, 'internal error');
      else res.destroy();
    }
  }

  const measured = withSla(routerHandler, sla);
  // Bare response stand-ins without an event emitter API skip latency recording.
  return (req, res) => (typeof res.once === 'function' ? measured(req, res) : routerHandler(req, res));
}

module.exports = { createRouter, clientKey, MAX_BODY };
