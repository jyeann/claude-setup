// The sidecar .constellation-sky.json over HTTP: rename carries position (SC5), written atomically, never a note,
// corrupt, oversized, symlinked and read-only handling. Acceptance tests are read-only for builders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  withServer, sandbox, mk, putNote, getNote, renameNote, enc, sleep, listVault, getSky, skyOf, starMap, hashPoint2, titleKeyOf,
  genVault, writeNotes, SIDECAR_NAME, sidecarBytes, sidecarText, readSidecarJson, SAMPLE_TITLES, sampleBytes,
} from './helpers.js';

const IDEAS = [-971.85, -2767.39];
const sc = (v) => path.join(v, SIDECAR_NAME);
const write = (v, name, content) => fs.writeFileSync(path.join(v, `${name}.md`), content);
const writeSidecar = (v, obj) => fs.writeFileSync(sc(v), typeof obj === 'string' ? obj : JSON.stringify(obj));
const MAP = { version: 1, samplesSeeded: false, seeds: { 'idea two': 'ideas' } };
const own = (title) => hashPoint2(titleKeyOf(title));
const warnCount = (s, text) => s.logs().stderr.split(text).length - 1;
const UNREADABLE = 'Ignoring unreadable .constellation-sky.json';
const stat = (v) => { const st = fs.statSync(sc(v)); return `${st.ino}:${st.mtimeMs}:${st.size}`; };
const posOf = async (s, title) => starMap(await skyOf(s)).get(title);
const err = (res, status, code) => { assert.equal(res.status, status, res.text); assert.equal(res.body.error.code, code); };

// ---------------------------------------------------------------- the worked rename cases
test('SC5 worked case: renaming Ideas to Project ideas keeps its exact x and y, Welcome does not move, and the sidecar holds the original seed', () => withServer(async (s) => {
  await mk(s, 'Welcome', 'Hello.\n\nSee [[Ideas]].\n');
  await mk(s, 'Ideas');
  const before = await skyOf(s);
  const pos = starMap(before);
  assert.equal(before.unlit.title.length, 0);
  const res = await renameNote(s, 'Ideas', 'Project ideas');
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body.updated, ['Welcome']);
  assert.equal(s.read('Welcome.md').toString(), 'Hello.\n\nSee [[Project ideas]].\n');
  const after = starMap(await skyOf(s));
  assert.equal(after.has('Ideas'), false);
  assert.deepEqual(after.get('Project ideas'), pos.get('Ideas'));
  assert.deepEqual(after.get('Welcome'), pos.get('Welcome'));
  assert.deepEqual(readSidecarJson(s), { version: 1, samplesSeeded: false, seeds: { 'project ideas': 'ideas' } });
  const back = await renameNote(s, 'Project ideas', 'Ideas');
  assert.equal(back.status, 200, back.text);
  const again = starMap(await skyOf(s));
  assert.deepEqual(again.get('Ideas'), pos.get('Ideas'), 'back at the same place');
  assert.deepEqual(again.get('Welcome'), pos.get('Welcome'));
  assert.deepEqual(readSidecarJson(s), { version: 1, samplesSeeded: false, seeds: {} }, 'newKey equals the seed, so the entry is removed');
}));

test('SC5 a note named Idea two with the sidecar seeds {"idea two":"ideas"} is reported at (-971.85, -2767.39)', () => withServer(async (s) => {
  assert.deepEqual(await posOf(s, 'Idea two'), IDEAS);
  assert.notDeepEqual(own('Idea two'), IDEAS, 'without the sidecar it would sit at its own-key point');
}, { setup: (v) => { write(v, 'Idea two', 'x'); writeSidecar(v, MAP); } }));

test('SC5 P4 renames carry the position through a chain: the entry always names the original seed and stale entries disappear', () => withServer(async (s) => {
  await mk(s, 'First name', 'x');
  const pos = await posOf(s, 'First name');
  assert.deepEqual(pos, own('First name'));
  for (const [from, to] of [['First name', 'Second'], ['Second', 'Third one'], ['Third one', 'Fourth']]) {
    assert.equal((await renameNote(s, from, to)).status, 200);
    assert.deepEqual(await posOf(s, to), pos, to);
  }
  assert.deepEqual(readSidecarJson(s).seeds, { fourth: 'first name' });
  assert.equal((await renameNote(s, 'Fourth', 'First name')).status, 200);
  assert.deepEqual(readSidecarJson(s).seeds, {});
  assert.deepEqual(await posOf(s, 'First name'), pos);
}));

