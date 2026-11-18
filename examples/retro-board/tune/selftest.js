#!/usr/bin/env node
'use strict';
// node tune/selftest.js [--only discover,ux] [--no-seeds] [--verbose]
// 1. Builds every phase base and checks it (one commit, prompt present, no golden answer leaked into it).
// 2. Runs every grader against the golden artifact (must be ACCEPTED) and against empty and degraded artifacts
//    (must be REJECTED) and prints a table. No `claude` process is started.
// 3. Proves the seeded defects are real: each changes behaviour (HTTP probes, a store probe, and a browser probe
//    for the UI seeds, when Playwright is available).
// Exit code 0 only if every expectation holds.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const U = require('./lib/util');
const { makeBases, layout, PLANS } = require('./make-bases');
const S = require('./seeds/seeds');
const { extractRoutes } = require('./lib/routes');

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : U.PHASES;
const skipSeeds = args.includes('--no-seeds');

const write = (root, rel, text) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
const goldenDoc = (n) => U.read(path.join(U.GOLDEN_DOCS, `${n}.md`));
const docPath = (n) => path.join(U.DOCS_REL, `${n}.md`);
const appPath = (...p) => path.join(U.APP_REL, ...p);
const copyGoldenApp = (wt, ...names) => { for (const n of names) U.copy(path.join(U.GOLDEN_APP, n), path.join(wt, appPath(n))); };

const cutAt = (text, marker) => { const i = text.indexOf(marker); return i < 0 ? text : text.slice(0, i); };

