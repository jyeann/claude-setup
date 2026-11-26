'use strict';
// The build standards catalogue (#136, spec #127): what every build of a given kind must have, written so each
// standard can be checked. One JSON file per layer in .claude/harness/standards/. The orchestrator reads it when
// it selects the standards that apply to a run (a later ticket); no always-loaded rule refers to it.
const fs = require('node:fs');
const path = require('node:path');

const STANDARDS_DIR = path.join(__dirname, '..', 'standards');
const REPO_ROOT = path.join(__dirname, '..', '..', '..');

const LAYER_KINDS = Object.freeze(['every-product', 'capability', 'product-kind', 'domain', 'implementation']);
// How a standard is proven: automated tests at three levels, a configuration or response check, a tool scan,
// or a review of a written record (only where the source itself asks for documentation).
const TEST_KINDS = Object.freeze(['unit', 'integration', 'e2e', 'config', 'scan', 'review']);
const SOURCE_KINDS = Object.freeze(['asvs', 'owasp-cheatsheet', 'wcag', 'repo', 'issue']);
const ASVS_VERSION = '5.0.0';
const WCAG_VERSION = '2.2';

const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';
const LAYER_ID = new RegExp(`^${SLUG}$`);
const NUMBERED = /^\d+\.\d+\.\d+$/;
const CHEATSHEET_URL = /^https:\/\/cheatsheetseries\.owasp\.org\/cheatsheets\/[A-Za-z0-9_]+\.html(?:#[\w-]+)?$/;
const ISSUE_REF = /^#\d+$/;
const STANDARD_FIELDS = ['id', 'layer', 'topic', 'title', 'mustBeTrue', 'test', 'why', 'sources'];

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const list = (v) => (Array.isArray(v) ? v : []);

// Problems with one source; repoRoot is where "repo" sources are looked up.
function sourceProblems(src, repoRoot) {
  if (!src || typeof src !== 'object') return ['a source is not an object'];
  if (!SOURCE_KINDS.includes(src.kind)) return [`source kind "${src.kind}" is not one of ${SOURCE_KINDS.join(', ')}`];
  if (!nonEmpty(src.ref)) return [`${src.kind} source has no ref`];
  switch (src.kind) {
    case 'asvs':
      return NUMBERED.test(src.ref) ? [] : [`ASVS ref "${src.ref}" is not a requirement id like 6.2.1 (OWASP ASVS ${ASVS_VERSION})`];
    case 'wcag':
      return NUMBERED.test(src.ref) ? [] : [`WCAG ref "${src.ref}" is not a success criterion like 2.5.8 (WCAG ${WCAG_VERSION})`];
    case 'owasp-cheatsheet':
      return CHEATSHEET_URL.test(src.url ?? '') ? [] : [`cheat sheet "${src.ref}" needs a url on https://cheatsheetseries.owasp.org/cheatsheets/`];
    case 'issue':
      return ISSUE_REF.test(src.ref) ? [] : [`issue ref "${src.ref}" is not like #127 (an issue in this repository)`];
    default: {
      const file = path.join(repoRoot, src.ref);
      const isFile = () => { try { return fs.statSync(file).isFile(); } catch { return false; } };
      if (path.isAbsolute(src.ref) || !file.startsWith(path.resolve(repoRoot) + path.sep) || !isFile()) return [`repository file "${src.ref}" does not exist`];
      if (src.section === undefined) return [];
      if (!nonEmpty(src.section)) return [`repository file "${src.ref}": section must be the text of a heading`];
      const heading = new RegExp(`^#{1,6}\\s+${escapeRe(src.section)}\\s*$`, 'm');
      return heading.test(fs.readFileSync(file, 'utf8')) ? [] : [`repository file "${src.ref}" has no heading "${src.section}"`];
    }
  }
}

// Problems with one layer file's content: its layer block, every standard, and its gaps.
function validateLayer(doc, { repoRoot = REPO_ROOT, file = '<layer>' } = {}) {
  const problems = [];
  const at = (where, msg) => problems.push(`${file}: ${where}: ${msg}`);
  const layer = doc?.layer;
  if (!layer || typeof layer !== 'object') return [`${file}: has no "layer" block`];
  if (typeof layer.id !== 'string') return [`${file}: layer: has no id`];
  if (!LAYER_ID.test(layer.id)) at('layer', `id "${layer.id}" is not lower-case words joined by "-"`);
  if (!LAYER_KINDS.includes(layer.kind)) at('layer', `kind "${layer.kind}" is not one of ${LAYER_KINDS.join(', ')}`);
  for (const f of ['title', 'appliesWhen']) if (!nonEmpty(layer[f])) at('layer', `has no ${f}`);
  const topics = list(layer.topics);
  if (topics.length === 0) at('layer', 'declares no topics');
  for (const t of topics) if (typeof t !== 'string' || !LAYER_ID.test(t)) at('layer', `topic ${JSON.stringify(t)} is not lower-case words joined by "-"`);
  if (new Set(topics).size !== topics.length) at('layer', 'declares a topic twice');
  const standards = list(doc.standards);
  if (doc.standards !== undefined && !Array.isArray(doc.standards)) at('layer', 'standards is not a list');
  if (standards.length === 0) at('layer', 'lists no standards');
  if (doc.gaps !== undefined && !Array.isArray(doc.gaps)) at('gaps', 'gaps is not a list');

  const idPattern = new RegExp(`^${escapeRe(layer.id)}\\.${SLUG}$`);
  const seen = new Set();
  standards.forEach((s, i) => {
    const where = nonEmpty(s?.id) ? s.id : `standard ${i + 1}`;
    const missing = STANDARD_FIELDS.filter((f) => s?.[f] === undefined || (typeof s[f] === 'string' && !nonEmpty(s[f])));
    if (missing.length) return at(where, `missing ${missing.join(', ')}`);
    if (!idPattern.test(s.id)) at(where, `id must be "${layer.id}.<lower-case-words>"`);
    if (seen.has(s.id)) at(where, 'id is listed twice');
    seen.add(s.id);
    if (s.layer !== layer.id) at(where, `layer "${s.layer}" is not this file's layer "${layer.id}"`);
    if (!topics.includes(s.topic)) at(where, `topic "${s.topic}" is not declared by layer ${layer.id} (${topics.join(', ')})`);
    if (!TEST_KINDS.includes(s.test?.kind)) at(where, `test kind "${s.test?.kind}" is not one of ${TEST_KINDS.join(', ')}`);
    if (!nonEmpty(s.test?.how)) at(where, 'test has no "how"');
    if (!Array.isArray(s.sources) || s.sources.length === 0) return at(where, 'has no source: cite OWASP ASVS, an OWASP cheat sheet, WCAG, a file in this repository or an owner issue');
    for (const src of s.sources) for (const p of sourceProblems(src, repoRoot)) at(where, p);
  });

  for (const g of list(doc.gaps)) {
    if (!nonEmpty(g?.topic) || !nonEmpty(g?.reason)) at('gaps', 'each gap needs a topic and a reason');
  }
  const used = new Set(standards.map((s) => s?.topic));
  const gapTopics = new Set(list(doc.gaps).map((g) => g?.topic));
  for (const t of topics) if (!used.has(t) && !gapTopics.has(t)) at('layer', `topic "${t}" has no standard and is not listed as a gap`);
  return problems;
}

// Loads every *.json layer file in dir: [{ file, doc }] sorted by file name. A file that is not JSON is
// returned with an error instead of a doc.
function loadStandards(dir = STANDARDS_DIR) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    try {
      return { file: f, doc: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) };
    } catch (e) {
      return { file: f, error: `${f}: is not valid JSON (${e.message})` };
    }
  });
}