test('SC5 P4 in a 50-note, 80-link vault a rename moves no star: every position by title is unchanged and links are rewritten', () => withServer(async (s) => {
  const before = starMap(await skyOf(s));
  assert.equal(before.size, 50);
  const res = await renameNote(s, 'N17', 'Renamed seventeen');
  assert.equal(res.status, 200, res.text);
  const after = starMap(await skyOf(s));
  assert.equal(after.size, 50);
  for (const [t, xy] of before) assert.deepEqual(after.get(t === 'N17' ? 'Renamed seventeen' : t), xy, t);
  assert.deepEqual(readSidecarJson(s).seeds, { 'renamed seventeen': 'n17' });
  for (const t of ['N03', 'N30']) assert.equal(await posOf(s, t) !== undefined, true);
}, { setup: (v) => writeNotes(v, genVault(50, 80, 31).notes) }));

test('SC5 the sidecar is compact JSON plus a newline with keys version, samplesSeeded, seeds, written atomically with mode 0644 and no temp file left', () => withServer(async (s) => {
  assert.equal(sidecarBytes(s.vault), null, 'nothing is written before the first rename');
  await mk(s, 'Ideas', 'x');
  await mk(s, 'Other', 'y');
  assert.equal(sidecarBytes(s.vault), null, 'creating notes does not write the sidecar');
  assert.equal((await renameNote(s, 'Ideas', 'Project ideas')).status, 200);
  assert.equal(sidecarBytes(s.vault).toString(), '{"version":1,"samplesSeeded":false,"seeds":{"project ideas":"ideas"}}\n');
  assert.equal(fs.lstatSync(sc(s.vault)).isFile(), true);
  assert.equal(fs.statSync(sc(s.vault)).mode & 0o777, 0o644);
  assert.equal((await renameNote(s, 'Other', 'Zeta')).status, 200);
  assert.equal(sidecarBytes(s.vault).toString(), '{"version":1,"samplesSeeded":false,"seeds":{"project ideas":"ideas","zeta":"other"}}\n', 'keys in code-unit order');
  assert.equal((await renameNote(s, 'Zeta', 'Alpha beta')).status, 200);
  assert.equal(sidecarBytes(s.vault).toString(), '{"version":1,"samplesSeeded":false,"seeds":{"alpha beta":"other","project ideas":"ideas"}}\n');
  assert.deepEqual(fs.readdirSync(s.vault).filter((n) => n.endsWith('.tmp')), []);
  assert.deepEqual(listVault(s.vault), ['Alpha beta.md', 'Project ideas.md']);
}));

test('SC5 unknown top-level keys survive a rewrite, written back after the known keys in their original order', () => withServer(async (s) => {
  assert.equal((await renameNote(s, 'Aaa', 'Bbb')).status, 200);
  assert.equal(sidecarBytes(s.vault).toString(), '{"version":1,"samplesSeeded":false,"seeds":{"bbb":"aaa"},"note":"keep me","zeta":[1,2],"alpha":{"x":null}}\n');
}, { setup: (v) => { write(v, 'Aaa', 'x'); fs.writeFileSync(sc(v), '{"note":"keep me","version":1,"zeta":[1,2],"seeds":{},"samplesSeeded":false,"alpha":{"x":null}}'); } }));

test('SC5 case-only and identical-title renames never touch the sidecar', () => withServer(async (s) => {
  const before = sidecarBytes(s.vault).toString();
  const stamp = stat(s.vault);
  await sleep(30);
  assert.equal((await renameNote(s, 'idea two', 'IDEA TWO')).status, 200);
  assert.equal((await renameNote(s, 'IDEA TWO', 'IDEA TWO')).status, 200);
  assert.equal((await renameNote(s, 'Other', 'other')).status, 200);
  assert.equal((await renameNote(s, 'other', 'Other')).status, 200);
  assert.equal(sidecarBytes(s.vault).toString(), before);
  assert.equal(stat(s.vault), stamp, 'same inode, mtime and size');
  assert.deepEqual(await posOf(s, 'IDEA TWO'), IDEAS);
}, { setup: (v) => { write(v, 'Idea two', 'x'); write(v, 'Other', 'y'); writeSidecar(v, MAP); } }));

