// Shared helpers for the incident-sim acceptance suites (Node and HTTP only, ESM, zero dependencies).
// Engine and core modules are imported lazily by their pinned path so a missing module fails the test that needs it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export { TESTIDS } from './testids.js';

export const APP_DIR = path.resolve(import.meta.dirname, '..');
export const SERVER = path.join(APP_DIR, 'src', 'server.js');
export const PUBLIC_DIR = path.join(APP_DIR, 'public');
export const JS_DIR = path.join(PUBLIC_DIR, 'js');
export const SCEN_DIR = path.join(APP_DIR, 'scenarios');
export const READY_RE = /^Incident Simulator running at http:\/\/localhost:(\d+)$/m;
export const GUIDE_PREFIX = 'https://bytebytego.com/guides/';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- pinned scenario contract (spec.md, "The 10 shipped scenarios")
// optimal: [fixId, node, cost]; alone: resolves alone; harmful/helpful/none: single-fix classes at firstPage.
export const SHIPPED = [
  { id: 'cache-stampede', d: 1, budget: 6, slug: 'how-can-cache-systems-go-wrong', root: 'cache',
    optimal: [['add-ttl-jitter', 'cache', 1]], alone: [['add-ttl-jitter', 'cache']],
    harmful: [['failover', 'db-primary']], helpful: [], none: [['scale-service', 'service-1']] },
  { id: 'thundering-herd', d: 2, budget: 6, slug: 'things-to-consider-when-using-cache', root: 'cache',
    optimal: [['backoff-jitter', 'clients', 2]], alone: [['backoff-jitter', 'clients']],
    harmful: [['scale-service', 'service-1']], helpful: [['shed-load', 'lb']], none: [] },
  { id: 'retry-storm', d: 2, budget: 6, slug: 'how-do-we-retry-on-failures', root: 'third-party',
    optimal: [['backoff-jitter', 'service-1', 2]], alone: [['backoff-jitter', 'service-1']],
    harmful: [['scale-service', 'service-1']], helpful: [], none: [] },
  { id: 'hot-partition', d: 2, budget: 6, slug: 'a-crash-course-in-database-sharding', root: 'db-primary',
    optimal: [['shard-rekey', 'db-primary', 2]], alone: [['shard-rekey', 'db-primary']],
    harmful: [['scale-service', 'service-1'], ['failover', 'db-primary']], helpful: [], none: [['add-index', 'db-primary']] },
  { id: 'queue-backlog', d: 1, budget: 6, slug: 'types-of-message-queue', root: 'consumer',
    optimal: [['rollback', 'consumer', 2], ['scale-service', 'consumer', 2]], alone: [],
    harmful: [], helpful: [['scale-service', 'consumer']], none: [['shed-load', 'lb']], noHarmfulAtAll: true },
  { id: 'n-plus-one', d: 2, budget: 6, slug: '7-must-know-strategies-to-scale-your-database', root: 'service-1',
    optimal: [['rollback', 'service-1', 2]], alone: [['rollback', 'service-1']],
    harmful: [['scale-service', 'service-1']], helpful: [['add-index', 'db-primary']], none: [] },
  { id: 'connection-pool-exhaustion', d: 2, budget: 6, slug: '7-must-know-strategies-to-scale-your-database', root: 'service-1',
    optimal: [['raise-pool-size', 'service-1', 2]], alone: [['raise-pool-size', 'service-1']],
    harmful: [['scale-service', 'service-1']], helpful: [], none: [] },
  { id: 'expiring-certificate', d: 1, budget: 6, slug: 'how-does-https-work', root: 'lb',
    optimal: [['renew-cert', 'lb', 2]], alone: [['renew-cert', 'lb']],
    harmful: [['rollback', 'service-1']], helpful: [], none: [] },
  { id: 'split-brain', d: 3, budget: 8, slug: 'cap-theorem-one-of-the-most-misunderstood-terms', root: 'db-primary',
    optimal: [['shed-load', 'lb', 2], ['failover', 'db-replica', 2]], alone: [],
    harmful: [['failover', 'db-replica'], ['scale-service', 'service-1']], helpful: [], none: [],
    helpfulOrNone: [['shed-load', 'lb']] },
  { id: 'cascading-failure', d: 3, budget: 8, slug: 'resiliency-patterns', root: 'third-party',
    optimal: [['shed-load', 'lb', 2], ['circuit-breaker', 'service-2', 2], ['scale-service', 'service-1', 2]], alone: [],
    harmful: [['scale-service', 'service-1']], helpful: [], none: [] },
];
export const SHIPPED_IDS = SHIPPED.map((s) => s.id);
export const pin = (id) => SHIPPED.find((s) => s.id === id);

