#!/usr/bin/env node
'use strict';
// builder <command> <job-id> ...   The craft-anything builder adapter. The job must name it (create --builder craft-anything)
// and be at the build stage. The build runs outside the repo (.harness/builds/<id>, or $HARNESS_BUILDS_DIR); the CLI is
// $CRAFT_ANYTHING_CLI or `craft-anything-cli` on PATH.
//   builder.js plan ID --request TEXT | --request-file F [--rounds N] [--build-with STACK] [--backend NAME]
//                      [--allow-run] [--deep --deep-reason R]        print the command; run nothing
//   builder.js run  ID (same flags) [--forbid name,logo,...] [--timeout-min N]
//                      runs it, reads craft.json and usage.json, scans app/ for forbidden terms, records the run on the job;
//                      exits 0 only when the build is ready, its checks pass and nothing forbidden was found
//   builder.js outcome ID [--forbid ...]                              read what a build left behind
//   builder.js collect ID --to <folder inside the project>            copy app/ into the repo (an empty folder only)
const fs = require('node:fs');
const path = require('node:path');
const jobs = require('../lib/job');
const builder = require('../lib/builder');

const argv = process.argv.slice(2);
const cmd = argv[0];
const rest = argv.slice(1);
const id = rest[0] && !rest[0].startsWith('--') ? rest[0] : undefined;
const flag = (name) => { const i = rest.indexOf(`--${name}`); return i > -1 && rest[i + 1] !== undefined && !rest[i + 1].startsWith('--') ? rest[i + 1] : undefined; };
const has = (name) => rest.includes(`--${name}`);
const terms = () => (flag('forbid') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const print = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);

function planFor(projectDir, job) {
  let request = flag('request');
  if (!request && flag('request-file')) request = fs.readFileSync(path.resolve(projectDir, flag('request-file')), 'utf8');
  const rounds = flag('rounds') === undefined ? 2 : Number(flag('rounds'));
  return builder.buildCommand(job, {
    projectDir, request, rounds, buildWith: flag('build-with') ?? '', backend: flag('backend') ?? '',
    allowRun: has('allow-run'), deep: has('deep'), deepReason: flag('deep-reason') ?? '', generateAssets: has('generate-assets'),
  });
}

async function main() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const root = jobs.rootOf(projectDir);
  if (!id) throw new Error('A job id is required.');
  const job = jobs.read(root, id);
  if (cmd === 'plan') { const p = planFor(projectDir, job); print({ binary: p.binary, argv: p.argv, folder: p.folder, mode: p.mode, allowRun: p.allowRun }); return 0; }
  if (cmd === 'run') {
    const plan = planFor(projectDir, job);
    if (plan.mode === 'deep') jobs.recordNote(root, id, { note: `deep mode (reads the original's code and files): ${flag('deep-reason')}`, by: 'builder' });
    const minutes = flag('timeout-min') === undefined ? 25 : Number(flag('timeout-min'));
    const result = await builder.run(plan, { timeoutMs: minutes * 60_000 });
    const outcome = builder.readOutcome(plan.folder);
    const hits = outcome.app ? builder.scanForbidden(path.join(plan.folder, 'app'), terms()) : [];
    builder.recordOutcome(root, id, outcome, { forbiddenHits: hits.length });
    print({ exitCode: result.code, timedOut: result.timedOut, folder: plan.folder, outcome, forbidden: hits, outputTail: result.output.slice(-1500) });
    return result.code === 0 && !result.timedOut && outcome.state === 'ready' && hits.length === 0 ? 0 : 1;
  }
  if (cmd === 'outcome') {
    const folder = builder.folderFor(projectDir, id);
    const outcome = builder.readOutcome(folder);
    print({ folder, outcome, forbidden: outcome.app ? builder.scanForbidden(path.join(folder, 'app'), terms()) : [] });
    return 0;
  }
  if (cmd === 'collect') {
    if (!flag('to')) throw new Error('--to <folder inside the project> is required.');
    print(builder.collect(projectDir, builder.folderFor(projectDir, id), flag('to')));
    return 0;
  }
  throw new Error(`Unknown command "${cmd ?? ''}". See the usage comment at the top of this file.`);
}

main().then((code) => { process.exitCode = code; }).catch((err) => { process.stderr.write(`builder: ${err.message}\n`); process.exitCode = 2; });
