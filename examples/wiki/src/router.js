// Request checks in their pinned order, routing, body reading and error mapping.
import { validateTitle, titleKey } from '../public/js/titles.js';
import { WikiError } from './errors.js';
import { sendJson, sendError, sendStatic } from './http.js';
import * as api from './api.js';

export const MAX_BODY_BYTES = 2 * 1024 * 1024 + 1024;
const MUTATING = new Set(['POST', 'PUT', 'DELETE']);

class TooLarge extends Error {}
class Aborted extends Error {}

const isString = (v) => typeof v === 'string';
const schemas = {
  create: (b) => isString(b.title) && (b.content === undefined || isString(b.content)),
  put: (b) => isString(b.content),
  rename: (b) => isString(b.title),
};

// Route table keyed by the API path shape. `title` marks routes whose second segment is a note title.
const ROUTES = {
  notes: { allow: ['GET', 'POST'], GET: (c) => api.listNotes(c), POST: (c, r) => api.createNote(c, r.body), schema: { POST: schemas.create } },
  note: {
    allow: ['GET', 'PUT', 'DELETE'], title: true,
    GET: (c, r) => api.getNote(c, r.key),
    PUT: (c, r) => api.putNote(c, r.key, r.headers['if-match'], r.body),
    DELETE: (c, r) => api.deleteNote(c, r.key, r.headers['if-match']),
    schema: { PUT: schemas.put },
  },
  rename: { allow: ['POST'], title: true, POST: (c, r) => api.rename(c, r.key, r.body), schema: { POST: schemas.rename } },
  backlinks: { allow: ['GET'], title: true, GET: (c, r) => api.backlinks(c, r.key) },
  search: { allow: ['GET'], GET: (c, r) => api.searchNotes(c, r.query.get('q')) },
  graph: { allow: ['GET'], GET: (c) => api.graph(c) },
};

// Pick the route from the raw (still encoded) path segments, or null for an unknown API path.
export function matchApi(segs) {
  const [a, b, c] = segs;
  if (segs.length === 1) return { name: ['notes', 'search', 'graph'].includes(a) ? a : null };
  if (a !== 'notes') return { name: null };
  if (segs.length === 2) return { name: 'note', raw: b };
  if (segs.length === 3 && (c === 'rename' || c === 'backlinks')) return { name: c, raw: b };
  return { name: null };
}

// One decodeURIComponent plus validateTitle. Null for anything that is not a usable title.
export function titleFromSegment(raw) {
  if (raw === undefined || raw === '') return null;
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  const v = validateTitle(decoded);
  return v.ok ? { title: v.title, key: titleKey(v.title) } : null;
}

export function allowedHosts(port) {
  return new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const declared = req.headers['content-length'];
    if (declared !== undefined && Number(declared) > MAX_BODY_BYTES) { reject(new TooLarge()); return; }
    req.on('error', () => {}); // a reset after we answered must not crash the process
    const chunks = [];
    let total = 0;
    const done = (fn, value) => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('close', onClose);
      fn(value);
    };
    const onData = (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) { req.pause(); done(reject, new TooLarge()); } else chunks.push(chunk);
    };
    const onEnd = () => done(resolve, Buffer.concat(chunks));
    const onError = (e) => done(reject, e);
    const onClose = () => done(reject, new Aborted());
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onClose);
  });
}

const isFlatObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.values(v).every((x) => x === null || typeof x !== 'object');

function parseBody(buf) {
  let value;
  try { value = JSON.parse(buf.toString('utf8')); } catch { return null; }
  return isFlatObject(value) ? value : null;
}

const badRequest = () => new WikiError(400, 'bad_request', 'The request body is not valid for this route.');

export function createHandler({ ctx, statics, getPort, log = (m) => process.stderr.write(`${m}\n`) }) {
  async function dispatch(req, res) {
    const method = req.method;
    // 1. Host
    const host = req.headers.host;
    if (host === undefined || !allowedHosts(getPort()).has(host)) {
      return sendError(res, 403, 'bad_host', 'This host name is not allowed.');
    }
    // 2. Route
    const rawUrl = req.url ?? '/';
    const q = rawUrl.indexOf('?');
    const pathname = q === -1 ? rawUrl : rawUrl.slice(0, q);
    const query = new URLSearchParams(q === -1 ? '' : rawUrl.slice(q + 1));
    const isApi = pathname === '/api' || pathname.startsWith('/api/');
    if (!isApi) {
      if (method !== 'GET') return sendError(res, 405, 'method_not_allowed', 'Method not allowed.', {}, { Allow: 'GET' });
      return sendStatic(res, statics, pathname);
    }
    const m = matchApi(pathname.split('/').slice(2));
    const route = m.name ? ROUTES[m.name] : null;
    if (!route) return sendError(res, 404, 'not_found', 'Not found.');
    if (!route.allow.includes(method)) {
      return sendError(res, 405, 'method_not_allowed', 'Method not allowed.', {}, { Allow: route.allow.join(', ') });
    }
    // 3. Title segment
    let key;
    if (route.title) {
      const t = titleFromSegment(m.raw);
      if (!t) return sendError(res, 404, 'note_not_found', 'Note not found.');
      key = t.key;
    }
    // 4. Origin
    if (MUTATING.has(method)) {
      const { origin } = req.headers;
      if ((origin !== undefined && origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') {
        return sendError(res, 403, 'bad_origin', 'This request did not come from the wiki page.');
      }
    }
    let body;
    if (method === 'POST' || method === 'PUT') {
      // 5. Content type
      const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') {
        return sendError(res, 415, 'unsupported_media_type', 'Send the body as application/json.');
      }
      // 6. Size
      let raw;
      try {
        raw = await readBody(req);
      } catch (e) {
        if (e instanceof TooLarge) {
          res.on('finish', () => req.destroy());
          return sendError(res, 413, 'too_large', 'The request body is too large.', {}, { Connection: 'close' });
        }
        return undefined; // client went away
      }
      // 7. JSON shape
      body = parseBody(raw);
      if (body === null || !(route.schema?.[method] ?? (() => true))(body)) throw badRequest();
    }
    const out = route[method](ctx, { key, body, headers: req.headers, query });
    return sendJson(res, out.status, out.body, out.headers);
  }

  return async function handle(req, res) {
    try {
      await dispatch(req, res);
    } catch (e) {
      if (res.headersSent || res.writableEnded) return;
      if (e instanceof WikiError) {
        sendError(res, e.status, e.code, e.message, e.params);
        return;
      }
      log(`internal error: ${e && e.stack ? e.stack : e}`);
      sendError(res, 500, 'internal', 'Something went wrong on the server.');
    }
  };
}
