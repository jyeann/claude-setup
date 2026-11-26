#!/usr/bin/env node
'use strict';
// Usage: design-check.js [--root <project>] [--brief <file> ...]
// Checks every docs/design/<product>/ folder (direction.md filled, pages.json valid) and each brief given
// (links direction.md, does not restate it, every section filled). Exit 1 on any problem.
const fs = require('node:fs');
const path = require('node:path');
const design = require('../lib/design');

const args = process.argv.slice(2);
const valuesOf = (flag) => args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1]] : []));
const root = path.resolve(valuesOf('--root')[0] || process.cwd());
const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

const problems = [];
const products = design.productDirs(root);
const directions = new Map();
for (const product of products) {
  const rel = path.join('docs', 'design', product, 'direction.md');
  const text = read(path.join(root, rel));
  if (text === null) problems.push(`${rel}: missing; every product with design work has one current-direction file`);
  else { directions.set(product, text); problems.push(...design.checkDirection(text, rel)); }
}
problems.push(...design.readRegisters(root).errors);

for (const brief of valuesOf('--brief')) {
  const text = read(brief);
  if (text === null) { problems.push(`${brief}: cannot read`); continue; }
  const product = /docs\/design\/([A-Za-z0-9._-]+)\/direction\.md/.exec(text)?.[1];
  problems.push(...design.checkBrief(text, { directionText: directions.get(product) || '', where: brief }));
}

if (problems.length) {
  console.error(`design-check: ${problems.length} problem(s).\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(products.length ? `design-check: ok (${products.length} product folder(s))` : 'design-check: ok (no product folders under docs/design)');
