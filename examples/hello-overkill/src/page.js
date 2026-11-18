'use strict';
// page.js: the whole single-page UI as one static HTML string (zero dependencies).
// Export shape (document for src/security.js):
//   module.exports = { html, styleHash, scriptHash }
//   html       string  full page, one <style> and one <script>, no inline handlers/style attributes
//   styleHash  string  CSP source token, quoted and ready to use: 'sha256-<base64>' (of the <style> body)
//   scriptHash string  CSP source token, quoted and ready to use: 'sha256-<base64>' (of the <script> body)
// All dynamic text is written with textContent; the script never builds markup from strings.
const crypto = require('node:crypto');

const LANGUAGES = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
  ['pt', 'Portuguese'], ['nl', 'Dutch'], ['sv', 'Swedish'], ['ja', 'Japanese'], ['sw', 'Swahili']];
const TONES = [['formal', 'Formal'], ['pirate', 'Pirate'], ['shakespearean', 'Shakespearean'], ['corporate', 'Corporate']];

const STYLE = String.raw`
:root{color-scheme:light dark;--bg:#fafafa;--fg:#1a1a1a;--muted:#555;--card:#fff;--line:#c9c9c9;--ctl-line:#767676;--accent:#0b57d0;--accent-fg:#fff;--ok:#0a6b2d;--bad:#b3261e;--focus:#0b57d0}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#ececec;--muted:#b0b0b0;--card:#1e1e1e;--line:#444;--ctl-line:#8a8a8a;--accent:#8ab4f8;--accent-fg:#101010;--ok:#6fdc8c;--bad:#ff8a80;--focus:#8ab4f8}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
[hidden]{display:none!important}
header,main,footer{max-width:40rem;margin:0 auto;padding:0 16px}
.brand{font-size:1.25rem;font-weight:700;margin:16px 0 4px}
nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
nav a{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border:1px solid var(--line);border-radius:8px;color:var(--fg);text-decoration:none}
nav a[aria-current=page]{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
h1{font-size:1.5rem;margin:16px 0}
label{display:block;font-weight:600;margin:12px 0 4px}
input[type=text],select,textarea{width:100%;min-height:44px;padding:8px 10px;font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--ctl-line);border-radius:8px}
textarea{min-height:8rem;overflow-wrap:anywhere}
input[aria-invalid=true],textarea[aria-invalid=true]{border-color:var(--bad)}
.check{display:flex;align-items:center;gap:10px;min-height:44px;margin-top:8px}
.check input{width:24px;height:24px;appearance:none;-webkit-appearance:none;margin:0;background:var(--card);border:2px solid var(--ctl-line);border-radius:4px}
.check input:checked{background:var(--accent);box-shadow:inset 0 0 0 4px var(--card)}
.check label{margin:0;font-weight:400}
button,.btn{min-height:44px;padding:0 18px;font:inherit;font-weight:600;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:var(--accent-fg);cursor:pointer;display:inline-flex;align-items:center;text-decoration:none;margin-top:12px}
button[disabled],button[aria-disabled=true]{opacity:.6;cursor:not-allowed}
.secondary{background:transparent;color:var(--accent)}
button.opt{width:100%;text-align:left;justify-content:flex-start;height:auto;padding:10px 14px;overflow-wrap:anywhere}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-top:16px;overflow-wrap:anywhere}
.err{color:var(--bad);margin:4px 0 0;min-height:0}
.meta{display:flex;gap:16px;flex-wrap:wrap;color:var(--muted)}
.verdict{display:flex;gap:10px;align-items:baseline;font-size:1.25rem;border-left:6px solid var(--line)}
.verdict.ok{color:var(--ok);border-color:var(--ok)}
.verdict.bad{color:var(--bad);border-color:var(--bad)}
dl{margin:0}dt{font-weight:600;margin-top:8px}dd{margin:0;overflow-wrap:anywhere}
.mono{font-family:ui-monospace,monospace}
table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{border-bottom:1px solid var(--line);padding:8px;text-align:left;overflow-wrap:anywhere;vertical-align:top}
caption{text-align:left;font-weight:600;padding:4px 0}
:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
footer{color:var(--muted);font-size:.875rem;margin:32px auto 24px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:opacity .01s!important}}
@media (max-width:480px){button,.btn{width:100%;justify-content:center}nav a{flex:1;justify-content:center}}
@media print{nav,button,.btn,header,footer{display:none!important}}
`;

