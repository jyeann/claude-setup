// Markdown subset: block tokenizer plus a DOM builder. Output is only ever created with createElement,
// createTextNode and setAttribute from a fixed allow-list, so raw HTML in a note is just text.
import { scanCode, parseWikilinks } from './wikilink.js';
import { validateTitle } from './titles.js';

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`+|~+)\s*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const LIST = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const LINK = /\[([^\[\]]*)\]\(\s*((?:[^()\s]|\([^()\s]*\))*)(?:\s+"[^"]*")?\s*\)/y;

const indentOf = (ws) => ws.replace(/\t/g, '    ').length;
const isOrdered = (marker) => /\d/.test(marker[0]);

// Link scheme allow-list: strip ASCII whitespace and control characters, then only http(s) and mailto pass.
export function safeHref(href) {
  const cleaned = String(href).replace(/[\u0000-\u0020\u007F-\u009F\u2028\u2029]/g, '');
  return /^(https?:\/\/|mailto:)/i.test(cleaned) ? cleaned : null;
}

function startsBlock(line, nested) {
  return (!nested && FENCE.test(line)) || HEADING.test(line) || QUOTE.test(line) || LIST.test(line);
}

function parseList(lines, from, nested) {
  const first = LIST.exec(lines[from]);
  const base = indentOf(first[1]);
  const ordered = isOrdered(first[2]);
  const list = { type: 'list', ordered, items: [] };
  let topItem = null;
  let cur = null;
  let i = from;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j += 1;
      const next = j < lines.length ? LIST.exec(lines[j]) : null;
      if (next && indentOf(next[1]) >= base && (indentOf(next[1]) >= base + 2 || isOrdered(next[2]) === ordered)) {
        i = j;
        continue;
      }
      break;
    }
    const m = LIST.exec(line);
    if (m) {
      const indent = indentOf(m[1]);
      if (indent >= base + 2 && topItem) {
        if (!topItem.children) topItem.children = { type: 'list', ordered: isOrdered(m[2]), items: [] };
        cur = { text: m[3], children: null };
        topItem.children.items.push(cur);
      } else {
        if (isOrdered(m[2]) !== ordered) break;
        topItem = { text: m[3], children: null };
        cur = topItem;
        list.items.push(topItem);
      }
    } else if (startsBlock(line, nested)) {
      break;
    } else {
      cur.text += `\n${line.trim()}`;
    }
    i += 1;
  }
  return { list, next: i };
}

export function tokenizeBlocks(text, { nested = false } = {}) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i += 1;
      continue;
    }
    let m = nested ? null : FENCE.exec(line);
    if (m) {
      const char = m[1][0];
      const count = m[1].length;
      const body = [];
      i += 1;
      while (i < lines.length) {
        const close = FENCE_CLOSE.exec(lines[i]);
        i += 1;
        if (close && close[1][0] === char && close[1].length >= count) break;
        body.push(lines[i - 1]);
      }
      blocks.push({ type: 'fence', text: body.join('\n'), info: m[2].trim() });
      continue;
    }
    m = HEADING.exec(line);
    if (m) {
      blocks.push({ type: 'heading', level: Math.min(6, m[1].length + 1), text: (m[2] || '').replace(/[ \t]+#+$/, '').trim() });
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        inner.push(lines[i].replace(/^ {0,3}> ?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', children: tokenizeBlocks(inner.join('\n'), { nested: true }) });
      continue;
    }
    if (LIST.test(line)) {
      const { list, next } = parseList(lines, i, nested);
      blocks.push(list);
      i = next;
      continue;
    }
    const para = [line.trim()];
    i += 1;
    while (i < lines.length && lines[i].trim() !== '' && !startsBlock(lines[i], nested)) {
      para.push(lines[i].trim());
      i += 1;
    }
    blocks.push({ type: 'paragraph', text: para.join('\n') });
  }
  return blocks;
}

const isSpace = (ch) => ch === undefined || /\s/.test(ch);
const isWord = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

// Atoms are code spans and wikilinks, found with the same shared scanners the server uses.
function atomsOf(s) {
  const atoms = new Map();
  for (const span of scanCode(s)) atoms.set(span.start, { kind: 'code', ...span });
  for (const link of parseWikilinks(s)) atoms.set(link.start, { kind: 'wikilink', ...link });
  return atoms;
}

function findClose(s, from, hi, marker, env) {
  let k = from;
  while (k < hi) {
    const atom = env.atoms.get(k);
    if (atom) k = atom.end;
    else if (s[k] === '\\') k += 2;
    else if (s.startsWith(marker, k)) {
      if (marker.length === 1 && s[k + 1] === marker) k += 2;
      else return k;
    } else k += 1;
  }
  return -1;
}

function straddles(env, from, to) {
  for (const atom of env.atoms.values()) {
    const inside = atom.start >= from && atom.end <= to;
    const outside = atom.end <= from || atom.start >= to;
    if (!inside && !outside) return true;
  }
  return false;
}

function codeNode(doc, s, atom) {
  const raw = s.slice(atom.start, atom.end);
  let n = 0;
  while (raw[n] === '`') n += 1;
  let inner = raw.slice(n, raw.length - n);
  if (inner.length > 2 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim() !== '') inner = inner.slice(1, -1);
  const el = doc.createElement('code');
  el.textContent = inner;
  return el;
}

