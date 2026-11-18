'use strict';
// Seeded defects, applied as exact string replacements to copies of the golden app (tune/golden/app).
//   REVIEW_SEEDS : phase 6 (review). Five defects in server and client code, found by reading.
//   QA_SEEDS     : phase 7 (qa). Three UI defects in public/js, found by running the app in a browser.
//   TEST_MUTANTS : phase 4 (tests). Extra behavioural defects the grader uses besides the review seeds.
// Paths are relative to the app directory (examples/retro-board). `detect` is what the grader looks for.
const fs = require('node:fs');
const path = require('node:path');

const REVIEW_SEEDS = [
  {
    id: 'vote-budget',
    title: 'Vote budget off by one (4 votes allowed)',
    file: 'src/board.js',
    from: '  if (votesUsed(board, voter) >= MAX_VOTES) throw',
    to: '  if (votesUsed(board, voter) > MAX_VOTES) throw',
    // behaviour: a client can vote on 4 cards; the 5th gets 409 no_votes_left
    detect: {
      file: /(?<!public\/js\/)(?<![\w.-])board\.js/i,
      keywords: /off[- ]by[- ]one|(?:\b4\b|four|fourth|extra|one more)[^\n]{0,40}vote|vote[^\n]{0,60}(?:\b4\b|four|fourth|extra|more than (?:3|three))|>\s*MAX_VOTES|MAX_VOTES[^\n]{0,40}(?:>=|>)|votes?[^\n]{0,40}budget[^\n]{0,80}(?:exceed|allow|one)/i,
    },
  },
  {
    id: 'token-compare',
    title: 'Facilitator token compared with === instead of a constant-time compare',
    file: 'src/router.js',
    from: "tokens.safeEqual(tokens.sha256Hex(f), b.facHash);",
    to: 'tokens.sha256Hex(f) === b.facHash;',
    // timing-only defect: the result is identical, the code path is live on every facilitator request
    detect: {
      file: /router\.js|tokens\.js/i,
      keywords: /timing|constant[- ]time|timingSafeEqual|side[- ]channel|safeEqual|strict equality/i,
    },
  },
  {
    id: 'swap-before-write',
    title: 'Store swaps the new board into memory before the write succeeds (no rollback)',
    file: 'src/store.js',
    from: '      persist(hash, draft);\n      boards.set(hash, draft);\n      return draft;',
    to: '      boards.set(hash, draft);\n      persist(hash, draft);\n      return draft;',
    // behaviour: when the write fails the client gets 503 "Nothing changed" but the board in memory has changed
    detect: {
      file: /store\.js/i,
      keywords: /roll[- ]?back|(?:before|prior to|ahead of)[^\n]{0,60}(?:persist|writ|sav|disk|flush)|(?:persist|writ|sav|disk)[^\n]{0,80}(?:fail|throw|error)[^\n]{0,80}(?:memory|stale|diverg|swap|map|state)|in[- ]memory[^\n]{0,80}(?:diverg|stale|out of sync|not (?:persisted|saved|written))|boards\.set[^\n]{0,60}persist/i,
    },
  },
  {
    id: 'inner-html',
    title: 'Card text inserted with innerHTML in public/js/board.js',
    file: 'public/js/board.js',
    from: 'if (p.text.textContent !== card.text) p.text.textContent = card.text;',
    to: 'if (p.text.textContent !== card.text) p.text.innerHTML = card.text;',
    // behaviour: a card containing <img onerror=...> or <b> is parsed as markup in every viewer's browser
    detect: {
      file: /board\.js/i,
      keywords: /innerHTML|\bXSS\b|cross[- ]site script|markup injection|html injection|script injection|unescaped|not escaped/i,
    },
  },
  {
    id: 'origin-absent',
    title: 'Host/Origin check skipped when the Origin header is absent',
    file: 'src/router.js',
    from: "  if (typeof host !== 'string' || !host) return false;\n  if (ctx.loopback) {",
    to: "  if (typeof host !== 'string' || !host) return false;\n  if (req.headers.origin === undefined) return true;\n  if (ctx.loopback) {",
    // behaviour: a request with Host: evil.example and no Origin is served instead of 403
    detect: {
      file: /router\.js/i,
      keywords: /origin[^\n]{0,100}(?:absent|missing|undefined|not (?:sent|present|set)|no origin|without)|(?:absent|missing|without|no|undefined)[^\n]{0,30}origin|DNS[- ]rebinding|host (?:check|header|validation)[^\n]{0,100}(?:skip|bypass|early return|returns? true)|returns? true[^\n]{0,80}origin/i,
    },
  },
];

