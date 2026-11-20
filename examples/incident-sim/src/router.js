// Request pipeline in its pinned order: Host, method, Sec-Fetch-Site, exact-key path lookup. No body is ever read.
import { send, sendText } from './http.js';

export const allowedHosts = (port) => new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);

export function createHandler({ routes, getPort, log = (m) => process.stderr.write(`${m}\n`) }) {
  function dispatch(req, res) {
    const host = req.headers.host;
    if (host === undefined || !allowedHosts(getPort()).has(host)) return sendText(req, res, 403, 'This host name is not allowed.');
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(req, res, 405, 'Method not allowed.', { Allow: 'GET, HEAD' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return sendText(req, res, 403, 'This request is not allowed.');
    const url = req.url ?? '/';
    const q = url.indexOf('?');
    const entry = routes.get(q === -1 ? url : url.slice(0, q));
    if (!entry) return sendText(req, res, 404, 'Not found.');
    return send(req, res, 200, entry.type, entry.bytes, entry.cache);
  }
  return function handle(req, res) {
    req.on('error', () => {});
    try {
      dispatch(req, res);
    } catch (e) {
      log(`internal error: ${e && e.stack ? e.stack : e}`);
      if (res.headersSent || res.writableEnded) { res.destroy(); return; }
      try { sendText(req, res, 500, 'Something went wrong on the server.'); } catch { res.destroy(); }
    }
  };
}
