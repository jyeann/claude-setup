#!/usr/bin/env node
'use strict';
// Usage: pipeline.js check --product <dir> --docs <dir> [--issue-json <file>]
// The whole-pipeline definition of done for orch-product-team: every phase has its output, both owner gates
// are on the spec issue, and the product passes its own verify gate. Use it as the harness verify command so
// the Stop hook keeps the agent working through every phase. Exit 0: complete. Exit 1: a phase is incomplete
// (named, with what is missing). Exit 2: usage error. Exit 3: waiting for the owner; the last line reads
// "waiting for owner: spec issue #N needs label <gate>", and the Stop hook lets the turn end.
// A layer verdict comment on the spec issue that redirects a layer sends the run back to that layer's phase;
// a 4th redirect at one gate stops the run (exit 3, "PIPELINE STOPPED").
// --issue-json: a saved copy of the spec issue (with its comments as an array, for the layer verdicts),
// read only when gh cannot reach GitHub.
const { checkPipeline, formatReport } = require('../lib/pipeline');

async function main([command, ...rest]) {
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--product', '--docs', '--issue-json'].includes(rest[i]) || rest[i + 1] === undefined) throw new Error(`Unexpected argument: ${rest[i]}`);
    flags[rest[i].slice(2)] = rest[i + 1];
  }
  if (command !== 'check' || !flags.product || !flags.docs) throw new Error('Usage: pipeline.js check --product <dir> --docs <dir>');
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const result = await checkPipeline({ root, product: flags.product, docs: flags.docs, issueJson: flags['issue-json'] });
  console.log(formatReport(result));
  if (result.pass) return 0;
  return result.waiting ? 3 : 1;
}

main(process.argv.slice(2))
  .then((code) => { process.exitCode = code; })
  .catch((err) => { console.error(`pipeline: ${err.message}`); process.exitCode = 2; });
