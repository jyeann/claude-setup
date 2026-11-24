#!/usr/bin/env node
'use strict';
// Effort tuning per phase of the product-team process, graded against the retro board golden reference.
//   node tune/run.js --phases discover,ux --levels low,medium,high --trials 2 --model claude-sonnet-5-5 --out report.json
// For each phase (sequentially) it builds a fresh base repo, runs the harness tune.js there with the phase's grader as the
// verify command, and merges each base's .harness/tune-report.json into one report. COSTS REAL TOKENS: every trial is a
// `claude -p` run. Use --dry-run to print the commands without running anything.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const U = require('./lib/util');
const { makeBase } = require('./make-bases');

const TUNE_JS = path.join(U.HARNESS_DIR, 'bin', 'tune.js');
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const USAGE = `usage: node tune/run.js [--phases a,b] [--levels low,medium,high] [--trials N] [--model M] [--out report.json]
                       [--agent-timeout-min N] [--keep] [--dry-run]
phases: ${U.PHASES.join(', ')} (default: all)`;

function parseArgs(argv) {
  const f = { keep: false, 'dry-run': false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--keep' || a === '--dry-run') f[a.slice(2)] = true;
    else if (a === '--help' || a === '-h') f.help = true;
    else if (a.startsWith('--') && argv[i + 1] !== undefined) { f[a.slice(2)] = argv[i + 1]; i += 1; }
    else throw new Error(`bad argument near ${a}\n${USAGE}`);
  }
  return f;
}

const pick = (r) => ({
  model: r.model, effort: r.effort, passRate: r.passRate, trials: r.trials,
  meanCostUsd: r.meanCostUsd, meanSeconds: r.meanSeconds, meanOutputTokens: r.meanOutputTokens, meanTurns: r.meanTurns,
});

function runTune(base, phase, { candidates, trials, timeoutMin }) {
  const grader = path.join(U.TUNE, 'graders', `${phase}.js`);
  const args = [TUNE_JS, '--task-file', 'TASK.md', '--verify', `node "${grader}"`, '--candidates', candidates, '--trials', String(trials), '--agent-timeout-min', String(timeoutMin)];
  return { args, exec: () => new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: base, env: { ...process.env, CLAUDE_PROJECT_DIR: base }, stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', (e) => resolve({ code: 2, error: e.message }));
    child.on('close', (code) => resolve({ code }));
  }) };
}

async function main(argv) {
  const f = parseArgs(argv);
  if (f.help) { console.log(USAGE); return 0; }
  const phases = (f.phases ? f.phases.split(',') : U.PHASES).map((s) => s.trim()).filter(Boolean);
  const levels = (f.levels || 'low,medium,high').split(',').map((s) => s.trim()).filter(Boolean);
  const model = f.model || 'claude-sonnet-5-5';
  const trials = Number.parseInt(f.trials || '1', 10);
  const timeoutMin = Number(f['agent-timeout-min'] || 20);
  const out = path.resolve(f.out || 'report.json');
  for (const p of phases) if (!U.PHASES.includes(p)) throw new Error(`unknown phase "${p}"\n${USAGE}`);
  for (const l of levels) if (!EFFORTS.includes(l)) throw new Error(`unknown effort "${l}" (use ${EFFORTS.join(', ')})`);
  if (!Number.isInteger(trials) || trials < 1) throw new Error('--trials must be a positive integer');
  if (!U.exists(TUNE_JS)) throw new Error(`tune.js not found at ${TUNE_JS} (set HARNESS_DIR)`);
  const candidates = levels.map((l) => `${model}:${l}`).join(',');

  const work = U.tmp('retro-tune-');
  const report = { generatedAt: new Date().toISOString(), model, levels, trials, phases: [] };
  const save = () => fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.error(`bases in ${work}; ${phases.length} phase(s) x ${levels.length} level(s) x ${trials} trial(s)${f['dry-run'] ? ' (dry run)' : ''}`);
  let exit = 0;
  try {
    for (const phase of phases) {
      const entry = { phase, results: [] };
      report.phases.push(entry);
      try {
        const base = makeBase(phase, path.join(work, phase));
        const t = runTune(base, phase, { candidates, trials, timeoutMin });
        console.error(`\n== ${phase}: CLAUDE_PROJECT_DIR=${base} node ${t.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`);
        if (f['dry-run']) { entry.dryRun = true; save(); continue; }
        const res = await t.exec();
        // tune exits 0 when a candidate passes, 1 when none does (both leave a report), 2 on a real error
        const reportFile = path.join(base, '.harness', 'tune-report.json');
        if (U.exists(reportFile)) entry.results = JSON.parse(U.read(reportFile)).results.map(pick);
        else { entry.error = res.error || `tune.js exited ${res.code} without a report`; exit = 1; }
        if (res.code === 2) { entry.error = entry.error || 'tune.js exited 2'; exit = 1; }
      } catch (err) {
        entry.error = err.message;
        exit = 1;
        console.error(`phase ${phase} failed: ${err.message}`);
      }
      save();
    }
  } finally {
    if (f.keep || f['dry-run']) console.error(`bases kept in ${work}`); else U.rmrf(work);
  }
  save();
  console.error(`\nreport written to ${out}`);
  return exit;
}

main(process.argv.slice(2)).then((c) => { process.exitCode = c; }).catch((e) => { console.error(`run: ${e.message}`); process.exitCode = 2; });