test('SC5 a rename that is refused (409 existing title, 404 missing source, 400 bad title) changes nothing, not even the sidecar', () => withServer(async (s) => {
  const before = sidecarBytes(s.vault);
  const stamp = stat(s.vault);
  err(await renameNote(s, 'Idea two', 'OTHER'), 409, 'title_exists');
  err(await renameNote(s, 'Idea two', ' other '), 409, 'title_exists');
  err(await renameNote(s, 'Missing', 'Whatever'), 404, 'note_not_found');
  err(await renameNote(s, 'Idea two', 'a/b'), 400, 'title_separator');
  err(await renameNote(s, 'Idea two', ''), 400, 'title_empty');
  assert.deepEqual(sidecarBytes(s.vault), before);
  assert.equal(stat(s.vault), stamp);
  assert.deepEqual(listVault(s.vault), ['Idea two.md', 'Other.md']);
  assert.deepEqual(await posOf(s, 'Idea two'), IDEAS);
}, { setup: (v) => { write(v, 'Idea two', 'x'); write(v, 'Other', 'y'); writeSidecar(v, MAP); } }));

test('SC5 notes written, saved and deleted without an entry never create or modify the sidecar', () => withServer(async (s) => {
  const created = await mk(s, 'Plain', 'v1');
  assert.equal(sidecarBytes(s.vault), null);
  const put = await putNote(s, 'Plain', 'v2', created.revision);
  assert.equal(put.status, 200);
  assert.equal((await s.call('DELETE', enc('Plain'))).status, 204);
  assert.equal(sidecarBytes(s.vault), null, 'no sidecar appears from note writes');
  assert.equal(fs.existsSync(sc(s.vault)), false);
}));

test('SC5 note writes leave an existing sidecar byte for byte alone, and deleting a note without an entry does not write it', () => withServer(async (s) => {
  const before = sidecarBytes(s.vault);
  const stamp = stat(s.vault);
  await sleep(30);
  const made = await mk(s, 'Plain', 'v1');
  await putNote(s, 'Plain', 'v2', made.revision);
  const other = await getNote(s, 'Other');
  await putNote(s, 'Other', 'edited', other.body.revision);
  assert.equal((await s.call('DELETE', enc('Plain'))).status, 204);
  assert.equal((await s.call('DELETE', enc('Other'))).status, 204);
  assert.deepEqual(sidecarBytes(s.vault), before);
  assert.equal(stat(s.vault), stamp, 'not rewritten');
}, { setup: (v) => { write(v, 'Idea two', 'x'); write(v, 'Other', 'y'); writeSidecar(v, MAP); } }));

test('SC5 deleting a note that has an entry removes the entry and prunes the rest; other entries stay', () => withServer(async (s) => {
  assert.equal((await s.call('DELETE', enc('Idea two'))).status, 204);
  assert.deepEqual(readSidecarJson(s), { version: 1, samplesSeeded: false, seeds: { 'other two': 'orphan' } });
  assert.equal(sidecarBytes(s.vault).toString(), '{"version":1,"samplesSeeded":false,"seeds":{"other two":"orphan"}}\n');
  assert.deepEqual(await posOf(s, 'Other two'), [-2308.84, 507.13]);
}, { setup: (v) => {
  write(v, 'Idea two', 'x'); write(v, 'Other two', 'y');
  writeSidecar(v, { version: 1, samplesSeeded: false, seeds: { 'idea two': 'ideas', 'other two': 'orphan', 'gone note': 'welcome' } });
} }));

