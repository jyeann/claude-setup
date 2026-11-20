// Test helpers: load and validate the fixture scenario, and build tiny topologies for the physics tests.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from '../../public/js/engine/validate.js';
import { PARAMS, EDGE_PARAMS, NODE_TYPES } from '../../public/js/engine/catalogue.js';
import { compileTopology } from '../../public/js/engine/model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const rawFixture = (name = 'stampede') => JSON.parse(fs.readFileSync(path.join(here, `${name}.json`), 'utf8'));

// Validate a mutated copy of the fixture. Throws with the validator messages when it is invalid.
export function fixture(mutate, name = 'stampede') {
  const raw = rawFixture(name);
  if (mutate) mutate(raw);
  const res = validate(raw, `${raw.id}.json`);
  if (!res.ok) throw new Error(`fixture invalid: ${res.errors.map((e) => `${e.field}: ${e.message}`).join(' | ')}`);
  return res.scenario;
}

// Full parameter set with catalogue defaults for a node id plus overrides.
export function node(id, over = {}) {
  const out = {};
  for (const [k, spec] of Object.entries(PARAMS[NODE_TYPES[id]])) if (spec.default !== undefined) out[k] = spec.default;
  if (NODE_TYPES[id] === 'db' && over.hotShare === undefined) out.hotShare = 1 / (over.shards || 1);
  return { ...out, ...over };
}
export function edge(from, to, over = {}) {
  const out = {};
  for (const [k, spec] of Object.entries(EDGE_PARAMS)) if (spec.default !== undefined) out[k] = spec.default;
  out.missOnly = NODE_TYPES[from] === 'cache';
  return { from, to, ...out, ...over };
}

// A tiny hand-built world for computeTick: {T, params, edgeParams, prev, run(opts)}.
export function world(nodes, edges) {
  const T = compileTopology({ topology: { nodes, edges } });
  const params = {};
  for (const [id, p] of Object.entries(nodes)) params[id] = { ...p };
  const edgeParams = {};
  for (const e of edges) { const { from, to, ...rest } = e; edgeParams[`${from}>${to}`] = { ...rest }; }
  const prev = {};
  for (const id of T.ids) prev[id] = { p50: 0, p99: 0, errorRate: 0, saturation: 0, queue: 0, hitRate: null, rps: 0, missRps: 0, connections: 0 };
  return { T, params, edgeParams, prev };
}