const QA_SEEDS = [
  {
    id: 'vote-count-stale',
    title: 'Vote count on a card does not update until reload',
    file: 'public/js/board.js',
    from: '  p.count.firstChild.nodeValue = String(card.votes);',
    to: '  if (!p.counted) { p.count.firstChild.nodeValue = String(card.votes); p.counted = true; }',
    // all of these must match one DEFECT line or one FAIL line
    detect: [/vote/i, /count|tally|number|total/i, /stale|not updat|n.t updat|never updat|unchanged|not chang|n.t chang|until|reload|refresh|still (?:show|read)|only after|doesn.t move|does not move/i],
  },
  {
    id: 'delete-no-confirm',
    title: 'Delete skips the confirmation step',
    file: 'public/js/board.js',
    from: "p.del.addEventListener('click', () => openConfirm(el));",
    to: "p.del.addEventListener('click', () => confirmDelete(el));",
    detect: [/delet/i, /confirm|prompt|dialog|are you sure|delete this card\?/i, /skip|without|no |not |missing|immediate|directly|bypass|instead|straight|right away|at once/i],
  },
  {
    id: 'closed-form-visible',
    title: 'Closing a retro leaves the add-card form visible',
    file: 'public/js/board.js',
    from: '    if (v.closed && c.form) { c.form.remove(); c.form = null; }\n',
    to: '',
    detect: [/clos/i, /form|textarea|add (?:card|box|button|control)|add-/i, /still|remain|visible|shown|present|not (?:hidden|removed|gone)|stays?|left|should (?:be )?(?:hidden|removed|gone)/i],
  },
];

const TEST_MUTANTS = [
  {
    id: 'vote-on-closed',
    title: 'Voting still works on a closed board',
    file: 'src/board.js',
    from: '  const card = findCard(board, id);\n  requireOpen(board);\n  if (card.voters.includes(voter)) return false;\n  if (votesUsed',
    to: '  const card = findCard(board, id);\n  if (card.voters.includes(voter)) return false;\n  if (votesUsed',
  },
  {
    id: 'export-order',
    title: 'Markdown export lists the lowest-voted card first',
    file: 'src/export.js',
    from: '.sort((a, b) => b.votes - a.votes || a.id - b.id)',
    to: '.sort((a, b) => a.votes - b.votes || a.id - b.id)',
  },
  {
    id: 'double-vote',
    title: 'A client can vote more than once on the same card',
    file: 'src/board.js',
    from: '  if (card.voters.includes(voter)) return false;\n  if (votesUsed',
    to: '  if (votesUsed',
  },
];

function occurrences(text, needle) {
  let n = 0;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) n += 1;
  return n;
}

// Apply seeds to the app directory `appDir` in place. Every `from` must occur exactly once.
function applySeeds(appDir, seeds) {
  for (const seed of seeds) {
    const file = path.join(appDir, seed.file);
    const text = fs.readFileSync(file, 'utf8');
    const n = occurrences(text, seed.from);
    if (n !== 1) throw new Error(`seed ${seed.id}: expected 1 match in ${seed.file}, found ${n}`);
    fs.writeFileSync(file, text.replace(seed.from, () => seed.to));
  }
}

// 1-based line (same numbering in the golden and in the patched file) of the first line the seed changes.
function seedLine(goldenText, seed) {
  const idx = goldenText.indexOf(seed.from);
  if (idx < 0) return null;
  const toLines = seed.to.split('\n');
  const fromLines = seed.from.split('\n');
  let off = 0;
  while (off < toLines.length && off < fromLines.length && toLines[off] === fromLines[off]) off += 1;
  return goldenText.slice(0, idx).split('\n').length + off;
}

module.exports = { REVIEW_SEEDS, QA_SEEDS, TEST_MUTANTS, applySeeds, seedLine };