// scenario: {name, expect: 'accept'|'reject', apply(worktree)}
const SCENARIOS = {
  discover: [
    { name: 'golden', expect: 'accept', apply: (wt) => write(wt, docPath('brief'), goldenDoc('brief')) },
    { name: 'empty', expect: 'reject', apply: (wt) => write(wt, docPath('brief'), '') },
    { name: 'degraded: no sources, 4 criteria, no defaults', expect: 'reject', apply: (wt) => {
      let t = goldenDoc('brief').replace(/https?:\/\/\S+/g, '');
      t = t.replace(/\n(?:[5-9]|1[0-5])\. [^\n]*/g, '');
      t = t.replace(/\*\*(?:No|Yes|Not in the MVP|Needs a human)[^*]*\*\*/g, '').replace(/\*\*[^*]+\*\*/g, '');
      write(wt, docPath('brief'), t);
    } },
  ],
  ux: [
    { name: 'golden', expect: 'accept', apply: (wt) => write(wt, docPath('ux'), goldenDoc('ux')) },
    { name: 'empty', expect: 'reject', apply: (wt) => write(wt, docPath('ux'), '') },
    { name: 'degraded: journeys only, no states or checks', expect: 'reject', apply: (wt) => write(wt, docPath('ux'), cutAt(goldenDoc('ux'), '## Screens and states')) },
  ],
  design: [
    { name: 'golden', expect: 'accept', apply: (wt) => write(wt, docPath('design'), goldenDoc('design')) },
    { name: 'empty', expect: 'reject', apply: (wt) => write(wt, docPath('design'), '') },
    { name: 'degraded: first 4 sections only', expect: 'reject', apply: (wt) => write(wt, docPath('design'), cutAt(goldenDoc('design'), '## 5.')) },
  ],
  tests: [
    { name: 'golden', expect: 'accept', apply: (wt) => copyGoldenApp(wt, 'acceptance', 'spec.md') },
    { name: 'empty', expect: 'reject', apply: () => {} },
    { name: 'degraded: 30 vacuous tests that always pass', expect: 'reject', apply: (wt) => {
      copyGoldenApp(wt, 'spec.md');
      U.copy(path.join(U.GOLDEN_APP, 'acceptance', 'helpers.js'), path.join(wt, appPath('acceptance', 'helpers.js')));
      const body = Array.from({ length: 30 }, (_, i) => `test('behaves ${i}', () => { assert.ok(true); });`).join('\n');
      write(wt, appPath('acceptance', 'vacuous.test.js'), `'use strict';\nconst { test } = require('node:test');\nconst assert = require('node:assert/strict');\n${body}\n`);
    } },
    { name: 'degraded: 12 real tests (too few)', expect: 'reject', apply: (wt) => {
      copyGoldenApp(wt, 'acceptance', 'spec.md');
      const f = path.join(wt, appPath('acceptance', 'pages.acceptance.test.js'));
      U.rmrf(f);
      const api = path.join(wt, appPath('acceptance', 'api.acceptance.test.js'));
      const parts = U.read(api).split(/\n(?=test\()/);
      fs.writeFileSync(api, [parts[0], ...parts.slice(1, 13)].join('\n'));
    } },
  ],
  build: [
    { name: 'golden', expect: 'accept', apply: (wt) => copyGoldenApp(wt, 'src', 'public', 'tests') },
    { name: 'empty', expect: 'reject', apply: () => {} },
    { name: 'degraded: golden code, one placeholder unit test', expect: 'reject', apply: (wt) => {
      copyGoldenApp(wt, 'src', 'public');
      write(wt, appPath('tests', 'placeholder.test.js'), "'use strict';\nconst { test } = require('node:test');\ntest('works', () => { require('node:assert').ok(true); });\n");
    } },
    { name: 'degraded: golden tests, vote budget off by one', expect: 'reject', apply: (wt) => {
      copyGoldenApp(wt, 'src', 'public', 'tests');
      S.applySeeds(path.join(wt, U.APP_REL), [S.REVIEW_SEEDS[0]]);
    } },
  ],
  review: [
    { name: 'golden', expect: 'accept', apply: (wt) => U.copy(path.join(U.GOLDEN, 'reports', 'review-report.md'), path.join(wt, 'review-report.md')) },
    { name: 'empty', expect: 'reject', apply: () => {} },
    { name: 'degraded: files named, no defect found', expect: 'reject', apply: (wt) => write(wt, 'review-report.md', `# Review\n\nVerdict: approve.\n\nI read src/board.js, src/router.js, src/store.js and public/js/board.js. The code is readable and well organised. Naming is consistent, the modules are small, and the files follow the design. Minor style remarks: some long lines in router.js, a few comments could be shorter. The store.js module is easy to follow and board.js has clear helpers. Nothing blocks a release.\n\n### F1: Long lines\nSeverity: LOW\nFile: examples/retro-board/src/router.js:20\nWhat: some lines exceed 120 characters.\nFix: wrap them.\n`) },
    { name: 'degraded: only 3 of 5 seeds found', expect: 'reject', apply: (wt) => {
      const full = U.read(path.join(U.GOLDEN, 'reports', 'review-report.md'));
      const keep = full.split(/\n(?=### F)/).filter((s, i) => i === 0 || /^### F[123]/.test(s));
      write(wt, 'review-report.md', keep.join('\n'));
    } },
    { name: 'degraded: all findings present but the code was "fixed"', expect: 'reject', apply: (wt) => {
      U.copy(path.join(U.GOLDEN, 'reports', 'review-report.md'), path.join(wt, 'review-report.md'));
      U.copy(path.join(U.GOLDEN_APP, 'src', 'board.js'), path.join(wt, appPath('src', 'board.js')));
    } },
  ],
  qa: [
    { name: 'golden', expect: 'accept', apply: (wt) => U.copy(path.join(U.GOLDEN, 'reports', 'qa-report.md'), path.join(wt, 'qa-report.md')) },
    { name: 'empty', expect: 'reject', apply: () => {} },
    { name: 'degraded: everything passes, no defects', expect: 'reject', apply: (wt) => write(wt, 'qa-report.md', `# QA\n\n${Array.from({ length: 15 }, (_, i) => `CHECK ${i + 1}: PASS - works as described`).join('\n')}\n\nNo defects found. The vote count updates, delete asks for confirmation and closing hides the form.\n`) },
    { name: 'degraded: defects named but only 5 checks pass', expect: 'reject', apply: (wt) => {
      const t = U.read(path.join(U.GOLDEN, 'reports', 'qa-report.md')).replace(/^CHECK (6|10|12|13|14): PASS/gm, 'CHECK $1: FAIL');
      write(wt, 'qa-report.md', t);
    } },
    { name: 'degraded: only one defect named', expect: 'reject', apply: (wt) => {
      const t = U.read(path.join(U.GOLDEN, 'reports', 'qa-report.md')).split('\n').filter((l) => !/^DEFECT [23]|^CHECK (9|11|15)/.test(l)).join('\n');
      write(wt, 'qa-report.md', t);
    } },
  ],
  release: [
    { name: 'golden', expect: 'accept', apply: (wt) => U.copy(path.join(U.GOLDEN_APP, 'README.md'), path.join(wt, appPath('README.md'))) },
    { name: 'empty', expect: 'reject', apply: () => {} },
    { name: 'degraded: invented config, no test command', expect: 'reject', apply: (wt) => write(wt, appPath('README.md'), '# Retro board\n\nRun `npm start`. Set `PORT`, `HOST` and `DATA_DIR`, `MAX_BOARDS`. Also set `RETRO_SECRET` and `LOG_LEVEL=debug`.\n\nShare the participant link and keep the facilitator link private.\n\n' + 'More text so the file is long enough to count as a README. '.repeat(8) + '\n') },
    { name: 'degraded: 130 lines', expect: 'reject', apply: (wt) => write(wt, appPath('README.md'), `${U.read(path.join(U.GOLDEN_APP, 'README.md'))}\n${Array.from({ length: 60 }, (_, i) => `Extra line ${i}.`).join('\n')}\n`) },
  ],
};

function runGrader(phase, scenario, bases) {
  const wt = U.tmp(`selftest-${phase}-`);
  try {
    U.copy(bases[phase], wt, (src) => path.basename(src) !== '.git');
    scenario.apply(wt);
    const t0 = Date.now();
    const r = U.run(process.execPath, [path.join(U.TUNE, 'graders', `${phase}.js`)], { cwd: wt, timeoutMs: 12 * 60_000 });
    return { code: r.code, out: r.out, seconds: (Date.now() - t0) / 1000 };
  } finally {
    U.rmrf(wt);
  }
}

function checkBases(bases) {
  const problems = [];
  const git = (cwd, a) => require('node:child_process').execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
  for (const [phase, dir] of Object.entries(bases)) {
    if (git(dir, ['rev-list', '--count', 'HEAD']) !== '1') problems.push(`${phase}: more than one commit`);
    if (git(dir, ['status', '--porcelain']) !== '') problems.push(`${phase}: uncommitted files`);
    const files = git(dir, ['ls-files']).split('\n');
    if (!files.includes('TASK.md')) problems.push(`${phase}: no TASK.md`);
    if (files.some((f) => f.startsWith('tune/') || f.startsWith('.claude/') || /holdout/i.test(f))) problems.push(`${phase}: contains kit or harness files`);
    const blob = files.map((f) => U.readIf(path.join(dir, f)) || '').join('\n');
    if (/\/home\/user\/claude-setup|scratchpad|holdout\.test/i.test(blob)) problems.push(`${phase}: mentions a local path or the holdout file`);
    const inApp = (n) => files.some((f) => f.startsWith(`${U.APP_REL}/${n}`));
    const want = {
      discover: {}, ux: {}, design: {}, tests: {},
      build: { src: false, public: false, tests: false, acceptance: true },
      review: { src: true, public: true, tests: false, acceptance: false },
      qa: { src: true, public: true, tests: false, acceptance: false },
      release: { src: true, public: true, tests: true, acceptance: true },
    }[phase];
    for (const [n, yes] of Object.entries(want)) if (inApp(`${n}/`) !== yes) problems.push(`${phase}: ${n}/ ${yes ? 'missing' : 'present'}`);
    if (phase === 'release' && inApp('README.md')) problems.push('release: README.md present');
    const doc = (n) => files.includes(`${U.DOCS_REL}/${n}.md`);
    const wantDocs = { discover: [], ux: ['brief'], design: ['brief', 'ux'], tests: ['brief', 'ux', 'design'], build: ['brief', 'ux', 'design'], review: ['design'], qa: ['ux'], release: ['brief', 'design'] }[phase];
    for (const n of ['brief', 'ux', 'design']) if (doc(n) !== wantDocs.includes(n)) problems.push(`${phase}: docs ${n}.md ${wantDocs.includes(n) ? 'missing' : 'present (not an input of this phase)'}`);
  }
  return problems;
}

// ---- seed proofs --------------------------------------------------------------------------------------------

function stageApp(seeds) {
  const d = U.tmp('selftest-seed-');
  U.copy(U.GOLDEN_APP, d);
  if (seeds.length) S.applySeeds(d, seeds);
  return d;
}

function rawGet(port, pathname, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: 'GET', headers, agent: false }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end();
  });
}

