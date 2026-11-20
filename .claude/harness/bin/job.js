#!/usr/bin/env node
'use strict';
// The only writer of job records (docs/jobs/<id>/job.json, or $HARNESS_JOBS_DIR). Agents call this; they never edit the file.
//   job.js create --id ID --title T [--kind build|rebuild] [--builder native|craft-anything] [--source S]
//                 [--surface money,logins] [--requested-by WHO --ack TEXT]      (rebuild needs --requested-by and --ack)
//   job.js intake ID --from docs/jobs/ID/intake.md          (the intake agent's verdict file; see agents/intake.md)
//   job.js intake ID --decision accept|reject|ask [--risk low|medium|high] [--surface a,b] [--reason R]
//   job.js advance ID STAGE        job.js gate ID --passed true|false [--summary S]
//   job.js sync ID          pull this job's delegated-agent runs (tokens, time, outcome) from the hook trace; tag each agent
//                           description [job:ID] (for example "[phase:build] [job:ID] Build it"). Safe to repeat.
//   job.js agent ID --agent A --phase P --reason WHY [--effort E] [--model M] [--tokens N] [--duration-ms N] [--ok true|false] [--task T]
//                           figures typed in by hand; the reason (why the trace lacks them) is required and shown in the summary
//   job.js review ID --reviewer R --verdict pass|fail [--summary S]
//   job.js needs-human ID --reason real-scenario-test|secrets-or-access|spend-legal-scope --detail TEXT
//   job.js feedback ID --text T     job.js merge ID [--human] [--ref PR]     job.js show ID     job.js queue     job.js summary ID
const fs = require('node:fs');
const path = require('node:path');
const job = require('../lib/job');
const { parseIntake } = require('../lib/intake');
const { readSessions } = require('../lib/trace');

const argv = process.argv.slice(2);
const cmd = argv[0];
const rest = argv.slice(1);
// Positional arguments are the ones that are not a flag and not a flag's value (--human takes no value).
const positional = rest.filter((a, i) => !a.startsWith('--') && (i === 0 || !rest[i - 1].startsWith('--') || rest[i - 1] === '--human'));
const flag = (name) => { const i = rest.indexOf(`--${name}`); return i > -1 && rest[i + 1] !== undefined && !rest[i + 1].startsWith('--') ? rest[i + 1] : undefined; };
const has = (name) => rest.includes(`--${name}`);
const num = (name) => { const v = flag(name); if (v === undefined) return null; const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error(`--${name} must be a non-negative number.`); return n; };
const bool = (name) => { const v = flag(name); if (v === undefined) return null; if (v !== 'true' && v !== 'false') throw new Error(`--${name} must be true or false.`); return v === 'true'; };
const list = (name) => (flag(name) ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function run() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const root = job.rootOf(projectDir);
  const id = flag('id') ?? positional[0];
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  switch (cmd) {
    case 'create': return out(job.create(root, { id, title: flag('title'), kind: flag('kind'), builder: flag('builder'), source: flag('source') ?? '', surfaces: list('surface'), requestedBy: flag('requested-by') ?? '', acknowledgement: flag('ack') ?? '' }));
    case 'intake': {
      // --from <file>: the verdict file the intake agent wrote, parsed strictly, so nothing is re-typed on the way in.
      const from = flag('from');
      if (from) return out(job.intake(root, id, parseIntake(fs.readFileSync(path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd(), from), 'utf8'))));
      return out(job.intake(root, id, { decision: flag('decision'), risk: flag('risk'), surfaces: list('surface'), reason: flag('reason') ?? '' }));
    }
    case 'advance': return out(job.advance(root, id, positional[1]));
    case 'waive-ref-check': return out(job.waiveRefCheck(root, id, { reason: flag('reason') }));
    case 'gate': return out(job.recordGate(root, id, { passed: bool('passed') === true, summary: flag('summary') ?? '' }));
    case 'sync': {
      const r = job.syncAgents(root, id, { sessions: readSessions(projectDir) });
      return out({ id, added: r.added, runs: r.job.agents.length, untagged: r.untagged.length, untaggedRuns: r.untagged.slice(0, 10) });
    }
    case 'agent': return out(job.recordAgent(root, id, { agent: flag('agent'), phase: flag('phase'), effort: flag('effort') ?? null, model: flag('model') ?? null, tokens: num('tokens'), durationMs: num('duration-ms'), ok: bool('ok'), task: flag('task') ?? '', reason: flag('reason') ?? '' }));
    case 'review': return out(job.recordReview(root, id, { reviewer: flag('reviewer'), verdict: flag('verdict'), summary: flag('summary') ?? '' }));
    case 'needs-human': return out(job.needsHuman(root, id, { reason: flag('reason'), detail: flag('detail') ?? '' }));
    case 'feedback': return out(job.feedback(root, id, { text: flag('text') }));
    case 'merge': return out(job.merge(root, id, { human: has('human'), by: has('human') ? 'human' : 'approver', ref: flag('ref') ?? '' }));
    case 'show': return out(job.read(root, id));
    case 'summary': return out(job.summary(job.read(root, id)));
    case 'queue': return out(job.queue(root).map((j) => ({ id: j.id, title: j.title, stage: j.stage, status: j.status, risk: j.risk, needsHuman: j.needsHuman })));
    default:
      throw new Error(`Unknown command "${cmd ?? ''}". See the usage comment at the top of this file.`);
  }
}

try { run(); } catch (err) { process.stderr.write(`job: ${err.message}\n`); process.exit(1); }