const SCRIPT = String.raw`
'use strict';
var $ = function (id) { return document.getElementById(id); };
var main = $('main'), statusEl = $('status'), title = $('title');
var views = { hello: $('v-hello'), battle: $('v-battle'), verify: $('v-verify'), cert: $('v-cert') };
var GENERIC = 'The greeter is having a moment. Check that the server is running, then try again.';
var NAMES = { hello: 'Hello', battle: 'Battle', verify: 'Verify', cert: 'Certificate of Hello' };
var countdown = null;

var sayTimer = null;
function say(t) {
  if (sayTimer) clearTimeout(sayTimer);
  statusEl.textContent = '';
  sayTimer = setTimeout(function () { sayTimer = null; statusEl.textContent = t; }, 60);
}
var TEA1 = 'The greeter spilled its tea (418).', TEA2 = 'Nothing is broken. Try again in a moment.';
function retrySeconds(res) {
  var n = parseInt(res.retry, 10);
  if (n >= 1) return n;
  if (res.json && res.json.retryAfter >= 1) return Math.floor(res.json.retryAfter);
  return 5;
}
function errorText(res, generic) {
  if (res.status === 429) return "You've been greeted enough. Please wait " + retrySeconds(res) + ' seconds and try again.';
  if (res.status === 418) return TEA1 + ' ' + TEA2;
  return generic || GENERIC;
}
function setBusyBtn(btn, b) { if (b) btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled'); }
function isBusyBtn(btn) { return btn.getAttribute('aria-disabled') === 'true'; }
function el(tag, tid, text, cls) {
  var e = document.createElement(tag);
  if (tid) e.setAttribute('data-testid', tid);
  if (text !== undefined && text !== null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
function cpLen(s) { return Array.from(s).length; }

function api(method, path, body) {
  var opts = { method: method, headers: {} };
  if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
  return fetch(path, opts).then(function (r) {
    return r.text().then(function (t) {
      var j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
      return { status: r.status, retry: r.headers.get('retry-after'), json: j };
    });
  }, function () { return { status: 0, retry: null, json: null }; });
}

/* ---------- routing ---------- */
function parseHash() {
  var h = location.hash || '#/hello';
  var q = h.indexOf('?');
  var path = q < 0 ? h : h.slice(0, q);
  var parts = path.replace(/^#\/?/, '').split('/');
  return { name: parts[0], id: parts[1] || '', query: q < 0 ? '' : h.slice(q + 1) };
}
var first = true, lastSig = null;
function route() {
  var r = parseHash();
  var key = r.name === 'battle' ? 'battle' : r.name === 'verify' ? 'verify' : (r.name === 'certificate' && r.id) ? 'cert' : 'hello';
  if (r.name !== 'hello' && r.name !== 'battle' && r.name !== 'verify' && !(r.name === 'certificate' && r.id)) { location.replace('#/hello'); return; }
  var sig = key + '/' + r.id;
  if (sig === lastSig) return;
  lastSig = sig;
  Object.keys(views).forEach(function (k) { views[k].hidden = k !== key; });
  title.textContent = NAMES[key];
  ['hello', 'battle', 'verify'].forEach(function (k) {
    var a = $('nav-' + k);
    if (k === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = NAMES[key] + ' - Hello Overkill';
  if (key === 'battle') loadBattle(false);
  if (key === 'cert') loadCert(r.id);
  if (!first) title.focus();
  first = false;
}

/* ---------- hello ---------- */
function forcedChaos() {
  var v = new URLSearchParams(location.search).get('chaos');
  if (!v) { var h = parseHash().query; v = h ? new URLSearchParams(h).get('chaos') : null; }
  if (!v) return null;
  if (v === 'always418' || v === '418') return '418';
  if (v === 'delay') return 'delay';
  if (v === '1') return '1';
  return null;
}
var lastReq = null;
var sayBtn = $('say-hello'), nameIn = $('name'), nameErr = $('name-error'), result = $('result');

function setBusy(b) { setBusyBtn(sayBtn, b); sayBtn.textContent = b ? 'Greeting...' : 'Say hello'; }
function showResult(nodes) { clear(result); nodes.forEach(function (n) { result.appendChild(n); }); }
function retryButton(fn) {
  var b = el('button', 'retry-btn', 'Try again', 'secondary');
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}
function failure(res, retryFn) {
  if (res.status === 429) { rateLimited(res); return; }
  var box = el('div', 'error-message');
  if (res.status === 418) {
    box.appendChild(el('p', null, TEA1));
    box.appendChild(el('p', null, TEA2));
  } else {
    box.appendChild(el('p', null, GENERIC));
  }
  var b = retryButton(retryFn);
  showResult([box, b]);
  say(errorText(res));
  b.focus();
}
function rateLimited(res) {
  var n = retrySeconds(res);
  var msg = errorText(res);
  showResult([el('div', 'rate-limit-message', msg)]);
  say(msg);
  if (countdown) clearInterval(countdown);
  setBusyBtn(sayBtn, true);
  var left = n;
  sayBtn.textContent = 'Wait ' + left + 's';
  countdown = setInterval(function () {
    left -= 1;
    if (left <= 0) {
      clearInterval(countdown); countdown = null;
      setBusy(false);
      say('You can say hello again.');
    } else sayBtn.textContent = 'Wait ' + left + 's';
  }, 1000);
}
function success(j) {
  var p = el('p', 'greeting-text', j.greeting);
  p.setAttribute('lang', j.language || 'en');
  var meta = el('div', null, null, 'meta');
  meta.appendChild(el('span', 'visit-count', 'Visit ' + j.visit));
  meta.appendChild(el('span', 'streak-count', 'Streak ' + j.streak + (j.streak === 1 ? ' day' : ' days')));
  var a = el('a', 'cert-link', 'View certificate', 'btn secondary');
  a.setAttribute('href', '#/certificate/' + encodeURIComponent(j.certificate.id));
  showResult([p, meta, a]);
  say('Greeting ready for ' + j.name + '.');
}
function sendHello(req) {
  lastReq = req;
  var inResult = result.contains(document.activeElement);
  setBusy(true);
  clear(result);
  if (inResult) sayBtn.focus();
  result.appendChild(el('div', 'result-loading', 'Warming up the greeting...'));
  var f = forcedChaos();
  var c = f || (req.chaos ? '1' : null);
  var path = '/hello' + (c ? '?chaos=' + encodeURIComponent(c) : '');
  return api('POST', path, { name: req.name, language: req.language, tone: req.tone }).then(function (res) {
    setBusy(false);
    if (res.status === 200 && res.json && res.json.greeting && res.json.certificate) success(res.json);
    else if (res.status === 400 && res.json && typeof res.json.error === 'string') {
      showResult([el('div', 'result-empty', 'No greeting yet. Say hello to someone.')]);
      nameErr.textContent = res.json.error; nameIn.setAttribute('aria-invalid', 'true'); say(res.json.error); nameIn.focus();
    } else failure(res, function () { sendHello(lastReq); });
  });
}
function submitHello(ev) {
  ev.preventDefault();
  if (isBusyBtn(sayBtn)) return;
  var name = nameIn.value.normalize('NFC').trim();
  var err = '';
  if (!name) err = 'Enter a name so we know who to greet.';
  else if (cpLen(name) > 40) err = 'Names can be at most 40 characters.';
  if (err) { nameErr.textContent = err; nameIn.setAttribute('aria-invalid', 'true'); say(err); nameIn.focus(); return; }
  nameErr.textContent = ''; nameIn.removeAttribute('aria-invalid');
  sendHello({ name: name, language: $('language').value, tone: $('tone').value, chaos: $('chaos').checked });
}
$('hello-form').addEventListener('submit', submitHello);

/* ---------- certificate ---------- */
function loadCert(id, refocus) {
  var box = $('cert-body');
  clear(box);
  var done = function () { if (refocus) { var c = box.querySelector('button,a,textarea'); (c || title).focus(); } };
  box.appendChild(el('p', null, 'Loading certificate...'));
  if (!/^[a-f0-9]{16}$/.test(id)) { certMissing(box); say('We could not find that certificate.'); done(); return; }
  api('GET', '/api/certificates/' + id).then(function (res) {
    if (parseHash().id !== id) return;
    clear(box);
    if (res.status === 200 && res.json) { renderCert(box, res.json); say('Certificate loaded.'); }
    else if (res.status === 404) { certMissing(box); say('We could not find that certificate.'); }
    else { var msg = errorText(res); box.appendChild(el('div', 'error-message', msg)); box.appendChild(retryButton(function () { loadCert(id, true); })); say(msg); }
    done();
  });
}
function certMissing(box) {
  clear(box);
  box.appendChild(el('p', null, 'We could not find that certificate. Go back and say hello again.'));
  var a = el('a', null, 'Back to Hello', 'btn secondary'); a.setAttribute('href', '#/hello'); box.appendChild(a);
}
function renderCert(box, c) {
  var dl = el('dl');
  [['Name', 'cert-name', c.name], ['Greeting', 'cert-greeting', c.greeting], ['Date', 'cert-date', c.date], ['Signature', 'cert-signature', c.signature]].forEach(function (r) {
    dl.appendChild(el('dt', null, r[0]));
    dl.appendChild(el('dd', r[1], r[2], r[1] === 'cert-signature' ? 'mono' : ''));
  });
  var card = el('div', null, null, 'card'); card.appendChild(dl);
  var lab = el('label', null, 'Certificate text'); lab.setAttribute('for', 'cert-text-box');
  var ta = el('textarea', 'cert-text'); ta.id = 'cert-text-box'; ta.readOnly = true; ta.value = c.text;
  var copy = el('button', 'cert-copy', 'Copy certificate'); copy.type = 'button';
  copy.addEventListener('click', function () {
    var p;
    try { p = navigator.clipboard.writeText(ta.value); } catch (e) { p = Promise.reject(e); }
    p.then(function () { say('Certificate copied.'); }, function () { say('Select the text and copy it yourself.'); });
  });
  var v = el('a', 'cert-verify-link', 'Verify this certificate', 'btn secondary'); v.setAttribute('href', '#/verify');
  [card, lab, ta, copy, v].forEach(function (n) { box.appendChild(n); });
}

/* ---------- verify ---------- */
var vIn = $('cert-input'), vBtn = $('verify-btn'), vErr = $('verify-error'), vOut = $('verify-out');
$('verify-form').addEventListener('submit', function (ev) {
  ev.preventDefault();
  if (isBusyBtn(vBtn)) return;
  var text = vIn.value;
  clear(vOut);
  vErr.textContent = '';
  vIn.removeAttribute('aria-invalid');
  var verr = '';
  if (!text.trim()) verr = 'Paste a certificate first.';
  else if (text.length > 10000) verr = 'That is too long to be a certificate (10,000 characters max).';
  if (verr) { vErr.textContent = verr; vIn.setAttribute('aria-invalid', 'true'); say(verr); vIn.focus(); return; }
  setBusyBtn(vBtn, true); vBtn.textContent = 'Checking...';
  api('POST', '/api/verify', { text: text }).then(function (res) {
    setBusyBtn(vBtn, false); vBtn.textContent = 'Verify';
    if (res.status === 200 && res.json && (res.json.verdict === 'Authentic' || res.json.verdict === 'Forged')) {
      var ok = res.json.verdict === 'Authentic';
      var box = el('div', 'verify-result', null, 'card verdict ' + (ok ? 'ok' : 'bad'));
      var g = el('span', null, ok ? '✓' : '✗'); g.setAttribute('aria-hidden', 'true');
      box.appendChild(g);
      box.appendChild(el('strong', 'verify-verdict', res.json.verdict));
      var why = ok ? 'This certificate was signed by this server.'
        : res.json.reason === 'unreadable' ? 'This is not a readable certificate.'
        : 'The signature does not match. The certificate was changed or was not made here.';
      var d = el('p', null, why);
      vOut.appendChild(box); vOut.appendChild(d);
      say(res.json.verdict + '. ' + why);
    } else {
      var m = errorText(res);
      vOut.appendChild(el('div', res.status === 429 ? 'rate-limit-message' : 'error-message', m)); say(m);
    }
  });
});

/* ---------- battle ---------- */
var bBox = $('battle-body'), lbBox = $('lb-body');
function renderLb(rows) {
  var tbl = el('table', 'leaderboard');
  tbl.appendChild(el('caption', null, 'Top 10 greetings'));
  var head = el('tr');
  ['Rank', 'Greeting', 'Votes'].forEach(function (h) { var t = el('th', null, h); t.setAttribute('scope', 'col'); head.appendChild(t); });
  var th = el('thead'); th.appendChild(head); tbl.appendChild(th);
  var tb = el('tbody');
  if (!rows || !rows.length) {
    var tr0 = el('tr'); var td0 = el('td', null, 'No votes yet. Cast the first one.'); td0.setAttribute('colspan', '3'); tr0.appendChild(td0); tb.appendChild(tr0);
  } else rows.forEach(function (r, i) {
    var tr = el('tr', 'leaderboard-row');
    tr.appendChild(el('td', null, String(r.rank || i + 1)));
    tr.appendChild(el('td', 'lb-greeting', r.greeting));
    tr.appendChild(el('td', 'lb-votes', String(r.votes)));
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  clear(lbBox); lbBox.appendChild(tbl);
}
function loadLb() {
  clear(lbBox); lbBox.appendChild(el('p', null, 'Loading leaderboard...'));
  return api('GET', '/api/leaderboard').then(function (res) {
    if (res.status === 200 && res.json) renderLb(res.json.leaderboard);
    else { clear(lbBox); lbBox.appendChild(el('p', null, GENERIC)); say(GENERIC); }
  });
}
function loadBattle(refocus) {
  clear(bBox); bBox.appendChild(el('p', null, 'Finding two greetings...'));
  loadLb();
  api('GET', '/api/battle').then(function (res) {
    clear(bBox);
    if (res.status !== 200 || !res.json || !res.json.a || !res.json.b) {
      var lm = 'Could not load the battle. Try again.';
      bBox.appendChild(el('p', null, lm));
      var rb = retryButton(function () { loadBattle(true); });
      bBox.appendChild(rb);
      say(lm);
      if (refocus) rb.focus();
      return;
    }
    var note = el('p', null, null, 'err'); note.id = 'vote-error';
    [['a', 'A', 'battle-option-a'], ['b', 'B', 'battle-option-b']].forEach(function (p) {
      var o = res.json[p[0]];
      var b = el('button', p[2], 'Vote for ' + p[1] + ': ' + o.greeting, 'opt');
      b.type = 'button';
      b.setAttribute('aria-describedby', 'vote-error');
      b.addEventListener('click', function () { vote(o, note); });
      bBox.appendChild(b);
    });
    bBox.appendChild(note);
    say('Battle ready. Choose a greeting.');
    if (refocus) $('battle-body').querySelector('button').focus();
  });
}
function vote(o, note) {
  note.textContent = '';
  api('POST', '/api/battle/vote', { choice: o.id }).then(function (res) {
    if (res.status === 200 && res.json) {
      clear(bBox);
      bBox.appendChild(el('p', null, 'Thanks, vote counted.'));
      var nx = el('button', 'battle-next', 'Next battle'); nx.type = 'button';
      nx.addEventListener('click', function () { loadBattle(true); });
      bBox.appendChild(nx);
      renderLb(res.json.leaderboard);
      say('Vote counted for ' + o.greeting + '.');
      nx.focus();
    } else { note.textContent = errorText(res, 'Your vote was not saved. Try again.'); say(note.textContent); }
  });
}

window.addEventListener('hashchange', route);
route();
`;

