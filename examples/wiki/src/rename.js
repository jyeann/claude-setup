// Rename a note and rewrite every wikilink that pointed at it.
import { validateTitle, titleKey, TITLE_MESSAGES } from '../public/js/titles.js';
import { rewriteWikilinks } from '../public/js/wikilink.js';
import { WikiError, StorageError, ExistsError, storageError } from './errors.js';
import { revisionOf } from './revision.js';

// Node file system errors carry a string `code` such as EIO or EACCES.
const isFsError = (e) => e instanceof Error && typeof e.code === 'string' && /^E[A-Z0-9]+$/.test(e.code);

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const notFound = () => new WikiError(404, 'note_not_found', 'Note not found.');

export const titleExists = (existing) => new WikiError(
  409, 'title_exists', TITLE_MESSAGES.title_exists.replace('{existing}', () => existing), { existing },
);

// ctx: {index, vault}. Returns the response body. Synchronous on purpose: nothing interleaves.
export function renameNote(ctx, oldKey, rawNewTitle) {
  const { index, vault } = ctx;
  index.scan();
  const old = index.get(oldKey);
  if (!old) throw notFound();
  const v = validateTitle(rawNewTitle);
  if (!v.ok) throw new WikiError(400, v.code, v.message);
  const newTitle = v.title;

  if (newTitle === old.title) {
    const r = vault.readFile(old.filename);
    if (!r) throw notFound();
    return { title: old.title, revision: revisionOf(r.buf), updated: [], failed: [] };
  }

  const newKey = titleKey(newTitle);
  const newName = `${newTitle}.md`;
  const clash = index.get(newKey);
  if (clash && clash !== old) throw titleExists(clash.title);

  try {
    if (newKey === oldKey) {
      // Case-only change: the name differs only in case, so go through a temporary name.
      if (vault.occupied(newName) && vault.statFile(newName)?.ino !== old.ino) throw new ExistsError(newName);
      vault.moveCaseOnly(old.filename, newName);
    } else {
      vault.moveFile(old.filename, newName);
    }
  } catch (e) {
    if (e instanceof ExistsError) throw titleExists(newTitle);
    if (e instanceof StorageError) throw storageError();
    throw e;
  }

  // Candidates come from the index as it was before the move (fresh from the scan above): only notes whose
  // indexed links include the old key. The moved note is seen under its new key, title and file name.
  const candidates = [];
  for (const entry of index.entries.values()) {
    if (entry.big || !entry.links.some((l) => l.key === oldKey)) continue;
    candidates.push(entry === old ? { key: newKey, title: newTitle, filename: newName } : entry);
  }
  candidates.sort((a, b) => compare(a.key, b.key));
  const updated = [];
  const failed = [];
  for (const entry of candidates) {
    try {
      const r = vault.readFile(entry.filename); // fresh read, never the indexed copy
      if (!r) continue;
      const original = r.buf.toString('utf8');
      const { text, count } = rewriteWikilinks(original, oldKey, newTitle);
      if (count === 0) continue;
      if (!Buffer.from(original, 'utf8').equals(r.buf)) throw new StorageError('Not valid UTF-8; left untouched.');
      vault.writeAtomic(entry.filename, Buffer.from(text, 'utf8'));
      if (entry.key !== newKey) updated.push(entry.title);
    } catch (e) {
      if (!(e instanceof StorageError) && !isFsError(e)) throw e;
      failed.push({ title: entry.title, reason: 'write_failed' });
    }
  }

  index.scan();
  const renamed = index.get(newKey);
  const fresh = renamed && vault.readFile(renamed.filename);
  if (!fresh) throw storageError();
  return { title: renamed.title, revision: revisionOf(fresh.buf), updated, failed };
}
