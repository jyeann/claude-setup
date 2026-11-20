// Request handlers for the note API. Each takes a context and returns {status, body, headers} or throws.
import { validateTitle, normalizeTitle, titleKey } from '../public/js/titles.js';
import { WikiError, StorageError, ExistsError, storageError } from './errors.js';
import { revisionOf, parseIfMatch } from './revision.js';
import { renameNote, notFound, titleExists } from './rename.js';

export const MAX_NOTE_BYTES = 2 * 1024 * 1024;
export const MAX_QUERY_LENGTH = 200;

const iso = (ms) => new Date(ms).toISOString();
const tooLarge = () => new WikiError(413, 'note_too_large', 'This note is larger than 2 MiB.');
const conflict = (currentRevision) => new WikiError(412, 'conflict', 'This note changed since you opened it.', { currentRevision });

function guardWrite(fn) {
  try {
    return fn();
  } catch (e) {
    if (e instanceof StorageError) throw storageError();
    throw e;
  }
}

// Locate a note and read its file fresh. A file that vanished is dropped and looked up once more.
function openNote({ index, vault }, key) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const entry = index.get(key) ?? (index.scan(), index.get(key));
    if (!entry) break;
    const r = vault.readFile(entry.filename);
    if (r) return { entry, r };
    index.scan();
  }
  throw notFound();
}

export function listNotes({ index }) {
  index.scan();
  const notes = index.list().map((e) => ({ title: e.title, modified: iso(e.mtimeMs), size: e.size }));
  return { status: 200, body: { notes } };
}

export function createNote(ctx, { title: rawTitle, content = '' }) {
  const { index, vault } = ctx;
  const v = validateTitle(rawTitle);
  if (!v.ok) throw new WikiError(400, v.code, v.message);
  index.scan();
  const key = titleKey(v.title);
  const existing = index.get(key);
  if (existing) throw titleExists(existing.title);
  const buf = Buffer.from(content, 'utf8');
  if (buf.length > MAX_NOTE_BYTES) throw tooLarge();
  const filename = `${v.title}.md`;
  try {
    vault.createFile(filename, buf);
  } catch (e) {
    if (e instanceof ExistsError) throw titleExists(v.title);
    if (e instanceof StorageError) throw storageError();
    throw e;
  }
  const entry = index.reload(filename);
  if (!entry) throw storageError();
  return {
    status: 201,
    body: { title: entry.title, revision: revisionOf(buf), modified: iso(entry.mtimeMs) },
    headers: { Location: `/api/notes/${encodeURIComponent(entry.title)}` },
  };
}

export function getNote(ctx, key) {
  const { entry, r } = openNote(ctx, key);
  const revision = revisionOf(r.buf);
  return {
    status: 200,
    body: { title: entry.title, content: r.buf.toString('utf8'), revision, modified: iso(r.mtimeMs) },
    headers: { ETag: `"${revision}"` },
  };
}

export function putNote(ctx, key, ifMatch, { content }) {
  if (ifMatch === undefined) throw new WikiError(428, 'revision_required', 'Send the revision you are saving over in If-Match.');
  const { index, vault } = ctx;
  const { entry, r } = openNote(ctx, key);
  const current = revisionOf(r.buf);
  if (parseIfMatch(ifMatch) !== current) throw conflict(current);
  const buf = Buffer.from(content, 'utf8');
  if (buf.length > MAX_NOTE_BYTES) throw tooLarge();
  guardWrite(() => vault.writeAtomic(entry.filename, buf));
  const fresh = index.reload(entry.filename);
  if (!fresh) throw storageError();
  const revision = revisionOf(buf);
  return {
    status: 200,
    body: { title: fresh.title, revision, modified: iso(fresh.mtimeMs) },
    headers: { ETag: `"${revision}"` },
  };
}

export function deleteNote(ctx, key, ifMatch) {
  const { index, vault } = ctx;
  const { entry, r } = openNote(ctx, key);
  if (ifMatch !== undefined && parseIfMatch(ifMatch) !== revisionOf(r.buf)) throw conflict(revisionOf(r.buf));
  if (!guardWrite(() => vault.deleteFile(entry.filename))) {
    index.scan();
    throw notFound();
  }
  index.remove(key);
  return { status: 204 };
}

export function rename(ctx, key, { title }) {
  return { status: 200, body: guardWrite(() => renameNote(ctx, key, title)) };
}

export function backlinks({ index }, key) {
  index.scan();
  if (!index.get(key)) throw notFound();
  return { status: 200, body: { backlinks: index.backlinksOf(key) } };
}

export function searchNotes({ index }, q) {
  if (typeof q !== 'string' || [...normalizeTitle(q)].length > MAX_QUERY_LENGTH) {
    throw new WikiError(400, 'bad_request', 'Search with q set to at most 200 characters.');
  }
  index.scan();
  return { status: 200, body: index.search(q) };
}

export function graph({ index }) {
  index.scan();
  return { status: 200, body: index.graph() };
}
