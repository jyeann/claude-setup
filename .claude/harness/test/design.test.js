'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const design = require('../lib/design');

const ROOT = path.join(__dirname, '..');
const HOOKS = path.join(ROOT, 'hooks');
const BIN = path.join(ROOT, 'bin', 'design-check.js');
const TEMPLATES = path.join(ROOT, 'templates');
const PAGE = 'https://claude.ai/code/artifact/1111-aaaa';
const OTHER_PAGE = 'https://claude.ai/artifact/2222-bbbb';

const project = () => fs.mkdtempSync(path.join(os.tmpdir(), 'harness-design-'));
const write = (dir, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
const register = (dir, product, pages) => write(dir, `docs/design/${product}/pages.json`, JSON.stringify({ product, pages }, null, 2));
const readRegister = (dir, product) => JSON.parse(fs.readFileSync(path.join(dir, 'docs/design', product, 'pages.json'), 'utf8'));
const publish = (input, session = 'sess-owner') => ({ tool_name: 'Artifact', session_id: session, tool_input: { action: 'publish', ...input } });
const runHook = (name, dir, event) => spawnSync('node', [path.join(HOOKS, name)], {
  input: JSON.stringify(event), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
});
const runBin = (dir, ...args) => spawnSync('node', [BIN, '--root', dir, ...args], { encoding: 'utf8' });

const FILLED_DIRECTION = `# Design direction: gachi

## Look
Flat pastel, thick outlines, chosen 2026-11-25 from variation B.

## Tool
Blender only.

## Characters
- Gachi (cat), Mochi (rabbit)

## Reference images
- docs/design/gachi/references/variation-b.png

## Changed
- 2026-11-25: owner moved from 3D render to flat pastel.
`;

const FILLED_BRIEF = `# Brief: idle animations

## Task
Make the idle loop for Mochi.

## Direction
Read docs/design/gachi/direction.md before starting. It is the current direction.

## Page and owner
Page ${PAGE} is owned by session sess-owner. Do not publish to it.

## Hand back
Send the finished files to the owning session; it publishes.

## Done means
The loop plays at 24 fps with no pop at the seam.
`;

// --- direction file ---

test('the filled direction template passes the direction check', () => {
  assert.deepEqual(design.checkDirection(FILLED_DIRECTION), []);
});

test('direction check names a missing section', () => {
  const problems = design.checkDirection(FILLED_DIRECTION.replace(/## Tool\nBlender only.\n\n/, ''));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Tool/);
});

test('direction check names a section left empty or as a placeholder', () => {
  const text = FILLED_DIRECTION.replace('Blender only.', '<the one tool used for assets>').replace('- Gachi (cat), Mochi (rabbit)\n', '');
  const problems = design.checkDirection(text);
  assert.equal(problems.length, 2);
  assert.ok(problems.some((p) => /Tool/.test(p)));
  assert.ok(problems.some((p) => /Characters/.test(p)));
});

test('the shipped direction template is reported as unfilled', () => {
  const template = fs.readFileSync(path.join(TEMPLATES, 'design-direction.md'), 'utf8');
  assert.equal(design.checkDirection(template).length, design.DIRECTION_SECTIONS.length);
});

// --- brief ---

test('a filled brief that links the direction file passes', () => {
  assert.deepEqual(design.checkBrief(FILLED_BRIEF, { directionText: FILLED_DIRECTION }), []);
});

test('a brief that does not link the direction file fails', () => {
  const problems = design.checkBrief(FILLED_BRIEF.replace('docs/design/gachi/direction.md', 'the direction'));
  assert.ok(problems.some((p) => /direction\.md/.test(p)));
});

test('a brief that restates a direction section heading fails', () => {
  const problems = design.checkBrief(`${FILLED_BRIEF}\n## Tool\nBlender only.\n`);
  assert.ok(problems.some((p) => /restates.*Tool/.test(p)));
});

test('a brief that copies a line of the direction file fails', () => {
  const brief = FILLED_BRIEF.replace('Make the idle loop for Mochi.', 'Make the idle loop. Flat pastel, thick outlines, chosen 2026-11-25 from variation B.');
  const problems = design.checkBrief(brief, { directionText: FILLED_DIRECTION });
  assert.ok(problems.some((p) => /copies/.test(p)));
});

test('a brief with an unfilled section fails, and the shipped template is unfilled', () => {
  assert.ok(design.checkBrief(FILLED_BRIEF.replace('Make the idle loop for Mochi.', '<what to make>')).some((p) => /Task/.test(p)));
  const template = fs.readFileSync(path.join(TEMPLATES, 'design-brief.md'), 'utf8');
  assert.ok(design.checkBrief(template).length >= design.BRIEF_SECTIONS.length);
});

// --- page register ---

test('register check accepts a valid register and rejects broken ones', () => {
  assert.deepEqual(design.checkRegister({ product: 'gachi', pages: [{ url: PAGE, owner: 's1' }] }), []);
  assert.ok(design.checkRegister({ pages: 'x' }).length > 0);
  assert.ok(design.checkRegister({ product: 'g', pages: [{ url: PAGE }] }).some((p) => /owner/.test(p)));
  assert.ok(design.checkRegister({ product: 'g', pages: [{ owner: 's1' }] }).some((p) => /url or file/.test(p)));
  const dup = design.checkRegister({ product: 'g', pages: [{ url: PAGE, owner: 'a' }, { url: `${PAGE}/`, owner: 'b' }] });
  assert.ok(dup.some((p) => /twice/.test(p)));
});

test('page urls compare without query, hash, trailing slash or the /code segment', () => {
  assert.equal(design.normalizeUrl(`${PAGE}/?v=3#top`), 'https://claude.ai/artifact/1111-aaaa');
  assert.equal(design.normalizeUrl(undefined), '');
});

// --- publish guard ---

test('a publish to a page owned by another session is blocked and names the owner', () => {
  const dir = project();
  register(dir, 'gachi', [{ url: PAGE, file: 'docs/design/gachi/pages/look.html', owner: 'sess-owner' }]);
  const byUrl = design.checkPublish(publish({ url: PAGE, file_path: '/tmp/x.html' }, 'sess-other'), dir);
  assert.equal(byUrl.block, true);
  assert.match(byUrl.reason, /sess-owner/);
  assert.match(byUrl.reason, /hand/i);
  const byFile = design.checkPublish(publish({ file_path: path.join(dir, 'docs/design/gachi/pages/look.html') }, 'sess-other'), dir);
  assert.equal(byFile.block, true);
});

test('an asset upload to another session\'s page is blocked too', () => {
  const dir = project();
  register(dir, 'gachi', [{ url: PAGE, owner: 'sess-owner' }]);
  assert.equal(design.checkPublish(publish({ url: PAGE, asset: true, file_path: 'a.png' }, 'sess-other'), dir).block, true);
});

test('the owning session and unregistered pages may publish', () => {
  const dir = project();
  register(dir, 'gachi', [{ url: PAGE, owner: 'sess-owner' }]);
  assert.equal(design.checkPublish(publish({ url: PAGE }), dir).block, false);
  assert.equal(design.checkPublish(publish({ url: OTHER_PAGE }, 'sess-other'), dir).block, false);
  assert.equal(design.checkPublish(publish({ file_path: 'new.html' }, 'sess-other'), dir).block, false);
});

test('reads and other tools are never blocked by the publish guard', () => {
  const dir = project();
  register(dir, 'gachi', [{ url: PAGE, owner: 'sess-owner' }]);
  assert.equal(design.checkPublish({ ...publish({ url: PAGE }, 'x'), tool_input: { action: 'read', url: PAGE } }, dir).block, false);
  assert.equal(design.checkPublish({ tool_name: 'Bash', tool_input: { command: 'ls' } }, dir).block, false);
});

test('a session with no id cannot publish to an owned page', () => {
  const dir = project();
  register(dir, 'gachi', [{ url: PAGE, owner: 'sess-owner' }]);
  assert.equal(design.checkPublish({ tool_name: 'Artifact', tool_input: { url: PAGE } }, dir).block, true);
});

test('a broken register blocks publishing to any page until it is fixed', () => {
  const dir = project();
  write(dir, 'docs/design/gachi/pages.json', '{not json');
  const v = design.checkPublish(publish({ url: OTHER_PAGE }), dir);
  assert.equal(v.block, true);
  assert.match(v.reason, /pages\.json/);
});

// --- claim after publish ---

test('a first publish records its session as owner in the product register', () => {
  const dir = project();
  const file = path.join(dir, 'docs/design/gachi/pages/look.html');
  write(dir, 'docs/design/gachi/pages/look.html', '<p>x</p>');
  const event = { ...publish({ file_path: file }), tool_response: { content: [{ type: 'text', text: `Published to ${PAGE}` }] } };
  const claimed = design.claimPublish(event, dir, () => '2026-11-26T00:00:00Z');
  assert.equal(claimed.claimed, true);
  assert.deepEqual(readRegister(dir, 'gachi').pages, [
    { url: design.normalizeUrl(PAGE), file: 'docs/design/gachi/pages/look.html', owner: 'sess-owner', claimedAt: '2026-11-26T00:00:00Z' },
  ]);
});

test('a later publish from another session does not change the owner', () => {
  const dir = project();
  register(dir, 'gachi', [{ url: PAGE, owner: 'sess-owner' }]);
  const event = { ...publish({ url: PAGE }, 'sess-other'), tool_response: `ok ${PAGE}` };
  assert.equal(design.claimPublish(event, dir).claimed, false);
  assert.equal(readRegister(dir, 'gachi').pages[0].owner, 'sess-owner');
});

test('the only product folder takes the claim when the file is outside docs/design', () => {
  const dir = project();
  register(dir, 'gachi', []);
  const event = { ...publish({ file_path: '/tmp/scratch/look.html' }), tool_response: `ok ${OTHER_PAGE}` };
  assert.equal(design.claimPublish(event, dir).claimed, true);
  assert.equal(readRegister(dir, 'gachi').pages[0].url, OTHER_PAGE);
  assert.equal(readRegister(dir, 'gachi').pages[0].file, undefined);
});

test('no claim without a product folder, a page url, an Artifact publish or a session', () => {
  const none = project();
  assert.equal(design.claimPublish({ ...publish({ file_path: 'x.html' }), tool_response: PAGE }, none).claimed, false);
  const two = project();
  register(two, 'a', []);
  register(two, 'b', []);
  assert.equal(design.claimPublish({ ...publish({ file_path: '/tmp/x.html' }), tool_response: PAGE }, two).claimed, false);
  assert.equal(design.claimPublish({ ...publish({ file_path: 'docs/design/a/x.html' }), tool_response: 'no link' }, two).claimed, false);
  assert.equal(design.claimPublish({ tool_name: 'Bash', tool_input: {}, tool_response: PAGE }, two).claimed, false);
  assert.equal(design.claimPublish({ tool_name: 'Artifact', tool_input: { file_path: 'docs/design/a/x.html' }, tool_response: PAGE }, two).claimed, false);
  assert.equal(design.claimPublish({ ...publish({ url: PAGE, asset: true }), tool_response: PAGE }, two).claimed, false);
});

// --- hooks and CLI ---

test('pre-publish hook exits 2 for a non-owner and 0 for the owner', () => {
  const dir = project();
  register(dir, 'gachi', [{ url: PAGE, owner: 'sess-owner' }]);
  const blocked = runHook('pre-publish.js', dir, publish({ url: PAGE }, 'sess-other'));
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, /BLOCKED.*sess-owner/);
  assert.equal(runHook('pre-publish.js', dir, publish({ url: PAGE })).status, 0);
});

test('pre-publish hook fails open on malformed input', () => {
  const r = spawnSync('node', [path.join(HOOKS, 'pre-publish.js')], { input: '{bad', encoding: 'utf8' });
  assert.equal(r.status, 1);
});

test('post-publish hook records the owner and never blocks', () => {
  const dir = project();
  register(dir, 'gachi', []);
  const r = runHook('post-publish.js', dir, { ...publish({ file_path: '/tmp/x.html' }), tool_response: `ok ${PAGE}` });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /owner/);
  assert.equal(readRegister(dir, 'gachi').pages[0].owner, 'sess-owner');
  assert.equal(spawnSync('node', [path.join(HOOKS, 'post-publish.js')], { input: '{bad', encoding: 'utf8' }).status, 0);
});

test('design-check passes a filled product folder and a brief', () => {
  const dir = project();
  write(dir, 'docs/design/gachi/direction.md', FILLED_DIRECTION);
  register(dir, 'gachi', [{ url: PAGE, owner: 'sess-owner' }]);
  write(dir, 'brief.md', FILLED_BRIEF);
  const r = runBin(dir, '--brief', path.join(dir, 'brief.md'));
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /design-check: ok/);
});

