// In-memory index of the vault, refreshed by an on-demand stat scan.
import { validateTitle, titleKey } from '../public/js/titles.js';
import { parseWikilinks } from '../public/js/wikilink.js';
import { MAX_INDEXED_BYTES } from './vault.js';
import { revisionOf } from './revision.js';
import { search } from './search.js';

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export class Index {
  constructor(vault, log = (line) => process.stderr.write(`${line}\n`)) {
    this.vault = vault;
    this.log = log;
    this.entries = new Map(); // key -> entry
    this.generation = 0;
    this.logged = new Set();
    this.derived = { generation: -1, sorted: [], backlinks: new Map() };
  }

  logOnce(id, line) {
    if (this.logged.has(id)) return;
    this.logged.add(id);
    this.log(line);
  }

  // Title and key for a filename, or null (logged once) when the stem is not a valid title.
  identify(filename) {
    const stem = filename.slice(0, -3).normalize('NFC');
    const v = validateTitle(stem);
    if (!v.ok) {
      this.logOnce(`invalid:${filename}`, `Skipping ${filename}: ${v.message}`);
      return null;
    }
    return { title: v.title, key: titleKey(v.title) };
  }

  // Build an entry by reading the file. Null when it vanished or is not a regular file.
  load(filename, ident, size) {
    const base = { title: ident.title, key: ident.key, filename };
    if (size > MAX_INDEXED_BYTES) {
      const st = this.vault.statFile(filename);
      if (!st) return null;
      return { ...base, ...st, content: '', lower: null, revision: null, links: [], big: true };
    }
    const r = this.vault.readFile(filename);
    if (!r) return null;
    if (r.size > MAX_INDEXED_BYTES) return { ...base, ino: r.ino, mtimeMs: r.mtimeMs, size: r.size, content: '', lower: null, revision: null, links: [], big: true };
    const content = r.buf.toString('utf8');
    const lower = content.toLowerCase();
    const links = [];
    const seen = new Set();
    for (const l of parseWikilinks(content)) {
      const v = validateTitle(l.target);
      if (!v.ok) continue;
      const key = titleKey(v.title);
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ key, target: v.title, line: l.line });
    }
    return {
      ...base, ino: r.ino, mtimeMs: r.mtimeMs, size: r.size, content,
      lower: lower.length === content.length ? lower : null,
      revision: revisionOf(r.buf), links, big: false,
    };
  }

  // Stat scan: pick up files added, changed or removed by other programs.
  scan() {
    const files = this.vault.listFiles().sort((a, b) => compare(a.filename, b.filename));
    const winners = new Map();
    for (const f of files) {
      const ident = this.identify(f.filename);
      if (!ident) continue;
      const first = winners.get(ident.key);
      if (first) {
        this.logOnce(`dup:${f.filename}`, `Skipping ${f.filename}: same title as ${first.file.filename}`);
        continue;
      }
      winners.set(ident.key, { file: f, ident });
    }
    const next = new Map();
    let changed = false;
    for (const [key, { file, ident }] of winners) {
      const old = this.entries.get(key);
      if (old && old.filename === file.filename && old.ino === file.ino && old.mtimeMs === file.mtimeMs && old.size === file.size) {
        next.set(key, old);
        continue;
      }
      changed = true;
      const entry = this.load(file.filename, ident, file.size);
      if (entry) next.set(key, entry);
    }
    for (const key of this.entries.keys()) if (!next.has(key)) changed = true;
    this.entries = next;
    if (changed) this.generation += 1;
  }

  get(key) {
    return this.entries.get(key) ?? null;
  }

  // Find a note by key; a miss triggers one scan in case another program just added it.
  find(key) {
    return this.get(key) ?? (this.scan(), this.get(key));
  }

  // Re-read one file after the app wrote it. Returns the new entry or null.
  reload(filename) {
    const ident = this.identify(filename);
    if (!ident) return null;
    const entry = this.load(filename, ident, 0);
    if (entry) this.entries.set(ident.key, entry); else this.entries.delete(ident.key);
    this.generation += 1;
    return entry;
  }

  remove(key) {
    if (this.entries.delete(key)) this.generation += 1;
  }

  prepare() {
    if (this.derived.generation === this.generation) return this.derived;
    const sorted = [...this.entries.values()].sort((a, b) => (
      Math.trunc(b.mtimeMs) - Math.trunc(a.mtimeMs) || compare(a.key, b.key)
    ));
    const byKey = [...this.entries.values()].sort((a, b) => compare(a.key, b.key));
    const backlinks = new Map();
    for (const e of byKey) {
      for (const l of e.links) {
        if (l.key === e.key) continue;
        if (!backlinks.has(l.key)) backlinks.set(l.key, []);
        backlinks.get(l.key).push({ title: e.title, snippet: l.line });
      }
    }
    this.derived = { generation: this.generation, sorted, byKey, backlinks };
    return this.derived;
  }

  // Notes by modified desc, then key asc.
  list() {
    return this.prepare().sorted;
  }

  backlinksOf(key) {
    return this.prepare().backlinks.get(key) ?? [];
  }

  search(q) {
    return search(this.entries.values(), q);
  }

  graph() {
    const { byKey } = this.prepare();
    const pairs = new Map();
    for (const e of byKey) {
      for (const l of e.links) {
        if (l.key === e.key || !this.entries.has(l.key)) continue;
        const [a, b] = e.key < l.key ? [e.key, l.key] : [l.key, e.key];
        pairs.set(`${a}\u0000${b}`, [a, b]);
      }
    }
    const linked = new Set();
    const edges = [...pairs.values()].sort((p, q) => compare(p[0], q[0]) || compare(p[1], q[1]));
    for (const [a, b] of edges) { linked.add(a); linked.add(b); }
    return {
      nodes: byKey.map((e) => ({ title: e.title, orphan: !linked.has(e.key) })),
      edges: edges.map(([a, b]) => [this.entries.get(a).title, this.entries.get(b).title]),
    };
  }
}
