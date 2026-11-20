// Strict JSON reader for imports and scenario files. Pure: no DOM, no Node built-ins.
// Order, first failure wins: size, nesting and token pre-scan, JSON.parse, forbidden keys, prototype-less rebuild.
// Reasons never echo a value; key names are cut to 40 characters plus "...".

export const DEFAULT_MAX_BYTES = 262144;
export const DEFAULT_MAX_DEPTH = 8;
export const DEFAULT_MAX_TOKENS = 20000;
const FORBIDDEN = ['__proto__', 'constructor', 'prototype'];

export function utf8Length(text) {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

const cut = (s) => (s.length > 40 ? `${s.slice(0, 40)}...` : s);

// Walk the raw text without parsing it. Strings (with escapes) are skipped.
// A 20,000-key object has 20,000 structural tokens, so the limit is reached at maxTokens (not only above it).
function scanStructure(text, maxDepth, maxTokens) {
  let depth = 0;
  let tokens = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 92) i++; // backslash: skip the escaped character
      else if (c === 34) inString = false;
    } else if (c === 34) {
      inString = true;
    } else if (c === 123 || c === 91) {
      if (++depth > maxDepth || ++tokens >= maxTokens) return false;
    } else if (c === 125 || c === 93) {
      depth--;
    } else if (c === 44) {
      if (++tokens >= maxTokens) return false;
    }
  }
  return true;
}

function forbiddenKey(root) {
  const stack = [root];
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    for (const k of Object.keys(v)) {
      if (FORBIDDEN.includes(k)) return k;
      stack.push(v[k]);
    }
  }
  return null;
}

function rebuild(v) {
  if (Array.isArray(v)) return v.map(rebuild);
  if (v !== null && typeof v === 'object') {
    const o = Object.create(null);
    for (const k of Object.keys(v)) o[k] = rebuild(v[k]);
    return o;
  }
  return v;
}

export function parseSafe(text, { maxBytes = DEFAULT_MAX_BYTES, maxDepth = DEFAULT_MAX_DEPTH, maxTokens = DEFAULT_MAX_TOKENS } = {}) {
  if (typeof text !== 'string') return { ok: false, reason: 'the file is not valid JSON. Export a fresh file from this page and try again.' };
  const bytes = utf8Length(text);
  if (bytes > maxBytes) return { ok: false, reason: `the file is ${Math.ceil(bytes / 1024)} KB and the limit is ${Math.floor(maxBytes / 1024)} KB.` };
  if (!scanStructure(text, maxDepth, maxTokens)) return { ok: false, reason: 'the file is nested too deeply.' };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'the file is not valid JSON. Export a fresh file from this page and try again.' };
  }
  const bad = forbiddenKey(parsed);
  if (bad !== null) return { ok: false, reason: `the file contains the key "${cut(bad)}", which is not allowed.` };
  return { ok: true, value: rebuild(parsed) };
}