test('design-check fails on a missing direction file, a bad register and a restating brief', () => {
  const dir = project();
  register(dir, 'gachi', [{ url: PAGE }]);
  write(dir, 'brief.md', `${FILLED_BRIEF}\n## Look\nFlat pastel.\n`);
  const r = runBin(dir, '--brief', path.join(dir, 'brief.md'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /direction\.md: missing/);
  assert.match(r.stderr, /owner/);
  assert.match(r.stderr, /restates/);
});

test('design-check reports an unreadable brief and a broken register', () => {
  const dir = project();
  write(dir, 'docs/design/gachi/direction.md', FILLED_DIRECTION);
  write(dir, 'docs/design/gachi/pages.json', '{bad');
  const r = runBin(dir, '--brief', path.join(dir, 'nope.md'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /nope\.md: cannot read/);
  assert.match(r.stderr, /pages\.json/);
});

test('design-check with no product folders says so and passes', () => {
  const r = runBin(project());
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no product folders/);
});

test('settings register the publish hooks on the Artifact tool', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'settings.json'), 'utf8'));
  const cmds = (event) => settings.hooks[event].filter((g) => g.matcher === 'Artifact').flatMap((g) => g.hooks.map((h) => h.command));
  assert.ok(cmds('PreToolUse').some((c) => c.includes('pre-publish.js')));
  assert.ok(cmds('PostToolUse').some((c) => c.includes('post-publish.js')));
});