const PROBES = {
  'vote-budget': async (dir) => {
    const H = require(path.join(dir, 'acceptance', 'helpers.js'));
    return H.withServer(async (s) => {
      const { p } = await H.createBoard(s);
      const ids = [];
      for (let i = 0; i < 5; i += 1) ids.push((await H.addCard(s, p, 'went-well', `card ${i}`, H.newClientId())).card.id);
      const me = H.newClientId();
      const codes = [];
      for (const id of ids.slice(0, 5)) codes.push((await H.vote(s, p, id, me)).status);
      return `votes 1-5 -> ${codes.join(',')}`;
    });
  },
  'token-compare': async (dir) => {
    // timing-only: prove the line is on the live path by making it throw
    const f = path.join(dir, 'src', 'router.js');
    const text = U.read(f);
    const live = text.replace(/tokens\.sha256Hex\(f\) === b\.facHash;/, '(() => { throw new Error("probe"); })();');
    fs.writeFileSync(f, live);
    const H = require(path.join(dir, 'acceptance', 'helpers.js'));
    return H.withServer(async (s) => {
      const { p, f: fac } = await H.createBoard(s);
      const res = await H.getFacBoard(s, p, fac);
      return `facilitator GET -> ${res.status}`;
    });
  },
  'swap-before-write': async (dir) => {
    const nodeFs = require('node:fs');
    const { createStore } = require(path.join(dir, 'src', 'store.js'));
    const { createBoard } = require(path.join(dir, 'src', 'board.js'));
    const data = U.tmp('selftest-store-');
    try {
      let failing = false;
      const fs2 = { ...nodeFs, renameSync: (...a) => { if (failing) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); return nodeFs.renameSync(...a); } };
      const store = createStore({ dir: data, fs: fs2, log: () => {} });
      store.open();
      store.create('a'.repeat(64), createBoard('original', 'f'.repeat(64)));
      failing = true;
      let thrown = 'no error';
      try { store.update('a'.repeat(64), (b) => { b.title = 'changed'; }); } catch (e) { thrown = e.code; }
      const b = store.get('a'.repeat(64));
      store.close();
      return `write failed (${thrown}); in-memory title "${b.title}", version ${b.version}`;
    } finally { U.rmrf(data); }
  },
  'origin-absent': async (dir) => {
    const H = require(path.join(dir, 'acceptance', 'helpers.js'));
    return H.withServer(async (s) => `GET / with Host evil.example.com and no Origin -> ${await rawGet(s.port, '/', { host: 'evil.example.com' })}`);
  },
  'inner-html': async (dir) => {
    const hits = fs.readdirSync(path.join(dir, 'public', 'js')).filter((f) => /\b(?:innerHTML|outerHTML)\s*=/.test(U.read(path.join(dir, 'public', 'js', f))));
    return `files assigning innerHTML: ${hits.join(',') || 'none'}`;
  },
};

