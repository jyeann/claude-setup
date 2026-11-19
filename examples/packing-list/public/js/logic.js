'use strict';
// Pure helpers shared by the pages. Mirrors the server rules and messages (src/validation.js).
(function (root) {
  const MAX_NAME = 80;
  const MAX_ITEM = 120;
  const MAX_ITEMS = 200;
  // U+0000-U+001F and U+007F-U+009F, built from code points so this file stays plain ASCII.
  const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f]');

  function progressText(n, m) { return n + ' of ' + m + ' packed'; }

  function codePointLength(s) { return Array.from(s).length; }

  function percent(n, m) { return m > 0 ? Math.round((n / m) * 100) : 0; }

  function checkName(raw) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value === '') return { ok: false, message: 'Enter a trip name.' };
    const n = codePointLength(value);
    if (n > MAX_NAME) return { ok: false, message: 'Trip name is too long (' + n + ' characters). The limit is ' + MAX_NAME + '.' };
    if (CONTROL.test(value)) return { ok: false, message: 'Trip name contains characters that are not allowed.' };
    return { ok: true, value };
  }

  function checkItem(raw, count) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value === '') return { ok: false, message: 'Enter an item to add.' };
    const n = codePointLength(value);
    if (n > MAX_ITEM) return { ok: false, message: 'Item is too long (' + n + ' characters). The limit is ' + MAX_ITEM + '.' };
    if (CONTROL.test(value)) return { ok: false, message: 'Item contains characters that are not allowed.' };
    if (count >= MAX_ITEMS) return { ok: false, message: 'This list is full (' + MAX_ITEMS + ' items)' };
    return { ok: true, value };
  }

  // Plan how to bring the rendered rows (current) in line with the server items (incoming).
  // pending maps an item id to the kind of write in flight: 'tick', 'remove' or 'add'.
  // Returns {remove: [ids], upsert: [{id, text, ticked}], order: [ids]}.
  function mergeItems(current, incoming, pending) {
    const byId = new Map(current.map((c) => [c.id, c]));
    const seen = new Set();
    const order = [];
    const upsert = [];
    const remove = [];
    for (const item of incoming) {
      const kind = pending.get(item.id);
      if (kind === 'remove') continue;
      seen.add(item.id);
      order.push(item.id);
      const cur = byId.get(item.id);
      const ticked = kind === 'tick' && cur ? cur.ticked : item.ticked;
      if (!cur || cur.text !== item.text || cur.ticked !== ticked) upsert.push({ id: item.id, text: item.text, ticked });
    }
    for (const cur of current) {
      if (seen.has(cur.id)) continue;
      if (pending.has(cur.id)) order.push(cur.id);
      else remove.push(cur.id);
    }
    return { remove, upsert, order };
  }

  const api = { progressText, codePointLength, percent, checkName, checkItem, mergeItems, MAX_NAME, MAX_ITEM, MAX_ITEMS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PackingLogic = api;
}(typeof window !== 'undefined' ? window : globalThis));
