// Pure search over index entries: literal, case-insensitive, with snippets and highlight ranges.
import { normalizeTitle } from '../public/js/titles.js';

const WINDOW = 120;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isHigh = (c) => c >= 0xd800 && c <= 0xdbff;
const isLow = (c) => c >= 0xdc00 && c <= 0xdfff;

// Entry fields used: key, title, mtimeMs, content, lower (null when lower-casing changes the length).
function findFirst(entry, ql, re) {
  if (entry.content === '') return null;
  if (entry.lower !== null) {
    const idx = entry.lower.indexOf(ql);
    return idx === -1 ? null : { idx, len: ql.length };
  }
  re.lastIndex = 0;
  const m = re.exec(entry.content);
  return m ? { idx: m.index, len: m[0].length } : null;
}

// Keep a window edge from splitting a surrogate pair by moving it inwards.
function safeStart(text, start) {
  return start > 0 && isLow(text.charCodeAt(start)) && isHigh(text.charCodeAt(start - 1)) ? start + 1 : start;
}
function safeEnd(text, end) {
  return end < text.length && end > 0 && isLow(text.charCodeAt(end)) && isHigh(text.charCodeAt(end - 1)) ? end - 1 : end;
}

function windowAround(content, idx, matchLen) {
  let start = Math.max(0, idx - Math.floor((WINDOW - matchLen) / 2));
  const end0 = Math.min(content.length, start + WINDOW);
  start = Math.max(0, end0 - WINDOW);
  return { start: safeStart(content, start), end: safeEnd(content, end0) };
}

function rangesIn(entry, ql, re, start, end, offset) {
  const ranges = [];
  if (entry.lower !== null) {
    for (let i = entry.lower.indexOf(ql, start); i !== -1 && i + ql.length <= end; i = entry.lower.indexOf(ql, i + ql.length)) {
      ranges.push([i - start + offset, i - start + offset + ql.length]);
    }
    return ranges;
  }
  const text = entry.content.slice(start, end);
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0] === '') { re.lastIndex += 1; continue; }
    ranges.push([m.index + offset, m.index + offset + m[0].length]);
  }
  return ranges;
}

function makeSnippet(entry, hit, ql, re) {
  const { content } = entry;
  if (hit) {
    const { start, end } = windowAround(content, hit.idx, hit.len);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < content.length ? '...' : '';
    return {
      snippet: prefix + content.slice(start, end) + suffix,
      ranges: rangesIn(entry, ql, re, start, end, prefix.length),
    };
  }
  const end = safeEnd(content, Math.min(content.length, WINDOW));
  return { snippet: content.slice(0, end) + (end < content.length ? '...' : ''), ranges: [] };
}

const compareKeys = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function search(entries, q) {
  const query = normalizeTitle(q);
  const ql = query.toLowerCase();
  if (ql === '') return { query: '', total: 0, results: [] };
  const re = new RegExp(escapeRegExp(ql), 'giu');
  const matched = [];
  for (const entry of entries) {
    const titleMatch = entry.key.includes(ql);
    const hit = findFirst(entry, ql, re);
    if (!titleMatch && !hit) continue;
    matched.push({ entry, titleMatch, hit });
  }
  matched.sort((a, b) => (
    Number(b.titleMatch) - Number(a.titleMatch)
    || Math.trunc(b.entry.mtimeMs) - Math.trunc(a.entry.mtimeMs)
    || compareKeys(a.entry.key, b.entry.key)
  ));
  const results = matched.map(({ entry, titleMatch, hit }) => ({
    title: entry.title,
    titleMatch,
    modified: new Date(entry.mtimeMs).toISOString(),
    ...makeSnippet(entry, hit, ql, re),
  }));
  return { query, total: results.length, results };
}
