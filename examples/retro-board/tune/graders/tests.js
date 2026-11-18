#!/usr/bin/env node
'use strict';
// Phase 4 grader (test owner). cwd = trial worktree root.
// Output: examples/retro-board/{spec.md, acceptance/helpers.js, acceptance/*.test.js}
// The agent's tests are run against (a) the golden implementation, which they must pass, and (b) several
// deliberately broken copies of it, which they must fail.
const path = require('node:path');
const U = require('../lib/util');
const { stageGolden, nodeTest } = require('../lib/stage');
const { REVIEW_SEEDS, TEST_MUTANTS } = require('../seeds/seeds');

const MIN_TESTS = 25;
const MIN_PASS_RATE = 0.95;
const MIN_KILLED = 3;
const RUN_TIMEOUT_MS = 150_000;
// token-compare is a timing-only defect, so no black-box test can see it; the other four review seeds can be.
const VARIANTS = [...REVIEW_SEEDS.filter((s) => s.id !== 'token-compare'), ...TEST_MUTANTS];

async function main() {
  const r = U.reporter('tests');
  const cwd = process.cwd();
  const app = path.join(cwd, U.APP_REL);
  const tests = U.exists(path.join(app, 'acceptance')) ? require('node:fs').readdirSync(path.join(app, 'acceptance')).filter((f) => /\.test\.js$/.test(f)) : [];
  r.check('spec.md exists', (U.readIf(path.join(app, 'spec.md')) || '').trim().length > 300);
  r.check('acceptance/helpers.js exists', U.exists(path.join(app, 'acceptance', 'helpers.js')));
  r.check('at least one acceptance/*.test.js file', tests.length > 0, `${tests.length} file(s)`);
  if (r.failed() > 0) return r.done();

  const g = stageGolden(cwd);
  const stagedVariants = [];
  try {
    const golden = await nodeTest(g.app, ['acceptance/*.test.js'], RUN_TIMEOUT_MS);
    const s = U.parseTestSummary(golden.out);
    const rate = s.tests > 0 ? s.pass / s.tests : 0;
    r.check(`at least ${MIN_TESTS} tests ran against the golden implementation`, s.tests >= MIN_TESTS, `${s.tests} tests${golden.timedOut ? ', TIMED OUT' : ''}`);
    r.check(`at least ${MIN_PASS_RATE * 100}% pass against the golden implementation`, rate >= MIN_PASS_RATE, `${s.pass}/${s.tests} passing (${(rate * 100).toFixed(1)}%)`);
    if (s.tests > 0 && rate < MIN_PASS_RATE) {
      const failing = [...golden.out.matchAll(/^\s*(?:✖|not ok \d+ -)\s+(.*?)(?:\s+\([\d.]+ms\))?$/gm)].map((m) => m[1]).slice(0, 6);
      for (const f of failing) console.log(`  failing against golden: ${f}`);
    }
    if (s.skipped + s.todo > 0) r.check('no skipped or todo tests', false, `${s.skipped} skipped, ${s.todo} todo`);
    if (r.failed() > 0) return r.done();

    // Broken copies, run a few at a time.
    for (const v of VARIANTS) stagedVariants.push({ v, ...stageGolden(cwd, { seeds: [v] }) });
    const results = [];
    const queue = [...stagedVariants];
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const item = queue.shift();
        const res = await nodeTest(item.app, ['acceptance/*.test.js'], RUN_TIMEOUT_MS);
        const sum = U.parseTestSummary(res.out);
        // killed = the suite failed for this variant (a timeout or a crash that left no failing test also counts as failed, but not as a clean kill)
        results.push({ id: item.v.id, killed: sum.fail + sum.cancelled > 0, ran: sum.tests > 0, fail: sum.fail + sum.cancelled });
      }
    }));
    results.sort((a, b) => VARIANTS.findIndex((x) => x.id === a.id) - VARIANTS.findIndex((x) => x.id === b.id));
    for (const x of results) console.log(`  variant ${x.id}: ${x.killed ? `caught (${x.fail} failing)` : x.ran ? 'NOT caught' : 'suite did not run'}`);
    const killed = results.filter((x) => x.killed).length;
    r.check(`tests fail against at least ${MIN_KILLED} of ${VARIANTS.length} broken copies of the golden code`, killed >= MIN_KILLED, `${killed}/${VARIANTS.length} caught`);
  } finally {
    U.rmrf(g.root);
    for (const x of stagedVariants) U.rmrf(x.root);
  }
  return r.done();
}

main().then((code) => { process.exitCode = code; }).catch((e) => { console.error(`tests grader error: ${e.stack}`); process.exitCode = 2; });
