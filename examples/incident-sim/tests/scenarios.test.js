// Scenario files: validity, solver equality and the first-page window (spec.md "The 10 shipped scenarios").
// SCENARIOS_DIR overrides the folder, so `SCENARIOS_DIR=/some/dir node --test tests/scenarios.test.js` checks any folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validate, formatError } from '../public/js/engine/validate.js';
import { solve, firstPageTick } from '../public/js/engine/solver.js';
import { createRun, step } from '../public/js/engine/engine.js';

const dir = process.env.SCENARIOS_DIR ? path.resolve(process.env.SCENARIOS_DIR) : path.resolve(import.meta.dirname, '..', 'scenarios');
const SHIPPED = [
  'cache-stampede', 'thundering-herd', 'retry-storm', 'hot-partition', 'queue-backlog',
  'n-plus-one', 'connection-pool-exhaustion', 'expiring-certificate', 'split-brain', 'cascading-failure',
];

const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];

test(`scenarios folder ${dir} holds at least one scenario file`, () => {
  assert.ok(files.length > 0, `no .json files in ${dir}`);
});

for (const file of files) {
  const parsed = validate(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')), file);

  test(`${file} is a valid scenario`, () => {
    assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.map(formatError).join('\n'));
  });
  if (!parsed.ok) continue;
  const sc = parsed.scenario;

  test(`${file} first SEV1/2 page lands between ticks 6 and 9 for seeds 0 to 49`, () => {
    for (let seed = 0; seed < 50; seed++) {
      const fp = firstPageTick(sc, seed);
      assert.ok(Number.isInteger(fp) && fp >= 6 && fp <= 9, `seed ${seed}: first page at ${fp}`);
    }
  });

  test(`${file} stays calm until onset and the no-action run ends out of budget`, () => {
    let s = createRun(sc, sc.seed);
    while (s.status === 'running') {
      if (s.onsetTick === null || s.tick <= s.onsetTick) assert.deepEqual(Object.keys(s.alerts).filter((k) => s.alerts[k].firing), [], `alert before onset at tick ${s.tick}`);
      s = step(s, []);
    }
    assert.equal(s.status, 'out-of-budget');
    assert.ok(s.onsetTick >= 4 && s.onsetTick <= 6, `onset ${s.onsetTick}`);
  });

  if (SHIPPED.includes(sc.id)) {
    test(`${file} solver finds the declared optimalPath and optimalSummary`, { timeout: 120000 }, () => {
      const sol = solve(sc);
      assert.ok(sol.path, 'the solver found no resolving path');
      assert.deepEqual(sol.path.map((p) => ({ id: p.id, node: p.node })), sc.optimalPath.map((p) => ({ id: p.id, node: p.node })));
      assert.deepEqual({ ...sol.summary }, { timeToMitigate: sc.optimalSummary.timeToMitigate, cost: sc.optimalSummary.cost });
    });
  }
}