// ---------------------------------------------------------------- module access
const modCache = new Map();
export function mod(rel) {
  if (!modCache.has(rel)) modCache.set(rel, import(pathToFileURL(path.join(JS_DIR, `${rel}.js`)).href));
  return modCache.get(rel);
}
let engineP;
export function engine() {
  engineP ??= Promise.all([
    mod('engine/hash'), mod('engine/prng'), mod('engine/catalogue'), mod('engine/guides'), mod('engine/validate'),
    mod('engine/engine'), mod('engine/classify'), mod('engine/replay'), mod('engine/score'), mod('engine/solver'),
    mod('engine/fingerprint'), mod('engine/template'), mod('engine/conditions'), mod('engine/model'),
  ]).then(([hash, prng, catalogue, guides, validate, eng, classify, replay, score, solver, fingerprint, template, conditions, model]) =>
    ({ hash, prng, catalogue, guides, validate, eng, classify, replay, score, solver, fingerprint, template, conditions, model }));
  return engineP;
}

// ---------------------------------------------------------------- scenarios
export const scenarioFile = (id) => path.join(SCEN_DIR, `${id}.json`);
export const rawScenario = (id) => JSON.parse(fs.readFileSync(scenarioFile(id), 'utf8'));
export const clone = (v) => structuredClone(v);
const scCache = new Map();
export function scenario(id) {
  if (!scCache.has(id)) {
    scCache.set(id, engine().then((E) => {
      const r = E.validate.validate(rawScenario(id), `${id}.json`);
      if (!r.ok) throw new Error(`scenario ${id} is invalid: ${r.errors.map((e) => E.validate.formatError(e)).join(' | ')}`);
      return r.scenario;
    }));
  }
  return scCache.get(id);
}
// Validate a mutated raw scenario. Returns the validate() result.
export async function validateRaw(raw, fileName = 'cache-stampede.json') {
  const E = await engine();
  return E.validate.validate(raw, fileName);
}
export const errField = (res, field) => (res.ok ? [] : res.errors.filter((e) => e.field === field));
export const errFieldStarts = (res, prefix) => (res.ok ? [] : res.errors.filter((e) => e.field === prefix || e.field.startsWith(prefix)));
// Every scenario error must end with an Expected clause.
export const hasExpected = (e) => typeof e.message === 'string' && /Expected: .+\.$/.test(e.message);

// ---------------------------------------------------------------- engine drivers
// Drives createRun + step. log entries {t,id,node} are passed when state.tick === t. each(state) is called for every state incl. tick 0.
export function drive(E, sc, seed, log = [], { stopTick = Infinity, each, createOpts } = {}) {
  let state = createOpts ? E.eng.createRun(sc, seed, createOpts) : E.eng.createRun(sc, seed);
  const sorted = [...log].sort((a, b) => a.t - b.t);
  let i = 0;
  if (each) each(state);
  while (state.status === 'running' && state.tick < stopTick) {
    while (i < sorted.length && sorted[i].t < state.tick) i++;
    const acts = [];
    while (i < sorted.length && sorted[i].t === state.tick) { acts.push({ id: sorted[i].id, node: sorted[i].node ?? null }); i++; }
    state = E.eng.step(state, acts);
    if (each) each(state);
  }
  return state;
}
const naCache = new Map();
export function noAction(id, seed) {
  const key = `${id}:${seed}`;
  if (!naCache.has(key)) {
    naCache.set(key, (async () => {
      const E = await engine();
      const sc = await scenario(id);
      const states = [];
      const final = drive(E, sc, seed, [], { each: (s) => states.push(s) });
      return { E, sc, states, final };
    })());
  }
  return naCache.get(key);
}
export const firstPage = (E, sc, seed) => E.solver.firstPageTick(sc, seed);
export const playbook = (E, sc, seed, steps, offset = 0) =>
  E.solver.schedule(firstPage(E, sc, seed) + offset, steps.map(([id, node]) => ({ id, node })));
