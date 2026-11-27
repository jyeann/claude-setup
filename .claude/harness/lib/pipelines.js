'use strict';
// The design pipeline catalogue (#157, spec #156): the kinds of design work a project can need (brand, screens,
// storyline, storyboard, character concept, 3D assets). One JSON file per pipeline in
// .claude/harness/pipelines/. Each is a form: the questions asked in the product Q&A, the written criteria its
// output is judged against at the design gate, its outputs, the pipelines it depends on, and what it hands to
// system analysis. Kickoff picks the pipelines a project needs (a later ticket); no always-loaded rule refers
// to the catalogue.
const fs = require('node:fs');
const path = require('node:path');

const PIPELINES_DIR = path.join(__dirname, '..', 'pipelines');
// Suggested starting sets by product kind (#158). A suggestion only; selection is per project (#159). Kept in a
// sub-folder so the catalogue loader, which reads every *.json directly in the pipelines folder, never takes it
// for a pipeline.
const STARTING_SETS = path.join('sets', 'starting-sets.json');

// How a criterion is checked at the gate: a tool measures it, the output is compared with a named reference
// (a brand guide, the experience document), or a reviewer reads the output against the written line.
const CHECK_KINDS = Object.freeze(['measure', 'compare', 'review']);
// What a pipeline's output brings into the product: behaviour to build, files to ship, cost while running.
const HANDOFF_KINDS = Object.freeze(['logic', 'assets', 'runtime']);
const PIPELINE_FIELDS = ['id', 'title', 'appliesWhen', 'dependsOn', 'questions', 'criteria', 'outputs', 'handoff'];

const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';
const PIPELINE_ID = new RegExp(`^${SLUG}$`);
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
const list = (v) => (Array.isArray(v) ? v : []);

// Problems with one pipeline file's content. Whether its dependsOn ids exist is a catalogue question.
function validatePipeline(doc, { file = '<pipeline>' } = {}) {
  const problems = [];
  const at = (where, msg) => problems.push(`${file}: ${where}: ${msg}`);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [`${file}: is not a pipeline object`];
  const missing = PIPELINE_FIELDS.filter((f) => doc[f] === undefined || (typeof doc[f] === 'string' && !nonEmpty(doc[f])));
  if (missing.length) return [`${file}: pipeline: missing ${missing.join(', ')}`];
  if (typeof doc.id !== 'string' || !PIPELINE_ID.test(doc.id)) return [`${file}: pipeline: id ${JSON.stringify(doc.id)} is not lower-case words joined by "-"`];
  for (const f of ['title', 'appliesWhen']) if (!nonEmpty(doc[f])) at('pipeline', `${f} is not text`);

  if (!Array.isArray(doc.dependsOn)) at('pipeline', 'dependsOn is not a list (use [] for none)');
  for (const d of list(doc.dependsOn)) if (typeof d !== 'string' || !PIPELINE_ID.test(d)) at('pipeline', `dependsOn entry ${JSON.stringify(d)} is not a pipeline id`);
  if (list(doc.dependsOn).includes(doc.id)) at('pipeline', 'depends on itself');
  if (new Set(list(doc.dependsOn)).size !== list(doc.dependsOn).length) at('pipeline', 'lists a dependency twice');

  // Paths are optional: the ways a pipeline can run (brand: follow a guide, or create one).
  if (doc.paths !== undefined && (!Array.isArray(doc.paths) || doc.paths.length === 0)) at('paths', 'paths, when given, is a non-empty list');
  const pathIds = new Set();
  for (const p of list(doc.paths)) {
    const where = nonEmpty(p?.id) ? `path ${p.id}` : 'paths';
    if (typeof p?.id !== 'string' || !PIPELINE_ID.test(p.id)) { at('paths', `path id ${JSON.stringify(p?.id)} is not lower-case words joined by "-"`); continue; }
    if (pathIds.has(p.id)) at(where, 'is listed twice');
    pathIds.add(p.id);
    for (const f of ['title', 'when']) if (!nonEmpty(p[f])) at(where, `has no ${f}`);
  }
  const pathProblem = (item) => {
    if (item.path === undefined) return null;
    if (pathIds.size === 0) return `names path "${item.path}" but the pipeline declares no paths`;
    return pathIds.has(item.path) ? null : `path "${item.path}" is not one of ${[...pathIds].join(', ')}`;
  };

  const idPattern = new RegExp(`^${escapeRe(doc.id)}\\.${SLUG}$`);
  const seen = new Set();
  // Checks the id of one question, criterion or output; returns the label to report it under.
  const item = (kind, entry, i) => {
    const where = nonEmpty(entry?.id) ? entry.id : `${kind} ${i + 1}`;
    if (!entry || typeof entry !== 'object') { at(where, `is not an object`); return null; }
    if (!nonEmpty(entry.id)) { at(where, 'missing id'); return null; }
    if (!idPattern.test(entry.id)) at(where, `id must be "${doc.id}.<lower-case-words>"`);
    if (seen.has(entry.id)) at(where, 'id is listed twice');
    seen.add(entry.id);
    return where;
  };
  const section = (name) => {
    if (!Array.isArray(doc[name])) at('pipeline', `${name} is not a list`);
    else if (doc[name].length === 0) at('pipeline', `lists no ${name}`);
    return list(doc[name]);
  };

  section('questions').forEach((q, i) => {
    const where = item('question', q, i);
    if (!where) return;
    for (const f of ['ask', 'why']) if (!nonEmpty(q[f])) at(where, `missing ${f}`);
    const p = pathProblem(q);
    if (p) at(where, p);
  });
  section('criteria').forEach((c, i) => {
    const where = item('criterion', c, i);
    if (!where) return;
    if (!nonEmpty(c.mustBeTrue)) at(where, 'missing mustBeTrue');
    if (!c.check || typeof c.check !== 'object') at(where, 'check is not an object with "kind" and "how"');
    else {
      if (!CHECK_KINDS.includes(c.check.kind)) at(where, `check kind "${c.check.kind}" is not one of ${CHECK_KINDS.join(', ')}`);
      if (!nonEmpty(c.check.how)) at(where, 'check has no "how"');
    }
    const p = pathProblem(c);
    if (p) at(where, p);
  });
  section('outputs').forEach((o, i) => {
    const where = item('output', o, i);
    if (!where) return;
    for (const f of ['title', 'what']) if (!nonEmpty(o[f])) at(where, `missing ${f}`);
    const p = pathProblem(o);
    if (p) at(where, p);
  });

  const handoff = doc.handoff;
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) at('handoff', `is not an object with ${HANDOFF_KINDS.join(', ')}`);
  else {
    let lines = 0;
    for (const k of HANDOFF_KINDS) {
      if (!Array.isArray(handoff[k])) { at('handoff', `${k} is not a list (use [] for none)`); continue; }
      for (const line of handoff[k]) if (!nonEmpty(line)) at('handoff', `${k} has an entry that is not text`);
      lines += handoff[k].length;
    }
    for (const k of Object.keys(handoff)) if (!HANDOFF_KINDS.includes(k)) at('handoff', `"${k}" is not one of ${HANDOFF_KINDS.join(', ')}`);
    if (lines === 0) at('handoff', 'hands nothing to system analysis: name the logic, assets or runtime cost the output brings');
  }
  return problems;
}

