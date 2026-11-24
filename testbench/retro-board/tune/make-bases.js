#!/usr/bin/env node
'use strict';
// node tune/make-bases.js <outRoot> [phase,phase,...]
// Creates one fresh git repo per phase at <outRoot>/<phase>, with ONE commit and no history, holding only the inputs
// that phase legitimately has plus its prompt as TASK.md. Everything comes from tune/golden and tune/seeds, so the
// kit does not depend on the layout of the repo it lives in.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const U = require('./lib/util');
const { REVIEW_SEEDS, QA_SEEDS, applySeeds } = require('./seeds/seeds');

const APP = U.APP_REL;
const DOCS = U.DOCS_REL;

const repoReadme = `# claude-setup

The product-team process and its test bench. \`testbench/README.md\` lists the products built earlier with the
process; each lives in its own repository.
`;
const catalogueReadme = `# Products built with the process

| Product | What it is |
|---|---|
| todo-api | A REST API for to-do lists |
| notes-api | A REST API for notes with tags |
| sheet-engine | A small spreadsheet formula engine (library) |
| link-shortener | A URL shortener with a web page |

Every product is Node 22 with no runtime dependencies. New products go in their own repository.
`;

const docs = (...names) => names.map((n) => ({ from: path.join(U.GOLDEN_DOCS, `${n}.md`), to: path.join(DOCS, `${n}.md`) }));
const app = (...names) => names.map((n) => ({ from: path.join(U.GOLDEN_APP, n), to: path.join(APP, n) }));

// phase -> {files: [{from,to}], text: {path: content}, seeds: [...]}  (seeds are applied to src/public after copying)
const PLANS = {
  discover: { text: { 'README.md': repoReadme, [path.join('testbench', 'README.md')]: catalogueReadme } },
  ux: { files: docs('brief') },
  design: { files: docs('brief', 'ux') },
  tests: { files: docs('brief', 'ux', 'design') },
  build: {
    files: [...docs('brief', 'ux', 'design'), ...app('spec.md', 'acceptance', 'verify.config.json', 'package.json', '.gitignore')],
  },
  review: {
    files: [...docs('design'), ...app('src', 'public', 'spec.md', 'package.json', '.gitignore')],
    seeds: REVIEW_SEEDS,
  },
  qa: {
    files: [...docs('ux'), ...app('src', 'public', 'package.json', '.gitignore')],
    seeds: QA_SEEDS,
  },
  release: {
    files: [...docs('brief', 'design'), ...app('src', 'public', 'spec.md', 'package.json', '.gitignore', 'acceptance', 'tests', 'verify.config.json')],
  },
};

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.name=tune-kit', '-c', 'user.email=tune-kit@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// Lay out the inputs of `phase` in `dest` (no git). Used by makeBase and by selftest.
function layout(phase, dest) {
  const plan = PLANS[phase];
  if (!plan) throw new Error(`unknown phase "${phase}" (use ${U.PHASES.join(', ')})`);
  fs.mkdirSync(dest, { recursive: true });
  for (const { from, to } of plan.files || []) U.copy(from, path.join(dest, to));
  for (const [rel, content] of Object.entries(plan.text || {})) {
    fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
    fs.writeFileSync(path.join(dest, rel), content);
  }
  if (plan.seeds) applySeeds(path.join(dest, APP), plan.seeds);
  fs.copyFileSync(path.join(U.TUNE, 'prompts', `${phase}.md`), path.join(dest, 'TASK.md'));
}

function makeBase(phase, dest) {
  U.rmrf(dest);
  layout(phase, dest);
  git(dest, ['init', '-q', '-b', 'main']);
  git(dest, ['add', '-A']);
  git(dest, ['commit', '-q', '-m', `tune base: ${phase}`]);
  const n = git(dest, ['rev-list', '--count', 'HEAD']);
  if (n !== '1') throw new Error(`base ${phase} has ${n} commits, expected 1`);
  return dest;
}

function makeBases(outRoot, phases = U.PHASES) {
  const made = {};
  for (const phase of phases) made[phase] = makeBase(phase, path.join(outRoot, phase));
  return made;
}

module.exports = { makeBase, makeBases, layout, PLANS };

if (require.main === module) {
  const [outRoot, list] = process.argv.slice(2);
  if (!outRoot) { console.error('usage: node tune/make-bases.js <outRoot> [phase,phase,...]'); process.exit(2); }
  const phases = list ? list.split(',').map((s) => s.trim()).filter(Boolean) : U.PHASES;
  for (const [phase, dir] of Object.entries(makeBases(path.resolve(outRoot), phases))) console.log(`${phase.padEnd(9)} ${dir}`);
}
