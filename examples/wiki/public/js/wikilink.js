// Code-region scanning and wikilink parsing/rewriting, shared by the browser and the server.
import { normalizeTitle, titleKey, validateTitle } from './titles.js';

const LINK = /\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]*?))?\]\]/g;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

// Lines with their start offsets, split on "\n" only (a trailing "\r" stays in the line).
function splitLines(text) {
  const lines = [];
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    lines.push({ start, end, text: text.slice(start, end) });
    start = end + 1;
  }
  return lines;
}

// Inline code spans of one line: a run of N backticks is closed by the next run of exactly N.
// Linear: split the line into maximal backtick runs, link each run to the next run of the same length.
function inlineSpans(line, base, out) {
  if (line.indexOf('`') === -1) return;
  const starts = [];
  const lens = [];
  for (let i = 0; i < line.length;) {
    if (line.charCodeAt(i) !== 96) { i += 1; continue; }
    let n = 1;
    while (line.charCodeAt(i + n) === 96) n += 1;
    starts.push(i);
    lens.push(n);
    i += n;
  }
  const nextSame = new Array(starts.length);
  const last = new Map();
  for (let k = starts.length - 1; k >= 0; k -= 1) {
    nextSame[k] = last.get(lens[k]);
    last.set(lens[k], k);
  }
  for (let k = 0; k < starts.length;) {
    const c = nextSame[k];
    if (c === undefined) { k += 1; continue; }
    out.push({ start: base + starts[k], end: base + starts[c] + lens[c] });
    k = c + 1;
  }
}

export function scanCode(text) {
  const out = [];
  let fence = null; // {char, count, start}
  for (const line of splitLines(text)) {
    if (fence) {
      const m = /^ {0,3}(`+|~+)\s*$/.exec(line.text);
      if (m && m[1][0] === fence.char && m[1].length >= fence.count) {
        out.push({ start: fence.start, end: line.end });
        fence = null;
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line.text);
    if (open) {
      fence = { char: open[1][0], count: open[1].length, start: line.start };
      continue;
    }
    inlineSpans(line.text, line.start, out);
  }
  if (fence) out.push({ start: fence.start, end: text.length });
  return out;
}

// Raw matches outside code: {start, end, group1, group2 (undefined without "|"), line}.
function rawMatches(text) {
  const code = scanCode(text);
  const found = [];
  let c = 0;
  for (const line of splitLines(text)) {
    // Segments of this line between code regions.
    const segments = [];
    let from = line.start;
    while (c < code.length && code[c].end <= line.start) c += 1;
    for (let k = c; k < code.length && code[k].start < line.end; k += 1) {
      if (code[k].start > from) segments.push([from, Math.min(code[k].start, line.end)]);
      from = Math.max(from, code[k].end);
    }
    if (from < line.end) segments.push([from, line.end]);
    const lineText = [...line.text.trim()].slice(0, 160).join('');
    for (const [s, e] of segments) {
      LINK.lastIndex = 0;
      const seg = text.slice(s, e);
      for (let m = LINK.exec(seg); m; m = LINK.exec(seg)) {
        found.push({ start: s + m.index, end: s + m.index + m[0].length, group1: m[1], group2: m[2], line: lineText });
      }
    }
  }
  return found;
}

export function parseWikilinks(text) {
  const links = [];
  for (const m of rawMatches(text)) {
    const target = normalizeTitle(m.group1);
    if (target === '') continue;
    links.push({
      start: m.start,
      end: m.end,
      target,
      label: m.group2 === undefined ? null : m.group2.trim(),
      line: m.line,
    });
  }
  return links;
}

export function rewriteWikilinks(text, oldKey, newTitle) {
  let out = '';
  let last = 0;
  let count = 0;
  for (const m of rawMatches(text)) {
    const target = normalizeTitle(m.group1);
    if (target === '' || !validateTitle(target).ok || titleKey(target) !== oldKey) continue;
    out += text.slice(last, m.start) + (m.group2 === undefined ? `[[${newTitle}]]` : `[[${newTitle}|${m.group2}]]`);
    last = m.end;
    count += 1;
  }
  return { text: out + text.slice(last), count };
}