function wikilinkNode(doc, atom, env) {
  const label = atom.label ? atom.label : atom.target;
  if (!validateTitle(atom.target).ok) {
    const span = doc.createElement('span');
    span.setAttribute('data-testid', 'unsafe-link');
    span.setAttribute('class', 'unsafe-link');
    span.setAttribute('title', 'Not a valid note title');
    span.textContent = label;
    return span;
  }
  const stored = env.resolve ? env.resolve(atom.target) : null;
  const a = doc.createElement('a');
  a.setAttribute('data-testid', 'wikilink');
  a.setAttribute('data-target', atom.target);
  a.textContent = label;
  if (stored) {
    a.setAttribute('data-state', 'exists');
    a.setAttribute('class', 'wikilink');
    a.setAttribute('href', `/n/${encodeURIComponent(stored)}`);
  } else {
    a.setAttribute('data-state', 'missing');
    a.setAttribute('class', 'wikilink wikilink-missing');
    a.setAttribute('href', '#');
    a.setAttribute('aria-label', `${label} (create note)`);
  }
  return a;
}

function externalLinkNode(doc, s, m, href, start, env) {
  const a = doc.createElement('a');
  a.setAttribute('href', href);
  a.setAttribute('target', '_blank');
  a.setAttribute('rel', 'noopener noreferrer');
  if (m[1] === '') a.appendChild(doc.createTextNode(href));
  else inlineInto(doc, a, s, start, start + m[1].length, env);
  const hint = doc.createElement('span');
  hint.setAttribute('class', 'sr-only');
  hint.textContent = ' (opens in new tab)';
  a.appendChild(hint);
  return a;
}

function unsafeLinkNode(doc, s, m, start, env) {
  const span = doc.createElement('span');
  span.setAttribute('data-testid', 'unsafe-link');
  span.setAttribute('class', 'unsafe-link');
  inlineInto(doc, span, s, start, start + m[1].length, env);
  return span;
}

function inlineInto(doc, parent, s, lo, hi, env) {
  let buf = '';
  const flush = () => {
    if (buf) parent.appendChild(doc.createTextNode(buf));
    buf = '';
  };
  let i = lo;
  while (i < hi) {
    const ch = s[i];
    const atom = env.atoms.get(i);
    if (atom && atom.end <= hi) {
      flush();
      parent.appendChild(atom.kind === 'code' ? codeNode(doc, s, atom) : wikilinkNode(doc, atom, env));
      i = atom.end;
      continue;
    }
    if (ch === '\n') {
      flush();
      parent.appendChild(doc.createElement('br'));
      i += 1;
      continue;
    }
    if (ch === '\\' && i + 1 < hi && /[\\`*_[\]()#!]/.test(s[i + 1])) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (ch === '!' && s[i + 1] === '[' && !env.atoms.has(i + 1)) {
      LINK.lastIndex = i + 1;
      const m = LINK.exec(s);
      if (m && LINK.lastIndex <= hi && !straddles(env, i, LINK.lastIndex)) {
        buf += s.slice(i, LINK.lastIndex); // images stay literal text
        i = LINK.lastIndex;
        continue;
      }
    }
    if (ch === '[') {
      LINK.lastIndex = i;
      const m = LINK.exec(s);
      if (m && LINK.lastIndex <= hi && !straddles(env, i, LINK.lastIndex)) {
        flush();
        const href = safeHref(m[2]);
        parent.appendChild(href ? externalLinkNode(doc, s, m, href, i + 1, env) : unsafeLinkNode(doc, s, m, i + 1, env));
        i = LINK.lastIndex;
        continue;
      }
    }
    if (ch === '*' || ch === '_') {
      const marker = s[i + 1] === ch ? ch + ch : ch;
      const start = i + marker.length;
      const openOk = start < hi && !isSpace(s[start]) && (ch === '*' || i === lo || !isWord(s[i - 1]));
      const close = openOk ? findClose(s, start, hi, marker, env) : -1;
      const closeOk = close > start && !isSpace(s[close - 1]) && (ch === '*' || !isWord(s[close + marker.length]));
      if (closeOk) {
        flush();
        const el = doc.createElement(marker.length === 2 ? 'strong' : 'em');
        parent.appendChild(el);
        inlineInto(doc, el, s, start, close, env);
        i = close + marker.length;
        continue;
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
}

export function renderInline(doc, parent, text, resolve) {
  inlineInto(doc, parent, text, 0, text.length, { atoms: atomsOf(text), resolve });
}

function listNode(doc, list, resolve) {
  const el = doc.createElement(list.ordered ? 'ol' : 'ul');
  for (const item of list.items) {
    const li = doc.createElement('li');
    renderInline(doc, li, item.text, resolve);
    if (item.children) li.appendChild(listNode(doc, item.children, resolve));
    el.appendChild(li);
  }
  return el;
}

function blockNode(doc, block, resolve) {
  switch (block.type) {
    case 'heading': {
      const el = doc.createElement(`h${block.level}`);
      renderInline(doc, el, block.text, resolve);
      return el;
    }
    case 'fence': {
      const pre = doc.createElement('pre');
      pre.setAttribute('tabindex', '0');
      const code = doc.createElement('code');
      code.textContent = block.text;
      pre.appendChild(code);
      return pre;
    }
    case 'quote': {
      const el = doc.createElement('blockquote');
      for (const child of block.children) el.appendChild(blockNode(doc, child, resolve));
      return el;
    }
    case 'list':
      return listNode(doc, block, resolve);
    default: {
      const p = doc.createElement('p');
      renderInline(doc, p, block.text, resolve);
      return p;
    }
  }
}

// resolve(target) returns the stored title of an existing note, or a falsy value when there is none.
export function renderMarkdown(doc, text, { resolve } = {}) {
  const fragment = doc.createDocumentFragment();
  for (const block of tokenizeBlocks(text)) fragment.appendChild(blockNode(doc, block, resolve));
  return fragment;
}