// ---------------------------------------------------------------- never a note
test('the sidecar is never listed, readable, writable, deletable, searchable or linkable through the note routes', () => withServer(async (s) => {
  const before = sidecarBytes(s.vault);
  const stamp = stat(s.vault);
  const list = await s.call('GET', '/api/notes');
  assert.deepEqual(list.body.notes.map((n) => n.title), ['Idea two']);
  for (const seg of ['.constellation-sky.json', '.constellation-sky', encodeURIComponent('.constellation-sky.json'), 'constellation-sky.json', '%2econstellation-sky.json']) {
    err(await s.call('GET', `/api/notes/${seg}`), 404, 'note_not_found');
    err(await s.call('GET', `/api/notes/${seg}/backlinks`), 404, 'note_not_found');
    err(await s.call('DELETE', `/api/notes/${seg}`), 404, 'note_not_found');
    err(await s.call('PUT', `/api/notes/${seg}`, { content: 'pwned' }, { headers: { 'if-match': `"${'0'.repeat(32)}"` } }), 404, 'note_not_found');
    err(await s.call('POST', `/api/notes/${seg}/rename`, { title: 'Moved' }), 404, 'note_not_found');
  }
  for (const title of ['.constellation-sky.json', '.constellation-sky']) err(await s.call('POST', '/api/notes', { title }), 400, 'title_leading_dot');
  err(await renameNote(s, 'Idea two', '.constellation-sky'), 400, 'title_leading_dot');
  assert.equal((await s.call('GET', '/api/search?q=samplesSeeded')).body.total, 0);
  assert.equal((await s.call('GET', '/api/search?q=ideas')).body.total, 0);
  assert.deepEqual((await s.call('GET', '/api/graph')).body.nodes.map((n) => n.title), ['Idea two']);
  assert.deepEqual((await skyOf(s)).stars.title, ['Idea two']);
  assert.deepEqual(sidecarBytes(s.vault), before);
  assert.equal(stat(s.vault), stamp);
}, { setup: (v) => { write(v, 'Idea two', 'plain'); writeSidecar(v, MAP); } }));

// ---------------------------------------------------------------- entries: validation, pruning, caps
test('SC5 entries for keys that are not current notes are ignored, and pruned at the next sidecar write', () => withServer(async (s) => {
  assert.deepEqual(await posOf(s, 'Real note'), own('Real note'), 'an entry for another key does not move this star');
  assert.deepEqual(await posOf(s, 'Moving'), own('Moving'));
  assert.equal((await renameNote(s, 'Moving', 'Moved')).status, 200);
  assert.deepEqual(readSidecarJson(s).seeds, { moved: 'moving' }, 'ghost, gone and the unrelated entries are pruned');
}, { setup: (v) => { write(v, 'Real note', 'x'); write(v, 'Moving', 'y'); writeSidecar(v, { version: 1, samplesSeeded: false, seeds: { ghost: 'ideas', 'gone note': 'orphan' } }); } }));

test('SC5 an entry is kept only when key and value are strings, valid titles, and already in titleKey form; the rest are dropped', () => withServer(async (s) => {
  const pos = starMap(await skyOf(s));
  assert.deepEqual(pos.get('Good'), IDEAS, 'the valid entry applies');
  for (const t of ['Upper key', 'Upper value', 'Number value', 'Bad value', 'Padded', 'Null value']) assert.deepEqual(pos.get(t), own(t), `${t} falls back to its own key`);
  assert.equal((await renameNote(s, 'Good', 'Fine')).status, 200);
  assert.deepEqual(readSidecarJson(s).seeds, { fine: 'ideas' });
}, { setup: (v) => {
  for (const t of ['Good', 'Upper key', 'Upper value', 'Number value', 'Bad value', 'Padded', 'Null value']) write(v, t, 'x');
  writeSidecar(v, '{"version":1,"samplesSeeded":false,"seeds":{"good":"ideas","Upper key":"ideas","upper value":"Ideas","number value":5,"bad value":"a/b","padded":" ideas ","null value":null,"":"ideas"}}');
} }));

test('SC5 __proto__ is just a key: a note named __proto__ takes its entry, and the object prototype is never touched', () => withServer(async (s) => {
  assert.deepEqual(await posOf(s, '__proto__'), IDEAS);
  assert.equal(({}).seeds, undefined);
  assert.equal(Object.keys({}).length, 0);
  assert.equal((await s.call('GET', '/api/notes')).status, 200);
  assert.equal((await renameNote(s, '__proto__', 'Plain name')).status, 200);
  assert.deepEqual(readSidecarJson(s).seeds, { 'plain name': 'ideas' });
  assert.deepEqual(await posOf(s, 'Plain name'), IDEAS);
}, { setup: (v) => { write(v, '__proto__', 'x'); fs.writeFileSync(sc(v), '{"version":1,"samplesSeeded":false,"seeds":{"__proto__":"ideas","constructor":"orphan"}}'); } }));

