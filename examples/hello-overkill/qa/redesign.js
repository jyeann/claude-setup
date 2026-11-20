'use strict';
// Standalone redesign QA (RC1-RC13 from docs/product/hello-overkill/redesign/ux-redesign.md section 7)
// plus the review screenshots. Not part of the verify gate. Run: node qa/redesign.js
// Exit 0 even when checks fail (results.json holds the verdicts); exit 2 on a fatal harness error.
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.resolve(ROOT, process.env.QA_SHOTS || '../../docs/product/hello-overkill/qa-redesign');
fs.mkdirSync(SHOTS, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hello-rc-'));
const SECRET = 'qa-test-secret-qa-test-secret-123'; // harness:allow-secret
const results = [];
const consoleErrors = [];
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
  try {
    const ev = await fn();
    results.push({ id, title, ok: true, evidence: ev || '' });
    console.log(`PASS ${id} ${title}`);
  } catch (e) {
    results.push({ id, title, ok: false, evidence: String(e.message).split('\n')[0].slice(0, 400) });
    console.log(`FAIL ${id} ${title}: ${String(e.message).split('\n')[0]}`);
  }
}
function assert(c, m) { if (!c) throw new Error(m); }
function eq(a, b, m) { if (a !== b) throw new Error(`${m || 'eq'}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(browser, opts = {}, init) {
  const ctx = await browser.newContext({ deviceScaleFactor: 1, viewport: { width: 1280, height: 800 }, ...opts });
  if (init) for (const f of [].concat(init)) await ctx.addInitScript(f);
  const page = await ctx.newPage();
  page.__errs = [];
  page.on('pageerror', (e) => { page.__errs.push('pageerror: ' + e.message); consoleErrors.push('pageerror: ' + e.message); });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (!/Failed to load resource/.test(t)) { page.__errs.push(t); consoleErrors.push(t); }
  });
  return page;
}
const tid = (p, id) => p.getByTestId(id);
const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const activeId = (p) => p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-testid'));
async function greet(page, name, lang, tone) {
  await tid(page, 'name-input').fill(name);
  if (lang) await tid(page, 'language-select').selectOption(lang);
  if (tone) await tid(page, 'tone-select').selectOption(tone);
  const resp = page.waitForResponse((r) => r.url().includes('/hello') && r.request().method() === 'POST');
  await tid(page, 'say-hello').click();
  return resp;
}
const waitText = (p, testid, re, ms) => p.waitForFunction(([t, src]) => { const e = document.querySelector(`[data-testid=${t}]`); return !!e && new RegExp(src).test(e.textContent); }, [testid, re.source], { timeout: ms || 4000 }).catch(async () => { const e = p.locator(`[data-testid=${testid}]`).first(); throw new Error(`${testid} missing /${re.source}/, was: ` + ((await e.count()) ? (await e.textContent()).slice(0, 120) : '(absent)')); });
const waitBg = (p, rgb, ms) => p.waitForFunction((c) => getComputedStyle(document.body).backgroundColor === c, rgb, { timeout: ms || 3000 }).catch(async () => { throw new Error(`body background never became ${rgb}, is ${await p.evaluate(() => getComputedStyle(document.body).backgroundColor)}`); });
const bodyBg = (p) => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
const LIGHT_BG = 'rgb(244, 238, 226)';
const DARK_BG = 'rgb(18, 22, 28)';

// Wait until every finite animation has finished (two rAFs first so insertions have been styled).
async function settle(p, ms) {
  await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
  await p.waitForFunction(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.getTiming().iterations !== Infinity).length === 0, null, { timeout: ms || 5000 }).catch(() => {});
}

// Init script: records the property keys of every keyframe seen (sampled every 30 ms so short
// animations are caught), and counts startViewTransition calls.
const ANIM_SPY = () => {
  window.__animLog = []; window.__vt = 0;
  const seen = new Set();
  window.__sampleAnims = () => {
    try {
      document.getAnimations().forEach((a) => {
        const e = a.effect;
        if (!e || typeof e.getKeyframes !== 'function') return;
        if (a.constructor && a.constructor.name === 'CSSTransition') return;
        const pe = e.pseudoElement || '';
        if (pe.indexOf('view-transition') >= 0) return;
        const keys = new Set();
        e.getKeyframes().forEach((k) => Object.keys(k).forEach((x) => keys.add(x)));
        const rec = { name: a.animationName || (a.constructor && a.constructor.name) || 'Animation', keys: [...keys].sort(), inf: e.getTiming().iterations === Infinity };
        const k = rec.name + '|' + rec.keys.join(',') + '|' + rec.inf;
        if (!seen.has(k)) { seen.add(k); window.__animLog.push(rec); }
      });
    } catch (e) { /* ignore */ }
  };
  setInterval(window.__sampleAnims, 30);
  const svt = document.startViewTransition;
  if (typeof svt === 'function') document.startViewTransition = function () { window.__vt++; return svt.apply(this, arguments); };
};
const NO_VT = () => { try { delete Document.prototype.startViewTransition; } catch (e) { /* ignore */ } try { document.startViewTransition = undefined; } catch (e) { /* ignore */ } };
const ALLOWED_KEYS = ['offset', 'easing', 'composite', 'computedOffset', 'opacity'];
async function animReport(p) {
  await p.evaluate(() => { window.__sampleAnims && window.__sampleAnims(); });
  const log = await p.evaluate(() => { const l = window.__animLog.slice(); window.__animLog.length = 0; return l; });
  const bad = log.filter((r) => r.keys.some((k) => !ALLOWED_KEYS.includes(k)));
  const inf = log.filter((r) => r.inf);
  return { n: log.length, bad, inf };
}

// Contrast helper, run in the page against a locator. o: {prop, bgFrom:'self'|'parent'|'body'}
function contrastIn(el, o) {
  const parse = (c) => {
    const m = String(c).match(/-?[\d.]+/g) || ['0', '0', '0'];
    const n = m.map(Number);
    if (/^color\(/.test(c)) return { r: n[0] * 255, g: n[1] * 255, b: n[2] * 255, a: n.length > 3 ? n[3] : 1 };
    return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 };
  };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  let n = o.bgFrom === 'parent' ? el.parentElement : o.bgFrom === 'body' ? document.body : el;
  const layers = [];
  while (n) {
    const c = parse(getComputedStyle(n).backgroundColor);
    if (c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    n = n.parentElement;
  }
  let bg = { r: 255, g: 255, b: 255, a: 1 };
  for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
  let fg = parse(getComputedStyle(el)[o.prop]);
  if (fg.a < 1) fg = over(fg, bg);
  const a = lum(fg), b = lum(bg);
  return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), fg: `${Math.round(fg.r)},${Math.round(fg.g)},${Math.round(fg.b)}`, bg: `${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}` };
}
const contrast = (loc, prop, bgFrom) => loc.first().evaluate(contrastIn, { prop, bgFrom: bgFrom || 'self' });

(async () => {
  const browser = await chromium.launch();
  const BIGLIM = { HELLO_READ_LIMIT: '1000', HELLO_FED_LIMIT: '1000' };
  const s = await startServer(tmpFile('main'), 1000, BIGLIM);
  const today = new Date().toISOString().slice(0, 10);

  // ---------- seed: one greeting, its certificate, one vote ----------
  let certId = null, T = null;
  {
    const p = await newPage(browser);
    await p.goto(s.url + '/');
    await greet(p, 'Ada', 'en', 'formal');
    await tid(p, 'greeting-text').waitFor({ timeout: 5000 });
    await tid(p, 'cert-link').click();
    await p.waitForFunction(() => /#\/certificate\//.test(location.hash));
    certId = p.url().split('#/certificate/')[1];
    await tid(p, 'cert-name').waitFor({ timeout: 5000 });
    T = await tid(p, 'cert-text').inputValue();
    await tid(p, 'nav-battle').click();
    await tid(p, 'battle-option-a').waitFor({ timeout: 5000 });
    await tid(p, 'battle-option-a').click();
    await tid(p, 'battle-next').waitFor({ timeout: 5000 });
    await p.context().close();
  }
  const toCert = async (p) => {
    await p.goto(s.url + '/');
    await greet(p, 'Ada', 'en', 'formal');
    await tid(p, 'greeting-text').waitFor({ timeout: 5000 });
    await tid(p, 'cert-link').click();
    await tid(p, 'cert-name').waitFor({ timeout: 5000 });
  };
  const clickRadio = async (p, id) => { const r = tid(p, id); await r.scrollIntoViewIfNeeded().catch(() => {}); await r.click({ force: true }); };

  // ---------- RC1 ----------
  await check('RC1', 'theme override, persistence, system fallback', async () => {
    const p = await newPage(browser, { colorScheme: 'light', reducedMotion: 'reduce' });
    await p.goto(s.url + '/');
    eq(await p.evaluate(() => document.documentElement.dataset.theme), undefined, 'data-theme initially');
    await waitBg(p, LIGHT_BG);
    await clickRadio(p, 'theme-dark');
    eq(await p.evaluate(() => document.documentElement.dataset.theme), 'dark', 'data-theme dark');
    await waitBg(p, DARK_BG);
    eq(await p.evaluate(() => localStorage.getItem('ho-theme')), 'dark', 'localStorage');
    await waitText(p, 'status', /Theme set to dark\./);
    await p.reload();
    eq(await p.evaluate(() => document.documentElement.dataset.theme), 'dark', 'dark after reload');
    await waitBg(p, DARK_BG);
    await clickRadio(p, 'theme-system');
    await p.waitForFunction(() => document.documentElement.dataset.theme === undefined && localStorage.getItem('ho-theme') === null, null, { timeout: 2000 }).catch(() => { throw new Error('system did not remove data-theme / key'); });
    await waitBg(p, LIGHT_BG);
    await p.context().close();
    const q = await newPage(browser, { colorScheme: 'dark', reducedMotion: 'reduce' });
    await q.goto(s.url + '/');
    await waitBg(q, DARK_BG);
    await clickRadio(q, 'theme-light');
    await waitBg(q, LIGHT_BG);
    await q.context().close();
    return 'light->dark override persists across reload, system clears it, light override beats dark system';
  });

  // ---------- RC2 ----------
  await check('RC2', 'no flash: override applied at domcontentloaded', async () => {
    const p = await newPage(browser, { colorScheme: 'light', reducedMotion: 'reduce' }, () => { try { localStorage.setItem('ho-theme', 'dark'); } catch (e) { /* ignore */ } });
    await p.goto(s.url + '/', { waitUntil: 'domcontentloaded' });
    const bg = await bodyBg(p);
    await p.context().close();
    eq(bg, DARK_BG, 'first-evaluate body background');
    return 'first computed body background ' + bg;
  });

  // ---------- RC3 ----------
  await check('RC3', 'reduced motion: keyframes are opacity-only, no infinite loops, no view transition', async () => {
    const p = await newPage(browser, { reducedMotion: 'reduce' }, ANIM_SPY);
    const rep = [];
    const done = async (label) => {
      await settle(p, 3000);
      const r = await animReport(p);
      rep.push(`${label}:${r.n}`);
      assert(r.bad.length === 0, `${label}: non-opacity keyframes ${JSON.stringify(r.bad.slice(0, 2))}`);
      assert(r.inf.length === 0, `${label}: infinite animation ${JSON.stringify(r.inf.slice(0, 2))}`);
    };
    await p.goto(s.url + '/');
    await tid(p, 'name-input').fill('Ada');
    await tid(p, 'say-hello').click();
    await tid(p, 'greeting-text').waitFor({ timeout: 5000 });
    await done('hello');
    await tid(p, 'cert-link').click();
    await tid(p, 'cert-name').waitFor({ timeout: 5000 });
    await done('certificate');
    await tid(p, 'nav-verify').click();
    await tid(p, 'verify-input').fill(T);
    await tid(p, 'verify-btn').click();
    await p.waitForFunction(() => { const v = document.querySelector('[data-testid=verify-verdict]'); return v && v.innerText.trim() === 'Authentic'; }, null, { timeout: 4000 });
    await done('verify');
    await tid(p, 'nav-battle').click();
    await tid(p, 'battle-option-a').waitFor({ timeout: 5000 });
    await tid(p, 'battle-option-a').click();
    await tid(p, 'battle-next').waitFor({ timeout: 5000 });
    await done('battle');
    await p.evaluate(() => { location.hash = '#/haiku'; });
    await tid(p, 'haiku-name-input').fill('Ada');
    await tid(p, 'haiku-go').click();
    await tid(p, 'haiku-line').first().waitFor({ timeout: 5000 });
    await done('haiku');
    await p.evaluate(() => { location.hash = '#/time-machine'; });
    await tid(p, 'tm-date-input').fill('1987-05-02');
    await tid(p, 'tm-go').click();
    await waitText(p, 'tm-era', /Era/, 5000);
    await done('time-machine');
    const vt = await p.evaluate(() => window.__vt);
    eq(vt, 0, 'startViewTransition calls');
    await p.context().close();
    return 'views ' + rep.join(' ') + '; 0 view transitions (CSSTransition instances excluded, view-transition pseudos excluded)';
  });

  // ---------- RC4 ----------
  await check('RC4', 'default motion completes; nothing left invisible', async () => {
    const p = await newPage(browser);
    const invisible = () => p.evaluate(() => {
      const bad = [];
      document.querySelectorAll('[data-testid]').forEach((e) => {
        if (!e.getClientRects().length || e.closest('[aria-hidden=true]')) return;
        let o = 1;
        for (let n = e; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity);
        if (Math.abs(o - 1) > 0.001) bad.push(e.getAttribute('data-testid') + '=' + o.toFixed(2));
      });
      return bad;
    });
    const running = () => p.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.getTiming().iterations !== Infinity).length);
    const verify = async (label, ms) => {
      await p.waitForTimeout(ms); // elapsed time is the thing under test here
      const bad = await invisible();
      assert(bad.length === 0, `${label}: partially transparent ${bad.slice(0, 4).join(',')}`);
      const r = await running();
      assert(r === 0, `${label}: ${r} animations still running`);
    };
    await p.goto(s.url + '/');
    await greet(p, 'Ada', 'en', 'formal');
    await tid(p, 'greeting-text').waitFor({ timeout: 5000 });
    await verify('hello', 1200);
    assert(await tid(p, 'greeting-stamp').isVisible(), 'greeting-stamp visible');
    const ov = await p.evaluate(() => {
      const t = document.querySelector('[data-testid=greeting-text]');
      const card = t.closest('.letter') || t.closest('#result') || t.parentElement;
      const a = document.querySelector('[data-testid=greeting-stamp]').getBoundingClientRect(), b = card.getBoundingClientRect();
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    });
    assert(ov, 'greeting-stamp does not overlap the greeting card');
    await tid(p, 'cert-link').click();
    await tid(p, 'cert-name').waitFor({ timeout: 5000 });
    await verify('certificate', 1500);
    await tid(p, 'nav-verify').click();
    await tid(p, 'verify-input').fill(T);
    await tid(p, 'verify-btn').click();
    await p.waitForFunction(() => { const v = document.querySelector('[data-testid=verify-verdict]'); return v && v.innerText.trim() === 'Authentic'; }, null, { timeout: 4000 });
    await verify('verify', 800);
    await p.evaluate(() => { location.hash = '#/haiku'; });
    await tid(p, 'haiku-name-input').fill('Ada');
    await tid(p, 'haiku-go').click();
    await tid(p, 'haiku-line').first().waitFor({ timeout: 5000 });
    await verify('haiku', 1800);
    await p.evaluate(() => { location.hash = '#/weather'; });
    await tid(p, 'weather-place-input').fill('Lisbon');
    await tid(p, 'weather-name-input').fill('Ada');
    await tid(p, 'weather-go').click();
    await waitText(p, 'weather-chance', /Chance of warm regards/, 5000);
    await verify('weather', 1100);
    await p.evaluate(() => { location.hash = '#/time-machine'; });
    await tid(p, 'tm-date-input').fill('1987-05-02');
    await tid(p, 'tm-go').click();
    await waitText(p, 'tm-era', /Era/, 5000);
    await verify('time-machine', 1400);
    await p.context().close();
    return 'hello, certificate, verify, haiku, weather, time machine: every rendered testid fully opaque, no finite animation running, stamp overlaps card';
  });

  // ---------- RC5 ----------
  await check('RC5', '390px: no overflow, 44px targets, 10 views x 2 themes; hostile hello', async () => {
    const hashes = ['#/hello', '#/battle', '#/verify', '#/certificate/' + certId, '#/weather', '#/wall', '#/sla', '#/time-machine', '#/haiku', '#/federation'];
    const fails = [];
    for (const cs of ['light', 'dark']) {
      const p = await newPage(browser, { colorScheme: cs, viewport: { width: 390, height: 844 } });
      for (const h of hashes) {
        await p.goto(s.url + '/' + h);
        await tid(p, 'view-title').waitFor({ timeout: 5000 });
        await settle(p, 3000);
        if (!(await noOverflow(p))) fails.push(`${cs} ${h}: horizontal overflow`);
        const small = await p.evaluate(() => {
          const out = [];
          const vis = (e) => { const r = e.getBoundingClientRect(); return e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && r.width > 1 && r.height > 1; };
          const name = (e) => e.getAttribute('data-testid') || (e.tagName.toLowerCase() + (e.id ? '#' + e.id : ''));
          document.querySelectorAll('a, button, select, input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea').forEach((e) => {
            if (!vis(e)) return;
            const h2 = e.getBoundingClientRect().height;
            if (h2 < 43.5) out.push(`${name(e)}=${Math.round(h2)}`);
          });
          document.querySelectorAll('input[type=checkbox], input[type=radio]').forEach((e) => {
            if (!e.getClientRects().length) return;
            const lab = (e.id && document.querySelector(`label[for="${e.id}"]`)) || e.closest('label');
            const h2 = lab ? lab.getBoundingClientRect().height : 0;
            if (h2 < 43.5) out.push(`label(${name(e)})=${Math.round(h2)}`);
          });
          return out;
        });
        if (small.length) fails.push(`${cs} ${h}: ${small.slice(0, 4).join(',')}`);
      }
      await p.context().close();
    }
    const p = await newPage(browser, { viewport: { width: 390, height: 844 } });
    await p.goto(s.url + '/');
    for (const nm of ['W'.repeat(40), '<img src=x onerror=window.__x=1>']) {
      await greet(p, nm, 'es', 'pirate');
      await tid(p, 'greeting-text').waitFor({ timeout: 5000 });
      await settle(p, 3000);
      const ok = await p.evaluate(() => {
        const t = document.querySelector('[data-testid=greeting-text]');
        const card = t.closest('.letter') || t.closest('#result') || t.parentElement;
        return Math.round(t.getBoundingClientRect().right) <= Math.round(card.getBoundingClientRect().right);
      });
      if (!ok) fails.push(`hostile "${nm.slice(0, 8)}": greeting-text exceeds card`);
      if (!(await noOverflow(p))) fails.push(`hostile "${nm.slice(0, 8)}": page overflow`);
    }
    eq(await p.evaluate(() => window.__x), undefined, 'xss ran');
    await p.context().close();
    assert(fails.length === 0, `${fails.length} problems: ${fails.slice(0, 5).join(' | ')}`);
    return '20 view/theme loads without overflow, all targets >= 44px, hostile names contained';
  });

  // ---------- RC6 ----------
  await check('RC6', 'certificate print layout and A4 PDF page count', async () => {
    const p = await newPage(browser);
    await toCert(p);
    await settle(p, 4000);
    await p.emulateMedia({ media: 'print' });
    for (const id of ['nav-hello', 'nav-weather', 'cert-copy', 'cert-print', 'cert-text', 'cert-verify-link', 'status']) assert(!(await tid(p, id).isVisible()), `${id} visible in print`);
    assert(!(await p.locator('footer').first().isVisible()), 'footer visible in print');
    for (const id of ['cert-sheet', 'cert-name', 'cert-greeting', 'cert-date', 'cert-signature', 'cert-serial', 'cert-seal', 'cert-guilloche']) assert(await tid(p, id).isVisible(), `${id} not visible in print`);
    eq(await bodyBg(p), 'rgb(255, 255, 255)', 'print body background');
    const box = await tid(p, 'cert-sheet').boundingBox();
    assert(box.width <= 666, 'sheet wider than 176mm: ' + box.width);
    const ratio = box.height / box.width;
    assert(Math.abs(ratio - 1.414) / 1.414 <= 0.01, `sheet aspect ${ratio.toFixed(3)} not within 1% of 1.414`);
    await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    const sheetBg = await tid(p, 'cert-sheet').evaluate((e) => getComputedStyle(e).backgroundColor);
    assert(/^rgb\((251, 248, 241|255, 255, 255)\)$/.test(sheetBg), 'sheet background in dark theme: ' + sheetBg);
    const c = await contrast(tid(p, 'cert-name'), 'color', 'self');
    assert(c.ratio >= 7, `cert-name contrast in dark theme ${c.ratio.toFixed(2)}`);
    const pdf = await p.pdf({ format: 'A4', printBackground: true });
    fs.writeFileSync(path.join(SHOTS, 'cert-print-a4.pdf'), pdf);
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page(?![A-Za-z])/g) || []).length;
    eq(pages, 1, 'A4 PDF page count');
    await p.context().close();
    const w = await newPage(browser);
    await w.goto(s.url + '/');
    await greet(w, 'W'.repeat(40), 'en', 'formal');
    await tid(w, 'greeting-text').waitFor({ timeout: 5000 });
    await tid(w, 'cert-link').click();
    await tid(w, 'cert-name').waitFor({ timeout: 5000 });
    await settle(w, 4000);
    await w.emulateMedia({ media: 'print' });
    const fit = await tid(w, 'cert-sheet').evaluate((e) => [e.scrollWidth, e.clientWidth]);
    await w.context().close();
    assert(fit[0] <= fit[1], `40xW sheet scrollWidth ${fit[0]} > clientWidth ${fit[1]}`);
    return `hidden chrome ok, sheet ${Math.round(box.width)}px aspect ${ratio.toFixed(3)}, dark-theme contrast ${c.ratio.toFixed(1)}, PDF ${pages} page, 40xW fits`;
  });

  // ---------- RC7 ----------
  await check('RC7', 'contrast spot checks, both themes', async () => {
    const fails = [], done = [];
    for (const cs of ['light', 'dark']) {
      const p = await newPage(browser, { colorScheme: cs, reducedMotion: 'reduce' });
      const ck = async (name, loc, prop, bgFrom, min) => {
        try {
          const r = await contrast(loc, prop, bgFrom);
          done.push(1);
          if (r.ratio < min) fails.push(`${cs} ${name} ${r.ratio.toFixed(2)}<${min} (${r.fg} on ${r.bg})`);
        } catch (e) { fails.push(`${cs} ${name}: ${String(e.message).split('\n')[0].slice(0, 80)}`); }
      };
      await p.goto(s.url + '/');
      await ck('body text', p.locator('body'), 'color', 'self', 4.5);
      await ck('lede', p.locator('main .lede'), 'color', 'self', 4.5);
      await ck('eyebrow', p.locator('main .eyebrow'), 'color', 'self', 4.5);
      await ck('say-hello', tid(p, 'say-hello'), 'color', 'self', 4.5);
      await ck('nav-hello current', tid(p, 'nav-hello'), 'color', 'self', 4.5);
      await ck('name-input border', tid(p, 'name-input'), 'borderTopColor', 'parent', 3);
      await tid(p, 'name-input').fill('');
      await tid(p, 'say-hello').click();
      await tid(p, 'name-error').filter({ hasText: /\S/ }).waitFor({ timeout: 3000 }).catch(() => {});
      await ck('name-error', tid(p, 'name-error'), 'color', 'parent', 4.5);
      // keyboard focus ring on say-hello
      await p.goto(s.url + '/?fresh=' + cs);
      await p.evaluate(() => document.activeElement && document.activeElement.blur());
      for (let i = 0; i < 8; i++) await p.keyboard.press('Tab');
      if ((await activeId(p)) !== 'say-hello') fails.push(`${cs} tab 8 did not land on say-hello`);
      else {
        await ck('focus ring', tid(p, 'say-hello'), 'outlineColor', 'body', 3);
        const w = await tid(p, 'say-hello').evaluate((e) => parseFloat(getComputedStyle(e).outlineWidth));
        if (!(w >= 2)) fails.push(`${cs} focus ring width ${w}`);
      }
      // disabled / busy button (chaos=delay keeps it in the busy state ~2 s)
      await p.goto(s.url + '/?chaos=delay');
      await tid(p, 'name-input').fill('Ada');
      await tid(p, 'say-hello').click();
      await tid(p, 'result-loading').waitFor({ timeout: 1500 }).catch(() => {});
      if ((await tid(p, 'say-hello').getAttribute('aria-disabled')) === 'true') await ck('say-hello aria-disabled', tid(p, 'say-hello'), 'color', 'self', 4.5);
      else fails.push(`${cs} say-hello not aria-disabled while loading`);
      await tid(p, 'greeting-text').waitFor({ timeout: 6000 }).catch(() => {});
      // verify verdicts
      await p.goto(s.url + '/#/verify');
      for (const [label, text] of [['Authentic', T], ['Forged', T.replace('A', 'B')]]) {
        await tid(p, 'verify-input').fill(text);
        await tid(p, 'verify-btn').click();
        await p.waitForFunction((l) => { const v = document.querySelector('[data-testid=verify-verdict]'); return v && v.innerText.trim() === l; }, label, { timeout: 4000 }).catch(() => { fails.push(`${cs} verdict ${label} never shown`); });
        await settle(p, 3000);
        await ck('verdict ' + label, tid(p, 'verify-verdict'), 'color', 'self', 4.5);
      }
      // wall
      await p.goto(s.url + '/#/wall');
      await waitText(p, 'wall-status', /Connected/, 5000).catch(() => {});
      await p.request.post(s.url + '/hello', { data: { name: 'Ada' } });
      await tid(p, 'wall-item').first().waitFor({ timeout: 5000 }).catch(() => fails.push(`${cs} no wall-item`));
      await ck('wall-item', tid(p, 'wall-item'), 'color', 'self', 4.5);
      await ck('wall-status', tid(p, 'wall-status'), 'color', 'self', 4.5);
      // sla
      await p.goto(s.url + '/#/sla');
      await waitText(p, 'sla-p95', /\S/, 5000).catch(() => {});
      await ck('sla-p95', tid(p, 'sla-p95'), 'color', 'self', 4.5);
      // battle votes
      await p.goto(s.url + '/#/battle');
      await tid(p, 'lb-votes').first().waitFor({ timeout: 5000 }).catch(() => fails.push(`${cs} no lb-votes`));
      await ck('lb-votes', tid(p, 'lb-votes'), 'color', 'self', 4.5);
      // certificate
      await p.goto(s.url + '/#/certificate/' + certId);
      await tid(p, 'cert-name').waitFor({ timeout: 5000 }).catch(() => fails.push(`${cs} no cert-name`));
      await ck('cert-name', tid(p, 'cert-name'), 'color', 'self', 4.5);
      await ck('cert-signature', tid(p, 'cert-signature'), 'color', 'self', 4.5);
      await p.context().close();
    }
    assert(fails.length === 0, `${fails.length} failing of ${done.length + fails.length}: ${fails.slice(0, 5).join(' | ')}`);
    return `${done.length} contrast pairs measured`;
  });

  // ---------- RC8 ----------
  await check('RC8', 'v1 focus rules survive', async () => {
    const out = [];
    const p = await newPage(browser);
    await p.goto(s.url + '/');
    await greet(p, 'Ada', 'en', 'formal');
    await tid(p, 'greeting-text').waitFor({ timeout: 5000 });
    eq(await activeId(p), 'say-hello', '(a) focus after greeting');
    out.push('a');
    // (e) blank name
    await tid(p, 'name-input').fill('');
    await tid(p, 'say-hello').click();
    eq(await activeId(p), 'name-input', '(e) blank name focus');
    out.push('e');
    // (d) nav moves focus to the title with a visible ring (activated by keyboard so :focus-visible applies)
    for (const id of ['nav-battle', 'nav-verify', 'nav-weather', 'nav-wall', 'nav-sla', 'nav-time-machine', 'nav-haiku', 'nav-federation', 'nav-hello']) {
      await tid(p, id).focus();
      await p.keyboard.press('Enter');
      await p.waitForFunction(() => document.activeElement && document.activeElement.getAttribute('data-testid') === 'view-title', null, { timeout: 2000 }).catch(() => { throw new Error(`(d) ${id}: focus not on view-title`); });
      const ring = await p.evaluate(() => { const cs = getComputedStyle(document.activeElement); return [cs.outlineStyle, parseFloat(cs.outlineWidth)]; });
      assert(ring[0] !== 'none' && ring[1] >= 2, `(d) ${id}: title ring ${ring}`);
    }
    out.push('d');
    // (c) vote
    await tid(p, 'nav-battle').click();
    await tid(p, 'battle-option-b').waitFor({ timeout: 5000 });
    await tid(p, 'battle-option-b').click();
    await tid(p, 'battle-next').waitFor({ timeout: 5000 });
    eq(await activeId(p), 'battle-next', '(c) battle-next focus');
    out.push('c');
    // (f) copy
    await p.goto(s.url + '/#/certificate/' + certId);
    await tid(p, 'cert-copy').waitFor({ timeout: 5000 });
    await tid(p, 'cert-copy').click();
    await sleep(300);
    eq(await activeId(p), 'cert-copy', '(f) focus stays on copy');
    out.push('f');
    await p.context().close();
    // (b) 418
    const q = await newPage(browser);
    await q.goto(s.url + '/?chaos=418');
    await tid(q, 'chaos-toggle').check();
    await greet(q, 'Ada', 'en', 'formal');
    await tid(q, 'error-message').waitFor({ timeout: 5000 });
    await tid(q, 'retry-btn').waitFor({ timeout: 3000 });
    eq(await activeId(q), 'retry-btn', '(b) retry-btn focus');
    out.push('b');
    await q.context().close();
    return 'sub-checks ' + out.join(',');
  });

  // ---------- RC9 ----------
  await check('RC9', 'DOM order equals visual order', async () => {
    const p = await newPage(browser);
    await p.goto(s.url + '/');
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    const order = [];
    for (let i = 0; i < 15; i++) { await p.keyboard.press('Tab'); order.push(await activeId(p)); }
    const want = ['nav-hello', 'nav-battle', 'nav-verify', 'name-input', 'language-select', 'tone-select', 'chaos-toggle', 'say-hello', 'nav-weather', 'nav-wall', 'nav-sla', 'nav-time-machine', 'nav-haiku', 'nav-federation', 'theme-system'];
    eq(order.join(','), want.join(','), 'tab order');
    const geo = () => p.evaluate(() => {
      const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left + scrollX, t: b.top + scrollY, r: b.right + scrollX, b: b.bottom + scrollY }; };
      return { main: r(document.querySelector('main')), annex: r(document.querySelector('.annex')), foot: r(document.querySelector('footer')) };
    });
    await p.setViewportSize({ width: 1280, height: 800 });
    let g = await geo();
    assert(g.annex.l >= g.main.r - 1, `1280: annex left ${g.annex.l} < main right ${g.main.r}`);
    assert(g.foot.t >= g.main.b - 1 && g.foot.t >= g.annex.b - 1, `1280: footer top ${g.foot.t} above main ${g.main.b} / annex ${g.annex.b}`);
    for (const w of [390, 768]) {
      await p.setViewportSize({ width: w, height: 900 });
      g = await geo();
      assert(g.annex.t >= g.main.b - 1, `${w}: annex top ${g.annex.t} < main bottom ${g.main.b}`);
      assert(g.foot.t >= g.annex.b - 1, `${w}: footer top ${g.foot.t} < annex bottom ${g.annex.b}`);
    }
    const info = await p.evaluate(() => {
      const say = document.querySelector('[data-testid=say-hello]');
      const foc = [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter((e) => e.getClientRects().length && e.tabIndex >= 0 && (e.compareDocumentPosition(say) & Node.DOCUMENT_POSITION_FOLLOWING));
      return { before: foc.map((e) => e.getAttribute('data-testid')), tabindex: document.querySelectorAll('[tabindex]:not([tabindex="-1"])').length };
    });
    eq(info.before.join(','), want.slice(0, 7).join(','), 'focusable before say-hello');
    eq(info.tabindex, 0, 'positive/0 tabindex attributes');
    await p.context().close();
    return 'tab order 15 stops incl. theme-system last; annex/footer geometry at 390, 768, 1280';
  });

  // ---------- RC10 ----------
  await check('RC10', 'view transition guard', async () => {
    const a = await newPage(browser, {}, NO_VT);
    await toCert(a);
    assert(await tid(a, 'cert-name').isVisible(), '(a) cert-name');
    await a.context().close();
    const b = await newPage(browser, {}, ANIM_SPY);
    await b.goto(s.url + '/');
    await greet(b, 'Ada', 'en', 'formal');
    await tid(b, 'greeting-text').waitFor({ timeout: 5000 });
    const hasApi = await b.evaluate(() => typeof document.startViewTransition === 'function');
    await settle(b, 3000);
    await tid(b, 'cert-link').click();
    await tid(b, 'cert-name').waitFor({ state: 'visible', timeout: 1500 });
    await b.waitForFunction(() => document.activeElement && document.activeElement.getAttribute('data-testid') === 'view-title', null, { timeout: 1500 }).catch(() => { throw new Error('(b) view-title not focused'); });
    const calls = await b.evaluate(() => window.__vt);
    await b.context().close();
    const c = await newPage(browser, { reducedMotion: 'reduce' }, ANIM_SPY);
    await toCert(c);
    eq(await c.evaluate(() => window.__vt), 0, '(c) reduced-motion view transition calls');
    await c.context().close();
    return `(a) works without the API; (b) API ${hasApi ? 'present' : 'absent'}, ${calls} transition call(s), cert-name visible and title focused; (c) 0 calls under reduced motion`;
  });

  // ---------- RC11 ----------
  await check('RC11', 'certificate artifact structure', async () => {
    const p = await newPage(browser);
    await p.goto(s.url + '/#/certificate/' + certId);
    await tid(p, 'cert-name').waitFor({ timeout: 5000 });
    await p.waitForTimeout(1500); // arrival choreography length
    const r = await p.evaluate(() => {
      const g = document.querySelector('[data-testid=cert-guilloche]');
      const seal = document.querySelector('[data-testid=cert-seal]');
      const paths = g ? [...g.querySelectorAll('path')] : [];
      return {
        paths: paths.length,
        badLen: paths.filter((x) => x.getAttribute('pathLength') !== '1').length,
        ring: seal ? [...seal.querySelectorAll('text')].filter((x) => /^rotate\(/.test(x.getAttribute('transform') || '')).length : -1,
        serial: (document.querySelector('[data-testid=cert-serial]') || { textContent: '' }).textContent.trim(),
        use: document.querySelectorAll('use, textPath').length,
        hrefs: [...document.querySelectorAll('[href]')].map((e) => e.getAttribute('href')).filter((h) => !/^#\//.test(h)),
        xlink: document.querySelectorAll('[*|href]').length,
      };
    });
    assert(r.paths >= 13, `guilloche paths ${r.paths} < 13`);
    eq(r.badLen, 0, 'paths without pathLength="1"');
    eq(r.ring, 26, 'seal ring glyphs');
    assert(/^Serial [0-9A-F]{4}(-[0-9A-F]{4}){3}$/.test(r.serial), 'serial text: ' + r.serial);
    eq(r.use, 0, '<use>/<textPath> count');
    eq(r.hrefs.length, 0, 'non-route hrefs: ' + r.hrefs.join(','));
    await p.context().close();
    return `${r.paths} guilloche paths, 26 ring glyphs, ${r.serial}`;
  });

  // ---------- RC12 ----------
  await check('RC12', 'constraint lint on the served HTML', async () => {
    const html = await (await (await newPage(browser)).request.get(s.url + '/')).text();
    const styles = html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi) || [];
    const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
    eq(styles.length, 1, '<style> count');
    eq(scripts.length, 1, '<script> count');
    const css = styles[0], js = scripts[0];
    const markup = html.replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<script\b[\s\S]*?<\/script>/gi, '');
    const bad = [];
    if (/\sstyle\s*=/i.test(markup)) bad.push('style= attribute');
    if (/\son\w+\s*=/i.test(markup)) bad.push('inline event handler');
    if (/data:/i.test(css)) bad.push('data: in CSS');
    if (/url\(/i.test(css)) bad.push('url( in CSS');
    if (/@import/i.test(css)) bad.push('@import');
    if (/\b(?:href|src)\s*=\s*["']?https?:\/\//i.test(markup)) bad.push('absolute href/src');
    if (/<link\b/i.test(markup)) bad.push('<link>');
    if (/<img\b/i.test(markup)) bad.push('<img>');
    const banned = [['innerHTML', /innerHTML/], ['outerHTML', /outerHTML/], ['insertAdjacentHTML', /insertAdjacentHTML/], ['document.write', /document\.write/], ['eval(', /\beval\s*\(/], ['new Function', /new\s+Function/], ['.href =', /\.href\s*=(?!=)/], ['.style.', /\.style\./], ['xlink:href', /xlink:href/]];
    for (const [n, re] of banned) if (re.test(js)) bad.push('script uses ' + n);
    const sets = [...js.matchAll(/setAttribute\(\s*['"]href['"]\s*,\s*([^)]*)/g)].map((m) => m[1].trim());
    for (const a of sets) if (!/^['"]#\//.test(a)) bad.push('setAttribute href arg ' + a.slice(0, 30));
    assert(bad.length === 0, bad.join('; '));
    // page text in every Hello state: no "Error:" and no "{"
    const p = await newPage(browser);
    const textBad = [];
    const scan = async (label) => { const t = await p.evaluate(() => document.body.innerText); if (/Error:/.test(t) || /\{/.test(t)) textBad.push(label); };
    await p.goto(s.url + '/');
    await scan('empty');
    await tid(p, 'name-input').fill('');
    await tid(p, 'say-hello').click();
    await scan('validation');
    await p.goto(s.url + '/?chaos=delay');
    await tid(p, 'name-input').fill('Ada');
    await tid(p, 'say-hello').click();
    await tid(p, 'result-loading').waitFor({ timeout: 1500 }).catch(() => {});
    await scan('loading');
    await tid(p, 'greeting-text').waitFor({ timeout: 6000 });
    await scan('success');
    await p.goto(s.url + '/?chaos=418');
    await tid(p, 'chaos-toggle').check();
    await greet(p, 'Ada', 'en', 'formal');
    await tid(p, 'error-message').waitFor({ timeout: 5000 });
    await scan('418');
    await p.route('**/hello*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
    await p.goto(s.url + '/');
    await tid(p, 'name-input').fill('Ada');
    await tid(p, 'say-hello').click();
    await tid(p, 'error-message').waitFor({ timeout: 5000 });
    await scan('500');
    await p.context().close();
    assert(textBad.length === 0, 'Error:/{ in hello states: ' + textBad.join(','));
    return `1 style, 1 script, ${sets.length} setAttribute(href) calls all route-only, 6 hello states clean`;
  });

  // ---------- RC13 ----------
  const rc13 = [];
  await check('RC13.1', 'wall: stubbed EventSource, 3 rows, status quiet', async () => {
    const stub = () => {
      window.EventSource = class extends EventTarget {
        constructor(url) {
          super(); this.url = url; this.readyState = 0;
          setTimeout(() => {
            this.readyState = 1; this.dispatchEvent(new Event('open'));
            [['es', 'pirate'], ['fr', 'formal'], ['de', 'casual']].forEach((x, i) => setTimeout(() => this.dispatchEvent(new MessageEvent('hello', { data: JSON.stringify({ language: x[0], tone: x[1] }), lastEventId: String(i + 1) })), 30 * (i + 1)));
          }, 40);
        }
        close() { this.readyState = 2; }
      };
    };
    const p = await newPage(browser, {}, stub);
    await p.goto(s.url + '/');
    await p.evaluate(() => { window.__mut = 0; new MutationObserver((l) => { window.__mut += l.length; }).observe(document.querySelector('[data-testid=status]'), { childList: true, characterData: true, subtree: true }); });
    await tid(p, 'nav-wall').click();
    await p.waitForFunction(() => document.querySelectorAll('[data-testid=wall-item]').length === 3, null, { timeout: 4000 }).catch(async () => { throw new Error('wall-item count ' + (await tid(p, 'wall-item').count())); });
    await sleep(500);
    const rows = await tid(p, 'wall-item').allInnerTexts();
    assert(rows.every((t) => /^A [a-z]{2}\/\w+ hello/.test(t.trim())), 'row text: ' + rows.join(' | '));
    const mut = await p.evaluate(() => window.__mut);
    assert(mut <= 2, `status mutated ${mut} times`);
    await p.context().close();
    return `3 rows, ${mut} status mutation(s)`;
  });

  await check('RC13.2', 'rate limit ticket and quiet countdown', async () => {
    const r = await startServer(tmpFile('rl'), null, BIGLIM);
    try {
      const p = await newPage(browser);
      await p.clock.install();
      await p.goto(r.url + '/');
      for (let i = 0; i < 10; i++) eq((await p.request.post(r.url + '/hello', { data: { name: 'Ada' } })).status(), 200, 'warm-up hello ' + i);
      const resp = await greet(p, 'Ada');
      eq(resp.status(), 429, '11th status');
      await tid(p, 'rate-limit-message').waitFor({ timeout: 4000 });
      const lbl = (await tid(p, 'say-hello').innerText()).trim();
      assert(/^Wait \d+s$/.test(lbl), 'label ' + lbl);
      const ra = Number(resp.headers()['retry-after']) || 10;
      await p.evaluate(() => { window.__texts = []; new MutationObserver(() => { const t = document.querySelector('[data-testid=status]').textContent.trim(); if (t) window.__texts.push(t); }).observe(document.querySelector('[data-testid=status]'), { childList: true, characterData: true, subtree: true }); });
      await p.clock.runFor(Math.min(3000, ra * 1000 - 1500));
      const mid = await p.evaluate(() => window.__texts.length);
      assert(mid <= 1, `status announced ${mid} times during ticking`);
      await p.clock.runFor((ra + 2) * 1000);
      await p.waitForFunction(() => /You can say hello again\./.test(document.querySelector('[data-testid=status]').textContent), null, { timeout: 4000 });
      await p.context().close();
      return `"${lbl}", ${mid} announcement(s) while ticking, final announcement present`;
    } finally { await stop(r); }
  });

  await check('RC13.3', 'time machine 1987-05-02 state and timing', async () => {
    const run = async (reduced) => {
      const p = await newPage(browser, reduced ? { reducedMotion: 'reduce' } : {});
      await p.goto(s.url + '/#/time-machine');
      await tid(p, 'tm-date-input').fill('1987-05-02');
      const t0 = Date.now();
      await tid(p, 'tm-go').click();
      const budget = reduced ? 400 : 1400;
      await p.waitForFunction(() => { const o = document.querySelector('#tm-out'); return o && o.dataset.era === 'e4'; }, null, { timeout: budget + 1500 }).catch(() => { throw new Error(`${reduced ? 'reduced' : 'default'}: #tm-out never got data-era="e4"`); });
      if (!reduced) await p.waitForFunction(() => /1987/.test(document.querySelector('[data-testid=tm-postmark]').textContent), null, { timeout: 1500 }).catch(() => { throw new Error('postmark year never 1987'); });
      else await p.waitForFunction(() => /1987/.test(document.querySelector('[data-testid=tm-postmark]').textContent), null, { timeout: 300 }).catch(() => { throw new Error('reduced: postmark year not 1987 within 300 ms'); });
      const dt = Date.now() - t0;
      assert(dt <= budget + 200, `${reduced ? 'reduced' : 'default'} reached in ${dt} ms, budget ${budget}`);
      const pos = await tid(p, 'tm-rail').evaluate((r) => (r.dataset.pos !== undefined ? r.dataset.pos : (r.querySelector('[data-pos]') || { dataset: {} }).dataset.pos));
      eq(pos, '3', 'rail marker data-pos');
      await p.context().close();
      return dt;
    };
    const a = await run(false), b = await run(true);
    return `default ${a} ms, reduced ${b} ms; era e4, year 1987, marker 3`;
  });

  await check('RC13.4', 'weather meter, exact percent, literal markup', async () => {
    const p = await newPage(browser);
    await p.goto(s.url + '/#/weather');
    await tid(p, 'weather-place-input').fill('Lisbon');
    await tid(p, 'weather-name-input').fill('Ada');
    await tid(p, 'weather-go').click();
    await waitText(p, 'weather-chance', /Chance of warm regards: \d+%/, 5000);
    const pct = Number((await tid(p, 'weather-chance').innerText()).match(/(\d+)%/)[1]);
    const q = Number(await tid(p, 'weather-meter').getAttribute('data-q'));
    assert(Number.isFinite(q) && q % 5 === 0, 'data-q not a multiple of 5: ' + q);
    assert(Math.abs(q - pct) < 5, `data-q ${q} too far from ${pct}%`);
    await tid(p, 'weather-place-input').fill('<b>x</b>');
    await tid(p, 'weather-go').click();
    await waitText(p, 'weather-forecast', /<b>x<\/b>/, 5000);
    eq(await p.locator('#v-weather b').count(), 0, '<b> elements');
    await p.context().close();
    return `${pct}% shown, data-q ${q}, markup literal`;
  });

  await check('RC13.5', 'federation map: not configured and stubbed up/down', async () => {
    const p = await newPage(browser);
    await p.goto(s.url + '/#/federation');
    await tid(p, 'fed-empty').waitFor({ state: 'visible', timeout: 4000 });
    const hq = await tid(p, 'fed-map').evaluate((m) => ({ text: m.textContent.replace(/\s+/g, ''), idx: [...m.querySelectorAll('text')].filter((t) => /^\d$/.test(t.textContent.trim())).length, lines: m.querySelectorAll('line').length }));
    assert(/HQ/.test(hq.text) && hq.idx === 0, `map not HQ-only: ${JSON.stringify(hq)}`);
    await p.context().close();
    const q = await newPage(browser);
    await q.route('**/api/federation', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, summary: { up: 1, total: 2 }, peers: [{ origin: 'http://peer-a.test', ok: true, latencyMs: 12 }, { origin: 'http://peer-b.test', ok: false, error: 'timeout' }] }) }));
    await q.goto(s.url + '/#/federation');
    await waitText(q, 'fed-summary', /^1 of 2 peers up\.$/, 5000);
    const lines = await tid(q, 'fed-map').evaluate((m) => { const l = [...m.querySelectorAll('line')]; const dashed = l.filter((e) => { const d = getComputedStyle(e).strokeDasharray; return d && d !== 'none'; }).length; return { total: l.length, dashed, solid: l.length - dashed }; });
    assert(lines.solid === 1 && lines.dashed === 1, 'map lines ' + JSON.stringify(lines));
    await q.context().close();
    return 'HQ-only map without peers; 1 solid + 1 dashed line for 1 of 2 up';
  });

  await check('RC13.6', 'haiku card theme and verified seal', async () => {
    const p = await newPage(browser);
    await p.goto(s.url + '/#/haiku');
    await tid(p, 'haiku-name-input').fill('Ada');
    await tid(p, 'haiku-theme-select').selectOption('ocean');
    await tid(p, 'haiku-go').click();
    await tid(p, 'haiku-line').first().waitFor({ timeout: 5000 });
    eq(await tid(p, 'haiku-card').getAttribute('data-haiku'), 'ocean', 'data-haiku');
    eq((await tid(p, 'haiku-counts').innerText()).trim(), '5-7-5 verified');
    await settle(p, 4000);
    assert(await tid(p, 'haiku-seal').locator('svg').first().isVisible(), 'seal icon not visible');
    await p.context().close();
    return 'data-haiku=ocean, "5-7-5 verified" with visible icon';
  });

  // ---------- screenshots ----------
  const shotFails = [];
  async function views(p, w, cs, full) {
    const out = (name) => path.join(SHOTS, `${name}-${w}-${cs}.png`);
    const snap = async (name) => { await settle(p, 5000); await p.screenshot({ path: out(name), fullPage: full }); };
    const run = async (name, fn) => { try { await fn(); } catch (e) { shotFails.push(`${name}-${w}-${cs}: ${String(e.message).split('\n')[0].slice(0, 80)}`); } };
    await run('hello', async () => { await p.goto(s.url + '/'); await greet(p, 'Ada', 'en', 'formal'); await tid(p, 'greeting-text').waitFor({ timeout: 5000 }); await snap('hello'); });
    await run('certificate', async () => { await p.goto(s.url + '/#/certificate/' + certId); await tid(p, 'cert-name').waitFor({ timeout: 5000 }); await snap('certificate'); });
    await run('verify-authentic', async () => {
      await p.goto(s.url + '/#/verify'); await tid(p, 'verify-input').fill(T); await tid(p, 'verify-btn').click();
      await p.waitForFunction(() => { const v = document.querySelector('[data-testid=verify-verdict]'); return v && v.innerText.trim() === 'Authentic'; }, null, { timeout: 4000 });
      await snap('verify-authentic');
    });
    await run('verify-forged', async () => {
      await tid(p, 'verify-input').fill(T.replace('A', 'B')); await tid(p, 'verify-btn').click();
      await p.waitForFunction(() => { const v = document.querySelector('[data-testid=verify-verdict]'); return v && v.innerText.trim() === 'Forged'; }, null, { timeout: 4000 });
      await snap('verify-forged');
    });
    await run('battle-voted', async () => { await p.goto(s.url + '/#/battle'); await tid(p, 'battle-option-a').waitFor({ timeout: 5000 }); await tid(p, 'battle-option-a').click(); await tid(p, 'battle-next').waitFor({ timeout: 5000 }); await snap('battle-voted'); });
    await run('weather', async () => {
      await p.goto(s.url + '/#/weather'); await tid(p, 'weather-place-input').fill('Lisbon'); await tid(p, 'weather-name-input').fill('Ada'); await tid(p, 'weather-go').click();
      await waitText(p, 'weather-chance', /Chance of warm regards/, 5000); await snap('weather');
    });
    await run('wall', async () => {
      const ws = await startServer(tmpFile('wall' + w + cs), 1000, BIGLIM);
      try {
        await p.goto(ws.url + '/#/wall');
        await waitText(p, 'wall-status', /Connected/, 5000);
        for (const n of ['Ada', 'Grace']) await p.request.post(ws.url + '/hello', { data: { name: n } });
        await p.waitForFunction(() => document.querySelectorAll('[data-testid=wall-item]').length >= 2, null, { timeout: 5000 });
        await snap('wall');
      } finally { await p.goto('about:blank'); await stop(ws); }
    });
    await run('sla', async () => {
      await p.goto(s.url + '/#/sla'); await waitText(p, 'sla-total-count', /^\d+$/, 5000);
      await p.waitForFunction(() => !/Collecting samples/.test(document.body.innerText), null, { timeout: 9000 }).catch(() => {});
      await snap('sla');
    });
    await run('time-machine', async () => {
      await p.goto(s.url + '/#/time-machine'); await tid(p, 'tm-date-input').fill('1987-05-02'); await tid(p, 'tm-go').click();
      await waitText(p, 'tm-era', /disco and dial-up dawn/, 5000); await snap('time-machine');
    });
    await run('haiku', async () => {
      await p.goto(s.url + '/#/haiku'); await tid(p, 'haiku-name-input').fill('Ada'); await tid(p, 'haiku-theme-select').selectOption('ocean'); await tid(p, 'haiku-go').click();
      await tid(p, 'haiku-line').first().waitFor({ timeout: 5000 }); await snap('haiku');
    });
    await run('federation', async () => { await p.goto(s.url + '/#/federation'); await tid(p, 'fed-empty').waitFor({ state: 'visible', timeout: 5000 }); await snap('federation'); });
  }
  await check('SHOTS', 'review screenshots: 11 views x {390,1280} x {light,dark}', async () => {
    for (const [w, h] of [[390, 844], [1280, 900]]) {
      for (const cs of ['light', 'dark']) {
        const p = await newPage(browser, { viewport: { width: w, height: h }, colorScheme: cs, deviceScaleFactor: 2 });
        await views(p, w, cs, w === 390);
        await p.context().close();
      }
    }
    const n = fs.readdirSync(SHOTS).filter((f) => /-(390|1280)-(light|dark)\.png$/.test(f)).length;
    assert(shotFails.length === 0, `${shotFails.length} failed: ${shotFails.slice(0, 4).join(' | ')}`);
    return n + ' screenshots';
  });

  const extraFails = [];
  await check('SHOTS-extra', 'hello-empty, 418, 429, print preview', async () => {
    const tryIt = async (name, fn) => { try { await fn(); } catch (e) { extraFails.push(`${name}: ${String(e.message).split('\n')[0].slice(0, 80)}`); } };
    await tryIt('hello-empty-1280-light', async () => {
      const p = await newPage(browser, { colorScheme: 'light', deviceScaleFactor: 2, viewport: { width: 1280, height: 900 } });
      await p.goto(s.url + '/'); await tid(p, 'result-empty').waitFor({ timeout: 4000 }); await settle(p);
      await p.screenshot({ path: path.join(SHOTS, 'hello-empty-1280-light.png') }); await p.context().close();
    });
    await tryIt('hello-418-390-light', async () => {
      const p = await newPage(browser, { colorScheme: 'light', deviceScaleFactor: 2, viewport: { width: 390, height: 844 } });
      await p.goto(s.url + '/?chaos=418'); await tid(p, 'chaos-toggle').check(); await greet(p, 'Ada', 'en', 'formal');
      await tid(p, 'error-message').waitFor({ timeout: 5000 }); await settle(p);
      await p.screenshot({ path: path.join(SHOTS, 'hello-418-390-light.png'), fullPage: true }); await p.context().close();
    });
    await tryIt('hello-429-390-dark', async () => {
      const r = await startServer(tmpFile('rl2'), null, BIGLIM);
      try {
        const p = await newPage(browser, { colorScheme: 'dark', deviceScaleFactor: 2, viewport: { width: 390, height: 844 } });
        await p.goto(r.url + '/');
        for (let i = 0; i < 10; i++) await p.request.post(r.url + '/hello', { data: { name: 'Ada' } });
        await greet(p, 'Ada'); await tid(p, 'rate-limit-message').waitFor({ timeout: 4000 }); await settle(p);
        await p.screenshot({ path: path.join(SHOTS, 'hello-429-390-dark.png'), fullPage: true }); await p.context().close();
      } finally { await stop(r); }
    });
    await tryIt('cert-print-preview', async () => {
      const p = await newPage(browser, { colorScheme: 'light', deviceScaleFactor: 2, viewport: { width: 1280, height: 900 } });
      await p.goto(s.url + '/#/certificate/' + certId); await tid(p, 'cert-name').waitFor({ timeout: 5000 }); await settle(p, 5000);
      await p.emulateMedia({ media: 'print' });
      await p.screenshot({ path: path.join(SHOTS, 'cert-print-preview.png'), fullPage: true }); await p.context().close();
    });
    assert(fs.existsSync(path.join(SHOTS, 'cert-print-a4.pdf')), 'cert-print-a4.pdf missing (RC6 did not reach the PDF step)');
    assert(extraFails.length === 0, extraFails.join(' | '));
    return 'extra screenshots written';
  });

  await check('CONSOLE', 'no page errors or unexpected console errors (extra, not an RC)', async () => {
    assert(consoleErrors.length === 0, `${consoleErrors.length}: ${consoleErrors.slice(0, 3).join(' | ')}`);
    return '0 errors';
  });

  await browser.close();
  await stop(s).catch(() => {});
  procs.forEach((p) => { try { p.kill('SIGKILL'); } catch (e) { /* ignore */ } });
  fs.writeFileSync(path.join(SHOTS, 'results.json'), JSON.stringify(results, null, 1));
  const pass = results.filter((r) => r.ok).length;
  console.log(`\nTOTAL ${results.length} PASS ${pass} FAIL ${results.length - pass}`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); procs.forEach((p) => { try { p.kill('SIGKILL'); } catch (err) { /* ignore */ } }); process.exit(2); });
