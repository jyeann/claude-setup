#!/usr/bin/env node
'use strict';
// issues <command> ...   GitHub issue intake. Reads issues as JSON (a file, or - for stdin); never calls GitHub.
//   issues.js plan  --from issues.json [--ack N="I own the legal side"] [--accept-untrusted N,M]   what would happen, per issue
//   issues.js apply --from issues.json (same flags)                 create the jobs (docs/jobs/issue-N/, with issue.md)
//   issues.js report <job-id>                                       draft the status text for the issue thread (nothing is posted)
// Get the JSON with:  gh api "repos/OWNER/REPO/issues?labels=factory&state=open" > issues.json
// Settings (optional): factory.config.json { label, trustedAssociations, trustedAuthors, concurrency, maxBodyChars }.
const fs = require('node:fs');
const path = require('node:path');
const jobs = require('../lib/job');
const issues = require('../lib/issues');

const argv = process.argv.slice(2);
const cmd = argv[0];
const rest = argv.slice(1);
const flags = (name) => rest.flatMap((a, i) => (a === `--${name}` && rest[i + 1] !== undefined ? [rest[i + 1]] : []));
const flag = (name) => flags(name)[0];

function readIssues(projectDir) {
  const from = flag('from');
  if (!from) throw new Error('--from <issues.json> (or -) is required.');
  const text = from === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(projectDir, from), 'utf8');
  let data;
  try { data = JSON.parse(text); } catch (err) { throw new Error(`The issues file is not valid JSON: ${err.message}`); }
  if (!Array.isArray(data)) throw new Error('The issues file must be a JSON list of issues.');
  return data;
}

function acksFrom() {
  const acks = {};
  for (const raw of flags('ack')) {
    const m = raw.match(/^(\d+)=(.+)$/s);
    if (!m || !m[2].trim()) throw new Error(`--ack needs NUMBER="text", got "${raw}".`);
    acks[Number(m[1])] = m[2].trim();
  }
  return acks;
}

function main() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const root = jobs.rootOf(projectDir);
  const out = (v) => process.stdout.write(`${JSON.stringify(v, null, 2)}\n`);
  if (cmd === 'report') {
    if (!rest[0]) throw new Error('A job id is required.');
    process.stdout.write(`${issues.report(jobs.read(root, rest[0]))}\n`);
    return 0;
  }
  if (cmd !== 'plan' && cmd !== 'apply') throw new Error(`Unknown command "${cmd ?? ''}". See the usage comment at the top of this file.`);
  const cfg = issues.loadConfig(projectDir);
  const acks = acksFrom();
  const acceptUntrusted = (flag('accept-untrusted') ?? '').split(',').map((s) => Number(s.trim())).filter(Number.isInteger);
  const actions = issues.plan(readIssues(projectDir), { cfg, root, acks, acceptUntrusted });
  const view = actions.map(({ _issue, ...a }) => a);
  if (cmd === 'plan') { out({ actions: view }); return 0; }
  const created = issues.apply(actions, { cfg, root, acks });
  out({ created, actions: view });
  return 0;
}

try { process.exitCode = main(); } catch (err) { process.stderr.write(`issues: ${err.message}\n`); process.exitCode = 2; }
