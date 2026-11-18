// Thin fetch wrapper: client id header, JSON bodies, ETag support. Same-origin only.

const CLIENT_KEY = 'retroBoard.clientId';

function randomId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function clientId() {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id || !/^[A-Za-z0-9_-]{22}$/.test(id)) {
      id = randomId();
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    return memoryId || (memoryId = randomId());
  }
}
let memoryId = '';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'network', board = null, retryAfter = 0 } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.board = board;
    this.retryAfter = retryAfter;
  }
  get isNetwork() { return this.status === 0 || this.status === 429 || this.status >= 500; }
}

// Resolves {status, data, etag}. status 304 has data null. Rejects with ApiError.
export async function request(method, url, { body, etag } = {}) {
  const headers = { 'X-Client-Id': clientId() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (etag) headers['If-None-Match'] = etag;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError('Network error');
  }
  if (res.status === 304) return { status: 304, data: null, etag };
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const err = (data && data.error) || {};
    throw new ApiError(err.message || `HTTP ${res.status}`, {
      status: res.status,
      code: err.code || 'error',
      board: (data && data.board) || null,
      retryAfter: Number(res.headers.get('Retry-After')) || 0,
    });
  }
  return { status: res.status, data, etag: res.headers.get('ETag') || '' };
}

export const createBoard = (title) => request('POST', '/api/boards', { body: { title } });

// Endpoints for one board. `f` is the facilitator token or null.
export function boardApi(p, f) {
  const base = `/api/boards/${p}`;
  const fbase = f ? `${base}/f/${f}` : base;
  return {
    get: (etag) => request('GET', fbase, { etag }),
    addCard: (column, text) => request('POST', `${base}/cards`, { body: { column, text } }),
    deleteCard: (id) => request('DELETE', f ? `${fbase}/cards/${id}` : `${base}/cards/${id}`),
    vote: (id) => request('PUT', `${base}/cards/${id}/vote`),
    unvote: (id) => request('DELETE', `${base}/cards/${id}/vote`),
    setClosed: (closed) => request('PUT', `${fbase}/closed`, { body: { closed } }),
    exportMarkdown: () => request('GET', `${fbase}/export`),
  };
}