test('SC5 only the first 10,000 entries of seeds are read', () => withServer(async (s) => {
  const pos = starMap(await skyOf(s));
  assert.deepEqual(pos.get('n00000'), IDEAS, 'entry 1 is read');
  assert.deepEqual(pos.get('n09999'), hashPoint2('welcome'), 'entry 10,000 is read');
  assert.deepEqual(pos.get('n10000'), own('n10000'), 'entry 10,001 is dropped');
}, { setup: (v) => {
  for (const t of ['n00000', 'n09999', 'n10000']) write(v, t, 'x');
  const seeds = {};
  for (let i = 0; i <= 10000; i++) seeds[`n${String(i).padStart(5, '0')}`] = i === 0 ? 'ideas' : i === 9999 ? 'welcome' : `s${i}`;
  seeds.n10000 = 'orphan';
  writeSidecar(v, { version: 1, samplesSeeded: false, seeds });
} }));

test('SC5 two entries with the same seed: the first key keeps it, the next gets the seed plus #1', () => withServer(async (s) => {
  const pos = starMap(await skyOf(s));
  assert.deepEqual(pos.get('alpha'), hashPoint2('shared seed'));
  assert.deepEqual(pos.get('beta'), hashPoint2('shared seed#1'));
  assert.deepEqual(pos.get('plain'), own('plain'));
}, { setup: (v) => { for (const t of ['alpha', 'beta', 'plain']) write(v, t, 'x'); writeSidecar(v, { version: 1, samplesSeeded: false, seeds: { alpha: 'shared seed', beta: 'shared seed' } }); } }));

test('SC5 a new note whose key equals a carried seed takes the next free seed: Project ideas keeps ideas, the new Ideas is placed at ideas#1', () => withServer(async (s) => {
  await mk(s, 'Ideas');
  const first = await posOf(s, 'Ideas');
  assert.deepEqual(first, hashPoint2('ideas'));
  assert.equal((await renameNote(s, 'Ideas', 'Project ideas')).status, 200);
  await mk(s, 'Ideas');
  const pos = starMap(await skyOf(s));
  assert.deepEqual(pos.get('Project ideas'), first);
  assert.deepEqual(pos.get('Ideas'), hashPoint2('ideas#1'));
  assert.notDeepEqual(pos.get('Ideas'), first);
}));

// ---------------------------------------------------------------- corrupt, oversized, symlinked, directory, read-only
const CORRUPT = ['{', '', 'not json at all', 'null', '[]', '"str"', '42', 'true', '{"version":"1"}', '{"version":1.5}', '{"version":null}', '{"seeds":{"idea two":"ideas"}}', '[{"version":1}]'];

test('an invalid, wrong-shape or unreadable sidecar is logged once as "Ignoring unreadable .constellation-sky.json", every star sits at its own key, and the next write replaces the file', async () => {
  for (const content of CORRUPT) {
    await withServer(async (s) => {
      for (let i = 0; i < 3; i++) assert.equal((await getSky(s)).status, 200);
      assert.equal(warnCount(s, UNREADABLE), 1, `${JSON.stringify(content)}: ${s.logs().stderr}`);
      const pos = starMap(await skyOf(s));
      assert.deepEqual(pos.get('Idea two'), own('Idea two'), JSON.stringify(content));
      assert.deepEqual(sidecarBytes(s.vault).toString(), content, 'reading never rewrites it');
      assert.equal((await renameNote(s, 'Idea two', 'Idea three')).status, 200);
      const fixed = readSidecarJson(s);
      assert.equal(fixed.version, 1, JSON.stringify(content));
      assert.deepEqual(fixed.seeds, { 'idea three': 'idea two' });
      assert.deepEqual(await posOf(s, 'Idea three'), own('Idea two'));
      assert.equal(warnCount(s, UNREADABLE), 1);
    }, { setup: (v) => { write(v, 'Idea two', 'x'); writeSidecar(v, content); } });
  }
});

test('an unreadable sidecar is never seeded over: an empty vault with seeding on stays empty and the file is byte for byte unchanged', async () => {
  for (const content of ['{', 'null', '{"version":"x"}']) {
    await withServer(async (s) => {
      assert.deepEqual(listVault(s.vault), []);
      assert.equal(sidecarBytes(s.vault).toString(), content);
      const sky = await skyOf(s);
      assert.equal(sky.samples, 0);
      assert.deepEqual(sky.stars.title, []);
      assert.equal(warnCount(s, UNREADABLE), 1);
    }, { env: { CONSTELLATION_SAMPLES: undefined }, setup: (v) => writeSidecar(v, content) });
  }
});

