'use strict';
// Static body markup for the single page. DOM order is also visual order: nothing focusable precedes nav-hello,
// and the secondary nav and the appearance control come after main (UC11 fixes the first 8 Tab stops).
const { iconSvg } = require('./icons');
const { guilloche, sealPath, ringGlyphs } = require('./geometry');

const LANGUAGES = [['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
  ['pt', 'Portuguese'], ['nl', 'Dutch'], ['sv', 'Swedish'], ['ja', 'Japanese'], ['sw', 'Swahili']];
const TONES = [['formal', 'Formal'], ['pirate', 'Pirate'], ['shakespearean', 'Shakespearean'], ['corporate', 'Corporate']];
const opts = (list) => list.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

const SPIN = '<span class="spin-ring" aria-hidden="true"></span>';
const btn = (attrs, iconName, label, cls = 'btn') => `<button ${attrs} class="${cls}">${iconSvg(iconName)}${SPIN}<span class="lbl">${label}</span></button>`;

const CREST = `<svg class="crest" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><circle cx="20" cy="20" r="18.5" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="20" cy="20" r="15" fill="none" stroke="currentColor" stroke-width=".75" stroke-dasharray="1.5 2"/><rect x="10" y="13" width="20" height="14" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.75"/><path d="M10.5 14l9.5 7 9.5-7" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/></svg>`;

// Certificate art, precomputed in Node (see geometry.js).
const G_CLASSES = ['rule', 'rule2', ...Array(12).fill('band'), 'rose', 'rose', 'rose', 'rose', 'mark'];
const GUILLOCHE = `<svg class="cert-guilloche" data-testid="cert-guilloche" viewBox="0 0 566 800" preserveAspectRatio="none" aria-hidden="true" focusable="false">${guilloche().map((d, i) => `<path class="${G_CLASSES[i]}" pathLength="1" d="${d}"/>`).join('')}</svg>`;
const RING = 'AUTHENTIC • GREETING OFFICE • ';
const SEAL = `<svg class="cert-seal" data-testid="cert-seal" role="img" aria-label="Seal of the Overkill Greeting Office" viewBox="0 0 120 140" focusable="false">`
  + '<defs><radialGradient id="seal-g" cx="32%" cy="28%" r="62%"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>'
  + '<g aria-hidden="true">'
  + '<path class="ribbon" d="M44 98l-10 38 13-7 8 10 6-37z"/><path class="ribbon" d="M76 98l10 38-13-7-8 10-6-37z"/>'
  + '<circle class="ripple" cx="60" cy="60" r="56"/>'
  + `<path class="disc" d="${sealPath(60, 60, 52, 4, 28, 224)}"/>`
  + '<circle fill="url(#seal-g)" cx="60" cy="60" r="52"/>'
  + '<circle class="inner" cx="60" cy="60" r="44"/><circle class="inner" cx="60" cy="60" r="25"/>'
  + ringGlyphs(RING, 34, 60, 60).map((g) => `<text x="${g.x}" y="${g.y}" transform="rotate(${g.rot} ${g.x} ${g.y})" dy="2.6">${g.ch === ' ' ? '' : g.ch}</text>`).join('')
  + '<text class="mono-gram" x="60" y="60" dy="9">HO</text>'
  + '</g></svg>';

const POSTMARK_BLANK = '<svg class="pm blank" id="tm-pm" data-testid="tm-postmark" viewBox="0 0 100 100" aria-hidden="true" focusable="false">'
  + '<circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" stroke-width="2.5" stroke-dasharray="4 3"/>'
  + '<circle cx="50" cy="50" r="36" fill="none" stroke="currentColor" stroke-width="1"/>'
  + '<text id="tm-pm-day" x="50" y="34">--</text><text id="tm-pm-mon" x="50" y="50">---</text><text id="tm-pm-yr" class="yr" x="50" y="70">----</text></svg>';

const RAIL_YEARS = [1900, 1920, 1946, 1970, 1990, 2000, 2020];

const field = (id, label, input, extra = '') => `<div class="field"><label for="${id}">${label}</label>${input}${extra}</div>`;

const BODY = `<div class="shell">
<div class="airmail" aria-hidden="true"></div>
<header class="letterhead">
<div class="brand-row">${CREST}<div><p class="brand">Hello Overkill</p><p class="eyebrow brand-sub">The Overkill Greeting Office</p></div></div>
<nav aria-label="Primary" class="tabs">
<a href="#/hello" data-testid="nav-hello" id="nav-hello" aria-current="page">${iconSvg('envelope')}Hello</a>
<a href="#/battle" data-testid="nav-battle" id="nav-battle">${iconSvg('duel')}Battle</a>
<a href="#/verify" data-testid="nav-verify" id="nav-verify">${iconSvg('loupe')}Verify</a>
</nav>
</header>
<div class="frame">
<main id="main">
<div class="view-head">
<p class="eyebrow" id="eyebrow">Counter 1</p>
<h1 id="title" data-testid="view-title" tabindex="-1">Hello</h1>
<p class="lede" id="lede">Pick a language and a tone. We will dispatch your greeting and stamp it.</p>
</div>

<section id="v-hello">
<div class="hello-grid">
<form id="hello-form" class="sheet slip" data-form="FORM HO-1" novalidate>
${field('name', 'Name', '<input type="text" id="name" name="name" data-testid="name-input" maxlength="40" autocomplete="given-name" spellcheck="false" aria-describedby="name-error">', '<p id="name-error" class="err" data-testid="name-error"></p>')}
${field('language', 'Language', `<select id="language" data-testid="language-select">${opts(LANGUAGES)}</select>`)}
${field('tone', 'Tone', `<select id="tone" data-testid="tone-select">${opts(TONES)}</select>`)}
<div class="check"><input type="checkbox" id="chaos" data-testid="chaos-toggle"><svg class="tick" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><label for="chaos">Chaos mode (sometimes the greeter misbehaves)</label></div>
<div class="form-actions">${btn('type="submit" id="say-hello" data-testid="say-hello"', 'envelope', 'Say hello')}</div>
</form>
<div id="result" class="envelope">
<div class="env-top" aria-hidden="true"><svg viewBox="0 0 400 40" preserveAspectRatio="none" focusable="false"><rect class="env-body" x=".5" y=".5" width="399" height="39"/><polygon class="env-flap" points="0.5,0.5 399.5,0.5 200,38"/></svg></div>
<div id="letter" class="letter blank">${iconSvg('envelope')}<div data-testid="result-empty">No greeting yet. Say hello to someone.</div></div>
</div>
</div>
</section>

<section id="v-battle" hidden>
<div id="battle-body" class="table-well"></div>
<div id="lb-body" class="lb-wrap"></div>
</section>

<section id="v-verify" hidden>
<div class="verify-grid">
<form id="verify-form" class="sheet tray" novalidate>
<div class="field"><label for="cert-input">Certificate text</label>
<textarea id="cert-input" data-testid="verify-input" spellcheck="false" aria-describedby="verify-hint verify-error"></textarea>
<p id="verify-hint" class="hint">Paste a certificate to check it.</p>
<p id="verify-error" class="err"></p></div>
<div class="form-actions">${btn('type="submit" id="verify-btn" data-testid="verify-btn"', 'loupe', 'Verify')}</div>
<div id="verify-scan" class="scan" aria-hidden="true" hidden></div>
</form>
<div id="verify-out" class="sheet verdict-pane"><div class="ghost-ring" aria-hidden="true">AWAITING SPECIMEN</div></div>
</div>
</section>

<section id="v-cert" hidden>
<div id="cert-wait" class="cert-stage"><div class="cert-skeleton" aria-hidden="true"></div><p id="cert-wait-text">Loading certificate...</p></div>
<div id="cert-msg" class="cert-stage" hidden></div>
<div id="cert-stage" class="cert-stage" hidden>
<div class="cert-sheet paper" data-testid="cert-sheet" id="cert-sheet">
${GUILLOCHE}
<div class="cert-body stagger">
${CREST.replace('class="crest"', 'class="cert-crest"')}
<p class="eyebrow">The Overkill Greeting Office</p>
<p class="eng-title" aria-hidden="true">Certificate of Hello</p>
<div class="cert-rule" aria-hidden="true"></div>
<dl class="cert-dl">
<dt>Name</dt><dd class="cert-name" id="cert-name" data-testid="cert-name"></dd>
<dt>Greeting</dt><dd class="cert-greet" id="cert-greeting" data-testid="cert-greeting"></dd>
<dt>Date</dt><dd class="cert-date" id="cert-date" data-testid="cert-date"></dd>
<dt>Signature</dt><dd class="cert-sig" id="cert-signature" data-testid="cert-signature"></dd>
</dl>
<p class="cert-serial" id="cert-serial" data-testid="cert-serial"></p>
${SEAL}
<p class="cert-foot">To check this certificate, open it on the issuing office's site and use Verify.</p>
</div>
</div>
<div class="cert-tools">
<label for="cert-text-box">Text to paste into Verify</label>
<textarea id="cert-text-box" data-testid="cert-text" readonly spellcheck="false"></textarea>
<div class="actions">
${btn('type="button" id="cert-copy" data-testid="cert-copy"', 'copy', 'Copy certificate')}
${btn('type="button" id="cert-print" data-testid="cert-print"', 'printer', 'Print certificate', 'btn secondary')}
<a href="#/verify" id="cert-verify-link" data-testid="cert-verify-link" class="btn secondary">${iconSvg('loupe')}Verify this certificate</a>
<span id="cert-copied" class="copied" aria-hidden="true" hidden>${iconSvg('check')}Copied</span>
</div>
</div>
</div>
</section>

<section id="v-weather" hidden>
<div class="two-col">
<form id="weather-form" class="sheet" novalidate>
${field('weather-place', 'Place', '<input type="text" id="weather-place" data-testid="weather-place-input" maxlength="40" autocomplete="off" aria-describedby="weather-hint weather-error">', '<p id="weather-hint" class="hint">Optional. Defaults to anywhere.</p>')}
${field('weather-date', 'Date', '<input type="date" id="weather-date" data-testid="weather-date-input" aria-describedby="weather-date-hint weather-error">', '<p id="weather-date-hint" class="hint">Optional. Yesterday, today or tomorrow (UTC).</p>')}
${field('weather-name', 'Name', '<input type="text" id="weather-name" data-testid="weather-name-input" maxlength="40" autocomplete="off" aria-describedby="weather-error">', '<p id="weather-error" class="err" data-testid="weather-error"></p>')}
<div class="form-actions">${btn('type="submit" id="weather-btn" data-testid="weather-go"', 'sun', 'Get forecast')}</div>
</form>
<div>
<div id="weather-out" class="sheet telegram">
<div class="tg-head" aria-hidden="true"><span>TELEGRAM</span><span id="wx-icon">${iconSvg('star')}</span><span>SIMULATED</span></div>
<div class="tg-body" id="weather-body"><p class="strip blank" data-testid="weather-forecast">Pick a place to see today's greeting forecast.</p></div>
</div>
<p id="weather-loading" class="loading-line" hidden></p>
</div>
</div>
</section>

<section id="v-wall" hidden>
<div class="board night">
<div class="board-head">
<p class="board-cap" aria-hidden="true">LIVE BOARD · SORTING FLOOR</p>
<span class="lamp" id="wall-lamp" data-testid="wall-lamp" data-state="connecting" aria-hidden="true"></span>
<p id="wall-status" data-testid="wall-status" tabindex="-1">Connecting...</p>
<p id="wall-count" data-testid="wall-count" class="board-count">0 hellos shown</p>
<button type="button" id="wall-pause" data-testid="wall-pause" class="btn secondary" aria-pressed="false">${iconSvg('pause')}<span class="lbl">Pause updates</span></button>
<button type="button" id="wall-retry" class="btn secondary" hidden>${iconSvg('retry')}<span class="lbl">Reconnect</span></button>
</div>
<div id="wall-empty-box"><p id="wall-empty" data-testid="wall-empty">No hellos yet. Say hello and watch it appear.</p><div class="ghost-rows" aria-hidden="true"><i></i><i></i><i></i></div></div>
<ul id="wall-list" data-testid="wall-list" class="feed" role="list" aria-label="Recent hellos"></ul>
</div>
</section>

<section id="v-sla" hidden>
<div id="sla-panel" class="control night">
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
<figure class="spark" aria-hidden="true"><svg data-testid="sla-spark" id="sla-spark" viewBox="0 0 240 56" preserveAspectRatio="none" focusable="false"><path id="spark-area" class="area" d="M0 56"/><path id="spark-line" class="lineP" d="M0 56"/></svg><figcaption id="spark-cap">Collecting samples...</figcaption></figure>
<table data-testid="sla-table">
<caption>Routes</caption>
<thead><tr><th scope="col">Route</th><th scope="col">Requests</th><th scope="col">p95</th></tr></thead>
<tbody id="sla-body"><tr><td colspan="3">Loading...</td></tr></tbody>
</table>
</div>
</section>

<section id="v-time-machine" hidden>
<div class="two-col">
<form id="tm-form" class="sheet" novalidate>
${field('tm-date', 'Date', '<input type="date" id="tm-date" data-testid="tm-date-input" min="1900-01-01" aria-describedby="tm-hint tm-error">', '<p id="tm-hint" class="hint">Any day from 1900-01-01 to today.</p>')}
${field('tm-name', 'Name', '<input type="text" id="tm-name" data-testid="tm-name-input" maxlength="40" autocomplete="off" aria-describedby="tm-name-hint tm-error">', '<p id="tm-name-hint" class="hint">Optional. Adds your streak for that day.</p><p id="tm-error" class="err" data-testid="tm-error"></p>')}
<div class="form-actions">${btn('type="submit" id="tm-btn" data-testid="tm-go"', 'clock', 'Travel')}</div>
<div class="rail" id="tm-rail" data-testid="tm-rail" data-pos="0" aria-hidden="true">${RAIL_YEARS.map((y) => `<span>${y}</span>`).join('')}<i class="marker" id="tm-marker" hidden></i></div>
</form>
<div>
<div id="tm-out" class="sheet era-card" data-era="e0">
<div class="era-head">${POSTMARK_BLANK}<p id="tm-empty">Pick a date to hear what the greeter said back then.</p></div>
<div id="tm-result" class="era-card-body"></div>
</div>
<p id="tm-loading" class="loading-line" hidden></p>
</div>
</div>
</section>

<section id="v-haiku" hidden>
<div class="two-col">
<form id="haiku-form" class="sheet" novalidate>
${field('haiku-name', 'Name', '<input type="text" id="haiku-name" data-testid="haiku-name-input" maxlength="40" autocomplete="off" aria-describedby="haiku-error">')}
${field('haiku-theme', 'Theme', '<select id="haiku-theme" data-testid="haiku-theme-select"><option value="morning">Morning</option><option value="ocean">Ocean</option><option value="city">City</option><option value="night">Night</option></select>')}
${field('haiku-syl', 'Syllables in your name', '<input type="number" id="haiku-syl" data-testid="haiku-syllables-input" min="1" max="6" step="1" inputmode="numeric" aria-describedby="haiku-syl-hint haiku-error">', '<p id="haiku-syl-hint" class="hint">Optional, 1 to 6. Use it when the automatic count is wrong.</p><p id="haiku-error" class="err" data-testid="haiku-error"></p>')}
<div class="form-actions">${btn('type="submit" id="haiku-btn" data-testid="haiku-go"', 'quill', 'Write haiku')}</div>
</form>
<div>
<div id="haiku-out" class="haiku-card" data-testid="haiku-card" data-haiku="morning">
<div class="dotrows" aria-hidden="true"><div>${'<i></i>'.repeat(5)}</div><div>${'<i></i>'.repeat(7)}</div><div>${'<i></i>'.repeat(5)}</div></div>
<p>Enter a name to compile a 5-7-5 haiku.</p>
</div>
<p id="haiku-loading" class="loading-line" hidden></p>
</div>
</div>
</section>

<section id="v-federation" hidden>
<div class="notice">${iconSvg('alert')}<p id="fed-notice" data-testid="fed-notice">Your name is sent to the listed peers. Each peer records a visit under that name.</p></div>
<p id="fed-empty" data-testid="fed-empty" hidden>No peers configured. Set HELLO_PEERS.</p>
<div class="fed-grid">
<svg class="fed-map" id="fed-map" data-testid="fed-map" viewBox="0 0 320 220" aria-hidden="true" focusable="false"><ellipse class="orbit" cx="160" cy="110" rx="110" ry="74"/><g id="fed-links"></g><circle class="hq" cx="160" cy="110" r="17"/><text class="hq-t" x="160" y="110">HQ</text><g id="fed-nodes"></g><g id="fed-dots"></g></svg>
<div>
<h2>Peer health</h2>
<div class="form-actions"><button type="button" id="fed-health-btn" data-testid="fed-health-btn" class="btn secondary">${iconSvg('network')}${SPIN}<span class="lbl">Check peers</span></button></div>
<p id="fed-health-error" class="err"></p>
<p id="fed-summary" data-testid="fed-summary"></p>
<div id="fed-peers"></div>
</div>
</div>
<h2 class="section-title">Greet the peers</h2>
<form id="fed-form" class="sheet" novalidate>
${field('fed-name', 'Name', '<input type="text" id="fed-name" data-testid="fed-name-input" maxlength="40" autocomplete="off" aria-describedby="fed-name-error">', '<p id="fed-name-error" class="err"></p>')}
<div class="form-actions">${btn('type="submit" id="fed-hello-btn" data-testid="fed-hello-btn"', 'envelope', 'Greet peers')}</div>
</form>
<p id="fed-loading" class="loading-line" hidden></p>
<div id="fed-out"></div>
</section>

<div id="status" data-testid="status" role="status" aria-live="polite" aria-atomic="true" class="sr"></div>
</main>
<div class="annex">
<div class="annex-head"><p class="annex-label" id="more-label">Other departments</p></div>
<nav aria-labelledby="more-label">
<a href="#/weather" data-testid="nav-weather" id="nav-weather" data-sub="TELEGRAM">${iconSvg('sun')}Weather</a>
<a href="#/wall" data-testid="nav-wall" id="nav-wall" data-sub="LIVE BOARD">${iconSvg('board')}Wall</a>
<a href="#/sla" data-testid="nav-sla" id="nav-sla" data-sub="CONTROL ROOM">${iconSvg('gauge')}SLA</a>
<a href="#/time-machine" data-testid="nav-time-machine" id="nav-time-machine" data-sub="POSTMARKS">${iconSvg('clock')}Time machine</a>
<a href="#/haiku" data-testid="nav-haiku" id="nav-haiku" data-sub="PRINT SHOP">${iconSvg('quill')}Haiku</a>
<a href="#/federation" data-testid="nav-federation" id="nav-federation" data-sub="SISTER OFFICES">${iconSvg('network')}Federation</a>
</nav>
</div>
</div>
<footer>
<p>Practice app. We store only your name, visit counts and dates on this server.</p>
<fieldset class="appearance"><legend>Appearance</legend><div class="seg">
<label for="theme-system"><input type="radio" name="theme" id="theme-system" value="system" data-testid="theme-system" checked>System</label>
<label for="theme-light"><input type="radio" name="theme" id="theme-light" value="light" data-testid="theme-light">Light</label>
<label for="theme-dark"><input type="radio" name="theme" id="theme-dark" value="dark" data-testid="theme-dark">Dark</label>
</div></fieldset>
</footer>
</div>`;

module.exports = { BODY, LANGUAGES, TONES };
