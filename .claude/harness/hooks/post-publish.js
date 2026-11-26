#!/usr/bin/env node
'use strict';
// One writer per page (#110): after a successful publish, records the publishing session as owner of a page that has
// none yet. It never blocks and never changes an existing owner.
const { readEvent, projectDirOf } = require('../lib/hook-io');
const { claimPublish } = require('../lib/design');
const { recordHookError } = require('../lib/trace');

try {
  const event = readEvent();
  const result = claimPublish(event, projectDirOf(event));
  if (result.claimed) {
    process.stderr.write(`[harness] design page ${result.page.url} recorded with owner ${result.page.owner} in docs/design/${result.product}/pages.json; commit it so other sessions see it.\n`);
  } else if (/product folder|more than one|not valid/.test(result.why)) {
    process.stderr.write(`[harness] design page owner not recorded: ${result.why}. Add the page to the right docs/design/<product>/pages.json.\n`);
  }
} catch (err) {
  recordHookError('post-publish', err); // best-effort: the pre-publish guard still holds
}