test('a version 1 sidecar whose seeds is missing or not an object is accepted with no seeds', async () => {
  for (const content of ['{"version":1}', '{"version":1,"seeds":[]}', '{"version":1,"seeds":"x"}', '{"version":1,"samplesSeeded":"yes","seeds":null}']) {
    await withServer(async (s) => {
      assert.deepEqual(await posOf(s, 'Idea two'), own('Idea two'), content);
      assert.equal((await getSky(s)).status, 200);
    }, { setup: (v) => { write(v, 'Idea two', 'x'); writeSidecar(v, content); } });
  }
});

test('a sidecar over 1 MiB is treated as absent and logged; one of exactly 1 MiB is read', async () => {
  const padded = (size) => {
    const head = JSON.stringify(MAP);
    return `${head}${' '.repeat(size - head.length - 1)}\n`;
  };
  await withServer(async (s) => {
    assert.equal(fs.statSync(sc(s.vault)).size, 1048577);
    assert.deepEqual(await posOf(s, 'Idea two'), own('Idea two'), 'ignored');
    assert.ok(s.logs().stderr.includes('.constellation-sky.json'), s.logs().stderr);
    assert.equal((await getSky(s)).status, 200);
  }, { setup: (v) => { write(v, 'Idea two', 'x'); fs.writeFileSync(sc(v), padded(1048577)); } });
  await withServer(async (s) => {
    assert.equal(fs.statSync(sc(s.vault)).size, 1048576);
    assert.deepEqual(await posOf(s, 'Idea two'), IDEAS, 'read');
    assert.equal(s.logs().stderr.includes('.constellation-sky.json'), false, s.logs().stderr);
  }, { setup: (v) => { write(v, 'Idea two', 'x'); fs.writeFileSync(sc(v), padded(1048576)); } });
});

test('an oversized sidecar counts as absent, so an empty vault still gets the sample notes and the file is replaced', () => withServer(async (s) => {
  assert.deepEqual(listVault(s.vault), SAMPLE_TITLES.map((t) => `${t}.md`).sort());
  assert.ok(s.logs().stderr.includes('.constellation-sky.json'));
  const fixed = readSidecarJson(s);
  assert.equal(fixed.samplesSeeded, true);
  assert.ok(fs.statSync(sc(s.vault)).size < 1000);
  assert.equal((await skyOf(s)).samples, 5);
}, { env: { CONSTELLATION_SAMPLES: undefined }, setup: (v) => fs.writeFileSync(sc(v), `{"version":1,"samplesSeeded":true,"seeds":{}}${' '.repeat(1048600)}`) }));

test('a symlinked sidecar is treated as absent and logged, its target is never read or written, and the next write replaces the link with a file', () => withServer(async (s) => {
  const target = path.join(s.base, 'elsewhere.json');
  const targetBefore = fs.readFileSync(target);
  assert.deepEqual(await posOf(s, 'Idea two'), own('Idea two'), 'the link is not followed');
  assert.ok(s.logs().stderr.includes('.constellation-sky.json'), s.logs().stderr);
  assert.equal((await renameNote(s, 'Idea two', 'Idea three')).status, 200);
  assert.equal(fs.lstatSync(sc(s.vault)).isSymbolicLink(), false, 'the link was replaced, not followed');
  assert.equal(fs.lstatSync(sc(s.vault)).isFile(), true);
  assert.deepEqual(readSidecarJson(s).seeds, { 'idea three': 'idea two' });
  assert.deepEqual(fs.readFileSync(target), targetBefore, 'the target outside the vault is untouched');
  assert.deepEqual(await posOf(s, 'Idea three'), own('Idea two'));
}, { setup: (v, sb) => {
  write(v, 'Idea two', 'x');
  fs.writeFileSync(path.join(sb.base, 'elsewhere.json'), JSON.stringify(MAP));
  fs.symlinkSync(path.join(sb.base, 'elsewhere.json'), sc(v));
} }));

