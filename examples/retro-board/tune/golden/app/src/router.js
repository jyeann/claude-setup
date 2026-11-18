'use strict';
const board = require('./board');
const { DomainError, normalizeTitle } = require('./validation');
const tokens = require('./tokens');
const { toMarkdown, filename, localIsoDate } = require('./export');
const { createLimiter } = require('./rate-limiter');
const http = require('./http');

const MAX_BODY = 8192;
const MAX_DRAIN = 1024 * 1024;
const SEG = '([^/]+)';

// kind: page | read | write | create. body: the route takes a JSON object.
const ROUTES = [
  { re: /^\/$/, methods: { GET: 'index' }, kind: 'read' },
  { re: new RegExp(`^/b/${SEG}$`), methods: { GET: 'boardPage' }, kind: 'read' },
  { re: new RegExp(`^/b/${SEG}/f/${SEG}$`), methods: { GET: 'boardPage' }, kind: 'read' },
  { re: new RegExp(`^/b/${SEG}/f/${SEG}/export$`), methods: { GET: 'exportPage' }, kind: 'read' },
  { re: /^\/api\/boards$/, methods: { POST: 'create' }, kind: 'create', api: true, body: true },
  { re: new RegExp(`^/api/boards/${SEG}$`), methods: { GET: 'get' }, kind: 'read', api: true },
  { re: new RegExp(`^/api/boards/${SEG}/f/${SEG}$`), methods: { GET: 'get' }, kind: 'read', api: true },
  { re: new RegExp(`^/api/boards/${SEG}/cards$`), methods: { POST: 'addCard' }, kind: 'write', api: true, body: true },
  { re: new RegExp(`^/api/boards/${SEG}/cards/${SEG}$`), methods: { DELETE: 'deleteOwn' }, kind: 'write', api: true },
  { re: new RegExp(`^/api/boards/${SEG}/cards/${SEG}/vote$`), methods: { PUT: 'vote', DELETE: 'unvote' }, kind: 'write', api: true },
  { re: new RegExp(`^/api/boards/${SEG}/f/${SEG}/cards/${SEG}$`), methods: { DELETE: 'deleteAny' }, kind: 'write', api: true, fac: true },
  { re: new RegExp(`^/api/boards/${SEG}/f/${SEG}/closed$`), methods: { PUT: 'close' }, kind: 'write', api: true, body: true, fac: true },
  { re: new RegExp(`^/api/boards/${SEG}/f/${SEG}/export$`), methods: { GET: 'export' }, kind: 'read', api: true },
];

function matchRoute(pathname) {
  for (const route of ROUTES) {
    const m = route.re.exec(pathname);
    if (m) return { route, params: m.slice(1) };
  }
  return null;
}

const errorBody = (code, message) => ({ error: { code, message } });
const fail = (res, status, code, message, headers) => http.sendJson(res, status, errorBody(code, message), headers);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_DRAIN) { req.destroy(); return; }
      if (size > MAX_BODY) { tooBig = true; chunks.length = 0; return; }
      chunks.push(c);
    });
    req.on('end', () => (tooBig ? reject(new DomainError('too_large', 413, 'The request is too large.')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
    req.on('aborted', () => reject(new DomainError('aborted', 400, 'Request aborted.')));
  });
}

function parseJsonObject(buf) {
  let value;
  try { value = JSON.parse(buf.toString('utf8')); } catch { value = undefined; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DomainError('bad_json', 400, 'The request body must be a JSON object.');
  }
  return value;
}

function hostAllowed(ctx, req) {
  const host = req.headers.host;
  if (typeof host !== 'string' || !host) return false;
  if (ctx.loopback) {
    const m = /^(localhost|127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|\[::1\])(?::(\d+))?$/i.exec(host);
    if (!m) return false;
    const port = m[2] === undefined ? 80 : Number(m[2]);
    if (port !== ctx.port) return false;
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let originHost;
    try { originHost = new URL(origin).host; } catch { return false; }
    if (originHost.toLowerCase() !== host.toLowerCase()) return false;
  }
  return true;
}

