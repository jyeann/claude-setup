#!/usr/bin/env node
'use strict';
// Phase 6 grader (review). cwd = trial worktree root. Output: review-report.md at the repo root.
// Seeded defects live in tune/seeds/seeds.js. A seed counts as found when the report names its file and a
// keyword that describes it close together, or cites a line of that file within 8 lines of the seeded line.
const fs = require('node:fs');
const path = require('node:path');
const U = require('../lib/util');
const { REVIEW_SEEDS, applySeeds, seedLine } = require('../seeds/seeds');

const MIN_FOUND = 4;
const WINDOW = 500; // characters between the file mention and the keyword
const LINE_SLACK = 8;

const r = U.reporter('review');
const cwd = process.cwd();
const report = U.readIf(path.join(cwd, 'review-report.md'));
if (!r.check('review-report.md exists at the repo root and is not empty', report && report.trim().length > 200, report ? `${report.length} chars` : 'missing')) process.exit(r.done());

// The reviewer must not fix the code: the app files have to be exactly the seeded ones.
const seeded = U.tmp('tune-review-');
try {
  U.copy(U.GOLDEN_APP, seeded);
  applySeeds(seeded, REVIEW_SEEDS);
  const changed = [];
  for (const f of new Set(REVIEW_SEEDS.map((s) => s.file))) {
    const mine = U.readIf(path.join(cwd, U.APP_REL, f));
    if (mine !== U.read(path.join(seeded, f))) changed.push(f);
  }
  r.check('source files were not modified (review only)', changed.length === 0, changed.length ? `modified: ${changed.join(', ')}` : '');

  let found = 0;
  for (const seed of REVIEW_SEEDS) {
    const line = seedLine(U.read(path.join(U.GOLDEN_APP, seed.file)), seed);
    const base = path.basename(seed.file);
    let how = null;
    // (1) keyword near a mention of the file
    const kw = new RegExp(seed.detect.keywords.source, `${seed.detect.keywords.flags.replace('g', '')}g`);
    for (const m of report.matchAll(kw)) {
      const from = Math.max(0, m.index - WINDOW);
      const around = report.slice(from, m.index + m[0].length + WINDOW);
      if (seed.detect.file.test(around)) { how = `keyword "${m[0].slice(0, 40)}" near ${base}`; break; }
    }
    // (2) a line citation `file.js:123` (or `file.js line 123`, `file.js#L123`) within LINE_SLACK of the seeded line
    if (!how) {
      const cite = new RegExp(`${base.replace('.', '\\.')}(?::|#L|\\s+lines?\\s+|\\s*\\(\\s*lines?\\s+|\\s*\\(L)(\\d+)(?:\\s*[-–]\\s*(\\d+))?`, 'gi');
      for (const m of report.matchAll(cite)) {
        const a = Number(m[1]);
        const b = m[2] ? Number(m[2]) : a;
        if (line !== null && a - LINE_SLACK <= line && line <= b + LINE_SLACK) { how = `cites ${base}:${m[1]}${m[2] ? `-${m[2]}` : ''} (seeded line ${line})`; break; }
      }
    }
    if (how) found += 1;
    console.log(`  seed ${seed.id}: ${how ? `found, ${how}` : `not found (${seed.file}:${line})`}`);
  }
  r.check(`report finds at least ${MIN_FOUND} of ${REVIEW_SEEDS.length} seeded defects`, found >= MIN_FOUND, `${found}/${REVIEW_SEEDS.length} found`);
} finally {
  U.rmrf(seeded);
}
process.exit(r.done());
