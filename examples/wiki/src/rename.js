// Rename a note and rewrite every wikilink that pointed at it.
import { validateTitle, titleKey, TITLE_MESSAGES } from '../public/js/titles.js';
import { rewriteWikilinks } from '../public/js/wikilink.js';
import { WikiError, StorageError, ExistsError } from './errors.js';
import { revisionOf } from './revision.js';

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const notFound = () => new WikiError(404, 'note_not_found', 'Note not found.');

export const titleExists = (existing) => new WikiError(
  409, 'title_exists', TITLE_MESSAGES.title_exists.replace('{existing}', () => existing), { existing },
);

const storageError = () => new WikiError(503, 'storage_error', 'The vault could not be written. Try again.');

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

  index.scan();
  const updated = [];
  const failed = [];
  for (const entry of [...index.entries.values()].sort((a, b) => compare(a.key, b.key))) {
    if (entry.big) continue;
    const r = vault.readFile(entry.filename);
    if (!r) continue;
    const { text, count } = rewriteWikilinks(r.buf.toString('utf8'), oldKey, newTitle);
    if (count === 0) continue;
    try {
      vault.writeAtomic(entry.filename, Buffer.from(text, 'utf8'));
      if (entry.key !== newKey) updated.push(entry.title);
    } catch (e) {
      if (!(e instanceof StorageError)) throw e;
      failed.push({ title: entry.title, reason: 'write_failed' });
    }
  }

  index.scan();
  const renamed = index.get(newKey);
  const fresh = renamed && vault.readFile(renamed.filename);
  if (!fresh) throw storageError();
  return { title: renamed.title, revision: revisionOf(fresh.buf), updated, failed };
}
