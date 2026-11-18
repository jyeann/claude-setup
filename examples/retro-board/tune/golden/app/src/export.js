'use strict';

const SECTIONS = [
  { key: 'went-well', heading: 'Went well', prefix: '- ' },
  { key: 'to-improve', heading: 'To improve', prefix: '- ' },
  { key: 'actions', heading: 'Actions', prefix: '- [ ] ' },
];

// Newlines, tabs and U+2028/9 (with spaces around them) become one space; a leading markdown marker gets a backslash. `<` stays as typed.
function escapeLine(text) {
  const flat = String(text).replace(/[ \t]*[\r\n\t\u2028\u2029]+[ \t]*/g, ' ').trim();
  return flat.replace(/^([#\-*>[+])/, '\\$1').replace(/^(\d+)\./, '$1\\.');
}

const votesLabel = (n) => `${n} ${n === 1 ? 'vote' : 'votes'}`;

function toMarkdown(board, isoDate) {
  const lines = [`# ${escapeLine(board.title)}`, '', `Date: ${isoDate}`, ''];
  for (const s of SECTIONS) {
    lines.push(`## ${s.heading}`, '');
    const cards = board.cards
      .filter((c) => c.column === s.key)
      .map((c) => ({ c, votes: c.voters.length, id: Number(c.id) }))
      .sort((a, b) => b.votes - a.votes || a.id - b.id);
    if (cards.length === 0) lines.push('- _No cards._');
    for (const { c, votes } of cards) lines.push(`${s.prefix}${escapeLine(c.text)} (${votesLabel(votes)})`);
    lines.push('');
  }
  return lines.join('\n');
}

function filename(title) {
  const slug = String(title)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return `${slug || 'retro'}.md`;
}

function localIsoDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

module.exports = { toMarkdown, filename, escapeLine, localIsoDate };