async function browserProbes(rows) {
  let pw;
  try { pw = require('playwright'); } catch { rows.push({ id: '(browser probes)', note: 'SKIPPED: playwright is not installed', ok: true }); return; }
  const mk = async (seeds, fn) => {
    const dir = stageApp(seeds);
    const H = require(path.join(dir, 'acceptance', 'helpers.js'));
    const browser = await pw.chromium.launch();
    try {
      return await H.withServer(async (s) => {
        const mkPage = async (url) => { const ctx = await browser.newContext(); const page = await ctx.newPage(); await page.goto(`${s.base}${url}`); await page.waitForSelector('[data-testid="board-title"]'); return page; };
        return fn(s, H, mkPage);
      });
    } finally { await browser.close(); U.rmrf(dir); }
  };
  const probes = {
    'vote-count-stale': async (s, H, mkPage) => {
      const { p } = await H.createBoard(s);
      await H.addCard(s, p, 'went-well', 'first', H.newClientId());
      const page = await mkPage(`/b/${p}`);
      await page.click('[data-testid="vote-btn"]');
      await page.waitForFunction(() => /1 vote/.test(document.querySelector('[data-testid="votes-left"]').textContent) === false);
      await page.waitForTimeout(400);
      const shown = (await page.textContent('[data-testid="vote-count"]')).trim();
      await page.reload(); await page.waitForSelector('[data-testid="card"]');
      return `count after click "${shown}", after reload "${(await page.textContent('[data-testid="vote-count"]')).trim()}"`;
    },
    'delete-no-confirm': async (s, H, mkPage) => {
      const { p } = await H.createBoard(s);
      const page = await mkPage(`/b/${p}`);
      await page.fill('[data-testid="new-went-well"]', 'mine');
      await page.click('[data-testid="add-went-well"]');
      await page.waitForSelector('[data-testid="delete-btn"]');
      await page.click('[data-testid="delete-btn"]');
      await page.waitForTimeout(400);
      return `confirm shown: ${await page.locator('[data-testid="delete-confirm"]').count() > 0}, card still there: ${await page.locator('[data-testid="card"]').count() > 0}`;
    },
    'closed-form-visible': async (s, H, mkPage) => {
      const { p, f } = await H.createBoard(s);
      const page = await mkPage(`/b/${p}/f/${f}`);
      await page.click('[data-testid="close-retro"]');
      await page.waitForSelector('[data-testid="closed-banner"]');
      await page.waitForTimeout(300);
      return `add form present after close: ${await page.locator('[data-testid="add-went-well"]').count() > 0}`;
    },
    'inner-html (browser)': async (s, H, mkPage) => {
      const { p } = await H.createBoard(s);
      const page = await mkPage(`/b/${p}`);
      await page.fill('[data-testid="new-went-well"]', '<b>hi</b>');
      await page.click('[data-testid="add-went-well"]');
      await page.waitForSelector('li.card:not(.is-saving)');
      await page.waitForTimeout(400);
      return `<b> element inside card text: ${await page.locator('.card-text b').count() > 0}`;
    },
  };
  const seedFor = { 'vote-count-stale': S.QA_SEEDS[0], 'delete-no-confirm': S.QA_SEEDS[1], 'closed-form-visible': S.QA_SEEDS[2], 'inner-html (browser)': S.REVIEW_SEEDS.find((x) => x.id === 'inner-html') };
  for (const [id, fn] of Object.entries(probes)) {
    try {
      const golden = await mk([], fn);
      const seeded = await mk([seedFor[id]], fn);
      rows.push({ id, golden, seeded, ok: golden !== seeded });
    } catch (e) { rows.push({ id, note: `ERROR ${e.message.split('\n')[0]}`, ok: false }); }
  }
}

