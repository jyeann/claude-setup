// Fetch wrapper for the note API. Every failure becomes an ApiError with a code the UI can switch on.
export class ApiError extends Error {
  constructor(status, code, message, params = {}, network = false) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.params = params;
    this.network = network;
  }
}

// Turn an HTTP status and parsed JSON body into an ApiError. Unknown shapes still give a usable error.
export function mapError(status, body) {
  const raw = body && typeof body === 'object' && body.error && typeof body.error === 'object' ? body.error : {};
  const { code, message, ...params } = raw;
  return new ApiError(status, typeof code === 'string' ? code : 'http_error', typeof message === 'string' ? message : 'The request failed.', params);
}

export const noteApiPath = (title) => `/api/notes/${encodeURIComponent(title)}`;

export function createApi(fetchFn) {
  async function request(method, url, { body, headers, signal } = {}) {
    const init = { method, headers: { ...headers }, signal };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetchFn(url, init);
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw new ApiError(0, 'network', 'Could not reach the wiki server.', {}, true);
    }
    if (res.status === 204) return null;
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) throw mapError(res.status, data);
    return data;
  }

  return {
    listNotes: async () => (await request('GET', '/api/notes')).notes,
    createNote: (title, content = '') => request('POST', '/api/notes', { body: { title, content } }),
    getNote: (title) => request('GET', noteApiPath(title)),
    saveNote: (title, content, revision) => request('PUT', noteApiPath(title), { body: { content }, headers: { 'If-Match': `"${revision}"` } }),
    deleteNote: (title) => request('DELETE', noteApiPath(title)),
    renameNote: (title, newTitle) => request('POST', `${noteApiPath(title)}/rename`, { body: { title: newTitle } }),
    backlinks: async (title) => (await request('GET', `${noteApiPath(title)}/backlinks`)).backlinks,
    search: (q, signal) => request('GET', `/api/search?q=${encodeURIComponent(q)}`, { signal }),
    graph: () => request('GET', '/api/graph'),
  };
}
