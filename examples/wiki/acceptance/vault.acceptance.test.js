// SC10 (the vault is the truth) and the server-side performance budgets of SC8 and SC9.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  withServer, mk, getNote, putNote, listVault, snapshot, touch, sleep, caseInsensitiveFs, enc,
} from './helpers.js';

const titlesOf = (res) => res.body.notes.map((n) => n.title);

// ---------------------------------------------------------------- outside edits
test('SC10 files added, appended to and removed by another program show up without a restart', () => withServer(async (s) => {
  assert.deepEqual((await s.call('GET', '/api/notes')).body, { notes: [] });
  fs.writeFileSync(s.file('Ext.md'), 'one');
  const added = await s.call('GET', '/api/notes');
  assert.deepEqual(titlesOf(added), ['Ext']);
  assert.equal(added.body.notes[0].size, 3);

  fs.writeFileSync(s.file('X.md'), 'see [[Ext]]');
  assert.deepEqual((await s.call('GET', '/api/notes/Ext/backlinks')).body.backlinks.map((b) => b.title), ['X']);
  assert.deepEqual((await s.call('GET', '/api/graph')).body.edges, [['Ext', 'X']]);

  fs.appendFileSync(s.file('Ext.md'), ' two words');
  const changed = await s.call('GET', '/api/notes');
  assert.equal(changed.body.notes.find((n) => n.title === 'Ext').size, 13);
  assert.equal((await getNote(s, 'Ext')).body.content, 'one two words');
  assert.deepEqual((await s.call('GET', '/api/search?q=words')).body.results.map((r) => r.title), ['Ext']);

  fs.unlinkSync(s.file('Ext.md'));
  assert.deepEqual(titlesOf(await s.call('GET', '/api/notes')), ['X']);
  assert.equal((await getNote(s, 'Ext')).status, 404);
  assert.equal((await s.call('GET', '/api/notes/Ext/backlinks')).status, 404);
  assert.deepEqual((await s.call('GET', '/api/graph')).body, { nodes: [{ title: 'X', orphan: true }], edges: [] });
  assert.equal((await s.call('GET', '/api/search?q=words')).body.total, 0);
}));

