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

  // Blocking GET used once at page start so the title and items are in the page when it finishes loading.
  // Returns {ok, status, body} or null on a network error.
  function getSync(url) {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send();
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch (err) { body = null; }
      return { ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, body };
    } catch (err) {
      return null;
    }
  }

  function errorMessage(res, fallback) {
    return res && res.body && res.body.error && typeof res.body.error.message === 'string' ? res.body.error.message : fallback;
  }

  function errorCode(res) {
    return res && res.body && res.body.error ? res.body.error.code : null;
  }

  root.PackingApi = { request, getSync, errorMessage, errorCode };
}(window));
