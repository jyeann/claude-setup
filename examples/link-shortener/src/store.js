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

  try {
    const text = fs.readFileSync(file, 'utf8');
    if (text.trim()) {
      const data = JSON.parse(text);
      if (Array.isArray(data)) for (const l of data) if (l && typeof l.slug === 'string') links.set(l.slug, l);
    }
  } catch { /* missing or unreadable file means no links */ }

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
      persist();
      return view(link);
    },
    get(slug) { const l = links.get(slug); return l ? view(l) : null; },
    list() { return [...links.values()].map(view).reverse(); },
    remove(slug) {
      if (!links.delete(slug)) return false;
      persist();
      return true;
    },
    // Counts a click. Returns { link } / { expired: true } / null when unknown.
    click(slug) {
      const l = links.get(slug);
      if (!l) return null;
      const v = view(l);
      if (v.expired) return { expired: true };
      l.clicks += 1;
      persist();
      return { link: view(l) };
    },
  };
}

module.exports = { createStore, randomSlug };
