#!/usr/bin/env node
'use strict';
// Usage: pipeline.js check --product <dir> --docs <dir> [--change <issue>] [--issue-json <file>]
// The whole-pipeline definition of done for orch-product-team: every phase has its output, both owner gates
// are on the spec issue, and the product passes its own verify gate. Use it as the harness verify command so
// the Stop hook keeps the agent working through every phase. Exit 0: complete. Exit 1: a phase is incomplete
// (named, with what is missing). Exit 2: usage error. Exit 3: waiting for the owner; the last line reads
// "waiting for owner: spec issue #N needs label <gate>", and the Stop hook lets the turn end.
// A layer verdict comment on the spec issue that redirects a layer sends the run back to that layer's phase;
// a 4th redirect at one gate stops the run (exit 3, "PIPELINE STOPPED").
// --change: a change-request run (#89) for an accepted product, gated on that change's own spec issue; its
// records go in <docs>/changes/<issue>/. Refused (exit 2) while the product's first run is not accepted.
// --issue-json: a saved copy of the spec issue (with its comments as an array, for the layer verdicts),
// read only when gh cannot reach GitHub.
const { checkPipeline, formatReport } = require('../lib/pipeline');

async function main([command, ...rest]) {
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--product', '--docs', '--issue-json', '--change'].includes(rest[i]) || rest[i + 1] === undefined) throw new Error(`Unexpected argument: ${rest[i]}`);
    flags[rest[i].slice(2)] = rest[i + 1];
  }
  if (command !== 'check' || !flags.product || !flags.docs) throw new Error('Usage: pipeline.js check --product <dir> --docs <dir> [--change <issue>]');
  // Only a plain number: "#30" or "other/repo#30" is refused rather than guessed at.
  const change = flags.change === undefined ? undefined : (/^\d+$/.test(flags.change) && Number.isSafeInteger(Number(flags.change)) ? Number(flags.change) : Number.NaN);
  if (Number.isNaN(change)) throw new Error(`--change needs an issue number (the change's spec issue), not ${flags.change}`);
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const result = await checkPipeline({ root, product: flags.product, docs: flags.docs, change, issueJson: flags['issue-json'] });
  console.log(formatReport(result));
  if (result.pass) return 0;
  return result.waiting ? 3 : 1;
}

main(process.argv.slice(2))
  .then((code) => { process.exitCode = code; })
  .catch((err) => { console.error(`pipeline: ${err.message}`); process.exitCode = 2; });