export const optimalSteps = (sc) => sc.optimalPath.map((p) => [p.id, p.node]);
export function scoreOf(E, sc, state, { hintUsed = false } = {}) {
  const r = E.eng.result(state);
  return E.score.score({
    result: r.result, timeToMitigate: r.timeToMitigate, optimalTime: sc.optimalSummary.timeToMitigate,
    budgetLeft: r.budgetLeft, budget: sc.budget, optimalCost: sc.optimalSummary.cost, harmful: r.harmful, hintUsed,
  });
}
// Every (fixId, node) pair where the node's type is in the fix's appliesTo.
export function validPairs(E, sc) {
  const out = [];
  for (const a of E.catalogue.ACTIONS) {
    if (a.kind !== 'fix') continue;
    for (const node of Object.keys(sc.topology.nodes)) if (a.appliesTo.includes(E.catalogue.NODE_TYPES[node])) out.push([a.id, node]);
  }
  return out;
}
export const hasEffects = (sc, id, node) => Array.isArray(sc.actions?.[id]?.effects?.[node]) && sc.actions[id].effects[node].length > 0;
export const stateCanon = (E, s) => E.hash.canonicalJson(s);

// Independent invariant re-check (spec "Invariants after every tick"). Returns a list of violations.
export function invariantViolations(E, sc, s) {
  const bad = [];
  const finite = (n) => typeof n === 'number' && Number.isFinite(n);
  for (const node of Object.keys(s.params)) {
    const g = (name) => E.eng.metric(s, node, name);
    for (const name of ['p50', 'p99', 'queue', 'rps', 'missRps', 'connections', 'errorRate', 'saturation']) {
      const v = g(name);
      if (!finite(v)) bad.push(`non-finite ${name} on ${node}`);
    }
    const hr = g('hitRate');
    if (hr !== null && !(finite(hr) && hr >= 0 && hr <= 1)) bad.push(`hitRate on ${node}`);
    const er = g('errorRate'); const sat = g('saturation');
    if (!(er >= 0 && er <= 1)) bad.push(`errorRate on ${node}`);
    if (!(sat >= 0 && sat <= 1)) bad.push(`saturation on ${node}`);
    if (!(g('p50') >= 0 && g('p50') <= g('p99') && g('p99') <= 30000)) bad.push(`latency on ${node}`);
    const cap = s.params[node].maxDepth ?? s.params[node].backlogMax;
    if (typeof cap === 'number' && !(g('queue') >= 0 && g('queue') <= cap)) bad.push(`queue on ${node}`);
  }
  if (!(Number.isInteger(s.budgetLeft) && s.budgetLeft >= 0 && s.budgetLeft <= sc.budget)) bad.push('budgetLeft');
  if (!(s.tick <= (sc.maxTicks ?? 600) + 10)) bad.push('tick');
  return bad;
}

// ---------------------------------------------------------------- temp folders
export function tempDir(prefix = 'incident-sim-') {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  return { base, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}
// files: name -> string | Buffer | {symlink: target} | {dir: true}
export function scenarioDir(files = {}) {
  const t = tempDir('incident-sim-scn-');
  const dir = path.join(t.base, 'scenarios');
  fs.mkdirSync(dir);
  for (const [name, v] of Object.entries(files)) {
    const p = path.join(dir, name);
    if (v && typeof v === 'object' && !Buffer.isBuffer(v)) {
      if (v.symlink) fs.symlinkSync(v.symlink, p); else if (v.dir) fs.mkdirSync(p);
    } else fs.writeFileSync(p, v);
  }
  return { dir, base: t.base, cleanup: t.cleanup };
}
// A copy of a shipped scenario as a JSON string with `mutate(obj)` applied. `id` is forced to match the new file stem.
export function variantJson(srcId, stem, mutate) {
  const o = clone(rawScenario(srcId));
  o.id = stem;
  if (mutate) mutate(o);
  return JSON.stringify(o, null, 2);
}

// ---------------------------------------------------------------- server spawn
function launch(opts = {}) {
  const env = { ...process.env };
  for (const k of ['HOST', 'PORT', 'INCIDENT_SIM_TEST', 'SCENARIOS_DIR']) delete env[k];
  Object.assign(env, { PORT: '0' });
  if (opts.test) env.INCIDENT_SIM_TEST = '1';
  if (opts.scenariosDir) env.SCENARIOS_DIR = opts.scenariosDir;
  Object.assign(env, opts.env || {});
  for (const k of Object.keys(env)) if (env[k] === undefined || env[k] === null) delete env[k];
  const child = spawn(process.execPath, [SERVER], { cwd: opts.cwd ?? APP_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  let exitInfo = null;
  const stopped = new Promise((resolve) => {
    child.once('exit', (code, signal) => { exitInfo = { code, signal }; resolve(exitInfo); });
  });
  const stop = async (signal = 'SIGTERM') => {
    if (exitInfo) return exitInfo;
    child.kill(signal);
    const killer = setTimeout(() => child.kill('SIGKILL'), 5000);
    const info = await stopped;
    clearTimeout(killer);
    return info;
  };
  return { child, stopped, stop, logs: () => ({ stdout, stderr, output: stdout + stderr }), exited: () => exitInfo };
}

function makeCall(server) {
  // call(method, path, {headers, host, body}) -> {status, headers, text, buffer, body}
  //  host: undefined = localhost:<port>, string = that Host header, null = no Host header.
  return (method, urlPath, o = {}) => new Promise((resolve, reject) => {
    const headers = {};
    if (o.host === undefined) headers.host = `localhost:${server.port}`;
    else if (o.host !== null) headers.host = o.host;
    const payload = o.body === undefined ? null : Buffer.from(o.body);
    if (payload) headers['content-length'] = String(payload.length);
    for (const [k, v] of Object.entries(o.headers || {})) {
      if (v === null || v === undefined) delete headers[k.toLowerCase()]; else headers[k.toLowerCase()] = v;
    }
    let responded = false;
    const req = http.request({
      host: server.connectHost, port: server.port, method, path: urlPath, headers,
      agent: false, setHost: false, strictContentLength: false,
    }, (res) => {
      responded = true;
      const chunks = [];
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString('utf8');
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, buffer, body: parsed });
      };
      res.on('data', (c) => chunks.push(c));
      res.on('end', done);
      res.on('close', done);
      res.on('error', done);
    });
    req.on('error', (e) => { if (!responded) reject(e); });
    req.setTimeout(8000, () => req.destroy(new Error('request timed out')));
    req.end(payload || undefined);
  });
}

