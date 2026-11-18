#!/usr/bin/env node
'use strict';
// Phase 3 grader. cwd = trial worktree root. Output: docs/product/retro-board/design.md
const fs = require('node:fs');
const path = require('node:path');
const U = require('../lib/util');
const { extractRoutes } = require('../lib/routes');

const r = U.reporter('design');
const md = U.readIf(path.join(process.cwd(), U.DOCS_REL, 'design.md'));
if (!r.check('design.md exists and is not empty', md && md.trim().length > 1000, md ? `${md.length} chars` : 'missing')) process.exit(r.done());

const numbered = new Set([...md.matchAll(/^##\s+(\d+)[.)]?\s+\S/gm)].map((m) => Number(m[1])));
r.check('at least 8 numbered sections ("## 1. ...")', numbered.size >= 8, `${numbered.size} found`);

const golden = JSON.parse(fs.readFileSync(path.join(U.GOLDEN, 'routes.json'), 'utf8'));
const mine = extractRoutes(md);
const hit = golden.filter((g) => mine.has(g));
const miss = golden.filter((g) => !mine.has(g));
r.check('at least 85% of the golden design\'s HTTP routes appear (method + path, params normalised)', hit.length / golden.length >= 0.85,
  `${hit.length}/${golden.length}${miss.length ? `; missing: ${miss.join(' | ')}` : ''}`);

const CONCERNS = [
  ['ETag or version', /\bETag\b|If-None-Match|\bversion\b/i],
  ['hash', /\bsha-?256\b|\bhash(?:ed|es|ing)?\b/i],
  ['constant-time compare', /constant[- ]time|timingSafeEqual/i],
  ['atomic write or rename', /atomic|\brename\b|renameSync/i],
  ['CSP', /\bCSP\b|Content-Security-Policy/i],
  ['rate limit', /rate[- ]?limit/i],
];
const present = CONCERNS.filter(([, re]) => re.test(md));
r.check('at least 5 of 6 concerns: ETag/version, hash, constant-time, atomic write, CSP, rate limit', present.length >= 5,
  `${present.length}/6; missing: ${CONCERNS.filter((c) => !present.includes(c)).map((c) => c[0]).join(', ') || 'none'}`);

process.exit(r.done());
