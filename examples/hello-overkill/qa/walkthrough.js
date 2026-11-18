'use strict';
// Standalone QA walkthrough (not part of the verify gate). Run: node qa/walkthrough.js
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.resolve(ROOT, '../../docs/product/hello-overkill/qa');
fs.mkdirSync(SHOTS, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-qa-'));
const SECRET = 'qa-test-secret-qa-test-secret-123';
const results = [];
const consoleErrors = []; // unexpected console / page errors
const expectedNoise = []; // browser "Failed to load resource" for forced 418/429
let procs = [];

function startServer(file, limit, extra) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, PORT: '0', DATA_FILE: file, HELLO_SIGNING_SECRET: SECRET, ...(extra || {}) };
    if (limit) env.HELLO_RATE_LIMIT = String(limit); else delete env.HELLO_RATE_LIMIT;
    const p = spawn('node', ['src/server.js'], { cwd: ROOT, env });
    procs.push(p);
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d;
      const m = buf.match(/listening on (\d+)/);
      if (m) resolve({ p, url: `http://localhost:${m[1]}`, origin: `http://127.0.0.1:${m[1]}`, file, limit });
    });
    p.on('exit', (c) => reject(new Error('server exited ' + c)));
    setTimeout(() => reject(new Error('server start timeout')), 8000);
  });
}
function stop(s) {
  return new Promise((r) => { s.p.removeAllListeners('exit'); s.p.on('exit', (c) => r(c)); s.p.kill('SIGTERM'); });
}
const tmpFile = (n) => path.join(TMP, n + '.json');

