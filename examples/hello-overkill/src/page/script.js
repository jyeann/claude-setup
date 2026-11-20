'use strict';
// The single inline client script. Plain ES5-style code inside one string: no template literals (the client
// code must never contain "${"), no innerHTML, text only through textContent, href only to '#/...' routes.
const { ICONS } = require('./icons');

const RAW = String.raw`(function () {
'use strict';
try { var savedTheme = localStorage.getItem('ho-theme'); if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.setAttribute('data-theme', savedTheme); } catch (e) { /* storage blocked: follow the system */ }

var ICONS = __ICONS__;
var SVGNS = 'http://www.w3.org/2000/svg';
var root = document.documentElement;
var $ = function (id) { return document.getElementById(id); };
var statusEl = $('status'), title = $('title'), eyebrowEl = $('eyebrow'), ledeEl = $('lede');

/* ---------- helpers ---------- */
function motionOK() { return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
function el(tag, tid, text, cls) {
  var e = document.createElement(tag);
  if (tid) e.setAttribute('data-testid', tid);
  if (text !== undefined && text !== null) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function svg(tag, attrs) {
  var e = document.createElementNS(SVGNS, tag);
  Object.keys(attrs || {}).forEach(function (k) {
    if (/^(on|href|style|xlink)/i.test(k)) return;
    e.setAttribute(k, String(attrs[k]));
  });
  return e;
}
function icon(name, cls) {
  var s = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false', 'class': cls || 'ic' });
  (ICONS[name] || []).forEach(function (p) { s.appendChild(svg(p[0], p[1])); });
  return s;
}
function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
function append(parent, kids) { kids.forEach(function (k) { if (k) parent.appendChild(k); }); return parent; }
function cpLen(s) { return Array.from(s).length; }
function restart(node, cls) { node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }
function setLabel(btn, text) { var l = btn.querySelector('.lbl'); if (l) l.textContent = text; else btn.textContent = text; }
function setBusyBtn(btn, b) {
  if (b) btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled');
  btn.classList.toggle('is-busy', !!b);
}
function isBusyBtn(btn) { return btn.getAttribute('aria-disabled') === 'true'; }
function busyBtn(btn, on, idle, busy) { setBusyBtn(btn, on); setLabel(btn, on ? busy : idle); }
function langOf(code) { var c = String(code || '').split('.')[0]; return /^[a-z]{2}$/.test(c) ? c : 'en'; }

var sayTimer = null;
function say(t) {
  if (sayTimer) clearTimeout(sayTimer);
  statusEl.textContent = '';
  sayTimer = setTimeout(function () { sayTimer = null; statusEl.textContent = t; }, 60);
}
// Announce a loading text only if the wait is noticeable; returns a cancel function.
function slowSay(text) {
  var view = curKey;
  var t = setTimeout(function () { if (curKey === view) say(text); }, 1000);
  return function () { clearTimeout(t); };
}

var GENERIC = 'The greeter is having a moment. Check that the server is running, then try again.';
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
function api(method, path, body) {
  var opts = { method: method, headers: {} };
  if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['content-type'] = 'application/json'; }
  return fetch(path, opts).then(function (r) {
    return r.text().then(function (t) {
      var j = null; try { j = JSON.parse(t); } catch (e) { j = null; }
      return { status: r.status, retry: r.headers.get('retry-after'), json: j };
    }, function () { return { status: 0, retry: null, json: null }; });
  }, function () { return { status: 0, retry: null, json: null }; });
}
function cleanText(v, max) {
  var s = typeof v === 'string' ? v : '';
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, '').slice(0, max || 300);
}
function normText(v) { return v.normalize('NFC').trim().replace(/\s+/g, ' '); }
function fmtMs(v) { return typeof v === 'number' ? v.toFixed(1) + ' ms' : 'n/a'; }
function fmtPct(v) { return typeof v === 'number' ? (v * 100).toFixed(2) + '%' : 'n/a'; }
function fmtUptime(sec) {
  if (typeof sec !== 'number') return 'n/a';
  var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + s + 's';
}
function tableOf(tid, caption, heads, cls) {
  var t = el('table', tid, null, cls);
  t.appendChild(el('caption', null, caption));
  var hr = el('tr');
  heads.forEach(function (h) { var th = el('th', null, h); th.setAttribute('scope', 'col'); hr.appendChild(th); });
  var hd = el('thead'); hd.appendChild(hr); t.appendChild(hd);
  return t;
}
function setLoading(node, on, text) {
  node.hidden = !on;
  node.textContent = on ? text : '';
  if (on) node.setAttribute('aria-busy', 'true'); else node.removeAttribute('aria-busy');
}
function showErr(errEl, input, msg, focus) {
  errEl.textContent = msg;
  if (input) { input.removeAttribute('aria-invalid'); void input.offsetWidth; input.setAttribute('aria-invalid', 'true'); }
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
    return cleanText(j.error, 200) + (typeof j.hint === 'string' ? '. ' + cleanText(j.hint, 200) : '');
  }
  return errorText(res, generic);
}
var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/* ---------- theme ---------- */
var THEME_COLORS = { light: '#F4EEE2', dark: '#12161C' };
var themePointer = false;
function storedTheme() { var t = root.getAttribute('data-theme'); return t === 'light' || t === 'dark' ? t : 'system'; }
function syncThemeColor() {
  var t = storedTheme();
  Array.prototype.forEach.call(document.querySelectorAll('meta[name=theme-color]'), function (m) {
    var scheme = /dark/.test(m.getAttribute('media') || '') ? 'dark' : 'light';
    m.setAttribute('content', THEME_COLORS[t === 'system' ? scheme : t]);
  });
}
function applyTheme(v, announce) {
  if (v === 'light' || v === 'dark') {
    root.setAttribute('data-theme', v);
    try { localStorage.setItem('ho-theme', v); } catch (e) { /* not persisted */ }
  } else {
    root.removeAttribute('data-theme');
    try { localStorage.removeItem('ho-theme'); } catch (e) { /* nothing stored */ }
  }
  syncThemeColor();
  root.classList.add('theme-anim');
  setTimeout(function () { root.classList.remove('theme-anim'); }, 400);
  if (announce) say(v === 'light' || v === 'dark' ? 'Theme set to ' + v + '.' : 'Theme follows your device.');
}
var themeSet = document.querySelector('.appearance');
var themeInput = $('theme-' + storedTheme());
if (themeInput) themeInput.checked = true;
syncThemeColor();
themeSet.addEventListener('pointerdown', function () { themePointer = true; });
themeSet.addEventListener('change', function (ev) {
  // Keyboard users already hear the native radio announcement; only pointer activation is announced.
  applyTheme(ev.target.value, themePointer);
  themePointer = false;
});

/* ---------- routing ---------- */
var KEYS = ['hello', 'battle', 'verify', 'cert', 'weather', 'wall', 'sla', 'time-machine', 'haiku', 'federation'];
var NAV = ['hello', 'battle', 'verify', 'weather', 'wall', 'sla', 'time-machine', 'haiku', 'federation'];
var NAMES = { hello: 'Hello', battle: 'Battle', verify: 'Verify', cert: 'Certificate of Hello', weather: 'Hello Weather', wall: 'Live Hello Wall', sla: 'Hello SLA', 'time-machine': 'Greeting Time Machine', haiku: 'Hello Haiku', federation: 'Federation' };
var HEAD = {
  hello: ['Counter 1', 'Pick a language and a tone. We will dispatch your greeting and stamp it.'],
  battle: ['Counter 2', 'Two greetings enter. Pick the one you would rather receive.'],
  verify: ['Counter 3', 'Paste a certificate. The examiner checks the seal.'],
  cert: ['Issued by the Greeting Office', 'Signed by this server. Print it, copy it, or have it verified.'],
  weather: ['Telegraph desk', 'A simulated forecast, delivered as a telegram.'],
  wall: ['Sorting floor', 'Hellos appear here as they happen. Names are never shown.'],
  sla: ['Control room', 'The last five minutes. Refreshes every 5 seconds while this view is open.'],
  'time-machine': ['Archive of postmarks', 'Pick any day since 1900 and hear how the greeter would have said it.'],
  haiku: ['Print shop', 'Seventeen syllables, set by hand and counted twice.'],
  federation: ['Sister offices', 'One greeting, sent to every office on the allowlist.']
};
var views = {};
KEYS.forEach(function (k) { views[k] = $('v-' + k); });
var curKey = '', leavers = [];
function onLeave(fn) { leavers.push(fn); }
function runLeave() { var l = leavers; leavers = []; l.forEach(function (f) { try { f(); } catch (e) { /* ignore */ } }); }
function isCur(k) { return curKey === k; }
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
  stopFlick();
  curKey = key;
  Object.keys(views).forEach(function (k) { views[k].hidden = k !== key; });
  title.textContent = NAMES[key];
  eyebrowEl.textContent = HEAD[key][0];
  ledeEl.textContent = HEAD[key][1];
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
var lastReq = null, countdown = null;
var sayBtn = $('say-hello'), nameIn = $('name'), nameErr = $('name-error'), result = $('result'), letter = $('letter');

function setBusy(b) { setBusyBtn(sayBtn, b); setLabel(sayBtn, b ? 'Greeting...' : 'Say hello'); }
function showLetter(nodes, cls) {
  letter.className = 'letter' + (cls ? ' ' + cls : '');
  clear(letter);
  append(letter, nodes);
}
function retryButton(fn) {
  var b = el('button', 'retry-btn', null, 'btn secondary');
  b.type = 'button';
  b.appendChild(icon('retry'));
  b.appendChild(el('span', null, 'Try again', 'lbl'));
  b.addEventListener('click', fn);
  return b;
}
function postmark(d) {
  var s = svg('svg', { 'class': 'postmark', viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false', 'data-testid': 'greeting-stamp' });
  s.appendChild(svg('circle', { cx: 50, cy: 50, r: 46, fill: 'none', stroke: 'currentColor', 'stroke-width': 3 }));
  s.appendChild(svg('circle', { cx: 50, cy: 50, r: 39, fill: 'none', stroke: 'currentColor', 'stroke-width': 1 }));
  [[String(d.getUTCDate()).padStart(2, '0'), 36, ''], [MONTHS[d.getUTCMonth()], 54, ''], [String(d.getUTCFullYear()), 72, 'yr']].forEach(function (t) {
    var tx = svg('text', { x: 50, y: t[1], 'class': t[2] }); tx.textContent = t[0]; s.appendChild(tx);
  });
  return s;
}
function failure(res, retryFn) {
  if (res.status === 429) { rateLimited(res); return; }
  var tea = res.status === 418;
  var box = el('div', 'error-message', null, 'panel-msg ' + (tea ? 'tea' : 'oops'));
  box.appendChild(icon(tea ? 'teacup' : 'alert', 'ic msg-ic'));
  if (tea) { box.appendChild(el('p', null, TEA1)); box.appendChild(el('p', null, TEA2)); }
  else box.appendChild(el('p', null, GENERIC));
  var b = retryButton(retryFn);
  box.appendChild(b);
  result.classList.remove('is-open');
  showLetter([box]);
  say(errorText(res));
  b.focus();
}
function rateLimited(res) {
  var n = retrySeconds(res);
  var msg = errorText(res);
  var ticket = el('div', null, null, 'ticket');
  var ring = svg('svg', { 'class': 'ring', viewBox: '0 0 56 56', 'aria-hidden': 'true', focusable: 'false' });
  ring.appendChild(svg('circle', { 'class': 'track', cx: 28, cy: 28, r: 24 }));
  var bar = svg('circle', { 'class': 'bar', cx: 28, cy: 28, r: 24, 'stroke-dashoffset': 0 });
  ring.appendChild(bar);
  ticket.appendChild(ring);
  ticket.appendChild(el('div', 'rate-limit-message', msg));
  result.classList.remove('is-open');
  showLetter([ticket]);
  say(msg);
  if (countdown) clearInterval(countdown);
  setBusyBtn(sayBtn, true);
  var left = n;
  setLabel(sayBtn, 'Wait ' + left + 's');
  countdown = setInterval(function () {
    left -= 1;
    bar.setAttribute('stroke-dashoffset', String(150.8 * (1 - Math.max(left, 0) / n)));
    if (left <= 0) {
      clearInterval(countdown); countdown = null;
      setBusy(false);
      say('You can say hello again.');
    } else setLabel(sayBtn, 'Wait ' + left + 's');
  }, 1000);
}
function success(j) {
  restart(result, 'is-open');
  var p = el('p', 'greeting-text', cleanText(j.greeting, 600), 'greeting');
  p.setAttribute('lang', langOf(j.language));
  var led = el('div', null, null, 'ledger stagger');
  led.appendChild(el('span', 'visit-count', 'Visit ' + j.visit, 'chip rise'));
  var streak = el('span', null, null, 'chip rise');
  streak.appendChild(el('span', 'streak-count', 'Streak ' + j.streak + (j.streak === 1 ? ' day' : ' days')));
  var dots = el('span', null, null, 'dots'); dots.setAttribute('aria-hidden', 'true');
  for (var i = 0; i < 7; i += 1) dots.appendChild(el('i', null, null, i < Math.min(j.streak, 7) ? 'on' : ''));
  streak.appendChild(dots);
  led.appendChild(streak);
  var id = String(j.certificate.id || '');
  led.appendChild(el('span', 'greeting-ref', 'Ref ' + id.slice(0, 4).toUpperCase() + ' ' + id.slice(4, 8).toUpperCase(), 'ref rise'));
  var a = el('a', 'cert-link', null, 'btn secondary rise');
  a.setAttribute('href', '#/certificate/' + encodeURIComponent(j.certificate.id));
  a.appendChild(icon('envelope'));
  a.appendChild(document.createTextNode('View certificate'));
  led.appendChild(a);
  showLetter([postmark(new Date()), p, led], 'arrive');
  say('Greeting ready for ' + cleanText(j.name, 40) + '.');
}
function sendHello(req) {
  lastReq = req;
  var inResult = result.contains(document.activeElement);
  setBusy(true);
  if (inResult) sayBtn.focus();
  var pen = svg('svg', { 'class': 'pen', viewBox: '0 0 200 40', 'aria-hidden': 'true', focusable: 'false' });
  pen.appendChild(svg('path', { pathLength: 1, d: 'M4 30c14-22 24-22 30 0s18 18 26-2 20-20 28 0 18 18 26 0 20-20 28 0 18 14 26-4 16-12 26 0' }));
  var loading = el('div', 'result-loading', 'Warming up the greeting...');
  loading.setAttribute('aria-busy', 'true');
  result.classList.remove('is-open');
  showLetter([pen, loading], 'blank');
  var stopSlow = slowSay('Warming up the greeting...');
  var f = forcedChaos();
  var c = f || (req.chaos ? '1' : null);
  var path = '/hello' + (c ? '?chaos=' + encodeURIComponent(c) : '');
  return api('POST', path, { name: req.name, language: req.language, tone: req.tone }).then(function (res) {
    stopSlow();
    setBusy(false);
    if (res.status === 200 && res.json && res.json.greeting && res.json.certificate) success(res.json);
    else if (res.status === 400 && res.json && typeof res.json.error === 'string') {
      showLetter([icon('envelope'), el('div', 'result-empty', 'No greeting yet. Say hello to someone.')], 'blank');
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
  if (err) { showErr(nameErr, nameIn, err, true); return; }
  nameErr.textContent = ''; nameIn.removeAttribute('aria-invalid');
  sendHello({ name: name, language: $('language').value, tone: $('tone').value, chaos: $('chaos').checked });
}
$('hello-form').addEventListener('submit', submitHello);

/* ---------- certificate ---------- */
var certWait = $('cert-wait'), certMsg = $('cert-msg'), certStage = $('cert-stage'), certText = $('cert-text-box');
var copiedTimer = null;
function certShow(which) { certWait.hidden = which !== 'wait'; certMsg.hidden = which !== 'msg'; certStage.hidden = which !== 'stage'; }
function loadCert(id, refocus) {
  certShow('wait');
  if (refocus) title.focus();
  var done = function () { if (refocus) { var c = views.cert.querySelector('#cert-msg button, #cert-msg a'); (c || title).focus(); } };
  if (!/^[a-f0-9]{16}$/.test(id)) { certMissing(); say('We could not find that certificate.'); done(); return; }
  var stopSlow = slowSay('Loading certificate...');
  api('GET', '/api/certificates/' + id).then(function (res) {
    stopSlow();
    if (parseHash().id !== id) return;
    if (res.status === 200 && res.json) { renderCert(res.json); say('Certificate loaded.'); }
    else if (res.status === 404) { certMissing(); say('We could not find that certificate.'); }
    else {
      var msg = errorText(res);
      clear(certMsg);
      var box = el('div', 'error-message', null, 'panel-msg oops');
      box.appendChild(icon('alert', 'ic msg-ic'));
      box.appendChild(el('p', null, msg));
      box.appendChild(retryButton(function () { loadCert(id, true); }));
      certMsg.appendChild(box);
      certShow('msg');
      say(msg);
    }
    done();
  });
}
function certMissing() {
  clear(certMsg);
  var dead = el('div', null, null, 'dead');
  var stamp = el('p', null, 'RETURNED TO SENDER', 'rts'); stamp.setAttribute('aria-hidden', 'true');
  dead.appendChild(stamp);
  dead.appendChild(el('p', null, 'We could not find that certificate. Go back and say hello again.'));
  var a = el('a', null, 'Back to Hello', 'btn secondary'); a.setAttribute('href', '#/hello');
  dead.appendChild(a);
  certMsg.appendChild(dead);
  certShow('msg');
}
function renderCert(c) {
  var id = String(c.id || '');
  $('cert-name').textContent = cleanText(c.name, 40);
  var g = $('cert-greeting'); g.textContent = cleanText(c.greeting, 600); g.setAttribute('lang', langOf(c.language));
  $('cert-date').textContent = c.date;
  $('cert-signature').textContent = cleanText(c.signature, 200);
  $('cert-serial').textContent = 'Serial ' + (id.toUpperCase().match(/.{1,4}/g) || []).join('-');
  certText.value = c.text;
  $('cert-copied').hidden = true;
  certShow('stage');
}
$('cert-copy').addEventListener('click', function () {
  var p;
  var pill = $('cert-copied');
  try { p = navigator.clipboard.writeText(certText.value); } catch (e) { p = Promise.reject(e); }
  p.then(function () {
    pill.hidden = false;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(function () { pill.hidden = true; }, 2000);
    say('Certificate copied.');
  }, function () { certText.select(); say('Select the text and copy it yourself.'); });
});
$('cert-print').addEventListener('click', function () { window.print(); });

/* ---------- verify ---------- */
var vIn = $('cert-input'), vBtn = $('verify-btn'), vErr = $('verify-error'), vOut = $('verify-out'), vScan = $('verify-scan');
$('verify-form').addEventListener('submit', function (ev) {
  ev.preventDefault();
  if (isBusyBtn(vBtn)) return;
  var text = vIn.value;
  vErr.textContent = '';
  vIn.removeAttribute('aria-invalid');
  var verr = '';
  if (!text.trim()) verr = 'Paste a certificate first.';
  else if (text.length > 10000) verr = 'That is too long to be a certificate (10,000 characters max).';
  if (verr) { showErr(vErr, vIn, verr, true); return; }
  busyBtn(vBtn, true, 'Verify', 'Checking...');
  vScan.hidden = false;
  var stopSlow = slowSay('Checking...');
  api('POST', '/api/verify', { text: text }).then(function (res) {
    stopSlow();
    busyBtn(vBtn, false, 'Verify', 'Checking...');
    vScan.hidden = true;
    clear(vOut);
    if (res.status === 200 && res.json && (res.json.verdict === 'Authentic' || res.json.verdict === 'Forged')) {
      var ok = res.json.verdict === 'Authentic';
      var box = el('div', 'verify-result', null, 'stamp ' + (ok ? 'ok' : 'bad'));
      var glyph = el('span', null, ok ? '\u2713' : '\u2717', 'glyph'); glyph.setAttribute('aria-hidden', 'true');
      box.appendChild(glyph);
      box.appendChild(el('strong', 'verify-verdict', res.json.verdict));
      var why = ok ? 'This certificate was signed by this server.'
        : res.json.reason === 'unreadable' ? 'This is not a readable certificate.'
        : 'The signature does not match. The certificate was changed or was not made here.';
      vOut.appendChild(box);
      vOut.appendChild(el('p', null, why, 'reason'));
      say(res.json.verdict + '. ' + why);
    } else {
      var m = errorText(res);
      vOut.appendChild(el('div', res.status === 429 ? 'rate-limit-message' : 'error-message', m, 'panel-msg oops'));
      say(m);
    }
  });
});

/* ---------- battle ---------- */
var bBox = $('battle-body'), lbBox = $('lb-body'), battleSeq = 0;
function renderLb(rows, hot) {
  var tbl = tableOf('leaderboard', 'Top 10 greetings', ['Rank', 'Greeting', 'Votes'], 'lb');
  var tb = el('tbody');
  if (!rows || !rows.length) {
    var tr0 = el('tr'); var td0 = el('td', null, 'No votes yet. Cast the first one.'); td0.setAttribute('colspan', '3'); tr0.appendChild(td0); tb.appendChild(tr0);
  } else rows.forEach(function (r, i) {
    var tr = el('tr', 'leaderboard-row', null, hot && r.greeting === hot && motionOK() ? 'hot' : '');
    tr.appendChild(el('td', null, String(r.rank || i + 1)));
    tr.appendChild(el('td', 'lb-greeting', r.greeting));
    tr.appendChild(el('td', 'lb-votes', String(r.votes)));
    tb.appendChild(tr);
  });
  tbl.appendChild(tb);
  clear(lbBox); lbBox.appendChild(tbl);
}
function loadLb() {
  var my = battleSeq;
  clear(lbBox); lbBox.appendChild(el('p', null, 'Loading leaderboard...', 'hint'));
  return api('GET', '/api/leaderboard').then(function (res) {
    if (my !== battleSeq) return;
    if (res.status === 200 && res.json) renderLb(res.json.leaderboard);
    else { clear(lbBox); lbBox.appendChild(el('p', null, GENERIC)); say(GENERIC); }
  });
}
function loadBattle(refocus) {
  var my = ++battleSeq;
  clear(bBox);
  bBox.appendChild(el('div', null, null, 'ghost-letter'));
  bBox.appendChild(el('div', null, null, 'ghost-letter'));
  bBox.appendChild(el('p', null, 'Finding two greetings...', 'hint'));
  loadLb();
  api('GET', '/api/battle').then(function (res) {
    if (my !== battleSeq || !isCur('battle')) return;
    clear(bBox);
    if (res.status !== 200 || !res.json || !res.json.a || !res.json.b) {
      var lm = 'Could not load the battle. Try again.';
      var box = el('div', 'error-message', null, 'panel-msg oops');
      box.appendChild(el('p', null, lm));
      var rb = retryButton(function () { loadBattle(true); });
      box.appendChild(rb);
      bBox.appendChild(box);
      say(lm);
      if (refocus) rb.focus();
      return;
    }
    var note = el('p', null, null, 'err vote-note'); note.id = 'vote-error';
    [['a', 'A', 'battle-option-a'], ['b', 'B', 'battle-option-b']].forEach(function (p) {
      var o = res.json[p[0]];
      var b = el('button', p[2], null, 'opt ' + p[0]);
      b.type = 'button';
      b.setAttribute('data-tag', p[1]);
      b.setAttribute('aria-describedby', 'vote-error');
      b.appendChild(el('span', null, 'Vote for ' + p[1] + ':', 'opt-tag'));
      b.appendChild(document.createTextNode(' '));
      var tx = el('span', null, cleanText(o.greeting, 300), 'opt-text'); tx.setAttribute('lang', langOf(o.id));
      b.appendChild(tx);
      b.addEventListener('click', function () { vote(o, res.json[p[0] === 'a' ? 'b' : 'a'], note, b); });
      bBox.appendChild(b);
    });
    bBox.appendChild(note);
    say('Battle ready. Choose a greeting.');
    if (refocus) bBox.querySelector('button').focus();
  });
}
function vote(o, other, note, btn) {
  if (isBusyBtn(btn)) return;
  var my = battleSeq;
  var opts = Array.prototype.slice.call(bBox.querySelectorAll('.opt'));
  note.textContent = '';
  opts.forEach(function (b) { setBusyBtn(b, true); });
  api('POST', '/api/battle/vote', { choice: o.id }).then(function (res) {
    opts.forEach(function (b) { setBusyBtn(b, false); });
    if (my !== battleSeq || !isCur('battle')) return;
    if (res.status === 200 && res.json) {
      clear(bBox);
      var list = el('ul', null, null, 'done-list'); list.setAttribute('role', 'list');
      var win = el('li', null, null, 'done-letter win');
      win.appendChild(el('span', null, 'Your pick', 'pick'));
      var wt = el('span', null, ' ' + cleanText(o.greeting, 300)); wt.setAttribute('lang', langOf(o.id)); win.appendChild(wt);
      var lose = el('li', null, null, 'done-letter lose');
      var lt = el('span', null, other ? cleanText(other.greeting, 300) : ''); lt.setAttribute('lang', langOf(other && other.id)); lose.appendChild(lt);
      append(list, [win, lose]);
      var after = el('div', null, null, 'after-vote');
      after.appendChild(el('p', null, 'Thanks, vote counted.', 'thanks'));
      var nx = el('button', 'battle-next', null, 'btn'); nx.type = 'button';
      nx.appendChild(icon('duel'));
      nx.appendChild(el('span', null, 'Next battle', 'lbl'));
      nx.addEventListener('click', function () { loadBattle(true); });
      after.appendChild(nx);
      append(bBox, [list, after]);
      renderLb(res.json.leaderboard, o.greeting);
      say('Vote counted for ' + o.greeting + '.');
      nx.focus();
    } else { note.textContent = errorText(res, 'Your vote was not saved. Try again.'); say(note.textContent); }
  });
}

/* ---------- weather ---------- */
var wPlace = $('weather-place'), wDate = $('weather-date'), wName = $('weather-name'), wBtn = $('weather-btn');
var wErr = $('weather-error'), wBody = $('weather-body'), wLoad = $('weather-loading'), wIcon = $('wx-icon');
function wxIcon(cond) {
  var c = String(cond || '').toLowerCase();
  if (/storm|thunder/.test(c)) return 'alert';
  if (/rain|shower|drizzle/.test(c)) return 'rain';
  if (/snow|flurr/.test(c)) return 'snow';
  if (/wind|gust|breez/.test(c)) return 'wind';
  if (/cloud|overcast|grey|gray|fog|mist/.test(c)) return 'cloud';
  if (/sun|clear|bright|spell|warm/.test(c)) return 'sun';
  return 'star';
}
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
  var stopSlow = slowSay('Reading the sky...');
  api('GET', '/api/weather' + (q.toString() ? '?' + q.toString() : '')).then(function (res) {
    stopSlow();
    busyBtn(wBtn, false, 'Get forecast', 'Checking...');
    setLoading(wLoad, false);
    var j = res.json;
    if (res.status === 200 && j && typeof j.forecast === 'string' && typeof j.greeting === 'string') {
      clear(wBody);
      wBody.className = 'tg-body stagger';
      clear(wIcon); wIcon.appendChild(icon(wxIcon(j.condition)));
      var pct = Math.max(0, Math.min(100, Number(j.chanceOfWarmRegards) || 0));
      var meter = el('div', 'weather-meter', null, 'meter');
      meter.setAttribute('aria-hidden', 'true');
      meter.setAttribute('data-q', String(Math.round(pct / 5) * 5));
      meter.appendChild(el('span'));
      append(wBody, [
        el('p', 'weather-forecast', cleanText(j.forecast), 'strip'),
        el('p', 'weather-chance', 'Chance of warm regards: ' + String(Number(j.chanceOfWarmRegards)) + '%', 'strip'),
        meter,
        el('p', 'weather-greeting', cleanText(j.greeting, 600), 'strip'),
        el('p', null, cleanText(j.place, 80) + ', ' + cleanText(j.date, 10) + ': ' + cleanText(j.condition, 80) + ', ' + String(Number(j.tempC)) + ' °C, wind ' + String(Number(j.windKph)) + ' km/h. Simulated forecast, not real weather.', 'tg-meta')
      ]);
      say('Forecast ready for ' + cleanText(j.place, 80) + '.');
    } else showErr(wErr, res.status === 400 ? wPlace : null, apiMsg(res), res.status === 400);
  });
});

/* ---------- wall ---------- */
var wallEs = null, wallLast = 0, wallEver = false, wallState = '', wallPaused = false, wallBuffer = [], wallAnimAt = 0;
var wStatus = $('wall-status'), wCount = $('wall-count'), wList = $('wall-list'), wEmptyBox = $('wall-empty-box'), wRetry = $('wall-retry'), wLamp = $('wall-lamp'), wPause = $('wall-pause');
var MILESTONES = ['first-visit', 'visit-10', 'visit-100', 'streak-7', 'streak-30', 'streak-100'];
function wallSet(state, text, announce) {
  wStatus.textContent = text;
  wLamp.setAttribute('data-state', state);
  wRetry.hidden = state !== 'closed' && state !== 'full';
  if (state !== wallState && announce && isCur('wall')) say(announce);
  wallState = state;
}
function wallCount() {
  var n = wList.children.length;
  wCount.textContent = n + (n === 1 ? ' hello shown' : ' hellos shown');
  wEmptyBox.hidden = n > 0;
}
function wallAdd(ev) {
  var id = parseInt(ev.lastEventId, 10);
  if (id >= 1) { if (id <= wallLast) return; wallLast = id; }
  var d;
  try { d = JSON.parse(ev.data); } catch (e) { return; }
  if (!d || typeof d !== 'object') return;
  var row = { language: cleanText(d.language, 8), tone: cleanText(d.tone, 16), milestone: typeof d.milestone === 'string' && MILESTONES.indexOf(d.milestone) >= 0 ? d.milestone : '', ts: d.ts };
  if (wallPaused) { wallBuffer.push(row); if (wallBuffer.length > 50) wallBuffer.shift(); return; }
  wallInsert(row, true);
}
function wallInsert(row, animate) {
  var txt = 'A ' + row.language + '/' + row.tone + ' hello';
  if (row.milestone) txt += ' (' + row.milestone + ' milestone)';
  var li = el('li', 'wall-item', txt);
  var when = new Date(typeof row.ts === 'number' || typeof row.ts === 'string' ? row.ts : Date.now());
  if (!isNaN(when.getTime())) li.setAttribute('data-time', when.toISOString().slice(11, 19));
  if (row.milestone) li.setAttribute('data-milestone', row.milestone);
  // Flash budget (WCAG 2.3.1): at most one animated row per 500 ms; the rest appear without motion.
  var now = Date.now();
  var anim = animate && motionOK() && now - wallAnimAt >= 500;
  wList.insertBefore(li, wList.firstChild);
  while (wList.children.length > 50) wList.removeChild(wList.lastChild);
  if (anim) {
    wallAnimAt = now;
    li.classList.add('new');
    if (wList.animate) wList.animate([{ transform: 'translateY(-' + (li.offsetHeight + 4) + 'px)' }, { transform: 'none' }], { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)' });
  }
  while (wList.children.length > 50) wList.removeChild(wList.lastChild);
  wallCount();
}
function stopWall() {
  if (wallEs) { wallEs.close(); wallEs = null; }
}
function startWall() {
  stopWall();
  clear(wList); wallLast = 0; wallEver = false; wallState = ''; wallBuffer = [];
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
wPause.addEventListener('click', function () {
  wallPaused = !wallPaused;
  wPause.setAttribute('aria-pressed', wallPaused ? 'true' : 'false');
  setLabel(wPause, wallPaused ? 'Resume updates' : 'Pause updates');
  if (!wallPaused) { var buf = wallBuffer; wallBuffer = []; buf.forEach(function (r) { wallInsert(r, false); }); }
});
window.addEventListener('pagehide', function () { runLeave(); });

/* ---------- sla ---------- */
var slaTimer = null, slaBusy = false, slaMsg = '', slaSamples = [];
var slaErr = $('sla-error'), slaBody = $('sla-body'), slaPanel = $('sla-panel');
function slaSet(id, text) {
  var n = $(id);
  if (n.textContent === text) return;
  n.textContent = text;
  if (motionOK()) restart(n, 'tick');
}
function slaFail(msg, locked) {
  slaErr.textContent = msg;
  slaPanel.classList.toggle('stale', !locked);
  slaPanel.classList.toggle('locked', !!locked);
  if (msg !== slaMsg && isCur('sla')) say(msg);
  slaMsg = msg;
}
function sparkline() {
  var cap = $('spark-cap');
  if (slaSamples.length < 2) { cap.textContent = 'Collecting samples...'; return; }
  var max = Math.max.apply(null, slaSamples.concat([1]));
  var step = 240 / (slaSamples.length - 1);
  var pts = slaSamples.map(function (v, i) { return [Math.round(i * step * 100) / 100, Math.round((52 - (v / max) * 44) * 100) / 100]; });
  var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0] + ' ' + p[1]; }).join('');
  $('spark-line').setAttribute('d', line);
  $('spark-area').setAttribute('d', line + 'L240 56L0 56Z');
  cap.textContent = 'p95, last 2 minutes in this tab';
}
function slaRender(j) {
  var t = j.total || {};
  slaSet('sla-uptime', fmtUptime(j.uptimeSeconds));
  slaSet('sla-total-count', typeof t.count === 'number' ? String(t.count) : 'n/a');
  slaSet('sla-error-rate', fmtPct(t.errorRate));
  var er = $('sla-error-rate');
  if (typeof t.errorRate === 'number' && t.errorRate > 0) er.setAttribute('data-alert', ''); else er.removeAttribute('data-alert');
  slaSet('sla-p50', fmtMs(t.p50));
  slaSet('sla-p95', fmtMs(t.p95));
  slaSet('sla-p99', fmtMs(t.p99));
  slaSet('sla-hello-rate', typeof j.helloPerMinute === 'number' ? j.helloPerMinute.toFixed(1) + ' per minute' : 'n/a');
  if (typeof t.p95 === 'number') { slaSamples.push(t.p95); if (slaSamples.length > 24) slaSamples.shift(); }
  sparkline();
  clear(slaBody);
  var rows = Array.isArray(j.routes) ? j.routes : [];
  if (!rows.length) {
    var tr0 = el('tr'); var td0 = el('td', null, 'No requests in the last 5 minutes.'); td0.setAttribute('colspan', '3'); tr0.appendChild(td0); slaBody.appendChild(tr0);
    return;
  }
  rows.forEach(function (r) {
    var tr = el('tr', 'sla-row');
    tr.appendChild(el('td', 'sla-route', cleanText(r.route, 80), 'mono'));
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
    if (res.status === 200 && res.json && res.json.total) {
      slaErr.textContent = ''; slaMsg = '';
      slaPanel.classList.remove('stale', 'locked');
      slaRender(res.json);
    } else if (res.status === 401) slaFail('The SLA dashboard is locked. A token is required.', true);
    else slaFail(errorText(res, 'Could not load the SLA numbers. Showing the last good ones.'), false);
  });
}
function stopSla() { if (slaTimer) { clearInterval(slaTimer); slaTimer = null; } }
function startSla() {
  stopSla();
  slaSamples = [];
  slaMsg = '';
  loadSla();
  slaTimer = setInterval(function () { if (!document.hidden && isCur('sla')) loadSla(); }, 5000);
  onLeave(stopSla);
}

/* ---------- time machine ---------- */
var tmDate = $('tm-date'), tmName = $('tm-name'), tmBtn = $('tm-btn'), tmErr = $('tm-error'), tmOut = $('tm-out'), tmRes = $('tm-result'), tmLoad = $('tm-loading');
var tmPm = $('tm-pm'), tmYr = $('tm-pm-yr'), tmRail = $('tm-rail'), tmMarker = $('tm-marker');
var ERA_KEYS = [['edwardian', 'e1'], ['radio', 'e2'], ['atomic', 'e3'], ['disco', 'e4'], ['web 1.0', 'e5'], ['social', 'e6'], ['now', 'e7']];
var flickTimer = null, flickStop = null, rollSeq = 0, tmYearBefore = '----';
function setTmMax() { tmDate.setAttribute('max', new Date().toISOString().slice(0, 10)); }
setTmMax();
function eraKey(era) {
  var s = String(era || '').toLowerCase();
  for (var i = 0; i < ERA_KEYS.length; i += 1) if (s.indexOf(ERA_KEYS[i][0]) >= 0) return ERA_KEYS[i][1];
  return 'e0';
}
function stopFlick() { if (flickTimer) { clearInterval(flickTimer); flickTimer = null; } if (flickStop) { clearTimeout(flickStop); flickStop = null; } }
function startFlick() {
  stopFlick();
  if (!motionOK()) { tmYr.textContent = '----'; return; }
  flickTimer = setInterval(function () { tmYr.textContent = String(1900 + Math.floor(Math.random() * 127)); }, 150);
  flickStop = setTimeout(stopFlick, 3000);
}
function rollYear(target) {
  var my = ++rollSeq;
  var from = parseInt(tmYr.textContent, 10);
  if (!motionOK() || !(from >= 1900) || !window.requestAnimationFrame) { tmYr.textContent = String(target); return; }
  var t0 = null;
  var stepFn = function (ts) {
    if (t0 === null) t0 = ts;
    var k = Math.min(1, (ts - t0) / 640);
    var e = 1 - Math.pow(1 - k, 3);
    if (my !== rollSeq) return;
    tmYr.textContent = String(Math.round(from + (target - from) * e));
    if (k < 1 && my === rollSeq) requestAnimationFrame(stepFn);
  };
  requestAnimationFrame(stepFn);
}
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
  tmYearBefore = tmYr.textContent;
  rollSeq += 1;
  tmPm.classList.remove('blank');
  startFlick();
  var stopSlow = slowSay('Warming up the flux capacitor...');
  api('GET', '/api/time-machine?' + q.toString()).then(function (res) {
    stopSlow();
    stopFlick();
    busyBtn(tmBtn, false, 'Travel', 'Travelling...');
    setLoading(tmLoad, false);
    var j = res.json;
    if (res.status === 200 && j && typeof j.greeting === 'string' && typeof j.era === 'string') {
      var key = eraKey(j.era);
      var y = parseInt(date.slice(0, 4), 10), m = parseInt(date.slice(5, 7), 10), d = date.slice(8, 10);
      $('tm-pm-day').textContent = d;
      $('tm-pm-mon').textContent = MONTHS[m - 1] || '---';
      rollYear(y);
      restart(tmPm, 'landed');
      tmOut.setAttribute('data-era', key);
      tmRail.setAttribute('data-pos', String(Math.max(0, ERA_KEYS.map(function (e) { return e[1]; }).indexOf(key))));
      tmMarker.hidden = false;
      $('tm-empty').hidden = true;
      clear(tmRes);
      tmRes.className = 'era-card-body stagger';
      tmRes.appendChild(el('p', 'tm-era', 'Era: ' + cleanText(j.era, 80), 'eyebrow'));
      tmRes.appendChild(el('p', 'tm-greeting', cleanText(j.greeting, 600), 'tm-greet'));
      if (j.streak && typeof j.streak === 'object') tmRes.appendChild(el('p', 'tm-streak', streakText(j.streak), 'hint'));
      restart(tmOut, 'landed');
      say('Greeting from ' + cleanText(j.era, 80) + ' ready.');
    } else {
      if (!tmOut.classList.contains('landed')) { tmPm.classList.add('blank'); tmYr.textContent = '----'; } else tmYr.textContent = tmYearBefore;
      showErr(tmErr, res.status === 400 ? tmDate : null, apiMsg(res), res.status === 400);
    }
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
  var stopSlow = slowSay('Counting syllables on our fingers...');
  api('POST', '/api/haiku', body).then(function (res) {
    stopSlow();
    busyBtn(hBtn, false, 'Write haiku', 'Counting syllables...');
    setLoading(hLoad, false);
    var j = res.json;
    if (res.status === 200 && j && Array.isArray(j.haiku) && j.haiku.length === 3) {
      var theme = ['morning', 'ocean', 'city', 'night'].indexOf(body.theme) >= 0 ? body.theme : 'city';
      clear(hOut);
      hOut.setAttribute('data-haiku', theme);
      hOut.classList.toggle('night', theme === 'night');
      var counts = Array.isArray(j.syllables) ? j.syllables : [];
      var lines = el('div', null, null, 'haiku-lines stagger');
      j.haiku.forEach(function (line, i) {
        var p = el('p', 'haiku-line', cleanText(line, 120));
        if (typeof counts[i] === 'number') p.setAttribute('data-n', String(counts[i]));
        lines.appendChild(p);
      });
      hOut.appendChild(lines);
      var sy = counts.map(function (n) { return String(Number(n)); }).join('-');
      var ok = j.verified === true && sy === '5-7-5';
      var pill = el('div', 'haiku-seal', null, 'seal-pill' + (ok ? '' : ' warn'));
      pill.appendChild(icon(ok ? 'check' : 'alert'));
      pill.appendChild(el('p', 'haiku-counts', ok ? COUNTS_OK : (sy || 'unknown') + ' not verified'));
      hOut.appendChild(pill);
      if (typeof j.limit === 'string') hOut.appendChild(el('p', null, cleanText(j.limit, 200), 'haiku-limit'));
      say('Haiku ready. ' + j.haiku.map(function (l) { return cleanText(l, 120); }).join('. '));
    } else showErr(hErr, res.status === 400 || res.status === 422 ? hName : null, apiMsg(res), res.status === 400 || res.status === 422);
  });
});

/* ---------- federation ---------- */
var FED_ERR = { timeout: 'timed out', refused: 'refused the connection', blocked_address: 'blocked (private address)', too_large: 'sent too much data', redirect: 'tried to redirect', bad_status: 'answered with an error', bad_content_type: 'sent the wrong content type', bad_json: 'sent unreadable data', bad_shape: 'sent an unexpected answer', network: 'could not be reached' };
function fedErr(code) { return Object.prototype.hasOwnProperty.call(FED_ERR, code) ? FED_ERR[code] : 'failed'; }
var fEmpty = $('fed-empty'), fSummary = $('fed-summary'), fPeers = $('fed-peers'), fHBtn = $('fed-health-btn');
var fName = $('fed-name'), fBtn = $('fed-hello-btn'), fErr = $('fed-name-error'), fOut = $('fed-out'), fLoad = $('fed-loading'), fHErr = $('fed-health-error');
var fMap = $('fed-map'), fLinks = $('fed-links'), fNodes = $('fed-nodes'), fDots = $('fed-dots');
function nodePos(i, n) { var a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [160 + 110 * Math.cos(a), 110 + 74 * Math.sin(a)]; }
function drawMap(states) {
  clear(fLinks); clear(fNodes);
  var n = Math.min(8, states.length);
  for (var i = 0; i < n; i += 1) {
    var p = nodePos(i, n), st = states[i];
    fLinks.appendChild(svg('line', { 'class': 'link ' + st, x1: 160, y1: 110, x2: p[0].toFixed(1), y2: p[1].toFixed(1) }));
    fNodes.appendChild(svg('circle', { 'class': 'node ' + st, cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: 11 }));
    var t = svg('text', { 'class': 'node-t', x: p[0].toFixed(1), y: p[1].toFixed(1) }); t.textContent = String(i + 1);
    fNodes.appendChild(t);
  }
}
var dotsTimer = null;
function sendDots(n) {
  if (dotsTimer) { clearTimeout(dotsTimer); dotsTimer = null; }
  clear(fDots);
  if (!motionOK() || !n) return;
  var count = Math.min(8, n);
  for (var i = 0; i < count; i += 1) {
    var p = nodePos(i, count);
    var dot = svg('circle', { 'class': 'dot', cx: 160, cy: 110, r: 4 });
    fDots.appendChild(dot);
    if (dot.animate) dot.animate([{ transform: 'translate(0px, 0px)', opacity: 1 }, { transform: 'translate(' + (p[0] - 160).toFixed(1) + 'px, ' + (p[1] - 110).toFixed(1) + 'px)', opacity: 0 }], { duration: 620, delay: i * 120, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' });
  }
  dotsTimer = setTimeout(function () { dotsTimer = null; clear(fDots); }, 620 + count * 120 + 50);
}
function loadFed(refocus) {
  if (isBusyBtn(fHBtn)) return;
  busyBtn(fHBtn, true, 'Check peers', 'Checking...');
  fMap.classList.add('checking');
  fHErr.textContent = '';
  api('GET', '/api/federation').then(function (res) {
    busyBtn(fHBtn, false, 'Check peers', 'Checking...');
    fMap.classList.remove('checking');
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
    if (j.configured === false) { fSummary.textContent = ''; drawMap([]); say('No peers configured.'); return; }
    var msg = String(Number(j.summary.up)) + ' of ' + String(Number(j.summary.total)) + ' peers up.';
    fSummary.textContent = msg;
    drawMap(j.peers.map(function (p) { return p.ok === true ? 'up' : 'down'; }));
    var t = tableOf('fed-peer-table', 'Peer health', ['Peer', 'Status'], 'peer-table');
    var tb = el('tbody');
    j.peers.forEach(function (p) {
      var tr = el('tr', 'fed-peer-row');
      tr.appendChild(el('td', 'fed-peer-origin', cleanText(p.origin, 200), 'fed-origin'));
      tr.appendChild(el('td', 'fed-peer-status', p.ok === true ? 'Up (' + String(Number(p.latencyMs)) + ' ms)' : 'Down: ' + fedErr(p.error), p.ok === true ? 'st-up' : 'st-down'));
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
  var stopSlow = slowSay('Asking the peers...');
  api('GET', '/api/federation/hello?' + new URLSearchParams({ name: name }).toString()).then(function (res) {
    stopSlow();
    busyBtn(fBtn, false, 'Greet peers', 'Greeting...');
    setLoading(fLoad, false);
    var j = res.json;
    if (res.status === 200 && j && Array.isArray(j.results) && j.summary) {
      clear(fOut);
      fEmpty.hidden = j.configured !== false;
      if (j.configured === false) { drawMap([]); say('No peers configured.'); return; }
      var msg = String(Number(j.summary.ok)) + ' of ' + String(Number(j.summary.total)) + ' peers answered.';
      fOut.appendChild(el('p', null, msg));
      drawMap(j.results.map(function (r) { return r.ok === true ? 'up' : 'down'; }));
      sendDots(j.results.length);
      var ul = el('ul', null, null, 'peers-list stagger'); ul.setAttribute('role', 'list');
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
    } else { clear(fOut); showErr(fErr, res.status === 400 ? fName : null, apiMsg(res), res.status === 400); }
  });
});

window.addEventListener('hashchange', route);
window.addEventListener('pageshow', function (e) { if (e.persisted) { lastSig = null; route(); } });
route();
})();
`;

const SCRIPT = RAW.replace('__ICONS__', () => JSON.stringify(ICONS));

module.exports = { SCRIPT };
