#!/usr/bin/env node
'use strict';
// Phase 8 grader (release). cwd = trial worktree root. Output: examples/retro-board/README.md
const fs = require('node:fs');
const path = require('node:path');
const U = require('../lib/util');

const r = U.reporter('release');
const md = U.readIf(path.join(process.cwd(), U.APP_REL, 'README.md'));
if (!r.check('examples/retro-board/README.md exists', md && md.trim().length > 200, md ? `${md.length} chars` : 'missing')) process.exit(r.done());

const lineCount = md.replace(/\n$/, '').split('\n').length;
r.check('under 120 lines', lineCount < 120, `${lineCount} lines`);
r.check('contains `npm start`', /npm start/.test(md));

// Source of truth for configuration: the golden src (the trial may not change it in this phase).
const srcDir = path.join(U.GOLDEN_APP, 'src');
const srcText = fs.readdirSync(srcDir).filter((f) => f.endsWith('.js')).map((f) => U.read(path.join(srcDir, f))).join('\n');
const inSrc = (name) => new RegExp(`\\b${name}\\b`).test(srcText);

const ENV = ['PORT', 'HOST', 'DATA_DIR', 'MAX_BOARDS'];
const missingEnv = ENV.filter((n) => !new RegExp(`\\b${n}\\b`).test(md));
r.check('names every env var: PORT, HOST, DATA_DIR, MAX_BOARDS', missingEnv.length === 0, missingEnv.length ? `missing: ${missingEnv.join(', ')}` : '');
r.check('mentions the participant link', /participant[ -](?:link|url)|link for (?:the )?participants?/i.test(md));
r.check('mentions the facilitator link', /facilitator[ -](?:link|url)|link for (?:the )?facilitator/i.test(md));
r.check('states the test command (node --test ... or npm test)', /node\s+--test\b|npm\s+(?:run\s+)?test\b/.test(md));

// Every ALL-CAPS identifier written like an env var (in backticks, or NAME=value in a code block) must exist in src/.
const NOT_ENV = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'JSON', 'HTTP', 'HTTPS', 'URL', 'CSP', 'API', 'HTML', 'CSS', 'SHA', 'UTF', 'ISO', 'NFC', 'CORS',
  'LAN', 'DNS', 'SIGINT', 'SIGTERM', 'TODO', 'MIT', 'ETAG', 'CSRF', 'XSS', 'OK', 'TCP', 'IP', 'UI', 'MD', 'README', 'NPM', 'CLI', 'TLS', 'SSL', 'PID', 'ID', 'ASCII']);
const candidates = new Set();
for (const m of md.matchAll(/`([^`\n]+)`/g)) {
  const token = /^([A-Z][A-Z0-9_]{1,})(?:=\S*)?$/.exec(m[1].trim());
  if (token) candidates.add(token[1]);
}
let inFence = false;
for (const l of md.split('\n')) {
  if (/^\s*```/.test(l)) { inFence = !inFence; continue; }
  const m = inFence && /^\s*(?:export\s+|set\s+)?([A-Z][A-Z0-9_]{1,})=/.exec(l);
  if (m) candidates.add(m[1]);
  const inline = inFence && /(?:^|\s)((?:[A-Z][A-Z0-9_]+=\S+\s+)+)/.exec(l); // PORT=4000 DATA_DIR=x npm start
  if (inline) for (const a of inline[1].matchAll(/([A-Z][A-Z0-9_]+)=/g)) candidates.add(a[1]);
}
const invented = [...candidates].filter((n) => !NOT_ENV.has(n) && !inSrc(n));
r.check('no invented configuration (every ENV_LIKE name in backticks or code blocks exists in src/)', invented.length === 0,
  invented.length ? `not in src/: ${invented.join(', ')}` : `${candidates.size} identifier(s) checked`);

process.exit(r.done());
