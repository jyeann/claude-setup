'use strict';
const { createHello, CORE_BODY } = require('./hello');
const { decideChaos } = require('./chaos');
const { securityHeaders } = require('./security');
const { LANGUAGES, TONES } = require('./greetings');
const { validateVerifyBody, validateVote } = require('./validation');
const { pickPair, leaderboard } = require('./battle');
const page = require('./page');

const MAX_BODY = 16 * 1024;
const SEC = securityHeaders(page.html);
const JSON_TYPE = 'application/json; charset=utf-8';
const CERT_ID = /^[a-f0-9]{16}$/;

// Builds the request handler: (req, res) => Promise<void>. Never rejects.
function createRouter({ store, limiter, voteLimiter, signer, chaos = decideChaos, now = Date.now, random = Math.random }) {
  const hello = createHello({ store, signer, now });

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
    });
  }

  // Parsed JSON, or undefined for empty / non-JSON bodies.
  function parse(buf) {
    const text = buf.toString('utf8');
    if (text.trim() === '') return undefined;
    try { return JSON.parse(text); } catch { return undefined; }
  }

  function limited(res, lim, req) {
    const r = lim.check(req.socket.remoteAddress);
    if (r.allowed) return false;
    req.resume();
    tooMany(res, r.retryAfter);
    return true;
  }

  function sendHello(res, parsed) {
    const out = hello.handle(parsed);
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
      try { store.vote(body.choice); } catch { return err(res, 500, 'could not save'); }
      return json(res, 200, { ok: true, leaderboard: leaderboard(store.votes()) });
    }
    if (path === '/api/leaderboard') {
      if (only('GET')) json(res, 200, { leaderboard: leaderboard(store.votes()) });
      return undefined;
    }
    return notFound(res);
  }

  return async function handler(req, res) {
    try {
      await dispatch(req, res);
    } catch {
      if (!res.headersSent) err(res, 500, 'internal error');
      else res.destroy();
    }
  };
}

module.exports = { createRouter, MAX_BODY };
