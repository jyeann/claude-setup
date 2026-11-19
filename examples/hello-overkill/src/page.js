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
input[type=text],input[type=date],input[type=number],select,textarea{width:100%;min-height:44px;padding:8px 10px;font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--ctl-line);border-radius:8px}
textarea{min-height:8rem;overflow-wrap:anywhere}
input[aria-invalid=true],textarea[aria-invalid=true],select[aria-invalid=true]{border-color:var(--bad)}
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
h2{font-size:1.125rem;margin:24px 0 0}
.hint{color:var(--muted);margin:4px 0 0}
.more{max-width:40rem;margin:24px auto 0;padding:0 16px}
.more nav{margin-bottom:0}
.more p{margin:0 0 4px;color:var(--muted)}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(8.5rem,1fr));gap:8px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}
.stat dt{margin:0;color:var(--muted);font-weight:400}
.stat dd{font-size:1.25rem;font-weight:600}
.feed{list-style:none;margin:0;padding:0}
.feed li{border-bottom:1px solid var(--line);padding:8px 0;overflow-wrap:anywhere}
.pre{white-space:pre-line}
.peer{border-left:6px solid var(--line);padding-left:10px}
.peer.ok{border-color:var(--ok)}
.peer.bad{border-color:var(--bad)}
footer{color:var(--muted);font-size:.875rem;margin:32px auto 24px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:opacity .01s!important}}
@media (max-width:480px){button,.btn{width:100%;justify-content:center}nav a{flex:1;justify-content:center}}
@media print{nav,button,.btn,header,footer,.more{display:none!important}}
`;

const SCRIPT = String.raw`
'use strict';
var $ = function (id) { return document.getElementById(id); };
var main = $('main'), statusEl = $('status'), title = $('title');
var KEYS = ['hello', 'battle', 'verify', 'cert', 'weather', 'wall', 'sla', 'time-machine', 'haiku', 'federation'];
var NAV = ['hello', 'battle', 'verify', 'weather', 'wall', 'sla', 'time-machine', 'haiku', 'federation'];
var views = {};
KEYS.forEach(function (k) { views[k] = $('v-' + k); });
var curKey = '', leavers = [];
function onLeave(fn) { leavers.push(fn); }
function runLeave() { var l = leavers; leavers = []; l.forEach(function (f) { try { f(); } catch (e) { /* ignore */ } }); }
var GENERIC = 'The greeter is having a moment. Check that the server is running, then try again.';
var NAMES = { hello: 'Hello', battle: 'Battle', verify: 'Verify', cert: 'Certificate of Hello', weather: 'Hello Weather', wall: 'Live Hello Wall', sla: 'Hello SLA', 'time-machine': 'Greeting Time Machine', haiku: 'Hello Haiku', federation: 'Federation' };
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
  var key = (r.name === 'certificate' && r.id) ? 'cert' : (r.name !== 'cert' && KEYS.indexOf(r.name) >= 0) ? r.name : null;
  if (!key) { location.replace('#/hello'); return; }
  var sig = key + '/' + r.id;
  if (sig === lastSig) return;
  lastSig = sig;
  runLeave();
  curKey = key;
  Object.keys(views).forEach(function (k) { views[k].hidden = k !== key; });
  title.textContent = NAMES[key];
  NAV.forEach(function (k) {
    var a = $('nav-' + k);
    if (k === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  document.title = NAMES[key] + ' - Hello Overkill';
  if (key === 'battle') loadBattle(false);
  if (key === 'cert') loadCert(r.id);
  if (key === 'wall') startWall();
  if (key === 'sla') startSla();
  if (key === 'time-machine') setTmMax();
  if (key === 'federation') loadFed(false);
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
  const loading = el('div', 'result-loading', 'Warming up the greeting...');
  loading.setAttribute('aria-busy', 'true');
  result.appendChild(loading);
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

/* ---------- v2 shared helpers ---------- */
function isCur(k) { return curKey === k; }
function busyBtn(btn, on, idle, busy) { setBusyBtn(btn, on); btn.textContent = on ? busy : idle; }
function setLoading(node, on, text) {
  node.hidden = !on;
  node.textContent = on ? text : '';
  if (on) node.setAttribute('aria-busy', 'true'); else node.removeAttribute('aria-busy');
}
function showErr(errEl, input, msg, focus) {
  errEl.textContent = msg;
  if (input) input.setAttribute('aria-invalid', 'true');
  say(msg);
  if (focus && input) input.focus();
}
function clearErr(errEl, inputs) {
  errEl.textContent = '';
  inputs.forEach(function (i) { i.removeAttribute('aria-invalid'); });
}
function apiMsg(res, generic) {
  var j = res.json;
  if ((res.status === 400 || res.status === 422) && j && typeof j.error === 'string') {
    return j.error + (typeof j.hint === 'string' ? '. ' + j.hint : '');
  }
  return errorText(res, generic);
}
function cleanText(v, max) {
  var s = typeof v === 'string' ? v : '';
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, '').slice(0, max || 300);
}
function normText(v) { return v.normalize('NFC').trim().replace(/\s+/g, ' '); }
function fmtMs(v) { return typeof v === 'number' ? v.toFixed(1) + ' ms' : 'n/a'; }
function fmtPct(v) { return typeof v === 'number' ? (v * 100).toFixed(2) + '%' : 'n/a'; }
function fmtUptime(sec) {
  if (typeof sec !== 'number') return 'n/a';
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + s + 's';
}
function tableOf(tid, caption, heads) {
  var t = el('table', tid);
  t.appendChild(el('caption', null, caption));
  var hr = el('tr');
  heads.forEach(function (h) { var th = el('th', null, h); th.setAttribute('scope', 'col'); hr.appendChild(th); });
  var hd = el('thead'); hd.appendChild(hr); t.appendChild(hd);
  return t;
}

/* ---------- weather ---------- */
var wPlace = $('weather-place'), wDate = $('weather-date'), wName = $('weather-name'), wBtn = $('weather-btn');
var wErr = $('weather-error'), wOut = $('weather-out'), wLoad = $('weather-loading');
$('weather-form').addEventListener('submit', function (ev) {
  ev.preventDefault();
  if (isBusyBtn(wBtn)) return;
  var place = normText(wPlace.value), name = normText(wName.value), date = wDate.value;
  clearErr(wErr, [wPlace, wDate, wName]);
  if (cpLen(place) > 40) { showErr(wErr, wPlace, 'Place can be at most 40 characters.', true); return; }
  if (cpLen(name) > 40) { showErr(wErr, wName, 'Names can be at most 40 characters.', true); return; }
  var q = new URLSearchParams();
  if (place) q.set('place', place);
  if (date) q.set('date', date);
  if (name) q.set('name', name);
  busyBtn(wBtn, true, 'Get forecast', 'Checking...');
  setLoading(wLoad, true, 'Reading the sky...');
  api('GET', '/api/weather' + (q.toString() ? '?' + q.toString() : '')).then(function (res) {
    busyBtn(wBtn, false, 'Get forecast', 'Checking...');
    setLoading(wLoad, false);
    var j = res.json;
    if (res.status === 200 && j && typeof j.forecast === 'string' && typeof j.greeting === 'string') {
      clear(wOut);
      wOut.appendChild(el('p', 'weather-forecast', cleanText(j.forecast)));
      wOut.appendChild(el('p', 'weather-chance', 'Chance of warm regards: ' + String(Number(j.chanceOfWarmRegards)) + '%'));
      wOut.appendChild(el('p', 'weather-greeting', cleanText(j.greeting, 600)));
      wOut.appendChild(el('p', null, cleanText(j.place, 80) + ', ' + cleanText(j.date, 10) + ': ' + cleanText(j.condition, 80) + ', ' + String(Number(j.tempC)) + ' °C, wind ' + String(Number(j.windKph)) + ' km/h. Simulated forecast, not real weather.', 'meta'));
      say('Forecast ready for ' + cleanText(j.place, 80) + '.');
    } else showErr(wErr, res.status === 400 ? wPlace : null, apiMsg(res), res.status === 400);
  });
});

/* ---------- wall ---------- */
var wallEs = null, wallLast = 0, wallEver = false, wallState = '';
var wStatus = $('wall-status'), wCount = $('wall-count'), wList = $('wall-list'), wEmpty = $('wall-empty'), wRetry = $('wall-retry');
var MILESTONES = ['first-visit', 'visit-10', 'visit-100', 'streak-7', 'streak-30', 'streak-100'];
function wallSet(state, text, announce) {
  wStatus.textContent = text;
  wRetry.hidden = state !== 'closed' && state !== 'full';
  if (state !== wallState && announce && isCur('wall')) say(announce);
  wallState = state;
}
function wallCount() {
  var n = wList.children.length;
  wCount.textContent = n + (n === 1 ? ' hello shown' : ' hellos shown');
  wEmpty.hidden = n > 0;
}
function wallAdd(ev) {
  var id = parseInt(ev.lastEventId, 10);
  if (id >= 1) { if (id <= wallLast) return; wallLast = id; }
  var d;
  try { d = JSON.parse(ev.data); } catch (e) { return; }
  if (!d || typeof d !== 'object') return;
  var txt = 'A ' + cleanText(d.language, 8) + '/' + cleanText(d.tone, 16) + ' hello';
  if (typeof d.milestone === 'string' && MILESTONES.indexOf(d.milestone) >= 0) txt += ' (' + d.milestone + ' milestone)';
  wList.insertBefore(el('li', 'wall-item', txt), wList.firstChild);
  while (wList.children.length > 50) wList.removeChild(wList.lastChild);
  wallCount();
}
function stopWall() {
  if (wallEs) { wallEs.close(); wallEs = null; }
}
function startWall() {
  stopWall();
  clear(wList); wallLast = 0; wallEver = false; wallState = '';
  wallCount();
  wallSet('connecting', 'Connecting...');
  if (typeof EventSource !== 'function') { wallSet('full', 'Wall is full, try later', 'The live wall is not available in this browser.'); return; }
  var es = new EventSource('/api/stream');
  wallEs = es;
  es.addEventListener('open', function () { wallEver = true; wallSet('open', 'Connected', 'Live wall connected.'); });
  es.addEventListener('hello', wallAdd);
  es.addEventListener('error', function () {
    if (wallEs !== es) return;
    if (es.readyState === 2) {
      es.close(); wallEs = null;
      if (wallEver) wallSet('closed', 'Disconnected. Reconnect to keep watching.', 'Live wall disconnected.');
      else wallSet('full', 'Wall is full, try later', 'The wall is full. Try again later.');
    } else wallSet('reconnecting', 'Reconnecting...', 'Live wall reconnecting.');
  });
  onLeave(stopWall);
}
wRetry.addEventListener('click', function () { startWall(); wStatus.focus(); });
window.addEventListener('pagehide', function () { runLeave(); });

/* ---------- sla ---------- */
var slaTimer = null, slaBusy = false, slaMsg = '';
var slaErr = $('sla-error'), slaBody = $('sla-body');
function slaFail(msg) {
  slaErr.textContent = msg;
  if (msg !== slaMsg && isCur('sla')) say(msg);
  slaMsg = msg;
}
function slaRender(j) {
  var t = j.total || {};
  $('sla-uptime').textContent = fmtUptime(j.uptimeSeconds);
  $('sla-total-count').textContent = typeof t.count === 'number' ? String(t.count) : 'n/a';
  $('sla-error-rate').textContent = fmtPct(t.errorRate);
  $('sla-p50').textContent = fmtMs(t.p50);
  $('sla-p95').textContent = fmtMs(t.p95);
  $('sla-p99').textContent = fmtMs(t.p99);
  $('sla-hello-rate').textContent = typeof j.helloPerMinute === 'number' ? j.helloPerMinute.toFixed(1) + ' per minute' : 'n/a';
  clear(slaBody);
  var rows = Array.isArray(j.routes) ? j.routes : [];
  if (!rows.length) {
    var tr0 = el('tr'); var td0 = el('td', null, 'No requests in the last 5 minutes.'); td0.setAttribute('colspan', '3'); tr0.appendChild(td0); slaBody.appendChild(tr0);
    return;
  }
  rows.forEach(function (r) {
    var tr = el('tr', 'sla-row');
    tr.appendChild(el('td', 'sla-route', cleanText(r.route, 80)));
    tr.appendChild(el('td', 'sla-count', typeof r.count === 'number' ? String(r.count) : 'n/a'));
    tr.appendChild(el('td', 'sla-row-p95', fmtMs(r.p95)));
    slaBody.appendChild(tr);
  });
}
function loadSla() {
  if (slaBusy) return;
  slaBusy = true;
  api('GET', '/api/sla').then(function (res) {
    slaBusy = false;
    if (!isCur('sla')) return;
    if (res.status === 200 && res.json && res.json.total) { slaErr.textContent = ''; slaMsg = ''; slaRender(res.json); }
    else if (res.status === 401) slaFail('The SLA dashboard is locked. A token is required.');
    else slaFail(errorText(res, 'Could not load the SLA numbers. Showing the last good ones.'));
  });
}
function stopSla() { if (slaTimer) { clearInterval(slaTimer); slaTimer = null; } }
function startSla() {
  stopSla();
  slaMsg = '';
  loadSla();
  slaTimer = setInterval(function () { if (!document.hidden && isCur('sla')) loadSla(); }, 5000);
  onLeave(stopSla);
}

/* ---------- time machine ---------- */
var tmDate = $('tm-date'), tmName = $('tm-name'), tmBtn = $('tm-btn'), tmErr = $('tm-error'), tmOut = $('tm-out'), tmLoad = $('tm-loading');
function setTmMax() { tmDate.setAttribute('max', new Date().toISOString().slice(0, 10)); }
setTmMax();
function streakText(s) {
  var n = cleanText(s.name, 40) || 'This visitor';
  if (s.status === 'no-record') return 'No streak on record for ' + n + '.';
  if (s.status === 'before-first-visit') return n + ' had not visited yet on that day.';
  if (s.status === 'on-streak') return 'Day ' + String(Number(s.dayOfStreak)) + ' of a ' + String(Number(s.streakLength)) + '-day streak for ' + n + '.';
  if (s.status === 'unknown') return n + ' visited by then, but only the current streak is remembered, so that day is unknown.';
  if (s.status === 'inactive-after') return 'That day is after the last visit by ' + n + '.';
  return 'Streak status unavailable.';
}
$('tm-form').addEventListener('submit', function (ev) {
  ev.preventDefault();
  if (isBusyBtn(tmBtn)) return;
  var date = tmDate.value, name = normText(tmName.value);
  clearErr(tmErr, [tmDate, tmName]);
  if (!date) { showErr(tmErr, tmDate, 'Pick a date between 1900-01-01 and today.', true); return; }
  if (cpLen(name) > 40) { showErr(tmErr, tmName, 'Names can be at most 40 characters.', true); return; }
  var q = new URLSearchParams(); q.set('date', date); if (name) q.set('name', name);
  busyBtn(tmBtn, true, 'Travel', 'Travelling...');
  setLoading(tmLoad, true, 'Warming up the flux capacitor...');
  api('GET', '/api/time-machine?' + q.toString()).then(function (res) {
    busyBtn(tmBtn, false, 'Travel', 'Travelling...');
    setLoading(tmLoad, false);
    var j = res.json;
    if (res.status === 200 && j && typeof j.greeting === 'string' && typeof j.era === 'string') {
      clear(tmOut);
      tmOut.appendChild(el('p', 'tm-era', 'Era: ' + cleanText(j.era, 80)));
      var g = el('p', 'tm-greeting', cleanText(j.greeting, 600));
      tmOut.appendChild(g);
      if (j.streak && typeof j.streak === 'object') tmOut.appendChild(el('p', 'tm-streak', streakText(j.streak)));
      say('Greeting from ' + cleanText(j.era, 80) + ' ready.');
    } else showErr(tmErr, res.status === 400 ? tmDate : null, apiMsg(res), res.status === 400);
  });
});

/* ---------- haiku ---------- */
var hName = $('haiku-name'), hTheme = $('haiku-theme'), hSyl = $('haiku-syl'), hBtn = $('haiku-btn');
var hErr = $('haiku-error'), hOut = $('haiku-out'), hLoad = $('haiku-loading');
var COUNTS_OK = '5-7-5 verified';
$('haiku-form').addEventListener('submit', function (ev) {
  ev.preventDefault();
  if (isBusyBtn(hBtn)) return;
  var name = normText(hName.value), syl = hSyl.value.trim();
  clearErr(hErr, [hName, hSyl]);
  if (!name) { showErr(hErr, hName, 'Enter a name so we can write your haiku.', true); return; }
  if (cpLen(name) > 40) { showErr(hErr, hName, 'Names can be at most 40 characters.', true); return; }
  if (syl && !/^[1-6]$/.test(syl)) { showErr(hErr, hSyl, 'Syllables must be a whole number from 1 to 6.', true); return; }
  var body = { name: name, theme: hTheme.value };
  if (syl) body.syllables = parseInt(syl, 10);
  busyBtn(hBtn, true, 'Write haiku', 'Counting syllables...');
  setLoading(hLoad, true, 'Counting syllables on our fingers...');
  api('POST', '/api/haiku', body).then(function (res) {
    busyBtn(hBtn, false, 'Write haiku', 'Counting syllables...');
    setLoading(hLoad, false);
    var j = res.json;
    if (res.status === 200 && j && Array.isArray(j.haiku) && j.haiku.length === 3) {
      clear(hOut);
      var box = el('div', null, null, 'pre');
      j.haiku.forEach(function (line) { box.appendChild(el('p', 'haiku-line', cleanText(line, 120))); });
      hOut.appendChild(box);
      var sy = Array.isArray(j.syllables) ? j.syllables.map(function (n) { return String(Number(n)); }).join('-') : '';
      hOut.appendChild(el('p', 'haiku-counts', j.verified === true && sy === '5-7-5' ? COUNTS_OK : (sy || 'unknown') + ' not verified', 'meta'));
      if (typeof j.limit === 'string') hOut.appendChild(el('p', null, cleanText(j.limit, 200), 'hint'));
      say('Haiku ready. ' + j.haiku.map(function (l) { return cleanText(l, 120); }).join('. '));
    } else showErr(hErr, res.status === 400 || res.status === 422 ? hName : null, apiMsg(res), res.status === 400 || res.status === 422);
  });
});

/* ---------- federation ---------- */
var FED_ERR = { timeout: 'timed out', refused: 'refused the connection', blocked_address: 'blocked (private address)', too_large: 'sent too much data', redirect: 'tried to redirect', bad_status: 'answered with an error', bad_content_type: 'sent the wrong content type', bad_json: 'sent unreadable data', bad_shape: 'sent an unexpected answer', network: 'could not be reached' };
function fedErr(code) { return Object.prototype.hasOwnProperty.call(FED_ERR, code) ? FED_ERR[code] : 'failed'; }
var fEmpty = $('fed-empty'), fSummary = $('fed-summary'), fPeers = $('fed-peers'), fHBtn = $('fed-health-btn');
var fName = $('fed-name'), fBtn = $('fed-hello-btn'), fErr = $('fed-name-error'), fOut = $('fed-out'), fLoad = $('fed-loading'), fHErr = $('fed-health-error');
function loadFed(refocus) {
  if (isBusyBtn(fHBtn)) return;
  busyBtn(fHBtn, true, 'Check peers', 'Checking...');
  fHErr.textContent = '';
  api('GET', '/api/federation').then(function (res) {
    busyBtn(fHBtn, false, 'Check peers', 'Checking...');
    if (!isCur('federation')) return;
    var j = res.json;
    if (res.status !== 200 || !j || !Array.isArray(j.peers) || !j.summary) {
      var m = errorText(res, 'Could not check the peers. Try again.');
      fHErr.textContent = m; say(m);
      if (refocus) fHBtn.focus();
      return;
    }
    clear(fPeers);
    fEmpty.hidden = j.configured !== false;
    if (j.configured === false) { fSummary.textContent = ''; say('No peers configured.'); return; }
    var msg = String(Number(j.summary.up)) + ' of ' + String(Number(j.summary.total)) + ' peers up.';
    fSummary.textContent = msg;
    var t = tableOf('fed-peer-table', 'Peer health', ['Peer', 'Status']);
    var tb = el('tbody');
    j.peers.forEach(function (p) {
      var tr = el('tr', 'fed-peer-row');
      tr.appendChild(el('td', 'fed-peer-origin', cleanText(p.origin, 200)));
      tr.appendChild(el('td', 'fed-peer-status', p.ok === true ? 'Up (' + String(Number(p.latencyMs)) + ' ms)' : 'Down: ' + fedErr(p.error)));
      tb.appendChild(tr);
    });
    t.appendChild(tb); fPeers.appendChild(t);
    say(msg);
  });
}
fHBtn.addEventListener('click', function () { loadFed(true); });
$('fed-form').addEventListener('submit', function (ev) {
  ev.preventDefault();
  if (isBusyBtn(fBtn)) return;
  var name = normText(fName.value);
  clearErr(fErr, [fName]);
  if (!name) { showErr(fErr, fName, 'Enter a name to send to the peers.', true); return; }
  if (cpLen(name) > 40) { showErr(fErr, fName, 'Names can be at most 40 characters.', true); return; }
  busyBtn(fBtn, true, 'Greet peers', 'Greeting...');
  setLoading(fLoad, true, 'Asking the peers...');
  api('GET', '/api/federation/hello?' + new URLSearchParams({ name: name }).toString()).then(function (res) {
    busyBtn(fBtn, false, 'Greet peers', 'Greeting...');
    setLoading(fLoad, false);
    var j = res.json;
    if (res.status === 200 && j && Array.isArray(j.results) && j.summary) {
      clear(fOut);
      fEmpty.hidden = j.configured !== false;
      if (j.configured === false) { say('No peers configured.'); return; }
      var msg = String(Number(j.summary.ok)) + ' of ' + String(Number(j.summary.total)) + ' peers answered.';
      fOut.appendChild(el('p', null, msg));
      var ul = el('ul', null, null, 'feed');
      j.results.forEach(function (r) {
        var ok = r.ok === true;
        var li = el('li', 'fed-result', null, 'peer ' + (ok ? 'ok' : 'bad'));
        li.appendChild(el('strong', null, cleanText(r.origin, 200)));
        if (ok) {
          var more = (r.visit ? ' (visit ' + String(Number(r.visit)) + (r.streak ? ', streak ' + String(Number(r.streak)) : '') + ')' : '');
          li.appendChild(el('p', 'fed-result-greeting', cleanText(r.greeting, 300) + more));
        } else li.appendChild(el('p', 'fed-result-error', 'This peer ' + fedErr(r.error) + '.'));
        ul.appendChild(li);
      });
      fOut.appendChild(ul);
      say(msg);
    } else showErr(fErr, res.status === 400 ? fName : null, apiMsg(res), res.status === 400);
  });
});

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
<section id="v-weather" hidden>
<form id="weather-form" novalidate>
<label for="weather-place">Place</label>
<input type="text" id="weather-place" data-testid="weather-place-input" maxlength="40" autocomplete="off" aria-describedby="weather-hint weather-error">
<p id="weather-hint" class="hint">Optional. Defaults to anywhere.</p>
<label for="weather-date">Date</label>
<input type="date" id="weather-date" data-testid="weather-date-input" aria-describedby="weather-date-hint weather-error">
<p id="weather-date-hint" class="hint">Optional. Yesterday, today or tomorrow (UTC).</p>
<label for="weather-name">Name</label>
<input type="text" id="weather-name" data-testid="weather-name-input" maxlength="40" autocomplete="off" aria-describedby="weather-error">
<p id="weather-error" class="err" data-testid="weather-error"></p>
<button type="submit" id="weather-btn" data-testid="weather-go">Get forecast</button>
</form>
<p id="weather-loading" class="meta" hidden></p>
<div id="weather-out" class="card"><p data-testid="weather-forecast">Pick a place to see today's greeting forecast.</p></div>
</section>
<section id="v-wall" hidden>
<p class="hint">Hellos appear here as they happen. Names are never shown.</p>
<div class="card">
<p id="wall-status" data-testid="wall-status" tabindex="-1">Connecting...</p>
<p id="wall-count" data-testid="wall-count" class="meta">0 hellos shown</p>
<button type="button" id="wall-retry" class="secondary" hidden>Reconnect</button>
</div>
<p id="wall-empty" data-testid="wall-empty">No hellos yet. Say hello and watch it appear.</p>
<ul id="wall-list" data-testid="wall-list" class="feed" aria-label="Recent hellos"></ul>
</section>
<section id="v-sla" hidden>
<p class="hint">The last five minutes. Refreshes every 5 seconds while this view is open.</p>
<p id="sla-error" class="err" data-testid="sla-error"></p>
<dl class="stats">
<div class="stat"><dt>Uptime</dt><dd id="sla-uptime" data-testid="sla-uptime">-</dd></div>
<div class="stat"><dt>Requests</dt><dd id="sla-total-count" data-testid="sla-total-count">-</dd></div>
<div class="stat"><dt>Server errors</dt><dd id="sla-error-rate" data-testid="sla-error-rate">-</dd></div>
<div class="stat"><dt>p50</dt><dd id="sla-p50" data-testid="sla-p50">-</dd></div>
<div class="stat"><dt>p95</dt><dd id="sla-p95" data-testid="sla-p95">-</dd></div>
<div class="stat"><dt>p99</dt><dd id="sla-p99" data-testid="sla-p99">-</dd></div>
<div class="stat"><dt>Hellos</dt><dd id="sla-hello-rate" data-testid="sla-hello-rate">-</dd></div>
</dl>
<table data-testid="sla-table">
<caption>Routes</caption>
<thead><tr><th scope="col">Route</th><th scope="col">Requests</th><th scope="col">p95</th></tr></thead>
<tbody id="sla-body"><tr><td colspan="3">Loading...</td></tr></tbody>
</table>
</section>
<section id="v-time-machine" hidden>
<form id="tm-form" novalidate>
<label for="tm-date">Date</label>
<input type="date" id="tm-date" data-testid="tm-date-input" min="1900-01-01" aria-describedby="tm-hint tm-error">
<p id="tm-hint" class="hint">Any day from 1900-01-01 to today.</p>
<label for="tm-name">Name</label>
<input type="text" id="tm-name" data-testid="tm-name-input" maxlength="40" autocomplete="off" aria-describedby="tm-name-hint tm-error">
<p id="tm-name-hint" class="hint">Optional. Adds your streak for that day.</p>
<p id="tm-error" class="err" data-testid="tm-error"></p>
<button type="submit" id="tm-btn" data-testid="tm-go">Travel</button>
</form>
<p id="tm-loading" class="meta" hidden></p>
<div id="tm-out" class="card"><p>Pick a date to hear what the greeter said back then.</p></div>
</section>
<section id="v-haiku" hidden>
<form id="haiku-form" novalidate>
<label for="haiku-name">Name</label>
<input type="text" id="haiku-name" data-testid="haiku-name-input" maxlength="40" autocomplete="off" aria-describedby="haiku-error">
<label for="haiku-theme">Theme</label>
<select id="haiku-theme" data-testid="haiku-theme-select"><option value="morning">Morning</option><option value="ocean">Ocean</option><option value="city">City</option><option value="night">Night</option></select>
<label for="haiku-syl">Syllables in your name</label>
<input type="number" id="haiku-syl" data-testid="haiku-syllables-input" min="1" max="6" step="1" inputmode="numeric" aria-describedby="haiku-syl-hint haiku-error">
<p id="haiku-syl-hint" class="hint">Optional, 1 to 6. Use it when the automatic count is wrong.</p>
<p id="haiku-error" class="err" data-testid="haiku-error"></p>
<button type="submit" id="haiku-btn" data-testid="haiku-go">Write haiku</button>
</form>
<p id="haiku-loading" class="meta" hidden></p>
<div id="haiku-out" class="card"><p>Enter a name to compile a 5-7-5 haiku.</p></div>
</section>
<section id="v-federation" hidden>
<p id="fed-notice" data-testid="fed-notice" class="card">Your name is sent to the listed peers. Each peer records a visit under that name.</p>
<p id="fed-empty" data-testid="fed-empty" hidden>No peers configured. Set HELLO_PEERS.</p>
<h2>Peer health</h2>
<button type="button" id="fed-health-btn" data-testid="fed-health-btn">Check peers</button>
<p id="fed-health-error" class="err"></p>
<p id="fed-summary" data-testid="fed-summary" class="meta"></p>
<div id="fed-peers"></div>
<h2>Greet the peers</h2>
<form id="fed-form" novalidate>
<label for="fed-name">Name</label>
<input type="text" id="fed-name" data-testid="fed-name-input" maxlength="40" autocomplete="off" aria-describedby="fed-name-error">
<p id="fed-name-error" class="err"></p>
<button type="submit" id="fed-hello-btn" data-testid="fed-hello-btn">Greet peers</button>
</form>
<p id="fed-loading" class="meta" hidden></p>
<div id="fed-out"></div>
</section>
<div id="status" data-testid="status" role="status" aria-live="polite" aria-atomic="true" class="sr"></div>
</main>
<div class="more">
<p id="more-label">More views</p>
<nav aria-labelledby="more-label">
<a href="#/weather" data-testid="nav-weather" id="nav-weather">Weather</a>
<a href="#/wall" data-testid="nav-wall" id="nav-wall">Wall</a>
<a href="#/sla" data-testid="nav-sla" id="nav-sla">SLA</a>
<a href="#/time-machine" data-testid="nav-time-machine" id="nav-time-machine">Time machine</a>
<a href="#/haiku" data-testid="nav-haiku" id="nav-haiku">Haiku</a>
<a href="#/federation" data-testid="nav-federation" id="nav-federation">Federation</a>
</nav>
</div>
<footer>Practice app. We store only your name, visit counts and dates on this server.</footer>
<script>${SCRIPT}</script>
</body>
</html>
`;

module.exports = { html, styleHash: hash(STYLE), scriptHash: hash(SCRIPT) };
