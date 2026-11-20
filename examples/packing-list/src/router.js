'use strict';
const http = require('./http');
const { newListId, LIST_ID_RE, ITEM_ID_RE } = require('./ids');
const { validateName, validateItemText } = require('./validation');
const lists = require('./lists');

const { DomainError, MESSAGES } = lists;
const MAX_BODY = 4096;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const READ_METHODS = ['GET', 'HEAD'];

const invalidBody = () => new DomainError('invalid_body', 400, 'Request body is not valid.');
const listNotFound = () => new DomainError('list_not_found', 404, MESSAGES.list_not_found);
const itemNotFound = () => new DomainError('item_not_found', 404, MESSAGES.item_not_found);

// "host:port" or "[::1]:port" -> lowercase host without the port.
function hostnameOf(hostHeader) {
  const h = String(hostHeader).toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end === -1 ? h : h.slice(0, end + 1);
  }
  const colon = h.indexOf(':');
  return colon === -1 ? h : h.slice(0, colon);
}

// R40. Returns true when the request may proceed.
function hostAllowed(req, loopback) {
  const host = req.headers.host;
  if (loopback && (typeof host !== 'string' || !LOOPBACK_HOSTS.has(hostnameOf(host)))) return false;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let originHost;
    try { originHost = new URL(origin).host.toLowerCase(); } catch { return false; }
    if (typeof host !== 'string' || originHost !== host.toLowerCase()) return false;
  }
  return true;
}

function view(list) {
  return lists.toView(list);
}

function getList(ctx, id) {
  const list = LIST_ID_RE.test(id) ? ctx.store.get(id) : undefined;
  if (!list) throw listNotFound();
  return list;
}

async function createList(req, res, ctx) {
  const body = await http.readJsonBody(req, MAX_BODY);
  const name = validateName(body.name);
  const list = lists.createList((ctx.newId || newListId)(), name, Date.now());
  const stored = ctx.store.create(list);
  http.sendJson(res, 201, view(stored));
}

async function showList(req, res, ctx, [id]) {
  http.sendJson(res, 200, view(getList(ctx, id)));
}

async function addItem(req, res, ctx, [id]) {
  const body = await http.readJsonBody(req, MAX_BODY);
  getList(ctx, id);
  const text = validateItemText(body.text);
  const { list } = ctx.store.update(id, (copy) => lists.addItem(copy, text));
  http.sendJson(res, 201, view(list));
}

async function tick(req, res, ctx, [id, itemId]) {
  const body = await http.readJsonBody(req, MAX_BODY);
  const current = getList(ctx, id);
  if (typeof body.ticked !== 'boolean') throw invalidBody();
  if (!ITEM_ID_RE.test(itemId) || !current.items.some((i) => i.id === itemId)) throw itemNotFound();
  const { list } = ctx.store.update(id, (copy) => lists.setTicked(copy, itemId, body.ticked));
  http.sendJson(res, 200, view(list));
}

async function remove(req, res, ctx, [id, itemId]) {
  req.resume();
  const current = getList(ctx, id);
  if (!ITEM_ID_RE.test(itemId) || !current.items.some((i) => i.id === itemId)) throw itemNotFound();
  const { list } = ctx.store.update(id, (copy) => lists.removeItem(copy, itemId));
  http.sendJson(res, 200, view(list));
}

const SEG = '([^/]+)';
const API_ROUTES = [
  { re: /^\/api\/lists$/, methods: { POST: createList } },
  { re: new RegExp(`^/api/lists/${SEG}$`), methods: { GET: showList } },
  { re: new RegExp(`^/api/lists/${SEG}/items$`), methods: { POST: addItem } },
  { re: new RegExp(`^/api/lists/${SEG}/items/${SEG}/ticked$`), methods: { PUT: tick } },
  { re: new RegExp(`^/api/lists/${SEG}/items/${SEG}$`), methods: { DELETE: remove } },
];

function methodNotAllowed(res, allowed) {
  http.sendError(res, 405, 'method_not_allowed', 'Method not allowed.', { Allow: allowed.join(', ') });
}

async function handleApi(req, res, ctx, pathname) {
  for (const route of API_ROUTES) {
    const m = route.re.exec(pathname);
    if (!m) continue;
    const fn = Object.hasOwn(route.methods, req.method) ? route.methods[req.method] : undefined;
    if (!fn) return methodNotAllowed(res, Object.keys(route.methods));
    return fn(req, res, ctx, m.slice(1));
  }
  http.sendError(res, 404, 'not_found', 'Not found.');
}

function handlePage(req, res, ctx, pathname) {
  const readOnly = READ_METHODS.includes(req.method);
  const notFound = () => {
    if (readOnly) return http.sendPage(res, 404, 'not-found.html');
    return http.sendError(res, 404, 'not_found', 'Not found.');
  };
  if (pathname === '/') {
    if (!readOnly) return methodNotAllowed(res, READ_METHODS);
    return http.sendPage(res, 200, 'index.html');
  }
  if (pathname.startsWith('/assets/')) {
    if (!readOnly) return methodNotAllowed(res, READ_METHODS);
    if (!http.sendAsset(res, pathname)) http.sendPage(res, 404, 'not-found.html');
    return undefined;
  }
  const m = /^\/l\/([^/]+)$/.exec(pathname);
  if (m) {
    if (!readOnly) return methodNotAllowed(res, READ_METHODS);
    const exists = LIST_ID_RE.test(m[1]) && ctx.store.get(m[1]) !== undefined;
    return exists ? http.sendPage(res, 200, 'list.html') : http.sendPage(res, 404, 'not-found.html');
  }
  return notFound();
}

function reportError(res, err) {
  if (res.headersSent) { res.destroy(); return; }
  if (err instanceof DomainError) {
    // Make sure an unread (oversized) body does not keep the connection busy.
    const extra = err.status === 413 || err.status === 415 ? { Connection: 'close' } : undefined;
    http.sendError(res, err.status, err.code, err.message, extra);
    return;
  }
  process.stderr.write(`internal error: ${err && err.message}\n`);
  http.sendError(res, 500, 'internal_error', 'Something went wrong.');
}

// ctx: { store, loopback, newId? }
async function handle(req, res, ctx) {
  try {
    http.applySecurityHeaders(res);
    if (!hostAllowed(req, ctx.loopback)) {
      req.resume();
      return http.sendError(res, 403, 'forbidden', 'Forbidden.');
    }
    const url = req.url || '/';
    const cut = url.search(/[?#]/);
    const pathname = cut === -1 ? url : url.slice(0, cut);
    if (pathname === '/api' || pathname.startsWith('/api/')) return await handleApi(req, res, ctx, pathname);
    return handlePage(req, res, ctx, pathname);
  } catch (err) {
    return reportError(res, err);
  }
}

module.exports = { handle, hostAllowed, hostnameOf, MAX_BODY };
