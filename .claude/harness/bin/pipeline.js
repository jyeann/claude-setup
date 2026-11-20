#!/usr/bin/env node
'use strict';
// Usage: pipeline.js check --product <dir> --docs <dir>
//        pipeline.js hash --product <dir>   (prints the source digest that reviews.md and qa.md record as "Examined:")
// The whole-pipeline definition of done for orch-product-team: all nine phases have their output and the
// product passes its own verify gate. Use it as the harness verify command so the Stop hook keeps the agent
// working through every phase. Exit 0: complete. Exit 1: a phase is incomplete (named, with what is missing).
// Exit 2: usage error.
const path = require('node:path');
const { checkPipeline, formatReport, sourceHash } = require('../lib/pipeline');

async function main([command, ...rest]) {
  const flags = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--product', '--docs'].includes(rest[i]) || rest[i + 1] === undefined) throw new Error(`Unexpected argument: ${rest[i]}`);
    flags[rest[i].slice(2)] = rest[i + 1];
  }
  if (command === 'hash' && flags.product && !flags.docs) {
    console.log(sourceHash(path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd(), flags.product)));
    return 0;
  }
  if (command !== 'check' || !flags.product || !flags.docs) throw new Error('Usage: pipeline.js check --product <dir> --docs <dir> | pipeline.js hash --product <dir>');
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const result = await checkPipeline({ root, product: flags.product, docs: flags.docs });
  console.log(formatReport(result));
  return result.pass ? 0 : 1;
}

main(process.argv.slice(2))
  .then((code) => { process.exitCode = code; })
  .catch((err) => { console.error(`pipeline: ${err.message}`); process.exitCode = 2; });