// Validates a loaded catalogue: each layer, file names that match layer ids, and ids unique across layers.
// Returns { problems, counts } where counts maps each layer id to its number of standards.
function validateCatalogue(entries, { repoRoot = REPO_ROOT } = {}) {
  const problems = [];
  const counts = {};
  const owner = new Map();
  if (entries.length === 0) problems.push('the standards catalogue has no layer files');
  for (const { file, doc, error } of entries) {
    if (error) { problems.push(error); continue; }
    problems.push(...validateLayer(doc, { repoRoot, file }));
    const id = doc?.layer?.id;
    if (typeof id !== 'string' || id === '') continue;
    if (file !== `${id}.json`) problems.push(`${file}: file name must be ${id}.json`);
    if (counts[id] !== undefined) problems.push(`${file}: layer ${id} is defined twice`);
    counts[id] = list(doc.standards).length;
    for (const s of list(doc.standards)) {
      if (!nonEmpty(s?.id)) continue;
      if (owner.has(s.id) && owner.get(s.id) !== file) problems.push(`${file}: ${s.id}: id is also used in ${owner.get(s.id)}`);
      owner.set(s.id, file);
    }
  }
  return { problems, counts };
}

module.exports = {
  STANDARDS_DIR, REPO_ROOT, LAYER_KINDS, TEST_KINDS, SOURCE_KINDS, ASVS_VERSION, WCAG_VERSION,
  loadStandards, validateLayer, validateCatalogue, sourceProblems,
};
