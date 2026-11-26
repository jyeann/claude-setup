'use strict';
// Design work across sessions (#109, #110): one owning session per published page, one current-direction file per
// product. The page register lives in the product's docs (`docs/design/<product>/pages.json`) so every session that
// clones the repository sees the same owners; the guard reads it before each Artifact publish.
const fs = require('node:fs');
const path = require('node:path');

const DESIGN_DIR = path.join('docs', 'design');
const DIRECTION_SECTIONS = ['Look', 'Tool', 'Characters', 'Reference images', 'Checks', 'Changed'];
// Sections a brief restates when it copies the direction instead of linking it ("Changed" is history, not direction).
const RESTATED = DIRECTION_SECTIONS.filter((s) => s !== 'Changed');
const BRIEF_SECTIONS = ['Task', 'Direction', 'Page and owner', 'Hand back', 'Done means'];
const DIRECTION_LINK = /docs\/design\/[A-Za-z0-9._-]+\/direction\.md/;
const PAGE_URL = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[A-Za-z0-9_-]+/gi;
const ARTIFACT_ID = /^https?:\/\/claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9_-]+)$/i;
const PLACEHOLDER = /<[a-z][^<>\n]*>/;
// A copied line must be long enough to be direction, not a shared word like "Blender only."
const MIN_COPIED = 30;

const ok = Object.freeze({ block: false, reason: '' });
const deny = (reason) => ({ block: true, reason });

// claude.ai/artifact/<id> and claude.ai/code/artifact/<id> are the same page; host and scheme case do not matter.
function normalizeUrl(url) {
  if (typeof url !== 'string') return '';
  const bare = url.trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  const id = ARTIFACT_ID.exec(bare)?.[1];
  return id ? `https://claude.ai/artifact/${id}` : bare;
}

// `## Heading` -> body text, for the headings named.
function sections(text) {
  const out = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(line);
    if (h) { current = h[1]; out.set(current, []); continue; }
    if (/^#\s/.test(line)) { current = null; continue; }
    if (current) out.get(current).push(line);
  }
  return new Map([...out].map(([k, v]) => [k, v.join('\n').trim()]));
}

function unfilled(found, names, where) {
  const problems = [];
  for (const name of names) {
    if (!found.has(name)) problems.push(`${where}: missing section "## ${name}"`);
    else if (!found.get(name)) problems.push(`${where}: section "## ${name}" is empty`);
    else if (PLACEHOLDER.test(found.get(name))) problems.push(`${where}: section "## ${name}" still has a <placeholder>`);
  }
  return problems;
}

function checkDirection(text, where = 'direction.md') {
  return unfilled(sections(text), DIRECTION_SECTIONS, where);
}

