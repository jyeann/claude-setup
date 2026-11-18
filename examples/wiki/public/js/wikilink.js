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
function inlineSpans(line, base, out) {
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') { i += 1; continue; }
    let n = 0;
    while (line[i + n] === '`') n += 1;
    let j = i + n;
    let close = -1;
    while (j < line.length) {
      if (line[j] !== '`') { j += 1; continue; }
      let m = 0;
      while (line[j + m] === '`') m += 1;
      if (m === n) { close = j + m; break; }
      j += m;
    }
    if (close === -1) { i += n; continue; }
    out.push({ start: base + i, end: base + close });
    i = close;
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
