#!/usr/bin/env node
'use strict';
// Usage:
//   design-check.js [--root <project>] [--brief <file> ...]
//     Checks every docs/design/<product>/ folder (direction.md filled, its Checks lines valid, pages.json and
//     checks.json readable) and each brief given (links direction.md, does not restate it, every section filled,
//     Done means asks for the check line). Exit 1 on any problem.
//   design-check.js run [--root <project>] [--product <p>] [--asset <a>] [--timeout <seconds>]
//     Runs the check command of each asset kind named in direction.md's Checks section and writes the result to
//     docs/design/<product>/checks.json. Exit 1 when any check fails (#111).
//   design-check.js status [--root <project>] [--product <p>]
//     Lists each asset as "done: <its check line>" or "not done: <asset> - <why>" (no record, failed, stale).
//     Exit 1 when any asset is not done.
const fs = require('node:fs');
const path = require('node:path');
const design = require('../lib/design');
const checks = require('../lib/design-checks');

const args = process.argv.slice(2);
const valuesOf = (flag) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : []));
const sub = args.find((a, i) => (a === 'run' || a === 'status') && !String(args[i - 1] || '').startsWith('--'));
const root = path.resolve(valuesOf('--root')[0] || process.cwd());
const only = { product: valuesOf('--product')[0], asset: valuesOf('--asset')[0] };
const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };
const fail = (msg) => { console.error(`design-check: ${msg}`); process.exit(1); };
const products = design.productDirs(root);
const directionOf = (product) => read(path.join(root, 'docs', 'design', product, 'direction.md'));

function run() {
  if (only.product && !products.includes(only.product)) fail(`no product folder "${only.product}" under docs/design`);
  const timeoutS = Number(valuesOf('--timeout')[0]) || undefined;
  const files = checks.projectFiles(root);
  const results = [];
  for (const product of products.filter((p) => !only.product || p === only.product)) {
    const text = directionOf(product);
    if (text === null) continue;
    const parsed = checks.parseChecks(design.sections(text).get('Checks') || '', product);
    if (parsed.problems.length) fail(parsed.problems.map((p) => `docs/design/${product}/direction.md: ${p}`).join('\n'));
    const list = parsed.checks.filter((c) => !only.asset || c.asset === only.asset);
    const fresh = [];
    for (const check of list) {
      console.log(`design-check: running ${product}/${check.asset}: ${check.command}`);
      const { record, output } = checks.runOne(root, check, { timeoutS, files });
      if (output.trim()) process.stdout.write(`${output.trimEnd()}\n`);
      fresh.push(record);
    }
    if (fresh.length) checks.writeRecords(root, product, fresh);
    results.push(...fresh);
  }
  if (only.asset && !results.length) fail(`no check named "${only.asset}" in any direction.md Checks section`);
  if (!results.length) fail('no checks to run: name a check command per asset kind in docs/design/<product>/direction.md under "## Checks"');
  console.log(results.map((r) => r.line).join('\n'));
  const failed = results.filter((r) => !r.ok);
  if (failed.length) fail(`${failed.length} of ${results.length} check(s) failed; those assets are not done.`);
  console.log(`design-check: ${results.length} check(s) passed, recorded in docs/design/<product>/checks.json`);
}

function status() {
  const { items, problems } = checks.statusAll(root, products, only);
  for (const i of items) console.log(i.state === 'done' ? `done: ${i.line}` : `not done: ${i.asset} - ${i.why}`);
  if (problems.length) console.error(problems.join('\n'));
  if (!items.length && !problems.length) console.log('design-check: no assets with a check under docs/design');
  if (problems.length || items.some((i) => i.state !== 'done')) process.exit(1);
}

function lint() {
  const problems = [];
  const directions = new Map();
  for (const product of products) {
    const rel = path.join('docs', 'design', product, 'direction.md');
    const text = directionOf(product);
    if (text === null) { problems.push(`${rel}: missing; every product with design work has one current-direction file`); continue; }
    directions.set(product, text);
    problems.push(...design.checkDirection(text, rel));
    problems.push(...checks.parseChecks(design.sections(text).get('Checks') || '', product).problems.map((p) => `${rel}: ${p}`));
    const { error } = checks.readRecords(root, product);
    if (error) problems.push(error);
  }
  problems.push(...design.readRegisters(root).errors);

  for (const brief of valuesOf('--brief')) {
    const text = read(brief);
    if (text === null) { problems.push(`${brief}: cannot read`); continue; }
    const product = /docs\/design\/([A-Za-z0-9._-]+)\/direction\.md/.exec(text)?.[1];
    problems.push(...design.checkBrief(text, { directionText: directions.get(product) || '', where: brief }));
  }

  if (problems.length) fail(`${problems.length} problem(s).\n${problems.join('\n')}`);
  console.log(products.length ? `design-check: ok (${products.length} product folder(s))` : 'design-check: ok (no product folders under docs/design)');
}

if (sub === 'run') run();
else if (sub === 'status') status();
else lint();
