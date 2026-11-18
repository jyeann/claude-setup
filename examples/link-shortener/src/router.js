'use strict';
const { validateCreate } = require('./validation');
const page = require('./page');
const { securityHeaders } = require('./security');

const SECURITY_HEADERS = securityHeaders(page);

const MAX_BODY = 10 * 1024;

function send(res, status, body, headers = {}) {
  const isObj = body !== undefined && typeof body === 'object';
  const payload = body === undefined ? '' : isObj ? JSON.stringify(body) : body;
  res.writeHead(status, { ...(payload ? { 'content-type': isObj ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8' } : {}), ...SECURITY_HEADERS, ...headers });
  res.end(payload);
}
const error = (res, status, message, headers) => send(res, status, { error: message }, headers);

// Resolves with the raw body string, or rejects with {tooLarge: true}.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > MAX_BODY) { req.resume(); reject({ tooLarge: true }); return; }
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { over = true; chunks.length = 0; return; }
      if (!over) chunks.push(c);
    });
    req.on('end', () => (over ? reject({ tooLarge: true }) : resolve(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', () => reject({ tooLarge: false }));
  });
}

function createRouter({ store, limiter }) {
  async function handleCreate(req, res) {
    const key = req.socket.remoteAddress || 'unknown';
    const verdict = limiter.check(key);
    if (!verdict.allowed) {
      req.resume();
      return error(res, 429, 'rate limit exceeded', { 'retry-after': String(verdict.retryAfter) });
    }
    let raw;
    try { raw = await readBody(req); } catch (e) {
      return e && e.tooLarge ? error(res, 413, 'request body too large', { connection: 'close' }) : error(res, 400, 'could not read body');
    }
    let body;
    try { body = JSON.parse(raw); } catch { return error(res, 400, 'malformed JSON'); }
    const problem = validateCreate(body);
    if (problem) return error(res, 400, problem);
    const link = store.create({ url: body.url, slug: body.slug, expiresAt: body.expiresAt });
    if (!link) return error(res, 409, 'slug already taken');
    return send(res, 201, link);
  }

  return async function route(req, res) {
    let pathname;
    // Take the path from the raw target: new URL() would read "//host/x" as a host and route "/x".
    const target = String(req.url);
    if (!target.startsWith('/') || target.startsWith('//')) return error(res, 404, 'not found');
    try { pathname = new URL(target, 'http://localhost').pathname; } catch { return error(res, 404, 'not found'); }
    const method = req.method;
    const allow = (...methods) => methods.includes(method);

    if (pathname === '/') {
      if (!allow('GET')) return error(res, 405, 'method not allowed', { allow: 'GET' });
      return send(res, 200, page);
    }
    if (pathname === '/healthz') {
      if (!allow('GET')) return error(res, 405, 'method not allowed', { allow: 'GET' });
      return send(res, 200, { ok: true });
    }
    if (pathname === '/api/links') {
      if (method === 'POST') return handleCreate(req, res);
      if (method === 'GET') return send(res, 200, store.list());
      return error(res, 405, 'method not allowed', { allow: 'GET, POST' });
    }
    const apiMatch = /^\/api\/links\/([^/]+)$/.exec(pathname);
    if (apiMatch) {
      if (!allow('GET', 'DELETE')) return error(res, 405, 'method not allowed', { allow: 'GET, DELETE' });
      let slug;
      try { slug = decodeURIComponent(apiMatch[1]); } catch { return error(res, 404, 'not found'); }
      if (method === 'GET') {
        const link = store.get(slug);
        return link ? send(res, 200, link) : error(res, 404, 'link not found');
      }
      return store.remove(slug) ? send(res, 204) : error(res, 404, 'link not found');
    }
    const slugMatch = /^\/([^/]+)$/.exec(pathname);
    if (slugMatch) {
      if (!allow('GET')) return error(res, 405, 'method not allowed', { allow: 'GET' });
      let slug;
      try { slug = decodeURIComponent(slugMatch[1]); } catch { return error(res, 404, 'not found'); }
      const result = store.click(slug);
      if (!result) return error(res, 404, 'link not found');
      if (result.expired) return error(res, 410, 'link expired');
      const url = result.link.url;
      return send(res, 302, undefined, { location: /^[\x21-\x7e]+$/.test(url) ? url : new URL(url).href });
    }
    return error(res, 404, 'not found');
  };
}

module.exports = { createRouter, MAX_BODY };
