// Authoring tool: node tests/tools/solve.js <scenario.json>
// Prints {path, optimalSummary, explored} for a scenario file. Copy optimalPath and optimalSummary into the file.
import fs from 'node:fs';
import path from 'node:path';
import { validate, formatError } from '../../public/js/engine/validate.js';
import { solve } from '../../public/js/engine/solver.js';

const file = process.argv[2];
if (!file) {
  process.stderr.write('usage: node tests/tools/solve.js <scenario.json>\n');
  process.exit(2);
}
const res = validate(JSON.parse(fs.readFileSync(file, 'utf8')), path.basename(file));
if (!res.ok) {
  for (const e of res.errors) process.stderr.write(`${formatError(e)}\n`);
  process.exit(1);
}
const sol = solve(res.scenario);
process.stdout.write(`${JSON.stringify({ path: sol.path, optimalSummary: sol.summary, explored: sol.explored }, null, 2)}\n`);