async function seedProofs() {
  const rows = [];
  for (const seed of S.REVIEW_SEEDS) {
    const dirG = stageApp([]);
    const dirS = stageApp([seed]);
    try {
      const golden = await PROBES[seed.id](dirG);
      const seeded = await PROBES[seed.id](dirS);
      rows.push({ id: seed.id, golden, seeded, ok: golden !== seeded });
    } catch (e) { rows.push({ id: seed.id, note: `ERROR ${e.message.split('\n')[0]}`, ok: false }); }
    finally { U.rmrf(dirG); U.rmrf(dirS); }
  }
  await browserProbes(rows);
  return rows;
}


// ---- driver plumbing (no claude, no real tune.js) ------------------------------------------------------------

// Runs run.js against a stub harness whose tune.js only checks its arguments and writes a fake report.
function driverPlumbing() {
  const rows = [];
  const dir = U.tmp('selftest-driver-');
  try {
    const stub = path.join(dir, 'harness');
    write(stub, path.join('bin', 'tune.js'), `'use strict';
const fs = require('node:fs'); const path = require('node:path'); const cp = require('node:child_process');
const a = process.argv.slice(2); const get = (k) => a[a.indexOf(k) + 1];
const base = process.env.CLAUDE_PROJECT_DIR; const bad = [];
fs.writeFileSync(path.join(__dirname, '..', 'ran'), '1');
if (get('--task-file') !== 'TASK.md') bad.push('task-file');
if (!/^node ".*graders[/]\\w+\\.js"$/.test(get('--verify'))) bad.push('verify=' + get('--verify'));
if (get('--agent-timeout-min') !== '20') bad.push('timeout');
if (!fs.existsSync(path.join(base, 'TASK.md'))) bad.push('TASK.md');
if (cp.execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: base, encoding: 'utf8' }).trim() !== '1') bad.push('history');
if (bad.length) { console.error('STUB: ' + bad.join(', ')); process.exit(2); }
if (path.basename(base) === 'ux') process.exit(2);
const results = get('--candidates').split(',').map((c) => { const i = c.lastIndexOf(':'); return { model: c.slice(0, i), effort: c.slice(i + 1), passRate: 0.5, trials: Number(get('--trials')), meanCostUsd: 0.1, meanSeconds: 5, meanOutputTokens: 100, meanTurns: 3, meanInputTokens: 1 }; });
fs.mkdirSync(path.join(base, '.harness'), { recursive: true });
fs.writeFileSync(path.join(base, '.harness', 'tune-report.json'), JSON.stringify({ results, best: null }));
process.exit(1);
`);
    const out = path.join(dir, 'report.json');
    const env = { ...process.env, HARNESS_DIR: stub };
    const r = U.run(process.execPath, [path.join(U.TUNE, 'run.js'), '--phases', 'discover,ux,design', '--levels', 'low,high', '--trials', '2', '--model', 'claude-sonnet-5-5', '--out', out], { env, timeoutMs: 60_000 });
    let rep = null;
    try { rep = JSON.parse(U.read(out)); } catch { /* reported below */ }
    const p = rep && rep.phases;
    const good = p && p.length === 3 && p[0].phase === 'discover' && p[0].results.length === 2 && p[0].results[1].effort === 'high' && p[0].results[0].model === 'claude-sonnet-5-5'
      && p[0].results[0].trials === 2 && p[0].results[0].meanTurns === 3 && !('meanInputTokens' in p[0].results[0])
      && p[1].phase === 'ux' && p[1].results.length === 0 && p[1].error && p[2].results.length === 2;
    rows.push({ id: 'run.js merges per-phase reports and keeps going after a failed phase', ok: Boolean(good), note: good ? 'discover ok, ux failed (recorded), design ok' : `unexpected: ${r.out.slice(-400)}` });
    U.rmrf(path.join(stub, 'ran'));
    const dry = U.run(process.execPath, [path.join(U.TUNE, 'run.js'), '--phases', 'review', '--dry-run', '--out', path.join(dir, 'dry.json')], { env, timeoutMs: 60_000 });
    rows.push({ id: 'run.js --dry-run prints the tune.js command and runs nothing', ok: dry.code === 0 && /graders[/]review\.js/.test(dry.out) && /--candidates claude-sonnet-5-5:low,claude-sonnet-5-5:medium,claude-sonnet-5-5:high/.test(dry.out) && !U.exists(path.join(dir, 'harness', 'ran')), note: dry.out.split('\n').find((l) => l.startsWith('== ')) || dry.out.slice(-200) });
  } finally { U.rmrf(dir); }
  return rows;
}