// Loads every *.json pipeline file in dir: [{ file, doc }] sorted by file name. A file that is not JSON is
// returned with an error instead of a doc.
function loadPipelines(dir = PIPELINES_DIR) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => {
    try {
      return { file: f, doc: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) };
    } catch (e) {
      return { file: f, error: `${f}: is not valid JSON (${e.message})` };
    }
  });
}

// The pipelines in the order they must be done, each after everything it depends on; null when the
// dependencies form a circle. deps maps each pipeline id to the ids it depends on.
function dependencyOrder(deps) {
  const order = [];
  const state = new Map();
  const visit = (id) => {
    if (state.get(id) === 'done') return true;
    if (state.get(id) === 'open') return false;
    state.set(id, 'open');
    for (const d of deps[id]) if (Object.hasOwn(deps, d) && !visit(d)) return false;
    state.set(id, 'done');
    order.push(id);
    return true;
  };
  for (const id of Object.keys(deps).sort()) if (!visit(id)) return null;
  return order;
}

// Validates a loaded catalogue: each pipeline, file names that match ids, ids unique, every dependency
// known, no circle. Returns { problems, counts, order }: counts maps each pipeline id to its number of
// criteria; order is the dependency order, or [] while there are problems that make it meaningless.
function validateCatalogue(entries) {
  const problems = [];
  const counts = {};
  const deps = {};
  const fileOf = {};
  if (entries.length === 0) problems.push('the pipeline catalogue has no pipeline files');
  for (const { file, doc, error } of entries) {
    if (error) { problems.push(error); continue; }
    problems.push(...validatePipeline(doc, { file }));
    const id = doc?.id;
    if (typeof id !== 'string' || !PIPELINE_ID.test(id)) continue;
    if (file !== `${id}.json`) problems.push(`${file}: file name must be ${id}.json`);
    if (Object.hasOwn(counts, id)) { problems.push(`${file}: pipeline ${id} is defined twice`); continue; }
    counts[id] = list(doc.criteria).length;
    deps[id] = list(doc.dependsOn).filter((d) => typeof d === 'string' && PIPELINE_ID.test(d));
    fileOf[id] = file;
  }
  for (const [id, needs] of Object.entries(deps)) {
    for (const d of needs) if (!Object.hasOwn(deps, d)) problems.push(`${fileOf[id]}: pipeline: depends on "${d}", which is not a pipeline in the catalogue (${Object.keys(deps).sort().join(', ')})`);
  }
  const order = dependencyOrder(deps);
  if (order === null) problems.push('the pipelines depend on each other in a circle: no pipeline in it could start');
  return { problems, counts, order: order ?? [] };
}

