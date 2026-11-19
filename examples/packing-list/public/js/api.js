'use strict';
// Fetch wrapper. Resolves {ok, status, body}; rejects on a network error.
(function (root) {
  async function request(method, url, payload) {
    const init = { method, headers: {} };
    if (payload !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(payload);
    }
    const res = await fetch(url, init);
    let body = null;
    try { body = await res.json(); } catch (err) { body = null; }
    return { ok: res.ok, status: res.status, body };
  }
  root.PackingApi = { request };
}(window));
