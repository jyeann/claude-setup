#!/usr/bin/env node
'use strict';
// Checked before "done" (#111): when design files changed after their last check record, the session is told to
// run the check before it ends the turn. It holds the turn once (never on its own second firing), and is silent
// when there is no design work or every record is current.
const { readEvent, projectDirOf } = require('../lib/hook-io');
const { productDirs } = require('../lib/design');
const { staleForStop } = require('../lib/design-checks');
const { recordHookError } = require('../lib/trace');

try {
  const event = readEvent();
  if (!event.stop_hook_active) {
    const projectDir = projectDirOf(event);
    const products = productDirs(projectDir);
    const items = products.length ? staleForStop(projectDir, products) : [];
    if (items.length) {
      const list = items.map((i) => `${i.product}/${i.asset} (${i.why})`).join('; ');
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: `Design files changed after their last check: ${list}. Run \`node .claude/harness/bin/design-check.js run\` `
          + 'before ending the turn, and report each asset as done only by quoting its line from checks.json; a failing '
          + 'or missing check is "not done". See the design-sessions skill.',
      }));
    }
  }
} catch (err) {
  recordHookError('stop-design', err); // best-effort: the skill rule and `design-check.js status` still hold
}
