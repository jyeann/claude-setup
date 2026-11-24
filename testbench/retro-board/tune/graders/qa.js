#!/usr/bin/env node
'use strict';
// Phase 7 grader (qa). cwd = trial worktree root. Output: qa-report.md at the repo root.
// Required report format (the prompt states it):
//   CHECK <n>: PASS|FAIL - <one line>          n = 1..15, the numbered "UI acceptance checks" of ux.md
//   DEFECT <k>: <file or area> - <what is wrong>  one line each
// The app carries three seeded UI defects (tune/seeds/seeds.js, QA_SEEDS).
const path = require('node:path');
const U = require('../lib/util');
const { QA_SEEDS, applySeeds } = require('../seeds/seeds');

const MIN_DEFECTS = 2;
const MIN_PASSING = 10;

const r = U.reporter('qa');
const cwd = process.cwd();
const report = U.readIf(path.join(cwd, 'qa-report.md'));
if (!r.check('qa-report.md exists at the repo root and is not empty', report && report.trim().length > 200, report ? `${report.length} chars` : 'missing')) process.exit(r.done());

const lines = report.split('\n').map((l) => l.replace(/^[\s>*|-]+/, '').replace(/[*_`]/g, ''));
const checks = new Map();
for (const l of lines) {
  const m = /^(?:CHECK|UI check|check)\s*#?(\d{1,2})\s*[:.)-]?\s*(PASS|FAIL)\b(.*)$/i.exec(l);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 15) checks.set(Number(m[1]), { result: m[2].toUpperCase(), note: m[3] });
}
const passing = [...checks.values()].filter((c) => c.result === 'PASS').length;
r.check(`report lists results for the numbered UI checks (as "CHECK n: PASS|FAIL")`, checks.size >= 12, `${checks.size} of 15 checks have a result`);
r.check(`at least ${MIN_PASSING} checks reported as passing`, passing >= MIN_PASSING, `${passing} PASS, ${checks.size - passing} FAIL`);

// A defect only counts when it is reported as a defect or a failing check, not mentioned inside a PASS line.
const claims = lines.filter((l) => /^DEFECT\b/i.test(l) || /^(?:CHECK|UI check|check)\s*#?\d+\s*[:.)-]?\s*FAIL\b/i.test(l));
let found = 0;
for (const seed of QA_SEEDS) {
  const hit = claims.find((l) => seed.detect.every((re) => re.test(l)));
  if (hit) found += 1;
  console.log(`  seeded defect ${seed.id}: ${hit ? `named ("${hit.slice(0, 90)}")` : 'not named'}`);
}
r.check(`report names at least ${MIN_DEFECTS} of ${QA_SEEDS.length} seeded UI defects`, found >= MIN_DEFECTS, `${found}/${QA_SEEDS.length} named`);

// QA reports, it does not fix: the served code must still be the seeded code.
const seeded = U.tmp('tune-qa-');
try {
  U.copy(U.GOLDEN_APP, seeded);
  applySeeds(seeded, QA_SEEDS);
  const changed = [...new Set(QA_SEEDS.map((s) => s.file))].filter((f) => U.readIf(path.join(cwd, U.APP_REL, f)) !== U.read(path.join(seeded, f)));
  r.check('public/js files were not modified (report only)', changed.length === 0, changed.length ? `modified: ${changed.join(', ')}` : '');
} finally {
  U.rmrf(seeded);
}
process.exit(r.done());