// A brief links the direction file and says nothing the file already says.
function checkBrief(text, { directionText = '', where = 'brief' } = {}) {
  const found = sections(text);
  const problems = unfilled(found, BRIEF_SECTIONS, where);
  if (!DIRECTION_LINK.test(text)) problems.push(`${where}: does not link the product's docs/design/<product>/direction.md`);
  for (const name of RESTATED) {
    if (found.has(name)) problems.push(`${where}: restates the direction section "## ${name}"; link direction.md instead`);
  }
  const copied = directionText.split('\n').map((l) => l.replace(/^[-*#\s]+/, '').trim())
    .filter((l) => l.length >= MIN_COPIED && text.includes(l));
  for (const line of copied) problems.push(`${where}: copies a line of direction.md ("${line.slice(0, 60)}"); link it instead`);
  // #111: the receiving session reports an asset done only with its check line, so the brief has to ask for it.
  if (found.get('Done means') && !/checks\.json/.test(found.get('Done means'))) {
    problems.push(`${where}: "## Done means" must ask for each asset's check line from docs/design/<product>/checks.json`);
  }
  return problems;
}

function checkRegister(data, where = 'pages.json') {
  if (!data || typeof data !== 'object' || !Array.isArray(data.pages)) return [`${where}: needs {"product": "...", "pages": [...]}`];
  const problems = [];
  if (typeof data.product !== 'string' || !data.product) problems.push(`${where}: "product" is missing`);
  const seen = new Set();
  data.pages.forEach((p, i) => {
    if (!p || (!p.url && !p.file)) { problems.push(`${where}: page ${i} needs a url or file`); return; }
    if (typeof p.owner !== 'string' || !p.owner) problems.push(`${where}: page ${i} has no owner session`);
    const key = p.url ? normalizeUrl(p.url) : `file:${p.file}`;
    if (seen.has(key)) problems.push(`${where}: page ${p.url || p.file} is listed twice`);
    seen.add(key);
  });
  return problems;
}

const productDirs = (projectDir) => {
  try {
    return fs.readdirSync(path.join(projectDir, DESIGN_DIR), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch { return []; }
};
const registerPath = (projectDir, product) => path.join(projectDir, DESIGN_DIR, product, 'pages.json');

// Every product's register; a register that exists but cannot be read is returned as an error, never skipped.
function readRegisters(projectDir) {
  const registers = [];
  const errors = [];
  for (const product of productDirs(projectDir)) {
    const file = registerPath(projectDir, product);
    if (!fs.existsSync(file)) continue;
    const rel = path.relative(projectDir, file);
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const problems = checkRegister(data, rel);
      if (problems.length) errors.push(...problems);
      else registers.push({ product, file, data });
    } catch (err) { errors.push(`${rel}: ${err.message}`); }
  }
  return { registers, errors };
}

const relFile = (file, projectDir) => {
  if (!file) return '';
  const rel = path.relative(projectDir, path.resolve(projectDir, file));
  return rel.startsWith('..') ? path.resolve(projectDir, file) : rel.split(path.sep).join('/');
};

const isPublish = (event) => event?.tool_name === 'Artifact' && (event.tool_input?.action ?? 'publish') === 'publish';

function findPage(registers, input, projectDir) {
  const url = normalizeUrl(input.url);
  const file = relFile(input.file_path, projectDir);
  for (const { product, data } of registers) {
    // Either key is enough: a page registered by file stays guarded when the publish also names a url.
    const page = data.pages.find((p) => (url && p.url && normalizeUrl(p.url) === url) || (file && p.file === file));
    if (page) return { product, page };
  }
  return null;
}

// PreToolUse: only the owning session publishes to a registered page (by url, or by file for a new publish).
function checkPublish(event, projectDir) {
  if (!isPublish(event)) return ok;
  const { registers, errors } = readRegisters(projectDir);
  if (errors.length) return deny(`The design page register is broken, so page owners cannot be checked: ${errors.join('; ')}. Fix it, then publish.`);
  const hit = findPage(registers, event.tool_input || {}, projectDir);
  if (!hit || hit.page.owner === event.session_id) return ok;
  return deny(`Page ${hit.page.url || hit.page.file} (product ${hit.product}) is owned by session ${hit.page.owner}; this session `
    + `(${event.session_id || 'unknown'}) may not publish to it. Hand your content to the owning session (send_message or the brief's `
    + '"Hand back" step) and let it publish. To move ownership, the owner edits '
    + `${path.join(DESIGN_DIR, hit.product, 'pages.json')}. See the design-sessions skill.`);
}

// Which product a new page belongs to: the product folder its file lives in, else the only product folder.
function productFor(input, projectDir) {
  const m = /^docs\/design\/([^/]+)\//.exec(relFile(input.file_path, projectDir));
  if (m) return m[1];
  const all = productDirs(projectDir);
  return all.length === 1 ? all[0] : null;
}

// PostToolUse: the first session to publish a page becomes its owner. An existing owner is never changed.
function claimPublish(event, projectDir, now = () => new Date().toISOString()) {
  const no = (why) => ({ claimed: false, why });
  if (!isPublish(event) || event.tool_input?.asset) return no('not a page publish');
  if (!event.session_id) return no('no session id');
  const input = event.tool_input || {};
  const text = typeof event.tool_response === 'string' ? event.tool_response : JSON.stringify(event.tool_response ?? '');
  const found = [...new Set((text.match(PAGE_URL) || []).map(normalizeUrl))];
  const url = normalizeUrl(input.url) || (found.length === 1 ? found[0] : '');
  if (!url) return no(found.length > 1 ? 'more than one page url in the result' : 'no page url in the result');
  const { registers, errors } = readRegisters(projectDir);
  if (errors.length) return no(`the register is not valid: ${errors.join('; ')}`);
  if (findPage(registers, { url }, projectDir)) return no('page already has an owner');
  const product = productFor(input, projectDir);
  if (!product) return no('no single product folder under docs/design');
  const file = registerPath(projectDir, product);
  let data = { product, pages: [] };
  if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rel = relFile(input.file_path, projectDir);
  const page = { url };
  if (rel.startsWith(`${DESIGN_DIR.split(path.sep).join('/')}/`)) page.file = rel;
  Object.assign(page, { owner: event.session_id, claimedAt: now() });
  data.pages.push(page);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Write whole or not at all: a half-written register would block every publish in other sessions.
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return { claimed: true, product, page };
}

module.exports = {
  DIRECTION_SECTIONS, BRIEF_SECTIONS, sections, normalizeUrl, checkDirection, checkBrief, checkRegister,
  readRegisters, productDirs, checkPublish, claimPublish,
};