test('SC10 create and rename see a title that another program just added', () => withServer(async (s) => {
  await mk(s, 'Mine', 'x');
  fs.writeFileSync(s.file('Taken.md'), 'outside');
  const dup = await s.call('POST', '/api/notes', { title: 'TAKEN' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, 'title_exists');
  assert.equal(dup.body.error.existing, 'Taken');
  fs.writeFileSync(s.file('Taken2.md'), 'outside2');
  const rn = await s.call('POST', '/api/notes/Mine/rename', { title: 'taken2' });
  assert.equal(rn.status, 409);
  assert.equal(rn.body.error.existing, 'Taken2');
  assert.equal(s.read('Taken.md').toString(), 'outside');
  assert.equal(s.read('Taken2.md').toString(), 'outside2');
  assert.ok(fs.existsSync(s.file('Mine.md')));
}));

// ---------------------------------------------------------------- what counts as a note
const mixedVault = (v) => {
  fs.writeFileSync(path.join(v, 'Real.md'), 'real content');
  fs.mkdirSync(path.join(v, 'sub'));
  fs.writeFileSync(path.join(v, 'sub', 'Inner.md'), 'inner secret words');
  fs.writeFileSync(path.join(v, 'sub', 'Deep.md'), '[[Real]]');
  fs.writeFileSync(path.join(v, 'notes.txt'), 'txt secret words');
  fs.writeFileSync(path.join(v, 'X.MD'), 'upper ext secret words');
  fs.writeFileSync(path.join(v, '.hidden.md'), 'hidden secret words');
  fs.symlinkSync('Real.md', path.join(v, 'Link.md'));
  fs.symlinkSync('/nonexistent/zzz.md', path.join(v, 'Dangle.md'));
  fs.mkdirSync(path.join(v, 'Dir.md'));
  fs.writeFileSync(path.join(v, 'Dir.md', 'a.md'), 'in dir secret words');
  fs.writeFileSync(path.join(v, 'bad:name.md'), 'bad stem secret words');
  fs.writeFileSync(path.join(v, 'con.md'), 'reserved stem secret words');
  fs.writeFileSync(path.join(v, 'dot..md'), 'trailing dot stem secret words');
  fs.writeFileSync(path.join(v, '.wiki-1-deadbeef.tmp'), 'stale tmp');
};
const mixedFiles = (v) => ({
  'sub/Inner.md': 'inner secret words', 'notes.txt': 'txt secret words', 'X.MD': 'upper ext secret words',
  '.hidden.md': 'hidden secret words', 'Dir.md/a.md': 'in dir secret words', 'bad:name.md': 'bad stem secret words',
  'con.md': 'reserved stem secret words', 'dot..md': 'trailing dot stem secret words', 'Real.md': 'real content',
});

test('SC10 subfolders, other extensions, .MD, dotfiles, symlinks, folders named .md and invalid stems are not notes', () => withServer(async (s) => {
  const list = await s.call('GET', '/api/notes');
  assert.deepEqual(titlesOf(list), ['Real']);
  assert.deepEqual((await s.call('GET', '/api/graph')).body, { nodes: [{ title: 'Real', orphan: true }], edges: [] });
  assert.equal((await s.call('GET', '/api/search?q=secret')).body.total, 0);
  assert.deepEqual((await s.call('GET', '/api/notes/Real/backlinks')).body.backlinks, []);
  for (const t of ['Inner', 'Deep', 'notes', 'X', 'hidden', '.hidden', 'Link', 'Dangle', 'Dir', 'a', 'name', 'bad:name', 'con', 'dot.', 'sub']) {
    assert.equal((await getNote(s, t)).status, 404, `GET ${t}`);
    assert.equal((await s.call('DELETE', enc(t))).status, 404, `DELETE ${t}`);
    const put = await s.call('PUT', enc(t), { content: 'overwritten' }, { headers: { 'if-match': `"${'0'.repeat(32)}"` } });
    assert.equal(put.status, 404, `PUT ${t}`);
  }
  await s.call('GET', '/api/notes');
  const { stderr } = s.logs();
  assert.equal(stderr.split('\n').filter((l) => l.includes('bad:name.md')).length, 1, `logged once: ${stderr}`);
  for (const [rel, content] of Object.entries(mixedFiles())) assert.equal(fs.readFileSync(path.join(s.vault, rel), 'utf8'), content, rel);
  assert.equal(fs.lstatSync(s.file('Link.md')).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(s.file('Link.md')), 'Real.md');
  assert.equal(fs.readlinkSync(s.file('Dangle.md')), '/nonexistent/zzz.md');
}, { setup: mixedVault }));

test('SC10 creating or renaming onto a symlink, dangling symlink or folder named .md is 409 and overwrites nothing', () => withServer(async (s) => {
  for (const t of ['Link', 'Dangle', 'Dir']) {
    const res = await s.call('POST', '/api/notes', { title: t, content: 'overwrite' });
    assert.equal(res.status, 409, t);
    assert.equal(res.body.error.code, 'title_exists');
    assert.equal(res.body.error.existing, t, 'existing is the requested title for a non-note');
  }
  const rename = await s.call('POST', '/api/notes/Real/rename', { title: 'Link' });
  assert.equal(rename.status, 409);
  assert.equal(rename.body.error.code, 'title_exists');
  assert.equal(s.read('Real.md').toString(), 'real content');
  assert.equal(fs.lstatSync(s.file('Link.md')).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(s.file('Dangle.md')).isSymbolicLink(), true);
  assert.equal(fs.statSync(s.file('Dir.md')).isDirectory(), true);
  assert.equal(fs.readFileSync(path.join(s.vault, 'Dir.md', 'a.md'), 'utf8'), 'in dir secret words');
  // titles that only look similar are free: notes.txt and X.MD and sub/Inner.md do not block them
  for (const t of ['notes', 'Inner', 'hidden']) assert.equal((await s.call('POST', '/api/notes', { title: t })).status, 201, t);
  assert.equal(fs.readFileSync(path.join(s.vault, 'notes.txt'), 'utf8'), 'txt secret words');
  assert.equal(fs.readFileSync(path.join(s.vault, 'sub', 'Inner.md'), 'utf8'), 'inner secret words');
}, { setup: mixedVault }));

test('SC10 delete removes only that file and nothing else in the vault', () => withServer(async (s) => {
  const before = fs.readdirSync(s.vault).sort();
  assert.equal((await s.call('DELETE', '/api/notes/real')).status, 204);
  assert.deepEqual(fs.readdirSync(s.vault).sort(), before.filter((n) => n !== 'Real.md'));
  assert.equal(fs.lstatSync(s.file('Link.md')).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(path.join(s.vault, 'sub', 'Inner.md'), 'utf8'), 'inner secret words');
  assert.deepEqual(titlesOf(await s.call('GET', '/api/notes')), []);
}, { setup: mixedVault }));

test('SC10 boot removes stale .wiki-*.tmp files and leaves other dotfiles alone', () => withServer(async (s) => {
  assert.equal(fs.existsSync(s.file('.wiki-1-deadbeef.tmp')), false);
  assert.equal(fs.existsSync(s.file('.wiki-99999-0badf00d.tmp')), false);
  assert.equal(fs.readFileSync(s.file('.hidden.md'), 'utf8'), 'hidden');
  assert.equal(fs.readFileSync(s.file('.wiki-notes.txt'), 'utf8'), 'keep me');
  assert.deepEqual(titlesOf(await s.call('GET', '/api/notes')), ['Real']);
}, { setup: (v) => {
  fs.writeFileSync(path.join(v, 'Real.md'), 'r');
  fs.writeFileSync(path.join(v, '.wiki-1-deadbeef.tmp'), 'stale');
  fs.writeFileSync(path.join(v, '.wiki-99999-0badf00d.tmp'), 'stale 2');
  fs.writeFileSync(path.join(v, '.hidden.md'), 'hidden');
  fs.writeFileSync(path.join(v, '.wiki-notes.txt'), 'keep me');
} }));

// ---------------------------------------------------------------- duplicate keys
test('SC10 two files with the same key: the name that sorts first wins, the other is skipped, logged once and left alone', async (t) => {
  if (caseInsensitiveFs()) { t.skip('the temp filesystem is case-insensitive, so two files cannot share a key'); return; }
  await withServer(async (s) => {
    for (let i = 0; i < 3; i++) assert.deepEqual(titlesOf(await s.call('GET', '/api/notes')), ['Ideas']);
    const got = await getNote(s, 'ideas');
    assert.equal(got.body.title, 'Ideas');
    assert.equal(got.body.content, 'upper');
    const lines = s.logs().stderr.split('\n').filter((l) => l.includes('ideas.md'));
    assert.equal(lines.length, 1, s.logs().stderr);
    const dup = await s.call('POST', '/api/notes', { title: 'IDEAS' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.existing, 'Ideas');
    // saving acts on the on-disk filename of the winner and never touches the loser
    const put = await putNote(s, 'ideas', 'saved', got.body.revision);
    assert.equal(put.status, 200);
    assert.equal(s.read('Ideas.md').toString(), 'saved');
    assert.equal(s.read('ideas.md').toString(), 'lower');
    // deleting the winner leaves the loser, which then becomes the note
    assert.equal((await s.call('DELETE', '/api/notes/Ideas')).status, 204);
    assert.equal(fs.existsSync(s.file('Ideas.md')), false);
    assert.equal(s.read('ideas.md').toString(), 'lower');
    const after = await s.call('GET', '/api/notes');
    assert.deepEqual(titlesOf(after), ['ideas']);
  }, { setup: (v) => {
    fs.writeFileSync(path.join(v, 'Ideas.md'), 'upper');
    fs.writeFileSync(path.join(v, 'ideas.md'), 'lower');
  } });
});

// ---------------------------------------------------------------- listing
test('SC10 the list is sorted by modified desc then key asc, with ISO modified and byte sizes', () => withServer(async (s) => {
  const res = await s.call('GET', '/api/notes');
  assert.equal(res.status, 200);
  assert.deepEqual(titlesOf(res), ['Newest', 'A', 'b', 'C', 'Oldest']);
  for (const n of res.body.notes) {
    const st = fs.statSync(s.file(`${n.title}.md`));
    assert.equal(n.modified, new Date(st.mtimeMs).toISOString());
    assert.equal(n.size, st.size);
  }
  assert.equal(res.body.notes.find((n) => n.title === 'Newest').size, Buffer.byteLength('\u20AC\u20AC\u{1F600}'));
  await sleep(20);
  await putNote(s, 'Oldest', 'touched now', (await getNote(s, 'Oldest')).body.revision);
  assert.equal(titlesOf(await s.call('GET', '/api/notes'))[0], 'Oldest');
}, { setup: (v) => {
  const base = Date.now() - 100000;
  const put = (name, body, offset) => {
    fs.writeFileSync(path.join(v, `${name}.md`), body);
    const t = new Date(base + offset);
    fs.utimesSync(path.join(v, `${name}.md`), t, t);
  };
  put('Oldest', 'o', 0);
  put('C', 'c', 5000);
  put('b', 'b', 5000);
  put('A', 'a', 5000);
  put('Newest', '\u20AC\u20AC\u{1F600}', 9000);
} }));

// ---------------------------------------------------------------- write mechanics
test('SC10 saves are atomic: no temp file is left behind and files are created with mode 0644', () => withServer(async (s) => {
  const made = await mk(s, 'Perm', 'v1');
  assert.equal(fs.statSync(s.file('Perm.md')).mode & 0o777, 0o644);
  const put = await putNote(s, 'Perm', 'v2', made.revision);
  assert.equal(put.status, 200);
  assert.equal(fs.statSync(s.file('Perm.md')).mode & 0o777, 0o644);
  await mk(s, 'Linker', '[[Perm]]');
  assert.equal((await s.call('POST', '/api/notes/Perm/rename', { title: 'Renamed' })).status, 200);
  for (const n of ['Renamed.md', 'Linker.md']) assert.equal(fs.statSync(s.file(n)).mode & 0o777, 0o644, n);
  assert.deepEqual(fs.readdirSync(s.vault).filter((n) => n.endsWith('.tmp')), []);
  assert.deepEqual(listVault(s.vault), ['Linker.md', 'Renamed.md']);
}));

test('SC10 rename leaves unrelated files byte identical, including their mtimes', () => withServer(async (s) => {
  await mk(s, 'Src', 'x');
  await mk(s, 'Other', 'no links\r\n');
  await mk(s, 'Linker', 'to [[src]]');
  const other = fs.statSync(s.file('Other.md')).mtimeMs;
  const before = snapshot(s.vault);
  await sleep(20);
  const res = await s.call('POST', '/api/notes/Src/rename', { title: 'Dest' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.updated, ['Linker']);
  const after = snapshot(s.vault);
  assert.equal(after['Other.md'], before['Other.md']);
  assert.equal(fs.statSync(s.file('Other.md')).mtimeMs, other);
  assert.equal(after['Dest.md'], before['Src.md']);
  assert.notEqual(after['Linker.md'], before['Linker.md']);
}));

// ---------------------------------------------------------------- performance (server side)
const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim minim veniam quis nostrud'.split(' ');
const pad = (i) => String(i).padStart(4, '0');
function paragraph(seed, minLength) {
  let out = '';
  let k = seed;
  while (out.length < minLength) { k = (k * 31 + 7) % 9973; out += `${LOREM[k % LOREM.length]} `; if (k % 17 === 0) out += '\n'; }
  return out;
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test('SC8 perf: with 5,000 notes of about 2 KB the median of 3 searches for "quarterly" is under 300 ms', { timeout: 120000 }, () => withServer(async (s) => {
  const warm = await s.call('GET', '/api/search?q=quarterly');
  assert.equal(warm.status, 200);
  assert.equal(warm.body.total, 100);
  const times = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const res = await s.call('GET', '/api/search?q=quarterly');
    times.push(performance.now() - t0);
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 100);
    assert.equal(res.body.results.length, 100);
  }
  assert.ok(median(times) < 300, `median ${median(times).toFixed(0)} ms (${times.map((t) => t.toFixed(0)).join(', ')})`);
  const list = await s.call('GET', '/api/notes');
  assert.equal(list.body.notes.length, 5000);
}, { setup: (v) => {
  for (let i = 0; i < 5000; i++) {
    const marker = i % 50 === 0 ? ' quarterly ' : ' ';
    fs.writeFileSync(path.join(v, `Note ${pad(i)}.md`), `# Note ${i}\n\n${paragraph(i, 1000)}${marker}${paragraph(i + 1, 1000)}\n`);
  }
} }));

test('SC9 perf: GET /api/graph on 1,000 linked notes is under 1 s and has the exact edges', { timeout: 120000 }, () => withServer(async (s) => {
  const warm = await s.call('GET', '/api/graph');
  assert.equal(warm.status, 200);
  const times = [];
  let last;
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    last = await s.call('GET', '/api/graph');
    times.push(performance.now() - t0);
  }
  assert.ok(median(times) < 1000, `median ${median(times).toFixed(0)} ms (${times.map((t) => t.toFixed(0)).join(', ')})`);
  assert.equal(last.body.nodes.length, 1000);
  assert.ok(last.body.nodes.every((n) => n.orphan === false));
  assert.equal(last.body.nodes[0].title, 'Note 0000');
  assert.equal(last.body.nodes[999].title, 'Note 0999');
  const want = new Set();
  for (let i = 0; i < 1000; i++) for (const d of [1, 2]) { const j = (i + d) % 1000; want.add(`${pad(Math.min(i, j))}|${pad(Math.max(i, j))}`); }
  const expected = [...want].sort().map((k) => k.split('|').map((p) => `Note ${p}`));
  assert.equal(expected.length, 2000);
  assert.deepEqual(last.body.edges, expected);
}, { setup: (v) => {
  for (let i = 0; i < 1000; i++) {
    fs.writeFileSync(path.join(v, `Note ${pad(i)}.md`), `Links to [[Note ${pad((i + 1) % 1000)}]] and [[note ${pad((i + 2) % 1000)}|two]].\n${paragraph(i, 300)}\n`);
  }
} }));