test('a dangling or directory-pointing sidecar symlink is also ignored and never followed', async () => {
  for (const kind of ['dangling', 'dir']) {
    await withServer(async (s) => {
      assert.deepEqual(await posOf(s, 'Idea two'), own('Idea two'), kind);
      assert.equal((await renameNote(s, 'Idea two', 'Idea three')).status, 200, kind);
      assert.equal(fs.lstatSync(sc(s.vault)).isFile(), true, kind);
      assert.deepEqual(fs.readdirSync(path.join(s.base, 'outside')), kind === 'dir' ? ['keep.txt'] : [], kind);
    }, { setup: (v, sb) => {
      write(v, 'Idea two', 'x');
      fs.mkdirSync(path.join(sb.base, 'outside'));
      if (kind === 'dir') fs.writeFileSync(path.join(sb.base, 'outside', 'keep.txt'), 'k');
      fs.symlinkSync(kind === 'dir' ? path.join(sb.base, 'outside') : path.join(sb.base, 'outside', 'nothing.json'), sc(v));
    } });
  }
});

test('a directory named .constellation-sky.json is treated as absent and never replaced: renames still succeed, the star falls back to its new key, the failure is logged', () => withServer(async (s) => {
  assert.equal(fs.lstatSync(sc(s.vault)).isDirectory(), true);
  assert.deepEqual(await posOf(s, 'Idea two'), own('Idea two'));
  const res = await renameNote(s, 'Idea two', 'Idea three');
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body.failed, []);
  assert.equal(fs.lstatSync(sc(s.vault)).isDirectory(), true, 'still a directory');
  assert.equal(fs.readFileSync(path.join(sc(s.vault), 'inner.txt'), 'utf8'), 'inner');
  assert.deepEqual(listVault(s.vault), ['Idea three.md']);
  assert.deepEqual(await posOf(s, 'Idea three'), own('Idea three'));
  assert.ok(s.logs().stderr.includes('.constellation-sky.json'), s.logs().stderr);
  assert.equal((await s.call('DELETE', enc('Idea three'))).status, 204, 'delete also succeeds');
  assert.equal(fs.lstatSync(sc(s.vault)).isDirectory(), true);
}, { setup: (v) => { write(v, 'Idea two', 'x'); fs.mkdirSync(sc(v)); fs.writeFileSync(path.join(sc(v), 'inner.txt'), 'inner'); } }));

test('seeding with a directory in the way of the sidecar is never fatal: the server starts, the samples exist, the failure is logged', () => withServer(async (s) => {
  assert.deepEqual(listVault(s.vault), SAMPLE_TITLES.map((t) => `${t}.md`).sort());
  assert.equal(fs.lstatSync(sc(s.vault)).isDirectory(), true);
  assert.ok(s.logs().stderr.includes('.constellation-sky.json'), s.logs().stderr);
  assert.equal((await skyOf(s)).samples, 5);
}, { env: { CONSTELLATION_SAMPLES: undefined }, setup: (v) => fs.mkdirSync(sc(v)) }));

test('a sidecar with version 2 is read-only: ignored for positions, never written, renames succeed and the star falls back to its new key', async () => {
  const content = '{"version":2,"samplesSeeded":false,"seeds":{"idea two":"ideas"},"future":{"a":[1,2,3]}}';
  await withServer(async (s) => {
    assert.deepEqual(await posOf(s, 'Idea two'), own('Idea two'), 'seeds of a newer version are not used');
    const before = stat(s.vault);
    const res = await renameNote(s, 'Idea two', 'Idea three');
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(sidecarBytes(s.vault).toString(), content, 'byte for byte unchanged');
    assert.equal(stat(s.vault), before);
    assert.deepEqual(await posOf(s, 'Idea three'), own('Idea three'));
    assert.equal((await s.call('DELETE', enc('Idea three'))).status, 204);
    assert.deepEqual(sidecarBytes(s.vault).toString(), content);
  }, { setup: (v) => { write(v, 'Idea two', 'x'); writeSidecar(v, content); } });
  await withServer(async (s) => {
    assert.deepEqual(listVault(s.vault), [], 'a newer sidecar counts as already seeded');
    assert.equal(sidecarBytes(s.vault).toString(), content);
  }, { env: { CONSTELLATION_SAMPLES: undefined }, setup: (v) => writeSidecar(v, content) });
});

