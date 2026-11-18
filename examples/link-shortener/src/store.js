'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomSlug() {
  let s = '';
  for (let i = 0; i < 7; i += 1) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

function createStore(file, now = Date.now) {
  const links = new Map();

  const isLoadable = (l) => {
    if (!l || typeof l.slug !== 'string' || typeof l.url !== 'string' || !Number.isInteger(l.clicks)) return false;
    try { return ['http:', 'https:'].includes(new URL(l.url).protocol); } catch { return false; }
  };

  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  if (text.trim()) {
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    if (Array.isArray(data)) {
      for (const l of data) if (isLoadable(l)) links.set(l.slug, l);
    } else {
      // Never overwrite a damaged or unexpected file: keep it aside and start empty.
      const aside = `${file}.corrupt-${now()}`;
      fs.renameSync(file, aside);
      console.error(`data file was not a JSON array; moved aside as ${aside}`);
    }
  }

  function persist() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...links.values()], null, 2));
    fs.renameSync(tmp, file);
  }

  const view = (l) => ({
    slug: l.slug, url: l.url, clicks: l.clicks, createdAt: l.createdAt, expiresAt: l.expiresAt,
    expired: l.expiresAt !== null && Date.parse(l.expiresAt) <= now(),
  });

  return {
    // Returns the link view, or null when the slug is taken.
    create({ url, slug, expiresAt }) {
      let s = slug;
      if (s === undefined) { do { s = randomSlug(); } while (links.has(s)); }
      else if (links.has(s)) return null;
      const link = { slug: s, url, clicks: 0, createdAt: new Date(now()).toISOString(), expiresAt: expiresAt === undefined ? null : expiresAt };
      links.set(s, link);
      try { persist(); } catch (err) { links.delete(s); throw err; }
      return view(link);
    },
    get(slug) { const l = links.get(slug); return l ? view(l) : null; },
    list() { return [...links.values()].map(view).reverse(); },
    remove(slug) {
      const old = links.get(slug);
      if (!old) return false;
      links.delete(slug);
      try { persist(); } catch (err) { links.set(slug, old); throw err; }
      return true;
    },
    // Counts a click. Returns { link } / { expired: true } / null when unknown.
    click(slug) {
      const l = links.get(slug);
      if (!l) return null;
      const v = view(l);
      if (v.expired) return { expired: true };
      l.clicks += 1;
      try { persist(); } catch (err) { l.clicks -= 1; throw err; }
      return { link: view(l) };
    },
  };
}

module.exports = { createStore, randomSlug };