const viewEtag = (view) => `"${view.version}"`;
const matchesEtag = (header, etag) => typeof header === 'string'
  && header.split(',').map((s) => s.trim().replace(/^W\//, '')).some((t) => t === etag || t === '*');

// ctx: {store, pages, assets, loopback, port, now?, limiters?}
function createRouter(ctx) {
  const limiters = ctx.limiters || {
    create: createLimiter({ limit: 20 }),
    write: createLimiter({ limit: 300 }),
    read: createLimiter({ limit: 900 }),
  };
  const now = ctx.now || (() => new Date());
  const notFoundPage = (res) => http.sendPage(res, 404, ctx.pages.notFound);

  function lookup(p) {
    if (!tokens.isToken(p)) throw new DomainError('board_not_found', 404, 'Board not found.');
    const hash = tokens.sha256Hex(p);
    const b = ctx.store.get(hash);
    if (!b) throw new DomainError('board_not_found', 404, 'Board not found.');
    return { hash, board: b };
  }
  const isFacilitator = (b, f) => typeof f === 'string' && tokens.safeEqual(tokens.sha256Hex(f), b.facHash);

  function respondView(res, status, b, req, role) {
    const view = board.toView(b, { role, voter: req.voter });
    http.sendJson(res, status, view, { ETag: viewEtag(view), Vary: 'X-Client-Id' });
  }

  const handlers = {
    index: (req, res) => http.sendPage(res, 200, ctx.pages.index),
    boardPage: (req, res, [p]) => {
      try { lookup(p); } catch { return notFoundPage(res); }
      return http.sendPage(res, 200, ctx.pages.board);
    },
    exportPage: (req, res, [p, f]) => {
      let found;
      try { found = lookup(p); } catch { return notFoundPage(res); }
      if (!isFacilitator(found.board, f)) return notFoundPage(res);
      return http.sendPage(res, 200, ctx.pages.export);
    },
    create: (req, res, params, body) => {
      const title = normalizeTitle(body.title);
      const p = tokens.newToken();
      const f = tokens.newToken();
      const created = ctx.store.create(tokens.sha256Hex(p), board.createBoard(title, tokens.sha256Hex(f), now()));
      const view = board.toView(created, { role: 'facilitator', voter: req.voter });
      http.sendJson(res, 201, { participantToken: p, facilitatorToken: f, board: view }, { ETag: viewEtag(view) });
    },
    get: (req, res, [p, f]) => {
      const { board: b } = lookup(p);
      const role = f !== undefined && isFacilitator(b, f) ? 'facilitator' : 'participant';
      const view = board.toView(b, { role, voter: req.voter });
      const etag = viewEtag(view);
      const headers = { ETag: etag, Vary: 'X-Client-Id', 'Cache-Control': 'no-cache' };
      if (matchesEtag(req.headers['if-none-match'], etag)) return http.sendNotModified(res, headers);
      return http.sendJson(res, 200, view, headers);
    },
    addCard: (req, res, [p], body) => {
      const { hash } = lookup(p);
      const updated = ctx.store.update(hash, (b) => board.addCard(b, body.column, body.text, req.voter, now()));
      respondView(res, 201, updated, req, 'participant');
    },
    deleteOwn: (req, res, [p, id]) => {
      const { hash } = lookup(p);
      const updated = ctx.store.update(hash, (b) => board.deleteCard(b, id, { voter: req.voter, facilitator: false }));
      respondView(res, 200, updated, req, 'participant');
    },
    vote: (req, res, [p, id]) => {
      const { hash } = lookup(p);
      respondView(res, 200, ctx.store.update(hash, (b) => board.vote(b, id, req.voter)), req, 'participant');
    },
    unvote: (req, res, [p, id]) => {
      const { hash } = lookup(p);
      respondView(res, 200, ctx.store.update(hash, (b) => board.unvote(b, id, req.voter)), req, 'participant');
    },
    deleteAny: (req, res, [p, f, id]) => {
      const { hash, board: b } = lookup(p);
      if (!isFacilitator(b, f)) throw new DomainError('forbidden', 403, 'Only the facilitator can do that.');
      const updated = ctx.store.update(hash, (d) => board.deleteCard(d, id, { voter: req.voter, facilitator: true }));
      respondView(res, 200, updated, req, 'facilitator');
    },
    close: (req, res, [p, f], body) => {
      const { hash, board: b } = lookup(p);
      if (!isFacilitator(b, f)) throw new DomainError('forbidden', 403, 'Only the facilitator can do that.');
      respondView(res, 200, ctx.store.update(hash, (d) => board.setClosed(d, body.closed)), req, 'facilitator');
    },
    export: (req, res, [p, f]) => {
      const { board: b } = lookup(p);
      if (!isFacilitator(b, f)) throw new DomainError('forbidden', 403, 'Only the facilitator can do that.');
      http.sendJson(res, 200, { filename: filename(b.title), markdown: toMarkdown(b, localIsoDate(now())) });
    },
  };

  // 409 responses carry a fresh view for the requester.
  function attachBoard(err, req, params, route) {
    const body = errorBody(err.code, err.message);
    if (err.status === 409 && route.api) {
      const b = tokens.isToken(params[0]) ? ctx.store.get(tokens.sha256Hex(params[0])) : undefined;
      if (b) {
        const role = route.fac && isFacilitator(b, params[1]) ? 'facilitator' : 'participant';
        body.board = board.toView(b, { role, voter: req.voter });
      }
    }
    return body;
  }

  return async function handle(req, res) {
    try {
      const pathname = (req.url || '/').split('?')[0];
      if (!hostAllowed(ctx, req)) return fail(res, 403, 'forbidden', 'Request not allowed.');
      const asset = req.method === 'GET' ? ctx.assets.get(pathname) : undefined;
      if (asset) return http.sendAsset(res, asset);
      const match = matchRoute(pathname);
      if (!match) {
        return pathname.startsWith('/api/') ? fail(res, 404, 'not_found', 'Not found.') : notFoundPage(res);
      }
      const { route, params } = match;
      const handlerName = route.methods[req.method];
      if (!handlerName) {
        return fail(res, 405, 'method_not_allowed', 'Method not allowed.', { Allow: Object.keys(route.methods).join(', ') });
      }
      const limiter = limiters[route.kind === 'read' ? 'read' : route.kind];
      const verdict = limiter.hit(req.socket.remoteAddress || 'unknown');
      if (!verdict.ok) return fail(res, 429, 'rate_limited', 'Too many requests.', { 'Retry-After': verdict.retryAfter });

      if (route.api) {
        const cid = req.headers['x-client-id'];
        if (!tokens.isClientId(cid)) return fail(res, 400, 'bad_client_id', 'Missing or invalid client id.');
        req.voter = tokens.sha256B64(cid);
      }
      let body;
      if (route.body) {
        const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (type !== 'application/json') return fail(res, 415, 'unsupported_media_type', 'Send application/json.');
        const declared = Number(req.headers['content-length']);
        if (declared > MAX_BODY) {
          req.resume();
          return fail(res, 413, 'too_large', 'The request is too large.', { Connection: 'close' });
        }
        body = parseJsonObject(await readBody(req));
      } else {
        req.resume();
      }
      try {
        return handlers[handlerName](req, res, params, body);
      } catch (err) {
        if (err instanceof DomainError) {
          return http.sendJson(res, err.status, attachBoard(err, req, params, route));
        }
        throw err;
      }
    } catch (err) {
      if (err instanceof DomainError) return fail(res, err.status, err.code, err.message, err.status === 413 ? { Connection: 'close' } : undefined);
      process.stderr.write(`Unexpected error: ${err && err.message}\n`);
      if (!res.headersSent) return fail(res, 500, 'internal_error', 'Something went wrong.');
      return res.end();
    }
  };
}

module.exports = { createRouter, matchRoute, hostAllowed, matchesEtag, ROUTES, MAX_BODY };
