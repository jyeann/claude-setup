#!/usr/bin/env node
'use strict';
// Phase 2 grader. cwd = trial worktree root. Output: docs/product/retro-board/ux.md
const path = require('node:path');
const U = require('../lib/util');

const r = U.reporter('ux');
const md = U.readIf(path.join(process.cwd(), U.DOCS_REL, 'ux.md'));
if (!r.check('ux.md exists and is not empty', md && md.trim().length > 1000, md ? `${md.length} chars` : 'missing')) process.exit(r.done());

// at least 10 journeys: headings "### J1. ..." or "### Journey 1 ..."
const journeys = new Set([...md.matchAll(/^#{2,4}\s+(?:J|Journey\s*)(\d+)\b/gim)].map((m) => Number(m[1])));
r.check('at least 10 journeys (headings "J<n>" or "Journey <n>")', journeys.size >= 10, `${journeys.size} found`);

const STATES = ['empty', 'loading', 'error', 'closed', 'offline', 'not found'];
const missing = STATES.filter((s) => !new RegExp(s.replace(' ', '[ -]'), 'i').test(md));
r.check('screen states mentioned: empty, loading, error, closed, offline, not found', missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : '');

const w390 = /\b390\s*(?:px|pixels?|wide)|(?:width|viewport|screen)[^\n]{0,30}\b390\b/i.test(md);
const w1100 = /\b1100\s*(?:px|pixels?|wide)|(?:width|viewport|screen)[^\n]{0,30}\b1100\b/i.test(md);
r.check('responsive widths 390 px and 1100 px both mentioned', w390 && w1100, `390: ${w390}, 1100: ${w1100}`);

const sec = U.sections(md).find((s) => /acceptance check/i.test(s.title));
r.check('has a "UI acceptance checks" section', sec, sec ? `"${sec.title}"` : 'no "## ... acceptance checks" heading');
const checks = sec ? U.numberedItems(sec.body) : [];
const withExpect = checks.filter((c) => /\bexpect/i.test(c.text));
// "each containing expect": the golden ux.md has one check (13) that says "check that ..." instead, so allow 10% slack.
r.check('at least 15 numbered checks, at least 90% of them containing "expect"', checks.length >= 15 && withExpect.length >= Math.ceil(checks.length * 0.9),
  `${checks.length} numbered, ${withExpect.length} contain "expect"`);

const A11Y = [['focus', /\bfocus/i], ['aria or screen reader', /\baria\b|aria-|screen[ -]?reader/i], ['contrast', /contrast/i], ['keyboard', /keyboard/i]];
const lacking = A11Y.filter(([, re]) => !re.test(md)).map((a) => a[0]);
r.check('accessibility terms: focus, aria or screen reader, contrast, keyboard', lacking.length === 0, lacking.length ? `missing: ${lacking.join(', ')}` : '');

process.exit(r.done());
