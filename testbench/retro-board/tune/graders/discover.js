#!/usr/bin/env node
'use strict';
// Phase 1 grader. cwd = trial worktree root. Output: docs/testbench/retro-board/brief.md
const path = require('node:path');
const U = require('../lib/util');

const r = U.reporter('discover');
const file = path.join(process.cwd(), U.DOCS_REL, 'brief.md');
const md = U.readIf(file);
if (!r.check('brief.md exists and is not empty', md && md.trim().length > 500, md ? `${md.length} chars` : 'missing')) process.exit(r.done());

// 1. seven headings
const HEADINGS = [
  ['problem and user', /problem|user/i],
  ['existing products', /existing|competi|alternatives|prior art/i],
  ['decision', /decision|build.*adopt|adopt.*extend/i],
  ['mvp scope', /scope|mvp/i],
  ['success criteria', /success criteri/i],
  ['risks', /^risks?\b/i],
  ['open questions', /open question/i],
];
const secs = U.sections(md);
const byKey = {};
for (const [key, re] of HEADINGS) {
  byKey[key] = secs.find((s) => re.test(s.title));
  r.check(`heading: ${key}`, byKey[key], byKey[key] ? `"${byKey[key].title}"` : 'no matching "## " heading');
}

// 2. at least 3 distinct https URLs under existing products
const products = byKey['existing products'];
const urls = new Set(((products && products.body.match(/https:\/\/[^\s)|>\]`"']+/g)) || []).map((u) => u.replace(/[.,;:]+$/, '')));
r.check('existing products: at least 3 distinct https URLs', urls.size >= 3, `${urls.size} found`);

// 3. a decision word
const decision = byKey.decision;
const word = decision && /\b(build|adopt|extend)\b/i.exec(decision.body);
r.check('decision names build, adopt or extend', word, word ? `"${word[1]}"` : 'none of the three words in the decision section');

// 4. success criteria: >= 10 numbered, each 8+ words
const criteria = byKey['success criteria'] ? U.numberedItems(byKey['success criteria'].body) : [];
const long = criteria.filter((c) => U.wordCount(c.text) >= 8);
r.check('success criteria: at least 10 items of 8+ words', long.length >= 10, `${criteria.length} numbered, ${long.length} with 8+ words`);

// 5. concept coverage over the criteria text
const text = criteria.map((c) => c.text).join('\n');
const CONCEPTS = [
  ['empty title error', /(?:empty|blank|missing|whitespace)[^.\n]{0,60}title|title[^.\n]{0,60}(?:empty|blank|missing|required)/i],
  ['copy link', /copy[^.\n]{0,40}(?:link|button|url)|(?:link|url)[^.\n]{0,40}copy/i],
  ['vote limit', /(?:\b3\b|three) votes|vote limit|no votes left|votes left|out of votes|vote budget/i],
  ['close', /\bclos(?:e|ed|ing)\b|reopen/i],
  ['export markdown', /export[^.\n]{0,40}markdown|markdown[^.\n]{0,40}(?:export|download|file)|\.md\b/i],
  ['restart or persistence', /restart|persist|surviv|server stops|stops? and (?:start|run)|same command starts/i],
  ['bad or unknown link', /(?:mistyped|bad|unknown|invalid|wrong|broken|misspelled)[^.\n]{0,30}(?:link|url|token)|not found/i],
  ['second browser', /second browser|another browser|two browsers|other browser|different browser|private window|second (?:tab|window|person)/i],
];
const covered = CONCEPTS.filter(([, re]) => re.test(text));
r.check('success criteria cover at least 6 of 8 concepts', covered.length >= 6, `${covered.length}/8 covered; missing: ${CONCEPTS.filter((c) => !covered.includes(c)).map((c) => c[0]).join(', ') || 'none'}`);

// 6. open questions, each with a default
const oq = byKey['open questions'] ? U.numberedItems(byKey['open questions'].body) : [];
const withDefault = oq.filter((q) => /default|\*\*[^*]{2,}\*\*|assum|proceed|unless/i.test(q.text));
r.check('open questions: at least 3, each with a stated default', oq.length >= 3 && withDefault.length === oq.length, `${oq.length} questions, ${withDefault.length} with a default`);

process.exit(r.done());
