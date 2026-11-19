'use strict';
// The job spine: one durable record per piece of work, written ONLY through this module (bin/job.js).
// An agent never edits job.json by hand. It calls the CLI, which validates every change, so state cannot drift,
// a handoff cannot be re-typed lossy, and cost/outcome figures land in one place.
const fs = require('node:fs');
const path = require('node:path');
const intakeRules = require('./intake');

const VERSION = 1;
const STAGES = Object.freeze(['intake', 'spec', 'build', 'gate', 'review', 'approve', 'merged']);
const RISKS = intakeRules.RISKS;
const KINDS = Object.freeze(['build', 'rebuild']);
const BUILDERS = Object.freeze(['native', 'craft-anything']);
// The only reasons a job may wait for the owner. Everything else is decided by the team and recorded.
const HUMAN_REASONS = Object.freeze(['real-scenario-test', 'secrets-or-access', 'spend-legal-scope']);
const REVIEWERS = intakeRules.REVIEWERS;
// Work in these areas is never merged by an agent, whatever the risk tag says.
const HUMAN_MERGE_SURFACES = intakeRules.SENSITIVE;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const LOCK_STALE_MS = 30_000;

const rootOf = (projectDir, env = process.env) => path.resolve(projectDir, env.HARNESS_JOBS_DIR || 'docs/jobs');
const dirOf = (root, id) => path.join(root, id);
const fileOf = (root, id) => path.join(dirOf(root, id), 'job.json');

function assertId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error(`Invalid job id "${id}": use lowercase letters, digits and dashes (max 64).`);
}

function read(root, id) {
  assertId(id);
  let text;
  try { text = fs.readFileSync(fileOf(root, id), 'utf8'); } catch { throw new Error(`No such job: ${id}`); }
  try { return JSON.parse(text); } catch (err) { throw new Error(`Corrupt job ${id}: ${err.message}`); }
}

function writeAtomic(root, job) {
  const file = fileOf(root, job.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o644 });
  fs.renameSync(tmp, file);
}