// ---------------------------------------------------------------- outside changes
test('an external change of the sidecar (size or mtime) is picked up by the next GET /api/sky without a restart', () => withServer(async (s) => {
  const first = await getSky(s);
  assert.deepEqual(starMap(first.body).get('Idea two'), own('Idea two'));
  writeSidecar(s.vault, MAP);
  const second = await getSky(s);
  assert.deepEqual(starMap(second.body).get('Idea two'), IDEAS, 'new file picked up');
  assert.notEqual(second.headers.etag, first.headers.etag);
  // same size, new mtime and content
  const swapped = JSON.stringify(MAP).replace('"ideas"', '"orphn"');
  assert.equal(swapped.length, JSON.stringify(MAP).length);
  fs.writeFileSync(sc(s.vault), swapped);
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(sc(s.vault), future, future);
  const third = await getSky(s);
  assert.deepEqual(starMap(third.body).get('Idea two'), own('orphn'), 'same size, new mtime picked up');
  fs.unlinkSync(sc(s.vault));
  assert.deepEqual(starMap((await getSky(s)).body).get('Idea two'), own('Idea two'), 'removal picked up');
}, { setup: (v) => write(v, 'Idea two', 'x') }));

test('rewriting the sidecar with identical content leaves the sky body and ETag unchanged; a different mapping changes them', () => withServer(async (s) => {
  const a = await getSky(s);
  fs.writeFileSync(sc(s.vault), JSON.stringify(MAP));
  const b = await getSky(s);
  assert.notEqual(b.headers.etag, a.headers.etag);
  const future = new Date(Date.now() + 3000);
  fs.writeFileSync(sc(s.vault), JSON.stringify(MAP));
  fs.utimesSync(sc(s.vault), future, future);
  const c = await getSky(s);
  assert.deepEqual(c.buffer, b.buffer, 'same positions, same bytes');
  assert.equal(c.headers.etag, b.headers.etag);
}, { setup: (v) => write(v, 'Idea two', 'x') }));

test('an outside rename (mv in a terminal) does not update the sidecar: the star moves to its new key, and the stale entry is pruned at the next write', () => withServer(async (s) => {
  assert.deepEqual(await posOf(s, 'Idea two'), IDEAS);
  const before = sidecarBytes(s.vault);
  fs.renameSync(s.file('Idea two.md'), s.file('Idea three.md'));
  assert.deepEqual(await posOf(s, 'Idea three'), own('Idea three'));
  assert.deepEqual(sidecarBytes(s.vault), before, 'untouched by the outside rename');
  assert.equal((await renameNote(s, 'Other', 'Other renamed')).status, 200);
  assert.deepEqual(readSidecarJson(s).seeds, { 'other renamed': 'other' }, 'the stale idea two entry is gone');
}, { setup: (v) => { write(v, 'Idea two', 'x'); write(v, 'Other', 'y'); writeSidecar(v, MAP); } }));

test('an outside edit that removes the sidecar between renames is tolerated: the next rename writes a fresh one', () => withServer(async (s) => {
  assert.equal((await renameNote(s, 'Idea two', 'Idea three')).status, 200);
  fs.unlinkSync(sc(s.vault));
  assert.equal((await renameNote(s, 'Other', 'Another')).status, 200);
  assert.deepEqual(readSidecarJson(s), { version: 1, samplesSeeded: false, seeds: { another: 'other' } });
  assert.deepEqual(await posOf(s, 'Idea three'), own('Idea three'));
  assert.deepEqual(await posOf(s, 'Another'), own('Other'));
}, { setup: (v) => { write(v, 'Idea two', 'x'); write(v, 'Other', 'y'); writeSidecar(v, MAP); } }));

test('the position of a note whose seed was carried survives a server restart', async () => {
  const sb = sandbox();
  try {
    let pos;
    await withServer(async (s) => {
      await mk(s, 'Ideas', 'x'); await mk(s, 'Linker', 'to [[Ideas]]');
      pos = starMap(await skyOf(s));
      assert.equal((await renameNote(s, 'Ideas', 'Project ideas')).status, 200);
    }, { sandbox: sb });
    await withServer(async (s) => {
      const after = starMap(await skyOf(s));
      assert.deepEqual(after.get('Project ideas'), pos.get('Ideas'));
      assert.deepEqual(after.get('Linker'), pos.get('Linker'));
    }, { sandbox: sb });
  } finally { sb.cleanup(); }
});
