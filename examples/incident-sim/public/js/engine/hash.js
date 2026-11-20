// FNV-1a 32 over UTF-8 bytes, hex8 and canonical JSON. Pure, no dependencies.

const OFFSET = 0x811c9dc5;
const PRIME = 16777619;

// Hash the UTF-8 encoding of a string without allocating a byte array.
export function fnv1a32(str) {
  let h = OFFSET;
  const n = str.length;
  for (let i = 0; i < n; i++) {
    let c = str.charCodeAt(i);
    if (c < 0x80) {
      h = Math.imul(h ^ c, PRIME) >>> 0;
    } else if (c < 0x800) {
      h = Math.imul(h ^ (0xc0 | (c >> 6)), PRIME) >>> 0;
      h = Math.imul(h ^ (0x80 | (c & 63)), PRIME) >>> 0;
    } else {
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < n) {
        const d = str.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          i++;
        }
      }
      if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd; // lone surrogate, as TextEncoder does
      if (c < 0x10000) {
        h = Math.imul(h ^ (0xe0 | (c >> 12)), PRIME) >>> 0;
        h = Math.imul(h ^ (0x80 | ((c >> 6) & 63)), PRIME) >>> 0;
        h = Math.imul(h ^ (0x80 | (c & 63)), PRIME) >>> 0;
      } else {
        h = Math.imul(h ^ (0xf0 | (c >> 18)), PRIME) >>> 0;
        h = Math.imul(h ^ (0x80 | ((c >> 12) & 63)), PRIME) >>> 0;
        h = Math.imul(h ^ (0x80 | ((c >> 6) & 63)), PRIME) >>> 0;
        h = Math.imul(h ^ (0x80 | (c & 63)), PRIME) >>> 0;
      }
    }
  }
  return h;
}

export function hex8(n) {
  return (n >>> 0).toString(16).padStart(8, '0');
}

// Keys sorted by code unit, no whitespace, numbers via String(n). Undefined values and functions are skipped like JSON.
export function canonicalJson(v) {
  if (v === null || v === undefined) return 'null';
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v) ? String(v === 0 ? 0 : v) : 'null';
  if (t === 'string') return JSON.stringify(v);
  if (t === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) {
    let out = '[';
    for (let i = 0; i < v.length; i++) out += (i ? ',' : '') + canonicalJson(v[i]);
    return out + ']';
  }
  const keys = Object.keys(v).sort();
  let out = '{';
  let first = true;
  for (const k of keys) {
    const x = v[k];
    if (x === undefined || typeof x === 'function') continue;
    out += (first ? '' : ',') + JSON.stringify(k) + ':' + canonicalJson(x);
    first = false;
  }
  return out + '}';
}
