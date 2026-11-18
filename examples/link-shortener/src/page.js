'use strict';

module.exports = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link shortener</title>
<style>
  :root { color-scheme: light dark; --bg: #fff; --fg: #1a1a1a; --muted: #555; --border: #ccc; --accent: #0b5fff; --err: #b00020; }
  @media (prefers-color-scheme: dark) { :root { --bg: #121212; --fg: #eee; --muted: #aaa; --border: #444; --accent: #6ea0ff; --err: #ff6b81; } }
  body { background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 60rem; padding: 1rem; }
  form { display: grid; gap: .75rem; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); align-items: end; margin-bottom: 1rem; }
  label { display: block; font-weight: 600; margin-bottom: .25rem; }
  input, button { font: inherit; padding: .5rem; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--fg); width: 100%; box-sizing: border-box; }
  button { background: var(--accent); color: var(--bg); cursor: pointer; border-color: var(--accent); }
  :focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  #message { color: var(--err); min-height: 1.5em; }
  .table-wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .5rem; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; }
  th { white-space: nowrap; overflow-wrap: normal; }
  td:first-child { overflow-wrap: normal; word-break: normal; min-width: 7ch; }
  td.num, th.num { text-align: right; }
</style>
</head>
<body>
<main>
<h1>Link shortener</h1>
<form id="create-form">
  <div><label for="url">Target URL</label><input id="url" name="url" type="url" required maxlength="2048" placeholder="https://example.com"></div>
  <div><label for="slug">Custom slug (optional)</label><input id="slug" name="slug" type="text" pattern="[A-Za-z0-9_\\-]{3,32}" minlength="3" maxlength="32" autocomplete="off"></div>
  <div><button type="submit">Create link</button></div>
</form>
<p id="message" role="alert"></p>
<div class="table-wrap">
<table id="links">
  <caption class="visually-hidden" style="text-align:left">Existing links</caption>
  <thead><tr><th scope="col">Slug</th><th scope="col">Target</th><th scope="col" class="num">Clicks</th></tr></thead>
  <tbody></tbody>
</table>
</div>
</main>
<script>
(function () {
  var form = document.getElementById('create-form');
  var message = document.getElementById('message');
  var body = document.querySelector('#links tbody');

  function cell(text, cls) {
    var td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    return td;
  }

  function render(links) {
    body.textContent = '';
    links.forEach(function (l) {
      var tr = document.createElement('tr');
      tr.appendChild(cell(l.slug));
      tr.appendChild(cell(l.url));
      tr.appendChild(cell(String(l.clicks), 'num'));
      body.appendChild(tr);
    });
  }

  function load() {
    return fetch('/api/links').then(function (r) { return r.json(); }).then(render)
      .catch(function () { message.textContent = 'Could not load links.'; });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var payload = { url: form.elements.url.value };
    if (form.elements.slug.value) payload.slug = form.elements.slug.value;
    message.textContent = '';
    fetch('/api/links', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok) { message.textContent = res.body.error || 'Request failed.'; return; }
        form.reset();
        return load();
      })
      .catch(function () { message.textContent = 'Request failed.'; });
  });

  load();
})();
</script>
</body>
</html>
`;
