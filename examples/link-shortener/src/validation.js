'use strict';

const RESERVED = new Set(['api', 'healthz']);
const SLUG_RE = /^[A-Za-z0-9_-]{3,32}$/;
const MAX_URL = 2048;
const ISO_RE = /^\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})?)?$/;

function validateUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return 'url is required and must be a string';
  if (url.length > MAX_URL) return `url must be at most ${MAX_URL} characters`;
  if (/[\u0000- \u007f]/.test(url)) return 'url must not contain whitespace or control characters';
  let parsed;
  try { parsed = new URL(url); } catch { return 'url must be an absolute URL'; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'url protocol must be http or https';
  return null;
}

function validateSlug(slug) {
  if (typeof slug !== 'string') return 'slug must be a string';
  if (!SLUG_RE.test(slug)) return 'slug must be 3-32 characters of A-Z, a-z, 0-9, _ or -';
  if (RESERVED.has(slug)) return 'slug is reserved';
  return null;
}

function validateExpiresAt(value, now = Date.now()) {
  if (typeof value !== 'string' || !ISO_RE.test(value)) return 'expiresAt must be an ISO-8601 date string';
  const t = Date.parse(value);
  if (Number.isNaN(t)) return 'expiresAt must be a valid date';
  // Date.parse rolls 2030-02-31 over to March 3; reject any day that does not exist in its month.
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return 'expiresAt must be a real calendar date';
  if (t <= now) return 'expiresAt must be in the future';
  return null;
}

// Returns an error message or null for a POST /api/links body.
function validateCreate(body, now = Date.now()) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return 'body must be a JSON object';
  const urlErr = validateUrl(body.url);
  if (urlErr) return urlErr;
  if (body.slug !== undefined) {
    const e = validateSlug(body.slug);
    if (e) return e;
  }
  if (body.expiresAt !== undefined) {
    const e = validateExpiresAt(body.expiresAt, now);
    if (e) return e;
  }
  return null;
}

module.exports = { validateUrl, validateSlug, validateExpiresAt, validateCreate, RESERVED, MAX_URL };