// Problems with the suggested starting sets, checked against a loaded catalogue: each set has an id, the
// product kind it suits, a reason and a list of pipelines; every pipeline in a set is in the catalogue, is
// listed once, and has the pipelines it depends on in the same set (a set must be startable as it stands).
function validateStartingSets(doc, entries, { file = STARTING_SETS } = {}) {
  const problems = [];
  const at = (where, msg) => problems.push(`${file}: ${where}: ${msg}`);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [`${file}: is not an object with "sets"`];
  if (!Array.isArray(doc.sets) || doc.sets.length === 0) return [`${file}: "sets" is not a non-empty list`];
  const deps = {};
  for (const { doc: p } of entries) if (p && typeof p.id === 'string') deps[p.id] = list(p.dependsOn);
  const known = Object.keys(deps).sort().join(', ');
  const ids = new Set();
  doc.sets.forEach((set, i) => {
    const where = nonEmpty(set?.id) ? `set ${set.id}` : `set ${i + 1}`;
    if (!set || typeof set !== 'object' || Array.isArray(set)) { at(where, 'is not an object'); return; }
    if (typeof set.id !== 'string' || !PIPELINE_ID.test(set.id)) at(where, `id ${JSON.stringify(set.id)} is not lower-case words joined by "-"`);
    else if (ids.has(set.id)) at(where, 'is listed twice');
    else ids.add(set.id);
    for (const f of ['productKind', 'why']) if (!nonEmpty(set[f])) at(where, `has no ${f}`);
    if (!Array.isArray(set.pipelines) || set.pipelines.length === 0) { at(where, 'pipelines is not a non-empty list'); return; }
    if (new Set(set.pipelines).size !== set.pipelines.length) at(where, 'lists a pipeline twice');
    for (const id of set.pipelines) {
      if (typeof id !== 'string' || !Object.hasOwn(deps, id)) { at(where, `${JSON.stringify(id)} is not a pipeline in the catalogue (${known})`); continue; }
      for (const d of deps[id]) if (!set.pipelines.includes(d)) at(where, `${id} depends on ${d}, which the set does not list`);
    }
  });
  return problems;
}

// Reads the starting sets file of a pipelines folder: { doc } or { error }, or null when the folder has none.
// Only a file that is not there counts as none; any other read failure (sets/ is a file, no permission) is an error.
function loadStartingSets(dir = PIPELINES_DIR) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, STARTING_SETS), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    return { error: `${STARTING_SETS}: cannot be read (${e.code || e.message})` };
  }
  try {
    return { doc: JSON.parse(text) };
  } catch (e) {
    return { error: `${STARTING_SETS}: is not valid JSON (${e.message})` };
  }
}

// Checks a whole pipelines folder: the catalogue and its starting sets. The starting sets file is required when
// requireSets is true (by default for the shipped folder) and checked whenever it is present.
// Returns { problems, counts, order, sets } where sets is the starting sets document or null.
function checkFolder(dir = PIPELINES_DIR, { requireSets = path.resolve(dir) === PIPELINES_DIR } = {}) {
  const entries = loadPipelines(dir);
  const { problems, counts, order } = validateCatalogue(entries);
  const sets = loadStartingSets(dir);
  if (sets === null && requireSets) problems.push(`${STARTING_SETS}: missing; the shipped catalogue suggests starting sets by product kind`);
  else if (sets?.error) problems.push(sets.error);
  else if (sets) problems.push(...validateStartingSets(sets.doc, entries));
  return { problems, counts, order, sets: sets?.doc ?? null };
}

module.exports = {
  PIPELINES_DIR, STARTING_SETS, CHECK_KINDS, HANDOFF_KINDS, PIPELINE_FIELDS,
  loadPipelines, validatePipeline, validateCatalogue, dependencyOrder,
  loadStartingSets, validateStartingSets, checkFolder,
};