// ---- main ---------------------------------------------------------------------------------------------------------

(async () => {
  const work = U.tmp('retro-selftest-');
  let bad = 0;
  try {
    const bases = makeBases(path.join(work, 'bases'), U.PHASES);
    const baseProblems = checkBases(bases);
    console.log(`bases: ${Object.keys(bases).length} built, ${baseProblems.length === 0 ? 'one commit each, only phase inputs, prompt present' : 'PROBLEMS'}`);
    for (const p of baseProblems) { console.log(`  ! ${p}`); bad += 1; }

    const golden = JSON.parse(U.read(path.join(U.GOLDEN, 'routes.json')));
    const mine = extractRoutes(goldenDoc('design'));
    const missingRoutes = golden.filter((g) => !mine.has(g));
    console.log(`route list: ${golden.length} golden routes, extractor finds ${golden.length - missingRoutes.length} in golden design.md`);
    if (missingRoutes.length) { console.log(`  ! not found: ${missingRoutes.join(' | ')}`); bad += 1; }

    const table = [];
    for (const phase of only) {
      if (!SCENARIOS[phase]) { console.log(`unknown phase ${phase}`); bad += 1; continue; }
      for (const sc of SCENARIOS[phase]) {
        const r = runGrader(phase, sc, bases);
        const accepted = r.code === 0;
        const ok = (sc.expect === 'accept') === accepted;
        if (!ok) bad += 1;
        table.push({ phase, scenario: sc.name, expect: sc.expect, got: accepted ? 'ACCEPTED' : r.code === 1 ? 'REJECTED' : `ERROR(${r.code})`, ok, seconds: r.seconds });
        if (verbose || !ok) console.log(`--- ${phase} / ${sc.name} (exit ${r.code})\n${r.out.split('\n').map((l) => `    ${l}`).join('\n')}`);
        else if (sc.expect === 'reject') {
          const fails = r.out.split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 2).map((l) => l.slice(0, 110));
          table[table.length - 1].why = fails.join(' || ');
        }
      }
    }

    const w = (s, n) => String(s).padEnd(n);
    console.log(`\n${w('grader', 9)} ${w('scenario', 50)} ${w('expect', 7)} ${w('result', 10)} ${w('ok', 3)} secs`);
    for (const t of table) console.log(`${w(t.phase, 9)} ${w(t.scenario, 50)} ${w(t.expect, 7)} ${w(t.got, 10)} ${w(t.ok ? 'yes' : 'NO', 3)} ${t.seconds.toFixed(1)}`);
    console.log('\nwhy the degraded artifacts were rejected (first failing checks):');
    for (const t of table.filter((x) => x.why)) console.log(`  ${t.phase} / ${t.scenario}: ${t.why}`);

    console.log('\ndriver plumbing (stub harness, no claude):');
    for (const row of driverPlumbing()) { if (!row.ok) bad += 1; console.log(`  ${row.ok ? 'ok ' : 'BAD'} ${row.id}: ${row.note}`); }

    if (!skipSeeds) {
      console.log('\nseeded defects change behaviour (golden vs seeded):');
      for (const row of await seedProofs()) {
        if (!row.ok) bad += 1;
        console.log(`  ${row.ok ? 'ok ' : 'BAD'} ${row.id}: ${row.note || `golden [${row.golden}]  seeded [${row.seeded}]`}`);
      }
    }
  } finally {
    U.rmrf(work);
  }
  console.log(bad === 0 ? '\nSELFTEST PASSED' : `\nSELFTEST FAILED (${bad} problem(s))`);
  process.exitCode = bad === 0 ? 0 : 1;
})().catch((e) => { console.error(e.stack); process.exitCode = 2; });

void layout; void PLANS;