// Start the server and resolve once the ready line is printed.
export async function startServer(opts = {}) {
  const l = launch(opts);
  const connectHost = opts.env?.HOST === '::1' ? '::1' : opts.env?.HOST === 'localhost' ? 'localhost' : '127.0.0.1';
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      l.child.kill('SIGKILL');
      reject(new Error(`server did not print the ready line within 8s. stdout: ${l.logs().stdout} stderr: ${l.logs().stderr}`));
    }, 8000);
    l.child.stdout.on('data', () => {
      const m = READY_RE.exec(l.logs().stdout);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    l.stopped.then((info) => {
      clearTimeout(timer);
      reject(new Error(`server exited early (code ${info.code}, signal ${info.signal}). stdout: ${l.logs().stdout} stderr: ${l.logs().stderr}`));
    });
  }).catch(async (e) => { await l.stop('SIGKILL'); throw e; });
  const server = { ...l, port, connectHost };
  server.call = makeCall(server);
  // Wait until the "Loaded" line is out (it follows the ready line).
  for (let i = 0; i < 100 && !/^Loaded \d+ scenarios?\.$/m.test(l.logs().stdout); i++) await sleep(20);
  return server;
}

// Start a server that must exit on its own. Resolves with {code, signal, stdout, stderr, output}.
export async function runToExit(opts = {}) {
  const l = launch(opts);
  const timer = setTimeout(() => l.child.kill('SIGKILL'), 8000);
  const info = await l.stopped;
  clearTimeout(timer);
  const { stdout, stderr, output } = l.logs();
  return { ...info, stdout, stderr, output };
}

export async function withServer(fn, opts = {}) {
  const server = await startServer(opts);
  try { return await fn(server); } finally { await server.stop(); }
}

// Send raw bytes to the server's port and collect whatever comes back until it closes or `ms` pass.
export function rawExchange(server, bytes, ms = 1500) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: server.connectHost, port: server.port });
    const chunks = [];
    const finish = () => { sock.destroy(); resolve(Buffer.concat(chunks).toString('latin1')); };
    sock.on('data', (c) => chunks.push(c));
    sock.on('error', finish);
    sock.on('close', finish);
    sock.on('connect', () => sock.write(bytes));
    setTimeout(finish, ms);
  });
}

// Whether this machine can listen on ::1 (so the ::1 test can assert the right thing instead of skipping).
export function ipv6Available() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(0, '::1', () => s.close(() => resolve(true)));
  });
}

// Expected security headers (spec "Headers").
export const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'none'; manifest-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";
export const SECURITY_HEADERS = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=()',
};

// Strip // and /* */ comments (URLs with "://" are left alone).
export const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
export function walkFiles(dir, accept = () => true) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walkFiles(p, accept) : accept(p) ? [p] : [];
  });
}
