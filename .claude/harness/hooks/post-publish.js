#!/usr/bin/env node
'use strict';
// One writer per page (#110): after a successful publish, records the publishing session as owner of a page that has
// none yet. It never blocks and never changes an existing owner.
const { readEvent, projectDirOf } = require('../lib/hook-io');
const { claimPublish } = require('../lib/design');

try {
  const event = readEvent();
  const result = claimPublish(event, projectDirOf(event));
  if (result.claimed) {
    process.stderr.write(`[harness] design page ${result.page.url} recorded with owner ${result.page.owner} in docs/design/${result.product}/pages.json; commit it so other sessions see it.\n`);
  }
} catch { /* recording ownership is best-effort; the pre-publish guard still holds */ }