// A lock file per job so two writers (parallel agents) never interleave a read-modify-write.
function withLock(root, id, fn) {
  const lock = path.join(dirOf(root, id), '.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      const fd = fs.openSync(lock, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let age = 0;
      try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch { continue; }
      if (age > LOCK_STALE_MS) { try { fs.unlinkSync(lock); } catch { /* raced */ } continue; }
      if (attempt > 50) throw new Error(`Job ${id} is locked by another writer.`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  try { return fn(); } finally { try { fs.unlinkSync(lock); } catch { /* already gone */ } }
}

function mutate(root, id, fn, { event, by = 'orchestrator', note = '', now = Date.now() } = {}) {
  return withLock(root, id, () => {
    const job = read(root, id);
    if (job.version !== VERSION) throw new Error(`Job ${id} has version ${job.version}; this tool writes version ${VERSION}.`);
    const result = fn(job);
    job.updatedAt = now;
    job.history.push({ ts: now, event, by, ...(note ? { note } : {}) });
    writeAtomic(root, job);
    return result === undefined ? job : result;
  });
}

function create(root, { id, title, kind = 'build', source = '', surfaces = [], builder = 'native', requestedBy = '', acknowledgement = '', external = null, now = Date.now() }) {
  assertId(id);
  if (!title || !String(title).trim()) throw new Error('A job needs a title.');
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}.`);
  if (!BUILDERS.includes(builder)) throw new Error(`builder must be one of ${BUILDERS.join(', ')}.`);
  if (fs.existsSync(fileOf(root, id))) throw new Error(`Job ${id} already exists.`);
  // Rebuilding a third party's product is the requester's responsibility; the spine records who asked and what they
  // acknowledged so the run is never silent about it.
  if (kind === 'rebuild' && (!requestedBy.trim() || !acknowledgement.trim())) {
    throw new Error('A rebuild job needs --requested-by and --ack (the requester owns the legal responsibility; it is recorded).');
  }
  const job = {
    version: VERSION, id, title: String(title).trim(), kind, source, builder, external, surfaces: [...new Set(surfaces)],
    stage: 'intake', status: 'active', risk: null, riskRaisedBy: null, reviewers: [], decision: null, needsHuman: null,
    requestedBy: requestedBy || null, acknowledgement: acknowledgement || null,
    gate: null, refChecks: [], refCheckWaiver: null, agents: [], feedback: [], reviews: [], merge: null,
    createdAt: now, updatedAt: now, history: [{ ts: now, event: 'created', by: 'orchestrator' }],
  };
  withLock(root, id, () => writeAtomic(root, job));
  return job;
}

// Intake decides whether the work is worth building and tags its risk. The risk picks the reviewers.
function intake(root, id, { decision, risk, surfaces = [], reason = '', by = 'intake' }) {
  if (!['accept', 'reject', 'ask'].includes(decision)) throw new Error('decision must be accept, reject or ask.');
  if (decision === 'accept' && !RISKS.includes(risk)) throw new Error(`An accepted job needs a risk: ${RISKS.join(', ')}.`);
  if (decision !== 'accept' && !reason.trim()) throw new Error('A rejection or question needs a reason.');
  return mutate(root, id, (job) => {
    if (job.stage !== 'intake') throw new Error(`Job ${id} is past intake (stage ${job.stage}).`);
    job.decision = { decision, reason, by };
    if (decision === 'reject') { job.status = 'rejected'; return; }
    if (decision === 'ask') { job.status = 'needs-human'; job.needsHuman = { reason: 'spend-legal-scope', detail: reason }; return; }
    job.surfaces = [...new Set([...job.surfaces, ...intakeRules.parseSurfaces(surfaces.join(','))])];
    const resolved = intakeRules.resolveRisk(risk, job.surfaces, job.kind);
    job.risk = resolved.risk;
    job.riskRaisedBy = resolved.raisedBy;
    job.reviewers = intakeRules.reviewersFor(job.risk, job.surfaces);
    job.stage = 'spec';
  }, { event: `intake:${decision}`, by, note: reason });
}

function advance(root, id, to, { by = 'orchestrator' } = {}) {
  if (!STAGES.includes(to)) throw new Error(`Unknown stage "${to}". Stages: ${STAGES.join(', ')}.`);
  return mutate(root, id, (job) => {
    if (to === 'merged') throw new Error('Use "merge" to finish a job.');
    if (job.status !== 'active') throw new Error(`Job ${id} is ${job.status}; it cannot advance.`);
    const from = STAGES.indexOf(job.stage);
    const target = STAGES.indexOf(to);
    // Forward one step, or back to build after a failed gate or review. Never skip, never jump back further.
    const back = to === 'build' && ['gate', 'review', 'approve'].includes(job.stage);
    if (!(target === from + 1 || back)) throw new Error(`Job ${id}: cannot go from ${job.stage} to ${to}.`);
    if (job.stage === 'spec' && to === 'build') {
      const why = refCheckBlock(job);
      if (why) throw new Error(`Job ${id}: ${why}`);
    }
    if (job.stage === 'gate' && to === 'review' && !(job.gate && job.gate.passed)) throw new Error(`Job ${id}: the gate has not passed, so it cannot go to review.`);
    job.stage = to;
  }, { event: `advance:${to}`, by });
}

// The tests are checked before anyone builds against them (lib/ref-check.js). Build needs a passing RED check against a
// stub; a GREEN check against a reference is optional but, once run, must pass. A waiver is a logged decision, not a skip.
function refCheckBlock(job) {
  if (job.refCheckWaiver) return null;
  const latest = (expect) => [...job.refChecks].reverse().find((c) => c.expect === expect);
  const red = latest('red');
  const green = latest('green');
  if (green && !green.passed) return 'the green reference check failed; fix the wrong test or the wrong reference first.';
  if (!red) return 'the tests have not been checked against a stub. Run ref-check --expect red --job <id>, or waive it with a reason.';
  if (!red.passed) return 'the red check failed: some tests pass against a stub or fail for the wrong reason.';
  return null;
}

function recordRefCheck(root, id, { expect, passed, summary = '', suites = [] }) {
  if (!['red', 'green'].includes(expect)) throw new Error('expect must be red or green.');
  return mutate(root, id, (job) => {
    job.refChecks.push({ expect, passed: Boolean(passed), summary, suites, ts: Date.now() });
  }, { event: `ref-check:${expect}:${passed ? 'pass' : 'fail'}`, by: 'ref-check', note: summary });
}

function waiveRefCheck(root, id, { reason, by = 'orchestrator' }) {
  if (!reason || !reason.trim()) throw new Error('A waiver needs a reason (it is recorded).');
  return mutate(root, id, (job) => {
    job.refCheckWaiver = { reason, by, ts: Date.now() };
  }, { event: 'ref-check:waived', by, note: reason });
}

// A free-text note in the job history, for decisions that need a recorded reason (for example, Deep mode).
function recordNote(root, id, { note, by = 'orchestrator' }) {
  if (!note || !note.trim()) throw new Error('A note needs text.');
  return mutate(root, id, () => {}, { event: 'note', by, note });
}

function recordGate(root, id, { passed, summary = '', by = 'gate' }) {
  return mutate(root, id, (job) => {
    job.gate = { passed: Boolean(passed), summary, ts: Date.now() };
  }, { event: `gate:${passed ? 'pass' : 'fail'}`, by, note: summary });
}

// outcome unreported (null) is kept distinct from failure so cost figures never count a lost agent as a success.
function recordAgent(root, id, { agent, phase, effort = null, model = null, tokens = null, durationMs = null, ok = null, task = '' }) {
  if (!agent || !phase) throw new Error('recordAgent needs --agent and --phase.');
  return mutate(root, id, (job) => {
    job.agents.push({ agent, phase, task, effort, model, tokens, durationMs, ok, ts: Date.now() });
  }, { event: 'agent', by: agent, note: `${phase}${ok === false ? ' (failed)' : ok === null ? ' (outcome unreported)' : ''}` });
}

function recordReview(root, id, { reviewer, verdict, summary = '' }) {
  if (!['pass', 'fail'].includes(verdict)) throw new Error('verdict must be pass or fail.');
  return mutate(root, id, (job) => {
    if (job.stage !== 'review') throw new Error(`Job ${id} is at ${job.stage}, not review.`);
    if (!job.reviewers.includes(reviewer)) throw new Error(`${reviewer} is not a reviewer for this job (${job.reviewers.join(', ')}).`);
    job.reviews = job.reviews.filter((r) => r.reviewer !== reviewer);
    job.reviews.push({ reviewer, verdict, summary, ts: Date.now() });
  }, { event: `review:${reviewer}:${verdict}`, by: reviewer, note: summary });
}

function needsHuman(root, id, { reason, detail = '' }) {
  if (!HUMAN_REASONS.includes(reason)) {
    throw new Error(`Not a reason to contact the owner: "${reason}". Allowed: ${HUMAN_REASONS.join(', ')}. Decide, record it, and carry on.`);
  }
  if (!detail.trim()) throw new Error('Say what you need from the owner (--detail).');
  return mutate(root, id, (job) => { job.status = 'needs-human'; job.needsHuman = { reason, detail }; }, { event: `needs-human:${reason}`, note: detail });
}

function feedback(root, id, { text, by = 'owner' }) {
  if (!text || !text.trim()) throw new Error('Feedback needs text.');
  return mutate(root, id, (job) => {
    job.feedback.push({ by, text, ts: Date.now() });
    if (job.status === 'needs-human') { job.status = 'active'; job.needsHuman = null; }
  }, { event: 'feedback', by });
}

// Agents may merge only low-risk work whose gate and every assigned reviewer passed, and never on a human-only surface.
function mergeVerdict(job) {
  const why = [];
  if (job.stage !== 'approve') why.push(`stage is ${job.stage}, not approve`);
  if (!(job.gate && job.gate.passed)) why.push('gate has not passed');
  const missing = job.reviewers.filter((r) => !job.reviews.some((x) => x.reviewer === r && x.verdict === 'pass'));
  if (missing.length) why.push(`reviews not passed: ${missing.join(', ')}`);
  const sensitive = job.surfaces.filter((s) => HUMAN_MERGE_SURFACES.includes(s));
  const auto = job.risk === 'low' && sensitive.length === 0;
  return { ready: why.length === 0, auto: why.length === 0 && auto, why, human: !auto ? (sensitive.length ? `touches ${sensitive.join(', ')}` : `risk is ${job.risk}`) : null };
}

function merge(root, id, { by = 'approver', human = false, ref = '' }) {
  return mutate(root, id, (job) => {
    const v = mergeVerdict(job);
    if (!v.ready) throw new Error(`Job ${id} cannot merge: ${v.why.join('; ')}.`);
    if (!v.auto && !human) throw new Error(`Job ${id} needs a human to merge (${v.human}).`);
    job.stage = 'merged'; job.status = 'done'; job.merge = { by, human, ref, ts: Date.now() };
  }, { event: 'merged', by, note: ref });
}

function list(root) {
  let ids = [];
  try { ids = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && ID_RE.test(d.name)).map((d) => d.name); } catch { return []; }
  return ids.flatMap((id) => { try { return [read(root, id)]; } catch { return []; } }).sort((a, b) => a.createdAt - b.createdAt);
}

const queue = (root) => list(root).filter((j) => j.status === 'active' || j.status === 'needs-human');

// Cost and time per job and per phase from the agent records. Unreported outcomes are counted, never assumed to pass.
function summary(job) {
  const byPhase = {};
  for (const a of job.agents) {
    const p = (byPhase[a.phase] ??= { runs: 0, failed: 0, unreported: 0, tokens: 0, durationMs: 0 });
    p.runs += 1;
    if (a.ok === false) p.failed += 1;
    if (a.ok === null) p.unreported += 1;
    p.tokens += a.tokens ?? 0;
    p.durationMs += a.durationMs ?? 0;
  }
  const all = Object.values(byPhase);
  return {
    id: job.id, stage: job.stage, status: job.status, risk: job.risk,
    runs: job.agents.length,
    failed: all.reduce((n, p) => n + p.failed, 0),
    unreported: all.reduce((n, p) => n + p.unreported, 0),
    tokens: all.reduce((n, p) => n + p.tokens, 0),
    durationMs: all.reduce((n, p) => n + p.durationMs, 0),
    byPhase,
  };
}

module.exports = {
  VERSION, STAGES, RISKS, KINDS, BUILDERS, HUMAN_REASONS, REVIEWERS, HUMAN_MERGE_SURFACES,
  rootOf, fileOf, read, create, intake, advance, recordRefCheck, waiveRefCheck, recordNote, recordGate, recordAgent, recordReview, needsHuman, feedback,
  mergeVerdict, merge, list, queue, summary,
};