const hash = (s) => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`;
const opts = (list) => list.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hello Overkill</title>
<style>${STYLE}</style>
</head>
<body>
<header>
<p class="brand">Hello Overkill</p>
<nav aria-label="Primary">
<a href="#/hello" data-testid="nav-hello" id="nav-hello">Hello</a>
<a href="#/battle" data-testid="nav-battle" id="nav-battle">Battle</a>
<a href="#/verify" data-testid="nav-verify" id="nav-verify">Verify</a>
</nav>
</header>
<main id="main">
<h1 id="title" data-testid="view-title" tabindex="-1">Hello</h1>
<section id="v-hello">
<form id="hello-form" novalidate>
<label for="name">Name</label>
<input type="text" id="name" name="name" data-testid="name-input" maxlength="40" autocomplete="off" aria-describedby="name-error">
<p id="name-error" class="err" data-testid="name-error"></p>
<label for="language">Language</label>
<select id="language" data-testid="language-select">${opts(LANGUAGES)}</select>
<label for="tone">Tone</label>
<select id="tone" data-testid="tone-select">${opts(TONES)}</select>
<div class="check"><input type="checkbox" id="chaos" data-testid="chaos-toggle"><label for="chaos">Chaos mode (sometimes the greeter misbehaves)</label></div>
<button type="submit" id="say-hello" data-testid="say-hello">Say hello</button>
</form>
<div id="result" class="card"><div data-testid="result-empty">No greeting yet. Say hello to someone.</div></div>
</section>
<section id="v-battle" hidden>
<div id="battle-body"></div>
<div id="lb-body"></div>
</section>
<section id="v-verify" hidden>
<form id="verify-form" novalidate>
<label for="cert-input">Certificate text</label>
<textarea id="cert-input" data-testid="verify-input" aria-describedby="verify-hint verify-error"></textarea>
<p id="verify-hint">Paste a certificate to check it.</p>
<p id="verify-error" class="err"></p>
<button type="submit" id="verify-btn" data-testid="verify-btn">Verify</button>
</form>
<div id="verify-out"></div>
</section>
<section id="v-cert" hidden>
<div id="cert-body"></div>
</section>
<div id="status" data-testid="status" role="status" aria-live="polite" aria-atomic="true" class="sr"></div>
</main>
<footer>Practice app. We store only your name, visit counts and dates on this server.</footer>
<script>${SCRIPT}</script>
</body>
</html>
`;

module.exports = { html, styleHash: hash(STYLE), scriptHash: hash(SCRIPT) };