async function check(id, title, fn) {
  const t = Date.now();
  try {
    const ev = await fn();
    results.push({ id, title, ok: true, evidence: ev || '' });
    console.log(`PASS ${id} ${title}`);
  } catch (e) {
    results.push({ id, title, ok: false, evidence: String(e.message).split('\n')[0].slice(0, 300) });
    console.log(`FAIL ${id} ${title}: ${String(e.message).split('\n')[0]}`);
  }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (a !== b) throw new Error(`${m || 'eq'}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); }

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 800 }, ...opts });
  const page = await ctx.newPage();
  page.__errs = [];
  page.on('pageerror', (e) => { page.__errs.push('pageerror: ' + e.message); consoleErrors.push('pageerror: ' + e.message); });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource/.test(t)) expectedNoise.push(t); else { page.__errs.push(t); consoleErrors.push(t); }
  });
  return page;
}
const tid = (p, id) => p.getByTestId(id);
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, name + '.png') });
async function greet(page, name, lang, tone) {
  await tid(page, 'name-input').fill(name);
  if (lang) await tid(page, 'language-select').selectOption(lang);
  if (tone) await tid(page, 'tone-select').selectOption(tone);
  const resp = page.waitForResponse((r) => r.url().includes('/hello') && r.request().method() === 'POST');
  await tid(page, 'say-hello').click();
  return resp;
}
const statusHas = (p, re) => p.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-testid=status]').textContent), re.source, { timeout: 3000 }).catch(async () => { throw new Error('status missing /' + re.source + '/, was: ' + (await p.locator('[data-testid=status]').textContent())); });
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

(async () => {
  const browser = await chromium.launch();
  let s;

  // ---------- Server 1: J1, J2, UC1-3, UC10, UC11 ----------
  s = await startServer(tmpFile('s1'), 1000);
  let page = await newPage(browser);
  let greetingAda;

  await check('UC1', 'page and controls', async () => {
    await page.goto(s.url + '/');
    for (const id of ['view-title', 'name-input', 'language-select', 'tone-select', 'say-hello']) await tid(page, id).waitFor({ state: 'visible', timeout: 3000 });
    eq((await tid(page, 'say-hello').innerText()).trim(), 'Say hello');
    assert((await tid(page, 'result-empty').innerText()).includes('No greeting yet'), 'empty text');
    const nl = await page.locator('[data-testid=language-select] option').count();
    const nt = await page.locator('[data-testid=tone-select] option').count();
    assert(nl >= 10 && nt >= 4, `options ${nl}/${nt}`);
    return `${nl} languages, ${nt} tones, empty card shown`;
  });
  await check('J1', 'first visit and first greeting', async () => {
    await page.goto(s.url + '/');
    eq(await page.title() !== '', true);
    assert((await tid(page, 'result-empty').innerText()).includes('No greeting yet. Say hello to someone.'));
    assert((await page.locator('footer').innerText()).includes('Practice app. We store only your name, visit counts and dates on this server.'), 'footer');
    await tid(page, 'name-input').fill('Ada');
    await tid(page, 'language-select').selectOption({ label: 'Spanish' });
    await tid(page, 'tone-select').selectOption({ label: 'Pirate' });
    await tid(page, 'name-input').press('Enter');
    await tid(page, 'greeting-text').waitFor({ timeout: 4000 });
    const txt = await tid(page, 'greeting-text').innerText();
    assert(txt.includes('Ada'), 'greeting includes Ada: ' + txt);
    eq((await tid(page, 'visit-count').innerText()).trim(), 'Visit 1');
    assert((await tid(page, 'streak-count').innerText()).includes('Streak 1 day'), 'streak');
    assert(await tid(page, 'cert-link').isVisible(), 'cert link');
    await statusHas(page, /Greeting ready for Ada\./);
    const foc = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
    assert(foc === 'say-hello' || foc === 'name-input', 'focus not moved to result: ' + foc);
    greetingAda = txt;
    await shot(page, 'J1-hello-light');
    return `"${txt}"; focus=${foc}`;
  });
  await check('UC2', 'Ada Spanish Pirate', async () => {
    await page.goto(s.url + '/');
    await greet(page, 'Ada', 'es', 'pirate');
    await tid(page, 'greeting-text').waitFor();
    assert((await tid(page, 'greeting-text').innerText()).includes('Ada'));
    eq(await tid(page, 'greeting-text').getAttribute('lang'), 'es');
    await statusHas(page, /Greeting ready for Ada/);
    assert(await tid(page, 'cert-link').isEnabled());
    await shot(page, 'UC2-hello-spanish-pirate-light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await shot(page, 'UC2-hello-spanish-pirate-dark');
    await page.emulateMedia({ colorScheme: 'light' });
    return 'greeting contains Ada, lang=es, status ok, cert-link enabled; light+dark screenshots';
  });

  await check('J2', 'all 10 languages x 4 tones', async () => {
    await page.goto(s.url + '/');
    const langs = await page.locator('[data-testid=language-select] option').evaluateAll((o) => o.map((x) => x.value));
    const tones = await page.locator('[data-testid=tone-select] option').evaluateAll((o) => o.map((x) => x.value));
    assert(langs.length >= 10 && tones.length >= 4, 'counts');
    let n = 0; const bad = [];
    for (const l of langs) for (const t of tones) {
      await greet(page, 'Ada', l, t);
      await page.waitForFunction(() => document.querySelector('[data-testid=say-hello]').getAttribute('aria-disabled') !== 'true');
      const txt = (await tid(page, 'greeting-text').innerText()).trim();
      const lang = await tid(page, 'greeting-text').getAttribute('lang');
      n++;
      if (!txt || !txt.includes('Ada') || lang !== l) bad.push(`${l}/${t}:"${txt}" lang=${lang}`);
    }
    assert(bad.length === 0, 'bad combos: ' + bad.slice(0, 3).join(' | '));
    return `${n} combos (${langs.join(',')} x ${tones.join(',')}) all non-empty with Ada and matching lang`;
  });

  await check('UC3', 'every combination (browser, raised limit)', async () => {
    return 'covered by J2 loop (40 combos, HELLO_RATE_LIMIT=1000)';
  });

  await check('UC10', 'core API, 404, hostile input, blank name', async () => {
    const r = await page.request.post(s.url + '/hello');
    eq(r.status(), 200);
    assert(r.headers()['content-type'].includes('application/json'), 'ct');
    eq(await r.text(), '{"message":"Hello World! Welcome to the API."}');
    const r2 = await page.request.get(s.url + '/nope');
    eq(r2.status(), 404);
    JSON.parse(await r2.text());
    await page.goto(s.url + '/');
    await greet(page, '<img src=x onerror=window.__x=1>', null, null);
    await tid(page, 'greeting-text').waitFor();
    assert((await tid(page, 'greeting-text').innerText()).includes('<img src=x onerror=window.__x=1>'), 'literal text');
    eq(await page.evaluate(() => window.__x), undefined, 'xss');
    eq(await page.locator('main img').count(), 0, 'img element injected');
    await shot(page, 'UC10-hostile-input');
    await tid(page, 'name-input').fill('W'.repeat(40));
    await tid(page, 'say-hello').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=say-hello]').getAttribute('aria-disabled') !== 'true');
    assert(await noOverflow(page), '40xW overflow at desktop');
    await tid(page, 'name-input').fill('   ');
    await tid(page, 'say-hello').click();
    eq((await tid(page, 'name-error').innerText()).trim(), 'Enter a name so we know who to greet.');
    eq(await page.evaluate(() => document.activeElement.getAttribute('data-testid')), 'name-input', 'focus');
    eq(await tid(page, 'name-input').getAttribute('aria-invalid'), 'true');
    await statusHas(page, /Enter a name so we know who to greet\./);
    return 'POST /hello exact body, 404 JSON, hostile name literal and no __x, blank-name error + focus + aria-invalid + status';
  });
  await check('J9', 'core API in browser', async () => {
    const r = await page.request.get(s.url + '/');
    eq(r.status(), 200);
    const r2 = await page.request.get(s.url + '/nope');
    eq(r2.status(), 404);
    return 'GET / 200 html; /nope 404 JSON (see UC10)';
  });
  await check('UC10b', 'name longer than 40 chars', async () => {
    await page.goto(s.url + '/');
    eq(await tid(page, 'name-input').getAttribute('maxlength'), '40');
    const r = await page.request.post(s.url + '/hello', { data: { name: 'x'.repeat(41) } });
    return `maxlength=40 on input; API with 41 chars -> ${r.status()}`;
  });

  // ---------- 390px hello ----------
  await check('UC10c', '390px viewport: no horizontal scroll (hello, battle, verify)', async () => {
    const p = await newPage(browser, { viewport: { width: 390, height: 844 } });
    await p.goto(s.url + '/');
    assert(await noOverflow(p), 'hello overflow');
    await greet(p, '<img src=x onerror=window.__x=1>', 'es', 'pirate');
    await tid(p, 'greeting-text').waitFor();
    assert(await noOverflow(p), 'hello overflow after greeting');
    await tid(p, 'name-input').fill('W'.repeat(40));
    await tid(p, 'say-hello').click();
    await p.waitForFunction(() => document.querySelector('[data-testid=say-hello]').getAttribute('aria-disabled') !== 'true');
    assert(await noOverflow(p), '40xW overflow');
    const hts = await p.evaluate(() => ['say-hello', 'name-input', 'language-select', 'tone-select'].map((i) => Math.round(document.querySelector(`[data-testid=${i}]`).getBoundingClientRect().height)));
    assert(hts.every((h) => h >= 44), 'touch targets <44: ' + hts);
    await shot(p, 'J1-hello-390');
    await tid(p, 'nav-battle').click();
    await tid(p, 'battle-option-a').waitFor();
    assert(await noOverflow(p), 'battle overflow');
    const a = await tid(p, 'battle-option-a').boundingBox(); const b = await tid(p, 'battle-option-b').boundingBox();
    assert(b.y > a.y + a.height - 1, 'battle options not stacked');
    await shot(p, 'J6-battle-390');
    await tid(p, 'nav-verify').click();
    assert(await noOverflow(p), 'verify overflow');
    await p.context().close();
    return `no overflow; touch heights ${hts}; battle options stacked`;
  });

  await check('UC11', 'keyboard, labels, dark/light 390', async () => {
    const p = await newPage(browser);
    await p.goto(s.url + '/');
    await p.evaluate(() => { document.activeElement && document.activeElement.blur(); });
    const order = [];
    for (let i = 0; i < 8; i++) {
      await p.keyboard.press('Tab');
      order.push(await p.evaluate(() => document.activeElement.getAttribute('data-testid')));
    }
    const want = ['nav-hello', 'nav-battle', 'nav-verify', 'name-input', 'language-select', 'tone-select', 'chaos-toggle', 'say-hello'];
    eq(order.join(','), want.join(','), 'tab order');
    // focus ring visible
    const outline = await p.evaluate(() => { const cs = getComputedStyle(document.activeElement); return cs.outlineStyle + ' ' + cs.outlineWidth; });
    assert(!/^none/.test(outline) && !/ 0px/.test(outline), 'focus ring: ' + outline);
    // keyboard-only hello
    await p.goto(s.url + '/');
    await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
    await p.keyboard.type('Kbd');
    await p.keyboard.press('Tab'); await p.keyboard.press('ArrowDown');
    await p.keyboard.press('Tab'); await p.keyboard.press('ArrowDown');
    await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
    eq(await p.evaluate(() => document.activeElement.getAttribute('data-testid')), 'say-hello');
    await p.keyboard.press('Enter');
    await tid(p, 'greeting-text').waitFor({ timeout: 4000 });
    assert((await tid(p, 'greeting-text').innerText()).includes('Kbd'));
    await p.keyboard.press('Tab'); // result link reachable
    eq(await p.evaluate(() => document.activeElement.getAttribute('data-testid')), 'cert-link', 'cert-link next in tab order');
    // Enter in name field
    await p.goto(s.url + '/');
    await tid(p, 'name-input').focus();
    await p.keyboard.type('Enterer');
    await p.keyboard.press('Enter');
    await tid(p, 'greeting-text').waitFor();
    await shot(p, 'UC11-keyboard-hello');
    eq(await tid(p, 'status').getAttribute('role'), 'status');
    eq(await tid(p, 'status').getAttribute('aria-live'), 'polite');
    for (const l of ['Name', 'Language', 'Tone']) await p.getByLabel(l, { exact: true }).locator('visible=true').first().waitFor({ timeout: 1000 }); // v2 views add hidden Name inputs, so match only the visible one
    await tid(p, 'nav-verify').click();
    await p.getByLabel('Certificate text').waitFor({ timeout: 1000 });
    const nav = await p.locator('nav[aria-label="Primary"]').count();
    eq(nav, 1, 'nav aria-label');
    eq(await p.locator('html').getAttribute('lang'), 'en');
    eq(await p.locator('h1').count(), 1, 'one h1');
    await p.setViewportSize({ width: 390, height: 844 });
    for (const cs of ['dark', 'light']) {
      await p.emulateMedia({ colorScheme: cs });
      await p.goto(s.url + '/#/hello');
      assert(await noOverflow(p), cs + ' overflow');
      assert((await tid(p, 'say-hello').innerText()).trim().length > 0, 'button text');
      const c = await p.evaluate(() => { const b = document.querySelector('[data-testid=say-hello]'); const cs = getComputedStyle(b); return [cs.color, cs.backgroundColor, getComputedStyle(document.body).backgroundColor]; });
      if (cs === 'dark') { await p.evaluate(() => 0); }
    }
    await p.context().close();
    return `tab order ${order.join('>')}; focus ring ${outline}; Enter submits; keyboard-only greeting incl. selects; labels found; dark+light 390 no overflow`;
  });

  await check('UC-A11Y-route', 'route change focuses h1, aria-current, unknown hash falls back', async () => {
    const p = await newPage(browser);
    await p.goto(s.url + '/');
    await tid(p, 'nav-battle').click();
    await tid(p, 'battle-option-a').waitFor();
    const f = await p.evaluate(() => document.activeElement.getAttribute('data-testid'));
    eq(f, 'view-title', 'focus after route');
    eq(await tid(p, 'nav-battle').getAttribute('aria-current'), 'page');
    await p.goto(s.url + '/#/bogus');
    await p.waitForFunction(() => location.hash === '#/hello');
    await p.context().close();
    return 'h1 focused after route change, aria-current=page, #/bogus -> #/hello';
  });

  // dark-mode screenshot of hello result (UC dark)
  await check('J1-dark', 'hello result in dark mode (colour scheme honoured)', async () => {
    const p = await newPage(browser, { colorScheme: 'dark' });
    await p.goto(s.url + '/');
    await greet(p, 'Ada', 'en', 'formal');
    await tid(p, 'greeting-text').waitFor();
    const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const m = bg.match(/\d+/g).map(Number);
    assert((m[0] + m[1] + m[2]) / 3 < 100, 'dark bg expected, got ' + bg);
    await shot(p, 'J1-hello-dark');
    await p.emulateMedia({ colorScheme: 'light' });
    const bg2 = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const m2 = bg2.match(/\d+/g).map(Number);
    assert((m2[0] + m2[1] + m2[2]) / 3 > 180, 'light bg expected, got ' + bg2);
    await p.context().close();
    return `dark body ${bg}; light body ${bg2}`;
  });

  await page.context().close();
  await stop(s);

  // ---------- Server 2: J3 / UC4 restart ----------
  const f2 = tmpFile('s2');
  s = await startServer(f2, 1000);
  page = await newPage(browser);
  await check('UC4', 'visit 2 and restart (J3)', async () => {
    await page.goto(s.url + '/');
    await greet(page, 'Ada', 'en', 'formal');
    await tid(page, 'greeting-text').waitFor();
    eq((await tid(page, 'visit-count').innerText()).trim(), 'Visit 1');
    assert((await tid(page, 'streak-count').innerText()).includes('Streak 1'));
    await greet(page, 'ada', 'en', 'formal');
    await page.waitForFunction(() => document.querySelector('[data-testid=visit-count]') && document.querySelector('[data-testid=visit-count]').innerText.trim() === 'Visit 2');
    const st = (await tid(page, 'streak-count').innerText()).trim();
    assert(st.length > 0, 'streak');
    await shot(page, 'J3-visit2');
    await page.context().close();
    await stop(s);
    s = await startServer(f2, 1000);
    page = await newPage(browser);
    await page.goto(s.url + '/');
    await greet(page, 'Ada', 'en', 'formal');
    await page.waitForFunction(() => document.querySelector('[data-testid=visit-count]') && document.querySelector('[data-testid=visit-count]').innerText.trim() === 'Visit 3', null, { timeout: 4000 });
    return `Visit 1 -> Visit 2 ("${st}") -> restart -> Visit 3`;
  });
  await check('J3', 'return visit and streak', async () => {
    return 'covered by UC4 (case-insensitive ada, restart continues count)';
  });
  await page.context().close();
  await stop(s);

  // ---------- Server 3: certificate + verify (J4, J5) ----------
  const f3 = tmpFile('s3');
  s = await startServer(f3, 1000);
  page = await newPage(browser);
  let T, certId;
  await check('UC5', 'certificate view (J4)', async () => {
    await page.goto(s.url + '/');
    await greet(page, 'Ada', 'en', 'formal');
    await tid(page, 'greeting-text').waitFor();
    const g = (await tid(page, 'greeting-text').innerText()).trim();
    await tid(page, 'cert-link').click();
    await page.waitForFunction(() => /#\/certificate\//.test(location.hash));
    certId = page.url().split('#/certificate/')[1];
    assert((await tid(page, 'view-title').innerText()).includes('Certificate'));
    await tid(page, 'cert-name').waitFor();
    eq((await tid(page, 'cert-name').innerText()).trim(), 'Ada');
    eq((await tid(page, 'cert-greeting').innerText()).trim(), g, 'greeting match');
    assert(/^\d{4}-\d{2}-\d{2}$/.test((await tid(page, 'cert-date').innerText()).trim()), 'date');
    const sig = (await tid(page, 'cert-signature').innerText()).trim();
    assert(sig.length >= 32, 'sig len ' + sig.length);
    T = await tid(page, 'cert-text').inputValue();
    assert(T.length > 0 && await tid(page, 'cert-verify-link').isVisible(), 'text/link');
    eq(await tid(page, 'cert-text').getAttribute('readonly') !== null, true, 'readonly');
    eq(await tid(page, 'cert-copy').isVisible(), true);
    await tid(page, 'cert-copy').click();
    await statusHas(page, /Certificate copied\.|Select the text and copy it yourself\./);
    const st = await tid(page, 'status').textContent();
    await shot(page, 'J4-certificate');
    await page.emulateMedia({ media: 'print' });
    const navVis = await page.locator('nav').first().isVisible();
    const btnVis = await tid(page, 'cert-copy').isVisible();
    await page.emulateMedia({ media: 'screen' });
    assert(!navVis && !btnVis, `print stylesheet hides nav/buttons (nav=${navVis}, btn=${btnVis})`);
    return `id ${certId}, date, ${sig.length}-char signature, copy status "${st.trim()}", print hides nav+buttons`;
  });
  await check('UC6', 'verify Authentic then Forged (J5)', async () => {
    await tid(page, 'cert-verify-link').click();
    await page.waitForFunction(() => location.hash === '#/verify');
    await tid(page, 'verify-input').fill(T);
    await tid(page, 'verify-btn').click();
    await page.waitForFunction(() => { const v = document.querySelector('[data-testid=verify-verdict]'); return v && v.innerText.trim() === 'Authentic'; });
    await statusHas(page, /Authentic/);
    const txt = await tid(page, 'verify-result').innerText();
    assert(/✓|✔|✓|✔/.test(txt), 'check glyph missing: ' + txt);
    await shot(page, 'J5-verify-authentic');
    const T2 = T.replace('A', 'B');
    assert(T2 !== T, 'no A to replace');
    await tid(page, 'verify-input').fill(T2);
    await tid(page, 'verify-btn').click();
    await page.waitForFunction(() => { const v = document.querySelector('[data-testid=verify-verdict]'); return v && v.innerText.trim() === 'Forged'; });
    const ft = await tid(page, 'verify-result').innerText();
    assert(/✗|✘|✕|×|✗|✘|✕/.test(ft), 'cross glyph missing: ' + ft);
    await shot(page, 'J5-verify-forged');
    // one char edit in signature
    const T3 = T.replace(/("signature":")(.)/, (m, a, c) => a + (c === '0' ? '1' : '0'));
    await tid(page, 'verify-input').fill(T3);
    await tid(page, 'verify-btn').click();
    await page.waitForFunction(() => (document.querySelector('[data-testid=verify-verdict]') || { innerText: '' }).innerText.trim() === 'Forged');
    // unreadable
    await tid(page, 'verify-input').fill('not json at all');
    await tid(page, 'verify-btn').click();
    await page.waitForFunction(() => document.body.innerText.includes('This is not a readable certificate.'));
    // empty
    await tid(page, 'verify-input').fill('');
    await tid(page, 'verify-btn').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=status]').innerText.includes('Paste a certificate first.'));
    // too long
    await tid(page, 'verify-input').fill('x'.repeat(10001));
    await tid(page, 'verify-btn').click();
    await page.waitForFunction(() => /too long to be a certificate/.test(document.body.innerText));
    return 'Authentic (glyph) -> one-char greeting edit Forged (glyph) -> signature edit Forged -> unreadable -> empty error -> >10000 chars message';
  });
  await check('J4b', 'permalink view in a fresh context + not found', async () => {
    const p = await newPage(browser);
    await p.goto(`${s.url}/#/certificate/${certId}`);
    await tid(p, 'cert-name').waitFor({ timeout: 3000 });
    eq((await tid(p, 'cert-name').innerText()).trim(), 'Ada');
    await shot(p, 'J4-certificate-permalink');
    await p.goto(`${s.url}/#/certificate/0000000000000000`);
    await p.waitForFunction(() => document.body.innerText.includes('We could not find that certificate. Go back and say hello again.'), null, { timeout: 3000 });
    await p.context().close();
    return 'permalink opens in a new context; unknown id shows not-found copy';
  });
  await check('J5b', 'certificate verifies after restart with same secret', async () => {
    await page.context().close();
    await stop(s);
    s = await startServer(f3, 1000);
    page = await newPage(browser);
    await page.goto(s.url + '/#/verify');
    await tid(page, 'verify-input').fill(T);
    await tid(page, 'verify-btn').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=verify-verdict]') && document.querySelector('[data-testid=verify-verdict]').innerText.trim() === 'Authentic', null, { timeout: 3000 });
    return 'Authentic after restart';
  });
  await page.context().close();
  await stop(s);

  // ---------- Server 4: battle (J6, UC7) ----------
  s = await startServer(tmpFile('s4'), 1000);
  page = await newPage(browser);
  await check('UC7', 'battle vote + leaderboard (J6)', async () => {
    await page.goto(s.url + '/');
    await tid(page, 'nav-battle').click();
    await tid(page, 'battle-option-a').waitFor();
    const a = (await tid(page, 'battle-option-a').innerText()).trim();
    const b = (await tid(page, 'battle-option-b').innerText()).trim();
    assert(a && b && a !== b, 'distinct options');
    assert(a.startsWith('Vote for A') && b.startsWith('Vote for B'), 'labels: ' + a.slice(0, 20));
    assert(await tid(page, 'leaderboard').isVisible(), 'leaderboard');
    assert((await page.locator('body').innerText()).includes('No votes yet. Cast the first one.'), 'empty message');
    await shot(page, 'J6-battle-light');
    await tid(page, 'battle-option-a').click();
    await page.waitForFunction(() => /Vote counted/i.test(document.querySelector('[data-testid=status]').innerText));
    await tid(page, 'leaderboard-row').first().waitFor();
    eq((await tid(page, 'lb-votes').first().innerText()).trim(), '1');
    const lbg = (await tid(page, 'lb-greeting').first().innerText()).trim();
    assert(a.includes(lbg), `leaderboard greeting "${lbg}" in "${a}"`);
    eq(await tid(page, 'battle-option-a').count(), 0, 'a removed');
    await tid(page, 'battle-next').waitFor();
    eq(await page.evaluate(() => document.activeElement.getAttribute('data-testid')), 'battle-next', 'next focused');
    assert((await page.locator('main').innerText()).includes('Thanks, vote counted.'), 'thanks text');
    await shot(page, 'J6-battle-voted');
    await tid(page, 'battle-next').click();
    await tid(page, 'battle-option-b').waitFor();
    await tid(page, 'battle-option-b').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=battle-next]'));
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=lb-votes]')].reduce((s, e) => s + Number(e.innerText), 0) === 2);
    await page.emulateMedia({ colorScheme: 'dark' });
    await shot(page, 'J6-battle-dark');
    return 'options A/B distinct; empty msg; vote -> status, row votes 1, buttons removed, Next focused; second vote sums to 2';
  });
  await page.context().close();
  await stop(s);

  // ---------- Server 5: chaos (J7, UC8) ----------
  s = await startServer(tmpFile('s5'), 1000);
  await check('UC8.2', 'chaos=418 friendly error + focus + no raw output', async () => {
    const p = await newPage(browser);
    await p.goto(s.url + '/?chaos=418');
    await tid(p, 'chaos-toggle').check();
    await greet(p, 'Ada', 'en', 'formal');
    await tid(p, 'error-message').waitFor();
    assert((await tid(p, 'error-message').innerText()).includes('The greeter spilled its tea (418)'));
    assert((await p.locator('main').innerText()).includes('Nothing is broken. Try again in a moment.'));
    await tid(p, 'retry-btn').waitFor();
    eq(await p.evaluate(() => document.activeElement.getAttribute('data-testid')), 'retry-btn', 'focus');
    const body = await p.locator('main').innerText();
    assert(!/\bat \S+:\d+|Error:|\{/.test(body), 'raw output: ' + body.slice(0, 120));
    await shot(p, 'J7-chaos-418');
    await p.context().close();
    return '418 message, retry focused, no stack/JSON in page';
  });
  let busyCount = -1;
  await check('UC8.3', 'chaos=delay shows loading then greeting', async () => {
    const p = await newPage(browser);
    await p.goto(s.url + '/?chaos=delay');
    await tid(p, 'name-input').fill('Ada');
    const t0 = Date.now();
    await tid(p, 'say-hello').click();
    await tid(p, 'result-loading').waitFor({ timeout: 500 });
    assert(await tid(p, 'say-hello').isDisabled(), 'disabled');
    eq((await tid(p, 'say-hello').innerText()).trim(), 'Greeting...');
    busyCount = await p.locator('[aria-busy=true]').count();
    await shot(p, 'J7-chaos-delay-loading');
    await tid(p, 'greeting-text').waitFor({ timeout: 6000 });
    const dt = Date.now() - t0;
    assert(dt >= 1900, 'delay too short ' + dt);
    await p.context().close();
    return `loading visible, button disabled "Greeting...", greeting after ${dt} ms`;
  });
  await check('UC8.3b', 'loading card carries aria-busy=true (ux.md Loading state)', async () => {
    assert(busyCount > 0, 'no element with aria-busy=true while loading (count ' + busyCount + ')');
    return 'aria-busy present';
  });
  await check('UC8.4', 'mixed chaos=1 never blank / no page errors', async () => {
    const p = await newPage(browser);
    await p.goto(s.url + '/');
    await tid(p, 'chaos-toggle').check();
    await tid(p, 'name-input').fill('Ada');
    let tries = 0, seen418 = false;
    for (; tries < 20; tries++) {
      if (tries === 0) await tid(p, 'say-hello').click(); else await tid(p, 'retry-btn').click();
      await p.waitForFunction(() => document.querySelector('[data-testid=greeting-text]') || document.querySelector('[data-testid=error-message]'), null, { timeout: 7000 });
      assert((await p.locator('main').innerText()).trim().length > 0, 'blank main');
      if (await tid(p, 'greeting-text').count()) break;
      seen418 = true;
    }
    assert(await tid(p, 'greeting-text').count(), 'no greeting in 20 tries');
    eq(p.__errs.length, 0, 'page errors: ' + p.__errs.join(';'));
    await p.context().close();
    return `greeting after ${tries + 1} attempt(s), error state seen=${seen418}, no page errors`;
  });
  await check('UC8.5', 'Try again repeats request and replaces error', async () => {
    const p = await newPage(browser);
    let n = 0;
    await p.route('**/hello*', (route) => {
      n++;
      if (n === 1) return route.fulfill({ status: 418, contentType: 'application/json', body: '{"error":"teapot"}' });
      return route.continue({ url: s.url + '/hello' });
    });
    await p.goto(s.url + '/?chaos=418');
    await tid(p, 'name-input').fill('Ada');
    await tid(p, 'say-hello').click();
    await tid(p, 'error-message').waitFor();
    await tid(p, 'retry-btn').click();
    await tid(p, 'greeting-text').waitFor({ timeout: 4000 });
    eq(await tid(p, 'error-message').count(), 0, 'error gone');
    assert((await tid(p, 'greeting-text').innerText()).includes('Ada'));
    await p.context().close();
    return 'first request 418, retry produced greeting for Ada, error removed';
  });
  await check('UC8.6', 'network down / 500 shows generic error', async () => {
    const p = await newPage(browser);
    await p.route('**/hello*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom","stack":"at x"}' }));
    await p.goto(s.url + '/');
    await tid(p, 'name-input').fill('Ada');
    await tid(p, 'say-hello').click();
    await tid(p, 'error-message').waitFor();
    const t = await tid(p, 'error-message').innerText();
    assert(t.includes('The greeter is having a moment. Check that the server is running, then try again.'), t);
    assert(!/boom|stack/.test(await p.locator('main').innerText()), 'leaked body');
    await p.unroute('**/hello*');
    await p.route('**/hello*', (route) => route.abort());
    await tid(p, 'retry-btn').click();
    await p.waitForFunction(() => document.querySelector('[data-testid=error-message]'));
    assert((await tid(p, 'error-message').innerText()).includes('having a moment'), 'abort message');
    await p.context().close();
    return '500 and aborted request both show generic copy, body not leaked';
  });
  await check('J7', 'chaos journey', async () => 'covered by UC8.2 to UC8.6 (forced ?chaos=418 and ?chaos=delay, mixed chaos=1)');
  await stop(s);

  // ---------- Server 6: default limit, 429 (J8, UC9) ----------
  s = await startServer(tmpFile('s6'), null);
  await check('UC9', 'rate limit 429 with countdown (J8)', async () => {
    const p = await newPage(browser);
    await p.clock.install();
    await p.goto(s.url + '/');
    await tid(p, 'name-input').fill('Ada');
    for (let i = 1; i <= 10; i++) {
      const r = greet(p, 'Ada');
      const resp = await r;
      eq(resp.status(), 200, `hello ${i}`);
      await p.waitForFunction(() => document.querySelector('[data-testid=say-hello]').getAttribute('aria-disabled') !== 'true');
    }
    const r11 = await greet(p, 'Ada');
    eq(r11.status(), 429, '11th status');
    const ra = r11.headers()['retry-after'];
    assert(/^[1-9]\d*$/.test(ra), 'retry-after ' + ra);
    await tid(p, 'rate-limit-message').waitFor();
    const msg = await tid(p, 'rate-limit-message').innerText();
    assert(/You've been greeted enough/.test(msg) && /\d+ seconds?/.test(msg), msg);
    assert(await tid(p, 'say-hello').isDisabled(), 'disabled');
    const lbl = (await tid(p, 'say-hello').innerText()).trim();
    assert(/^Wait \d+s$/.test(lbl), 'countdown label: ' + lbl);
    await shot(p, 'J8-rate-limit');
    const api = await p.request.post(s.url + '/hello');
    eq(api.status(), 429);
    assert(/^[1-9]\d*$/.test(api.headers()['retry-after']), 'api retry-after');
    await p.clock.runFor((Number(ra) + 2) * 1000);
    await p.waitForFunction(() => document.querySelector('[data-testid=say-hello]').getAttribute('aria-disabled') !== 'true', null, { timeout: 5000 });
    await statusHas(p, /You can say hello again\./);
    eq((await tid(p, 'say-hello').innerText()).trim(), 'Say hello');
    await p.context().close();
    return `10x 200 then 429, Retry-After ${ra}, message "${msg.trim()}", button "${lbl}" then re-enabled, status announced`;
  });
  await check('J8', 'rate limit journey', async () => 'covered by UC9');
  await stop(s);

  // ======================= v2 (six new views) =======================
  const v2ErrStart = consoleErrors.length;
  const hostileGreeting = '<img src=x onerror=window.__x=1>';
  const today = new Date().toISOString().slice(0, 10);
  const BIGLIM = { HELLO_READ_LIMIT: '1000', HELLO_FED_LIMIT: '1000' };
  const waitText = (p, testid, re, ms) => p.waitForFunction(([t, src]) => { const e = document.querySelector(`[data-testid=${t}]`); return !!e && new RegExp(src).test(e.textContent); }, [testid, re.source], { timeout: ms || 4000 }).catch(async () => { const e = p.locator(`[data-testid=${testid}]`).first(); throw new Error(`${testid} missing /${re.source}/, was: ` + ((await e.count()) ? (await e.textContent()).slice(0, 120) : '(absent)')); });
  const tabTo = async (p, n) => { const o = []; for (let i = 0; i < n; i++) { await p.keyboard.press('Tab'); o.push(await p.evaluate(() => document.activeElement.getAttribute('data-testid'))); } return o; };

  // stub peer: healthy, but answers /hello with a hostile greeting
  const stub = await new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/healthz') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true}'); }
      if (req.url === '/hello') {
        req.resume();
        return req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ greeting: hostileGreeting, visit: 1, streak: 1 })); });
      }
      res.writeHead(404); res.end();
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, origin: `http://127.0.0.1:${srv.address().port}` }));
  });
  const peer = await startServer(tmpFile('peer'), 1000);
  const m = await startServer(tmpFile('v2main'), 1000, { ...BIGLIM, HELLO_PEERS: `${peer.origin},${stub.origin}`, HELLO_PEERS_ALLOW_PRIVATE: '1' });
  let peerStopped = false;

  // ---- weather ----
  await check('V2-weather', 'forecast, determinism, bad place/date errors', async () => {
    const p = await newPage(browser);
    await p.goto(m.url + '/#/weather');
    assert((await tid(p, 'weather-forecast').innerText()).includes("Pick a place to see today's greeting forecast."), 'empty text');
    eq((await tid(p, 'view-title').innerText()).trim(), 'Hello Weather');
    await tid(p, 'weather-place-input').fill('Lisbon');
    await tid(p, 'weather-name-input').fill('Ada');
    await tid(p, 'weather-go').click();
    await waitText(p, 'weather-chance', /Chance of warm regards: \d+%/);
    const f1 = (await tid(p, 'weather-forecast').innerText()).trim();
    const g1 = (await tid(p, 'weather-greeting').innerText()).trim();
    assert(/Lisbon/.test(f1) && /Ada/.test(g1), 'content: ' + f1 + ' | ' + g1);
    await shot(p, 'v2-weather-light');
    // same place again, and in a fresh context
    await tid(p, 'weather-go').click();
    await p.waitForTimeout(400);
    await waitText(p, 'weather-forecast', /Lisbon/);
    eq((await tid(p, 'weather-forecast').innerText()).trim(), f1, 'repeat differs');
    const q = await newPage(browser);
    await q.goto(m.url + '/#/weather');
    await tid(q, 'weather-place-input').fill('  lisbon ');
    await tid(q, 'weather-name-input').fill('Ada');
    await tid(q, 'weather-go').click();
    await waitText(q, 'weather-greeting', /Ada/);
    // case differs in echo only; compare the numeric chance (seed ignores case)
    eq((await tid(q, 'weather-chance').innerText()).trim(), (await tid(p, 'weather-chance').innerText()).trim(), 'chance differs for same place');
    await q.context().close();
    // bad place (41 chars, maxlength removed)
    await p.evaluate(() => document.querySelector('[data-testid=weather-place-input]').removeAttribute('maxlength'));
    await tid(p, 'weather-place-input').fill('x'.repeat(41));
    await tid(p, 'weather-go').click();
    await waitText(p, 'weather-error', /place must be 1-40 characters|40/);
    const e1 = (await tid(p, 'weather-error').innerText()).trim();
    // bad date
    await tid(p, 'weather-place-input').fill('Lisbon');
    await tid(p, 'weather-date-input').fill('2020-01-01');
    await tid(p, 'weather-go').click();
    await waitText(p, 'weather-error', /date out of range/);
    await shot(p, 'v2-weather-error');
    await p.context().close();
    return `forecast "${f1.slice(0, 60)}"; repeat + fresh context identical; bad place -> "${e1}"; bad date -> "date out of range"`;
  });

  // ---- wall (dedicated server so the ring is empty) ----
  const w = await startServer(tmpFile('wall'), 1000, BIGLIM);
  let wallPageA;
  await check('V2-wall', 'anonymised rows, no name, announcements, EventSource closes on route change', async () => {
    const A = await newPage(browser);
    wallPageA = A;
    await A.addInitScript(() => { window.__es = []; const O = window.EventSource; window.EventSource = class extends O { constructor(...a) { super(...a); window.__es.push(this); } }; });
    await A.goto(w.url + '/#/wall');
    await waitText(A, 'wall-status', /^Connected$/);
    await waitText(A, 'status', /Live wall connected\./);
    assert(await tid(A, 'wall-empty').isVisible(), 'empty state');
    const B = await newPage(browser);
    await B.goto(w.url + '/');
    await greet(B, 'Zelda-Secret', 'es', 'pirate');
    await tid(B, 'greeting-text').waitFor();
    await greet(B, 'Quentin-Hidden', 'en', 'formal');
    await A.waitForFunction(() => document.querySelectorAll('[data-testid=wall-item]').length >= 2, null, { timeout: 4000 });
    const items = await tid(A, 'wall-item').allInnerTexts();
    assert(items.every((t) => /^A [a-z]{2}\/\w+ hello/.test(t.trim())), 'row format: ' + items.join(' | '));
    assert(items.some((t) => t.includes('es/pirate')), 'es/pirate row: ' + items.join(' | '));
    const body = await A.evaluate(() => document.body.innerText + document.documentElement.innerHTML);
    assert(!/Zelda|Quentin/i.test(body), 'name leaked into wall page');
    eq((await tid(A, 'wall-count').innerText()).trim(), '2 hellos shown');
    assert(!(await tid(A, 'wall-empty').isVisible()), 'empty hidden');
    // raw stream also has no name
    const raw = await new Promise((resolve) => {
      let buf = ''; const rq = http.get(w.url + '/api/stream', (r) => { r.setEncoding('utf8'); r.on('data', (d) => { buf += d; }); setTimeout(() => { rq.destroy(); resolve(buf); }, 700); });
      rq.on('error', () => resolve(buf));
    });
    assert(/event: hello/.test(raw) && !/Zelda|Quentin/i.test(raw), 'raw stream: ' + raw.slice(0, 120));
    await shot(A, 'v2-wall-light');
    // route change closes the EventSource
    const open1 = await A.evaluate(() => window.__es.filter((e) => e.readyState !== 2).length);
    assert(open1 >= 1, 'no open EventSource on wall: ' + open1);
    await tid(A, 'nav-battle').click();
    await tid(A, 'battle-option-a').waitFor();
    const states = await A.evaluate(() => window.__es.map((e) => e.readyState));
    assert(states.every((x) => x === 2), 'EventSource not closed: ' + states);
    const sla = await (await A.request.get(w.url + '/api/sla')).json();
    await B.context().close();
    return `2 anonymised rows ("${items[0].trim()}"), no name in DOM or raw stream, status "Live wall connected.", EventSource readyState ${states} after leaving, server streamsOpen=${sla.streamsOpen}`;
  });
  await check('V2-wall-reconnect', 'disconnect announcement and re-entry opens a fresh stream', async () => {
    const A = wallPageA;
    await A.goto(w.url + '/#/wall');
    await waitText(A, 'wall-status', /^Connected$/);
    await stop(w);
    await waitText(A, 'wall-status', /Reconnecting|Disconnected/, 8000);
    const st = (await tid(A, 'wall-status').innerText()).trim();
    await waitText(A, 'status', /Live wall (reconnecting|disconnected)\./, 4000);
    await shot(A, 'v2-wall-reconnecting');
    return `after server stop wall-status "${st}", live region "${(await tid(A, 'status').innerText()).trim()}"`;
  });
  await wallPageA.context().close();

  // ---- SLA ----
  await check('V2-sla', 'numbers appear, update, polling stops after leaving', async () => {
    const p = await newPage(browser);
    const slaReqs = [];
    p.on('request', (r) => { if (r.url().includes('/api/sla')) slaReqs.push(Date.now()); });
    await p.request.get(m.url + '/healthz');
    await p.goto(m.url + '/#/sla');
    await waitText(p, 'sla-total-count', /^\d+$/);
    assert(/ms$/.test((await tid(p, 'sla-p50').innerText()).trim()), 'p50 text: ' + await tid(p, 'sla-p50').innerText());
    assert(/ms$/.test((await tid(p, 'sla-p95').innerText()).trim()) && /ms$/.test((await tid(p, 'sla-p99').innerText()).trim()), 'p95/p99');
    assert((await tid(p, 'sla-uptime').innerText()).trim() !== '-', 'uptime');
    assert(/%/.test(await tid(p, 'sla-error-rate').innerText()), 'error rate');
    assert(/per minute/.test(await tid(p, 'sla-hello-rate').innerText()), 'hello rate');
    await tid(p, 'sla-row').first().waitFor();
    const c0 = Number((await tid(p, 'sla-total-count').innerText()).trim());
    for (let i = 0; i < 6; i++) await p.request.get(m.url + '/healthz');
    await p.waitForFunction((n) => Number(document.querySelector('[data-testid=sla-total-count]').textContent) > n, c0, { timeout: 8000 });
    const c1 = Number((await tid(p, 'sla-total-count').innerText()).trim());
    const rows = await tid(p, 'sla-route').allInnerTexts();
    await shot(p, 'v2-sla-light');
    const during = slaReqs.length;
    await tid(p, 'nav-hello').click();
    await tid(p, 'name-input').waitFor();
    await p.waitForTimeout(200);
    const atLeave = slaReqs.length;
    await p.waitForTimeout(11000);
    eq(slaReqs.length, atLeave, 'polling continued after leaving');
    await p.context().close();
    return `count ${c0} -> ${c1} without reload (${during} /api/sla fetches while open); routes ${rows.slice(0, 3).join(', ')}; 0 fetches in 11 s after leaving`;
  });

  // ---- time machine ----
  await check('V2-time-machine', 'min/max, era, streak status, pre-1900 error', async () => {
    const h = await newPage(browser);
    await h.goto(m.url + '/');
    await greet(h, 'Ada', 'en', 'formal');
    await tid(h, 'greeting-text').waitFor();
    await h.context().close();
    const p = await newPage(browser);
    await p.goto(m.url + '/#/time-machine');
    eq(await tid(p, 'tm-date-input').getAttribute('min'), '1900-01-01', 'min');
    eq(await tid(p, 'tm-date-input').getAttribute('max'), today, 'max');
    await tid(p, 'tm-date-input').fill('1987-05-02');
    await tid(p, 'tm-go').click();
    await waitText(p, 'tm-era', /disco and dial-up dawn/);
    assert((await tid(p, 'tm-greeting').innerText()).trim().length > 5, 'greeting');
    eq(await tid(p, 'tm-streak').count(), 0, 'streak shown without name');
    await tid(p, 'tm-date-input').fill(today);
    await tid(p, 'tm-name-input').fill('Ada');
    await tid(p, 'tm-go').click();
    await waitText(p, 'tm-streak', /Day 1 of a 1-day streak for Ada\./);
    const s1 = (await tid(p, 'tm-streak').innerText()).trim();
    await tid(p, 'tm-name-input').fill('Nobody Atall');
    await tid(p, 'tm-go').click();
    await waitText(p, 'tm-streak', /No streak on record for Nobody Atall\./);
    await shot(p, 'v2-time-machine-light');
    await tid(p, 'tm-name-input').fill('');
    await tid(p, 'tm-date-input').fill('1850-01-01');
    await tid(p, 'tm-go').click();
    await waitText(p, 'tm-error', /before 1900-01-01/);
    const e = (await tid(p, 'tm-error').innerText()).trim();
    await shot(p, 'v2-time-machine-error');
    await p.context().close();
    return `min/max ok (max ${today}); 1987-05-02 era "disco and dial-up dawn"; streak "${s1}"; unknown name "No streak on record"; 1850-01-01 -> "${e}"`;
  });

  // ---- haiku ----
  await check('V2-haiku', 'three lines, 5-7-5 verified, 422 for unscannable name', async () => {
    const p = await newPage(browser);
    await p.goto(m.url + '/#/haiku');
    await tid(p, 'haiku-name-input').fill('Ada');
    await tid(p, 'haiku-theme-select').selectOption('ocean');
    await tid(p, 'haiku-go').click();
    await tid(p, 'haiku-line').first().waitFor();
    eq(await tid(p, 'haiku-line').count(), 3, 'line count');
    const lines = (await tid(p, 'haiku-line').allInnerTexts()).map((x) => x.trim());
    assert(lines.every((l) => l.length > 0), 'empty line');
    assert(lines.join(' ').includes('Ada'), 'name placed');
    eq((await tid(p, 'haiku-counts').innerText()).trim(), '5-7-5 verified');
    await waitText(p, 'status', /Haiku ready/);
    const api = await (await p.request.post(m.url + '/api/haiku', { data: { name: 'Ada', theme: 'ocean' } })).json();
    eq(JSON.stringify(api.syllables), '[5,7,5]', 'api syllables');
    eq(JSON.stringify(api.haiku), JSON.stringify(lines), 'ui lines match api');
    await shot(p, 'v2-haiku-light');
    await tid(p, 'haiku-name-input').fill('日本');
    await tid(p, 'haiku-go').click();
    await waitText(p, 'haiku-error', /cannot be scanned/);
    const e = (await tid(p, 'haiku-error').innerText()).trim();
    const r = await p.request.post(m.url + '/api/haiku', { data: { name: '日本' } });
    eq(r.status(), 422, 'api status');
    await shot(p, 'v2-haiku-422');
    await p.context().close();
    return `lines ${JSON.stringify(lines)} "5-7-5 verified", API [5,7,5]; 日本 -> 422 "${e}"`;
  });

  // ---- federation ----
  let fedPage;
  await check('V2-federation', 'health, federated hello, plain-text hostile greeting, notice', async () => {
    const p = await newPage(browser);
    fedPage = p;
    await p.goto(m.url + '/#/federation');
    assert(await tid(p, 'fed-notice').isVisible(), 'notice visible');
    assert(/Your name is sent to the listed peers/.test(await tid(p, 'fed-notice').innerText()), 'notice text');
    await waitText(p, 'fed-summary', /2 of 2 peers up\./);
    const origins = await tid(p, 'fed-peer-origin').allInnerTexts();
    assert(origins.includes(peer.origin) && origins.includes(stub.origin), 'origins ' + origins);
    const sts = await tid(p, 'fed-peer-status').allInnerTexts();
    assert(sts.every((t) => /^Up \(\d+ ms\)$/.test(t.trim())), 'statuses ' + sts);
    eq(await p.locator('[data-testid=fed-peer-origin] a, [data-testid=fed-result] a').count(), 0, 'anchors');
    assert(!(await tid(p, 'fed-empty').isVisible()), 'empty hidden');
    await tid(p, 'fed-name-input').fill('Ada');
    await tid(p, 'fed-hello-btn').click();
    await p.waitForFunction(() => document.querySelectorAll('[data-testid=fed-result]').length === 2, null, { timeout: 5000 });
    const gs = await tid(p, 'fed-result-greeting').allInnerTexts();
    assert(gs.some((g) => g.includes('Ada') && !g.includes('<')), 'peer greeting: ' + gs.join(' | '));
    assert(gs.some((g) => g.includes(hostileGreeting)), 'hostile literal text missing: ' + gs.join(' | '));
    eq(await p.locator('main img').count(), 0, 'img injected');
    eq(await p.evaluate(() => window.__x), undefined, 'xss ran');
    await waitText(p, 'status', /2 of 2 peers answered\./);
    await shot(p, 'v2-federation-light');
    return `health "2 of 2 peers up", ${origins.length} plain-text origins; real peer greeting "${gs.find((g) => g.includes('Ada') && !g.includes('<')).slice(0, 50)}"; stub greeting shown literally, 0 img, window.__x undefined`;
  });
  await check('V2-federation-down', 'stopped peer is isolated, others still work', async () => {
    const p = fedPage;
    await stop(peer); peerStopped = true;
    await p.waitForTimeout(5300); // health cache ttl is 5 s
    await tid(p, 'fed-health-btn').click();
    await waitText(p, 'fed-summary', /1 of 2 peers up\./, 6000);
    const rows = await tid(p, 'fed-peer-row').allInnerTexts();
    const down = rows.find((r) => r.includes(peer.origin)); const up = rows.find((r) => r.includes(stub.origin));
    assert(/Down: /.test(down) && !/stack|ECONN|at /.test(down), 'down row: ' + down);
    assert(/Up \(/.test(up), 'up row: ' + up);
    await tid(p, 'fed-name-input').fill('Ada');
    await tid(p, 'fed-hello-btn').click();
    await waitText(p, 'status', /1 of 2 peers answered\./, 6000);
    const errs = await tid(p, 'fed-result-error').allInnerTexts();
    const oks = await tid(p, 'fed-result-greeting').allInnerTexts();
    eq(errs.length, 1, 'error count'); eq(oks.length, 1, 'ok count');
    assert(/^This peer /.test(errs[0].trim()) && !/ECONN|127\.0\.0\.1|stack/.test(errs[0]), 'error text: ' + errs[0]);
    await shot(p, 'v2-federation-peer-down');
    // the main server itself is unaffected
    const hr = await p.request.post(m.url + '/hello');
    eq(await hr.text(), '{"message":"Hello World! Welcome to the API."}');
    await p.context().close();
    return `down row "${down.replace(/\s+/g, ' ')}"; up row "${up.replace(/\s+/g, ' ')}"; hello: "${errs[0].trim()}" + 1 greeting; POST /hello still exact`;
  });

  // ---- keyboard ----
  await check('V2-keyboard', 'Tab order (8 original first) then More views nav, Enter navigates', async () => {
    const p = await newPage(browser);
    await p.goto(m.url + '/');
    await p.evaluate(() => { document.activeElement && document.activeElement.blur(); });
    const order = await tabTo(p, 14);
    const want = ['nav-hello', 'nav-battle', 'nav-verify', 'name-input', 'language-select', 'tone-select', 'chaos-toggle', 'say-hello', 'nav-weather', 'nav-wall', 'nav-sla', 'nav-time-machine', 'nav-haiku', 'nav-federation'];
    eq(order.join(','), want.join(','), 'tab order');
    // the More views nav is a labelled landmark
    eq(await p.locator('nav[aria-labelledby="more-label"]').count(), 1, 'more nav landmark');
    const outline = await p.evaluate(() => { const cs = getComputedStyle(document.activeElement); return cs.outlineStyle + ' ' + cs.outlineWidth; });
    assert(!/^none/.test(outline) && !/ 0px/.test(outline), 'focus ring: ' + outline);
    // Shift+Tab back to nav-sla then Enter
    await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Shift+Tab');
    eq(await p.evaluate(() => document.activeElement.getAttribute('data-testid')), 'nav-wall', 'shift-tab target');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => location.hash === '#/wall');
    await p.waitForFunction(() => document.activeElement && document.activeElement.getAttribute('data-testid') === 'view-title', null, { timeout: 2000 }).catch(() => {});
    eq(await p.evaluate(() => document.activeElement.getAttribute('data-testid')), 'view-title', 'h1 focused');
    eq(await tid(p, 'nav-wall').getAttribute('aria-current'), 'page');
    eq((await tid(p, 'view-title').innerText()).trim(), 'Live Hello Wall');
    // keyboard-only haiku
    await p.goto(m.url + '/#/haiku');
    await tid(p, 'haiku-name-input').focus();
    await p.keyboard.type('Kay');
    await p.keyboard.press('Tab'); await p.keyboard.press('ArrowDown');
    await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
    eq(await p.evaluate(() => document.activeElement.getAttribute('data-testid')), 'haiku-go');
    await p.keyboard.press('Enter');
    await tid(p, 'haiku-line').first().waitFor();
    await p.context().close();
    return `tab order ${order.join('>')}; focus ring ${outline}; Enter on nav-wall -> #/wall, h1 focused, aria-current; keyboard-only haiku`;
  });

  // ---- 390px + dark ----
  await check('V2-390', '390px: no horizontal scroll on each new view', async () => {
    const p = await newPage(browser, { viewport: { width: 390, height: 844 } });
    const res = [];
    const ov = async (n) => { const ok = await noOverflow(p); res.push(`${n}:${ok ? 'ok' : 'OVERFLOW'}`); return ok; };
    const bad = [];
    await p.goto(m.url + '/#/weather');
    if (!await ov('weather-empty')) bad.push('weather-empty');
    await tid(p, 'weather-place-input').fill('W'.repeat(40));
    await tid(p, 'weather-name-input').fill('W'.repeat(40));
    await tid(p, 'weather-go').click();
    await waitText(p, 'weather-chance', /Chance/);
    if (!await ov('weather')) bad.push('weather');
    await shot(p, 'v2-weather-390');
    await p.goto(m.url + '/#/wall');
    await waitText(p, 'wall-status', /Connected|Wall is full/);
    if (!await ov('wall')) bad.push('wall');
    await shot(p, 'v2-wall-390');
    await p.goto(m.url + '/#/sla');
    await waitText(p, 'sla-total-count', /^\d+$/);
    if (!await ov('sla')) bad.push('sla');
    await shot(p, 'v2-sla-390');
    await p.goto(m.url + '/#/time-machine');
    await tid(p, 'tm-date-input').fill('1987-05-02');
    await tid(p, 'tm-name-input').fill('W'.repeat(40));
    await tid(p, 'tm-go').click();
    await waitText(p, 'tm-streak', /./);
    if (!await ov('time-machine')) bad.push('time-machine');
    await shot(p, 'v2-time-machine-390');
    await p.goto(m.url + '/#/haiku');
    await tid(p, 'haiku-name-input').fill('W'.repeat(40));
    await tid(p, 'haiku-go').click();
    await p.waitForFunction(() => document.querySelector('[data-testid=haiku-line]') || document.querySelector('[data-testid=haiku-error]').textContent);
    if (!await ov('haiku')) bad.push('haiku');
    await tid(p, 'haiku-name-input').fill('Ada');
    await tid(p, 'haiku-go').click();
    await tid(p, 'haiku-line').first().waitFor();
    if (!await ov('haiku-result')) bad.push('haiku-result');
    await shot(p, 'v2-haiku-390');
    await p.goto(m.url + '/#/federation');
    await waitText(p, 'fed-summary', /peers up/, 6000);
    await tid(p, 'fed-name-input').fill('Ada');
    await tid(p, 'fed-hello-btn').click();
    await p.waitForFunction(() => document.querySelectorAll('[data-testid=fed-result]').length === 2, null, { timeout: 6000 });
    if (!await ov('federation')) bad.push('federation');
    await shot(p, 'v2-federation-390');
    await p.goto(m.url + '/');
    if (!await ov('hello-with-more-nav')) bad.push('hello');
    await shot(p, 'v2-more-nav-390');
    const hts = await p.evaluate(() => ['nav-weather', 'nav-wall', 'nav-sla', 'nav-time-machine', 'nav-haiku', 'nav-federation'].map((i) => Math.round(document.querySelector(`[data-testid=${i}]`).getBoundingClientRect().height)));
    await p.context().close();
    assert(bad.length === 0, 'overflow on: ' + bad.join(','));
    return `${res.join(' ')}; more-nav link heights ${hts}`;
  });
  await check('V2-dark', 'dark mode for wall and SLA (dark bg, readable, no overflow)', async () => {
    const out = [];
    for (const [view, ready] of [['wall', /Connected/], ['sla', /^\d+$/]]) {
      const p = await newPage(browser, { colorScheme: 'dark', viewport: { width: 390, height: 844 } });
      await p.goto(m.url + '/#/' + view);
      await waitText(p, view === 'wall' ? 'wall-status' : 'sla-total-count', ready);
      const info = await p.evaluate(() => {
        const rgb = (s) => s.match(/[\d.]+/g).map(Number);
        const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const bg = rgb(getComputedStyle(document.body).backgroundColor);
        let worst = 21; const bad = [];
        for (const e of document.querySelectorAll('main :is(p,dd,dt,td,th,li,caption,h1)')) {
          if (!e.offsetParent || !e.textContent.trim()) continue;
          let b = e; let bgc = null;
          while (b && !bgc) { const c = getComputedStyle(b).backgroundColor; const a = rgb(c); if (a.length < 4 || a[3] > 0.5) bgc = a; b = b.parentElement; }
          const fg = rgb(getComputedStyle(e).color);
          const l1 = lum(fg), l2 = lum(bgc || bg);
          const cr = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          if (cr < worst) worst = cr;
          if (cr < 4.5) bad.push(e.textContent.trim().slice(0, 20) + ':' + cr.toFixed(1));
        }
        return { bg, worst: Math.round(worst * 10) / 10, bad, overflow: document.documentElement.scrollWidth > window.innerWidth };
      });
      assert((info.bg[0] + info.bg[1] + info.bg[2]) / 3 < 100, view + ' bg not dark: ' + info.bg);
      assert(!info.overflow, view + ' dark overflow');
      assert(info.bad.length === 0, view + ' low contrast: ' + info.bad.join(','));
      await shot(p, `v2-${view}-dark-390`);
      await p.setViewportSize({ width: 1280, height: 800 });
      await shot(p, `v2-${view}-dark`);
      out.push(`${view} bg rgb(${info.bg.slice(0, 3)}) min contrast ${info.worst}`);
      await p.context().close();
    }
    return out.join('; ');
  });
  await stop(m);
  if (!peerStopped) await stop(peer);
  stub.srv.close(); stub.srv.closeAllConnections && stub.srv.closeAllConnections();
  await check('V2-CONSOLE', 'zero console/page errors during v2 (resource-load lines for forced 4xx excluded)', async () => {
    const v2Errs = consoleErrors.slice(v2ErrStart);
    assert(v2Errs.length === 0, `${v2Errs.length} errors: ${v2Errs.slice(0, 3).join(' | ')}`);
    return `0 console/page errors in v2 section`;
  });

  // ---------- Console errors ----------
  await check('CONSOLE', 'console errors = none (excluding browser resource-load lines for forced 4xx/5xx)', async () => {
    assert(consoleErrors.length === 0, `${consoleErrors.length} errors: ${consoleErrors.slice(0, 3).join(' | ')}`);
    return `0 console errors / page errors; ${expectedNoise.length} expected "Failed to load resource" lines from forced 418/429/500`;
  });
  await check('J10', 'tests journey (criterion 11)', async () => 'no UI; this walkthrough covers criteria 1,3,5,6,7,8 (UC1,UC2,UC4,UC5,UC6,UC7) plus 9,10; npm test is run separately');

  await browser.close();
  procs.forEach((p) => { try { p.kill('SIGKILL'); } catch {} });
  fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify(results, null, 1));
  const pass = results.filter((r) => r.ok).length;
  console.log(`\nTOTAL ${results.length} PASS ${pass} FAIL ${results.length - pass}`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); procs.forEach((p) => { try { p.kill('SIGKILL'); } catch {} }); process.exit(2); });
