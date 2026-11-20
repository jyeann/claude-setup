import { createHash } from 'node:crypto';

// First 32 hex characters of the SHA-256 of the file bytes.
export function revisionOf(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 32);
}

// Parses an If-Match header. Only the quoted strong form `"<revision>"` counts; anything else is null.
export function parseIfMatch(value) {
  if (typeof value !== 'string') return null;
  const m = /^"([0-9a-f]{32})"$/.exec(value);
  return m ? m[1] : null;
}