// --- review fixes ---

test('a file-only entry blocks a publish that carries a url and that file', () => {
  const dir = project();
  register(dir, 'gachi', [{ file: 'docs/design/gachi/look.html', owner: 'sess-owner' }]);
  const v = design.checkPublish(publish({ url: OTHER_PAGE, file_path: path.join(dir, 'docs/design/gachi/look.html') }, 'sess-other'), dir);
  assert.equal(v.block, true);
});

test('the two forms of an artifact url are the same page', () => {
  assert.equal(design.normalizeUrl('HTTPS://Claude.ai/artifact/1111-aaaa/'), design.normalizeUrl(PAGE));
  const dir = project();
  register(dir, 'gachi', [{ url: PAGE, owner: 'sess-owner' }]);
  assert.equal(design.checkPublish(publish({ url: 'https://claude.ai/artifact/1111-aaaa' }, 'sess-other'), dir).block, true);
});

test('no claim into a register that is not valid, and no claim from an ambiguous result', () => {
  const dir = project();
  register(dir, 'gachi', [{ url: PAGE }]);
  assert.equal(design.claimPublish({ ...publish({ file_path: '/tmp/x.html' }), tool_response: `ok ${OTHER_PAGE}` }, dir).claimed, false);
  assert.deepEqual(readRegister(dir, 'gachi').pages, [{ url: PAGE }]);
  const two = project();
  register(two, 'gachi', []);
  const r = design.claimPublish({ ...publish({ file_path: '/tmp/x.html' }), tool_response: `${PAGE} and ${OTHER_PAGE}` }, two);
  assert.equal(r.claimed, false);
});

test('a claim writes the register whole, with no temp file left behind', () => {
  const dir = project();
  register(dir, 'gachi', [{ url: OTHER_PAGE, owner: 'a' }]);
  assert.equal(design.claimPublish({ ...publish({ file_path: '/tmp/x.html' }), tool_response: PAGE }, dir).claimed, true);
  assert.equal(readRegister(dir, 'gachi').pages.length, 2);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'docs/design/gachi')), ['pages.json']);
});

test('post-publish says when it could not record an owner', () => {
  const dir = project();
  register(dir, 'a', []);
  register(dir, 'b', []);
  const r = runHook('post-publish.js', dir, { ...publish({ file_path: '/tmp/x.html' }), tool_response: PAGE });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /not recorded/);
});
