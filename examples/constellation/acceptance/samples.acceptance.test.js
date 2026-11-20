// First-boot sample notes (SC1) and DELETE /api/samples. Acceptance tests are read-only for builders.
// Seeding is on only when a test passes env: { CONSTELLATION_SAMPLES: undefined } (or any value other than "off").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  withServer, sandbox, mk, putNote, getNote, renameNote, enc, sleep, listVault, snapshot, getSky, skyOf, starMap, sha32,
  SAMPLES, SAMPLE_TITLES, sampleBytes, writeSamples, SIDECAR_NAME, sidecarBytes, readSidecarJson, retryOnRollover, DAY,
} from './helpers.js';

const SEED = { CONSTELLATION_SAMPLES: undefined };
const ON = { env: SEED };
const sc = (v) => path.join(v, SIDECAR_NAME);
const FILES = SAMPLES.map((x) => `${x.title}.md`).sort();
const err = (res, status, code) => { assert.equal(res.status, status, res.text); assert.equal(res.body.error.code, code); };
const remove = (s, headers) => s.call('DELETE', '/api/samples', undefined, headers ? { headers } : undefined);
const SAMPLE_SIDECAR = '{"version":1,"samplesSeeded":true,"seeds":{}}\n';

// ---------------------------------------------------------------- the shipped bytes
test('the sample table in the spec is transcribed exactly: byte counts and revisions', () => {
  assert.deepEqual(SAMPLES.map((x) => Buffer.byteLength(x.body)), SAMPLES.map((x) => x.bytes));
  assert.deepEqual(SAMPLES.map((x) => sha32(Buffer.from(x.body))), SAMPLES.map((x) => x.revision));
  assert.deepEqual(SAMPLE_TITLES, ['Start here', 'How the sky works', 'Writing a note', 'Links and unlit stars', 'Your vault']);
  for (const x of SAMPLES) assert.ok(x.body.startsWith('---\nsample: true\n---\n\n') && x.body.endsWith('\n') && !x.body.includes('\r'), x.title);
});

test('SC1 an empty vault with seeding on has exactly the five sample files, byte for byte, before the ready line is answered', () => withServer(async (s) => {
  assert.deepEqual(listVault(s.vault), FILES);
  for (const x of SAMPLES) {
    const bytes = fs.readFileSync(s.file(`${x.title}.md`));
    assert.equal(bytes.length, x.bytes, x.title);
    assert.deepEqual(bytes, Buffer.from(x.body, 'utf8'), x.title);
    assert.equal(sha32(bytes), x.revision);
    assert.equal(bytes.toString('utf8').startsWith('---\nsample: true\n---'), true);
  }
  const list = await s.call('GET', '/api/notes');
  assert.equal(list.body.notes.length, 5);
  assert.deepEqual(list.body.notes.map((n) => n.title).sort(), [...SAMPLE_TITLES].sort());
  assert.deepEqual(list.body.notes.map((n) => n.size).sort((a, b) => a - b), SAMPLES.map((x) => x.bytes).sort((a, b) => a - b));
  const lines = s.logs().stdout.split('\n').filter((l) => l !== '');
  assert.equal(lines.length, 1, 'still exactly one stdout line');
  assert.match(lines[0], /^Constellation running at http:\/\/localhost:\d+$/);
  assert.deepEqual(fs.readdirSync(s.vault).filter((n) => n.endsWith('.tmp')), []);
}, ON));

test('SC1 the sidecar of a seeded vault says samplesSeeded true, written after the five files', () => withServer(async (s) => {
  assert.equal(sidecarBytes(s.vault).toString(), SAMPLE_SIDECAR);
  assert.equal(fs.statSync(sc(s.vault)).mode & 0o777, 0o644);
  for (const x of SAMPLES) assert.equal(fs.statSync(s.file(`${x.title}.md`)).mode & 0o777, 0o644, x.title);
}, ON));

test('SC1 the sample sky is exact: five stars, six edges, one constellation Start here, backlinks and brightness as specified', () => retryOnRollover(() => withServer(async (s) => {
  const res = await getSky(s);
  const sky = res.body;
  assert.deepEqual(sky.stars.title, ['How the sky works', 'Links and unlit stars', 'Start here', 'Writing a note', 'Your vault']);
  assert.deepEqual(sky.stars.backlinks, [1, 2, 4, 1, 2]);
  assert.deepEqual(sky.edges, [0, 1, 0, 2, 1, 2, 2, 3, 2, 4, 3, 4]);
  assert.equal(sky.edges.length / 2, 6);
  assert.deepEqual(sky.stars.constellation, [0, 0, 0, 0, 0]);
  assert.deepEqual(sky.constellations, [{ id: 0, name: 'Start here', star: 2, count: 5 }]);
  assert.deepEqual(sky.unlit, { title: [], x: [], y: [], linkedFrom: [] });
  assert.equal(sky.unlitTotal, 0);
  assert.equal(sky.samples, 5);
  assert.equal(sky.version, 1);
  if (sky.now > Math.min(...sky.stars.mtime)) { const e = new Error('rolled'); e.rollover = true; throw e; }
  assert.deepEqual(sky.stars.b, [0.698, 0.755, 0.827, 0.698, 0.755]);
  for (const k of ['x', 'y']) assert.ok(sky.stars[k].every((v) => Number.isFinite(v) && Math.round(v * 100) / 100 === v));
  assert.deepEqual((await s.call('GET', '/api/unlit')).body, { unlit: [] });
}, ON)));

test('SC1 the sample sky is the first request answered from the warm cache and identical on a second, fresh vault (positions depend only on bytes)', async () => {
  const maps = [];
  for (let i = 0; i < 2; i++) {
    await withServer(async (s) => {
      const a = await getSky(s);
      const b = await getSky(s);
      if (a.body.now === b.body.now) assert.equal(a.headers.etag, b.headers.etag);
      maps.push(starMap(a.body));
    }, ON);
  }
  assert.equal(maps[0].size, 5);
  for (const [t, xy] of maps[0]) assert.deepEqual(maps[1].get(t), xy, t);
  const xs = [...maps[0].values()];
  const minPair = Math.min(...xs.flatMap((a, i) => xs.slice(i + 1).map((b) => Math.hypot(a[0] - b[0], a[1] - b[1]))));
  assert.ok(minPair >= 12, `stars are at least 12 apart (${minPair.toFixed(2)})`);
});

test('SC1 non-notes do not stop seeding: notes.txt, subfolders, dotfiles and .MD files are untouched and the samples still appear', () => withServer(async (s) => {
  assert.deepEqual(listVault(s.vault), [...FILES, 'X.MD', 'notes.txt', 'sub'].sort());
  assert.equal(fs.readFileSync(s.file('notes.txt'), 'utf8'), 'plain text');
  assert.equal(fs.readFileSync(path.join(s.vault, 'sub', 'Inner.md'), 'utf8'), 'inner');
  assert.equal(fs.readFileSync(s.file('.hidden.md'), 'utf8'), 'hidden');
  assert.equal((await skyOf(s)).samples, 5);
}, { ...ON, setup: (v) => {
  fs.writeFileSync(path.join(v, 'notes.txt'), 'plain text');
  fs.writeFileSync(path.join(v, 'X.MD'), 'upper');
  fs.writeFileSync(path.join(v, '.hidden.md'), 'hidden');
  fs.mkdirSync(path.join(v, 'sub'));
  fs.writeFileSync(path.join(v, 'sub', 'Inner.md'), 'inner');
} }));

test('SC1 a vault with any note is not seeded, and the sidecar is not written', () => withServer(async (s) => {
  assert.deepEqual(listVault(s.vault), ['Mine.md']);
  assert.equal(sidecarBytes(s.vault), null);
  const sky = await skyOf(s);
  assert.deepEqual(sky.stars.title, ['Mine']);
  assert.equal(sky.samples, 0);
  assert.equal(s.read('Mine.md').toString(), 'my own note');
}, { ...ON, setup: (v) => fs.writeFileSync(path.join(v, 'Mine.md'), 'my own note') }));

test('CONSTELLATION_SAMPLES=off (trimmed, any case) writes no sample file and no sidecar; every other value leaves seeding on', async () => {
  for (const value of ['off', 'OFF', 'Off', ' off ', '\toff\t']) {
    await withServer(async (s) => {
      assert.deepEqual(listVault(s.vault), [], JSON.stringify(value));
      assert.equal(sidecarBytes(s.vault), null, JSON.stringify(value));
      assert.equal((await skyOf(s)).samples, 0);
    }, { env: { CONSTELLATION_SAMPLES: value } });
  }
  for (const value of ['on', '0', '', 'false', 'no', 'offf', 'of', '1']) {
    await withServer(async (s) => {
      assert.deepEqual(listVault(s.vault), FILES, JSON.stringify(value));
      assert.equal((await skyOf(s)).samples, 5);
    }, { env: { CONSTELLATION_SAMPLES: value } });
  }
});

test('seeding conditions on the sidecar: samplesSeeded true or an unreadable file means nothing is written; false or absent seeds and keeps unknown keys', async () => {
  for (const content of ['{"version":1,"samplesSeeded":true,"seeds":{}}', '{"version":1,"samplesSeeded":true}', '{broken']) {
    await withServer(async (s) => {
      assert.deepEqual(listVault(s.vault), [], content);
      assert.equal(sidecarBytes(s.vault).toString(), content, 'not rewritten');
      assert.equal((await skyOf(s)).samples, 0);
    }, { ...ON, setup: (v) => fs.writeFileSync(sc(v), content) });
  }
  await withServer(async (s) => {
    assert.deepEqual(listVault(s.vault), FILES);
    assert.equal(sidecarBytes(s.vault).toString(), '{"version":1,"samplesSeeded":true,"seeds":{},"keep":"me"}\n');
  }, { ...ON, setup: (v) => fs.writeFileSync(sc(v), '{"version":1,"samplesSeeded":false,"seeds":{},"keep":"me"}') });
  await withServer(async (s) => {
    assert.deepEqual(listVault(s.vault), FILES);
    assert.equal(readSidecarJson(s).samplesSeeded, true);
  }, { ...ON, setup: (v) => fs.writeFileSync(sc(v), '{"version":1}') });
});

test('SC1 seeding never overwrites: it only runs on an empty vault, and a restart of a seeded vault rewrites nothing', async () => {
  const sb = sandbox();
  try {
    let stamps;
    await withServer(async (s) => {
      assert.deepEqual(listVault(s.vault), FILES);
      stamps = Object.fromEntries(FILES.map((f) => [f, fs.statSync(s.file(f)).mtimeMs]));
    }, { ...ON, sandbox: sb });
    await sleep(30);
    await withServer(async (s) => {
      assert.deepEqual(listVault(s.vault), FILES);
      for (const f of FILES) assert.equal(fs.statSync(s.file(f)).mtimeMs, stamps[f], f);
      assert.equal(sidecarBytes(s.vault).toString(), SAMPLE_SIDECAR);
    }, { ...ON, sandbox: sb });
  } finally { sb.cleanup(); }
});

// ---------------------------------------------------------------- DELETE /api/samples
test('SC1 DELETE /api/samples removes all five unedited samples, listed in the fixed order, and the vault is empty again', () => withServer(async (s) => {
  const res = await remove(s);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(res.body, { removed: ['Start here', 'How the sky works', 'Writing a note', 'Links and unlit stars', 'Your vault'], kept: [] });
  assert.deepEqual(Object.keys(res.body), ['removed', 'kept']);
  assert.deepEqual(listVault(s.vault), []);
  const sky = await skyOf(s);
  assert.deepEqual(sky.stars.title, []);
  assert.equal(sky.samples, 0);
  assert.equal(sidecarBytes(s.vault).toString(), SAMPLE_SIDECAR, 'the marker stays so the samples never come back');
  assert.deepEqual((await remove(s)).body, { removed: [], kept: [] }, 'a second call finds nothing and is still 200');
}, ON));

test('SC1 an edited sample is kept: it stops counting, DELETE removes the other four, and reports it in kept', () => withServer(async (s) => {
  const start = await getNote(s, 'Start here');
  const edited = `${start.body.content}Added by me.\n`;
  assert.equal((await putNote(s, 'Start here', edited, start.body.revision)).status, 200);
  assert.equal((await skyOf(s)).samples, 4);
  const res = await remove(s);
  assert.deepEqual(res.body, { removed: ['How the sky works', 'Writing a note', 'Links and unlit stars', 'Your vault'], kept: ['Start here'] });
  assert.deepEqual(listVault(s.vault), ['Start here.md']);
  assert.equal(s.read('Start here.md').toString(), edited);
  const sky = await skyOf(s);
  assert.equal(sky.samples, 0);
  assert.deepEqual(sky.stars.title, ['Start here']);
  assert.deepEqual(sky.unlit.title.sort(), ['How the sky works', 'Links and unlit stars', 'Writing a note', 'Your vault'], 'the kept note still links to the removed ones');
  assert.deepEqual((await remove(s)).body, { removed: [], kept: ['Start here'] }, 'still kept on a second call');
}, ON));

test('SC1 any change of the bytes makes a sample an ordinary note: outside edits stop it counting; DELETE keeps it only while it still starts with the sample marker', async () => {
  const edits = [
    ['a trailing space', (x) => Buffer.concat([x, Buffer.from(' ')]), true],
    ['CRLF line ends', (x) => Buffer.from(x.toString().replace(/\n/g, '\r\n')), false],
    ['a BOM', (x) => Buffer.concat([Buffer.from('\uFEFF'), x]), false],
    ['sample: yes', (x) => Buffer.from(x.toString().replace('sample: true', 'sample: yes')), false],
    ['no final newline', (x) => x.subarray(0, x.length - 1), true],
  ];
  for (const [label, edit, startsWithMarker] of edits) {
    await withServer(async (s) => {
      const file = s.file('Your vault.md');
      const bytes = edit(fs.readFileSync(file));
      fs.writeFileSync(file, bytes);
      const sky = await skyOf(s);
      assert.equal(sky.samples, 4, label);
      const res = await remove(s);
      assert.deepEqual(res.body.removed, ['Start here', 'How the sky works', 'Writing a note', 'Links and unlit stars'], label);
      assert.deepEqual(res.body.kept, startsWithMarker ? ['Your vault'] : [], label);
      assert.deepEqual(listVault(s.vault), ['Your vault.md'], `${label}: the edited file stays`);
      assert.deepEqual(fs.readFileSync(file), bytes, label);
    }, ON);
  }
});

test('SC1 an edited sample that is edited back to the exact bytes is a sample again', () => withServer(async (s) => {
  const note = await getNote(s, 'Your vault');
  const original = note.body.content;
  const changed = await putNote(s, 'Your vault', `${original}x`, note.body.revision);
  assert.equal((await skyOf(s)).samples, 4);
  const back = await putNote(s, 'Your vault', original, changed.body.revision);
  assert.equal(back.body.revision, SAMPLES[4].revision);
  assert.equal((await skyOf(s)).samples, 5);
  assert.equal((await putNote(s, 'Your vault', original, back.body.revision)).status, 200, 'a no-change save keeps the exact bytes');
  assert.equal((await skyOf(s)).samples, 5);
  assert.equal((await remove(s)).body.removed.length, 5);
}, ON));

test('SC1 only exact-bytes samples are removed: a user note called Start here without the marker is untouched and unlisted, a marked non-sample note is never touched', () => withServer(async (s) => {
  const res = await remove(s);
  assert.deepEqual(res.body, { removed: [], kept: [] });
  assert.deepEqual(listVault(s.vault), ['Other.md', 'Start here.md']);
  assert.equal(s.read('Start here.md').toString(), 'My own start page.\n');
  assert.equal(s.read('Other.md').toString(), '---\nsample: true\n---\nnot a shipped title\n');
}, { setup: (v) => {
  fs.writeFileSync(path.join(v, 'Start here.md'), 'My own start page.\n');
  fs.writeFileSync(path.join(v, 'Other.md'), '---\nsample: true\n---\nnot a shipped title\n');
} }));

test('SC1 a user note with the front-matter marker but other text under a sample title is kept, never deleted', () => withServer(async (s) => {
  const res = await remove(s);
  assert.deepEqual(res.body, { removed: ['Writing a note'], kept: ['Start here'] });
  assert.deepEqual(listVault(s.vault), ['Start here.md']);
  assert.equal(s.read('Start here.md').toString(), '---\nsample: true\n---\nMy words, hand written.\n');
  assert.equal((await skyOf(s)).samples, 0);
}, { setup: (v) => {
  fs.writeFileSync(path.join(v, 'Start here.md'), '---\nsample: true\n---\nMy words, hand written.\n');
  writeSamples(v, ['Writing a note']);
} }));

test('SC1 samples are found by titleKey: a file named in another case with the exact bytes is removed and listed by its stored title', () => withServer(async (s) => {
  assert.equal((await skyOf(s)).samples, 1);
  const res = await remove(s);
  assert.deepEqual(res.body, { removed: ['your VAULT'], kept: [] });
  assert.deepEqual(listVault(s.vault), []);
}, { setup: (v) => fs.writeFileSync(path.join(v, 'your VAULT.md'), sampleBytes('Your vault')) }));

test('SC1 a sample under a non-sample title, a symlinked sample and a folder called Start here.md are never removed', () => withServer(async (s) => {
  const res = await remove(s);
  assert.deepEqual(res.body, { removed: [], kept: [] });
  assert.equal(s.read('Copy.md').toString(), sampleBytes('Your vault').toString());
  assert.equal(fs.lstatSync(s.file('Start here.md')).isSymbolicLink(), true);
  assert.equal(fs.statSync(s.file('Writing a note.md')).isDirectory(), true);
  assert.equal(fs.readFileSync(path.join(s.base, 'real-start.md'), 'utf8'), sampleBytes('Start here').toString());
  assert.equal(fs.readFileSync(path.join(s.vault, 'Writing a note.md', 'inner.md'), 'utf8'), 'x');
}, { setup: (v, sb) => {
  fs.writeFileSync(path.join(v, 'Copy.md'), sampleBytes('Your vault'));
  fs.writeFileSync(path.join(sb.base, 'real-start.md'), sampleBytes('Start here'));
  fs.symlinkSync(path.join(sb.base, 'real-start.md'), path.join(v, 'Start here.md'));
  fs.mkdirSync(path.join(v, 'Writing a note.md'));
  fs.writeFileSync(path.join(v, 'Writing a note.md', 'inner.md'), 'x');
} }));

test('DELETE /api/samples with nothing to remove is 200 with empty lists, also with seeding off, and needs no body or content type', () => withServer(async (s) => {
  for (const headers of [undefined, { 'content-type': 'text/plain' }, { 'content-type': 'application/json' }]) {
    const res = await remove(s, headers);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { removed: [], kept: [] });
  }
  const withBody = await s.call('DELETE', '/api/samples', undefined, { raw: '{"ignored":true}', headers: { 'content-type': 'application/json' } });
  assert.equal(withBody.status, 200);
  assert.deepEqual(listVault(s.vault), []);
}));

test('DELETE /api/samples applies the mutation checks: bad Origin and cross-site are 403 bad_origin and remove nothing; a bad Host is 403 bad_host', () => withServer(async (s) => {
  const before = snapshot(s.vault);
  for (const h of [{ origin: 'http://evil.example' }, { origin: 'null' }, { origin: `http://127.0.0.1:${s.port}` }, { 'sec-fetch-site': 'cross-site' }]) {
    const res = await remove(s, h);
    err(res, 403, 'bad_origin');
    assert.equal(res.body.error.message, 'This request did not come from the Constellation page.');
    assert.deepEqual(snapshot(s.vault), before);
  }
  err(await remove(s, { host: 'evil.example' }), 403, 'bad_host');
  err(await s.call('GET', '/api/samples'), 405, 'method_not_allowed');
  assert.equal((await s.call('POST', '/api/samples', {})).headers.allow, 'DELETE');
  err(await s.call('DELETE', '/api/samples/x'), 404, 'not_found');
  assert.deepEqual(snapshot(s.vault), before);
  const ok = await remove(s, { origin: `http://localhost:${s.port}`, 'sec-fetch-site': 'same-origin' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.removed.length, 5);
}, ON));

test('SC1 the samples are removed by one call and other notes are left alone, including ones that link to them', () => withServer(async (s) => {
  await mk(s, 'Mine', 'See [[Start here]] and [[Your vault]].');
  const before = s.read('Mine.md');
  const res = await remove(s);
  assert.equal(res.body.removed.length, 5);
  assert.deepEqual(s.read('Mine.md'), before, 'no link rewriting');
  assert.deepEqual(listVault(s.vault), ['Mine.md']);
  const sky = await skyOf(s);
  assert.deepEqual(sky.unlit.title, ['Start here', 'Your vault']);
  assert.equal(sky.samples, 0);
}, ON));

test('SC1 removing a sample also drops its sidecar seed entry', () => withServer(async (s) => {
  assert.deepEqual((await remove(s)).body.removed.length, 5);
  assert.equal((await mk(s, 'Draft', sampleBytes('Start here').toString())).title, 'Draft');
  assert.equal((await renameNote(s, 'Draft', 'Start here')).status, 200);
  assert.deepEqual(readSidecarJson(s).seeds, { 'start here': 'draft' });
  assert.equal((await skyOf(s)).samples, 1, 'a note with the exact bytes under the sample title is a sample');
  const res = await remove(s);
  assert.deepEqual(res.body, { removed: ['Start here'], kept: [] });
  assert.deepEqual(readSidecarJson(s), { version: 1, samplesSeeded: true, seeds: {} });
}, ON));

// ---------------------------------------------------------------- restart behaviour
test('SC1 removal then restart does not reseed; deleting the whole vault folder (sidecar included) reseeds', async () => {
  const sb = sandbox();
  try {
    await withServer(async (s) => { assert.equal((await remove(s)).body.removed.length, 5); }, { ...ON, sandbox: sb });
    await withServer(async (s) => {
      assert.deepEqual(listVault(s.vault), [], 'no reseed');
      assert.equal((await skyOf(s)).samples, 0);
      assert.equal(sidecarBytes(s.vault).toString(), SAMPLE_SIDECAR);
    }, { ...ON, sandbox: sb });
    fs.rmSync(sb.vault, { recursive: true, force: true });
    await withServer(async (s) => {
      assert.deepEqual(listVault(s.vault), FILES, 'a new vault folder gets the samples again');
      assert.equal((await skyOf(s)).samples, 5);
    }, { ...ON, sandbox: sb, create: false });
  } finally { sb.cleanup(); }
});

test('SC1 deleting only the samples and the notes by hand, but keeping the sidecar, does not reseed; deleting just the sidecar of an empty vault does', async () => {
  const sb = sandbox();
  try {
    await withServer(async () => {}, { ...ON, sandbox: sb });
    for (const f of FILES) fs.unlinkSync(path.join(sb.vault, f));
    await withServer(async (s) => { assert.deepEqual(listVault(s.vault), []); }, { ...ON, sandbox: sb });
    fs.unlinkSync(sc(sb.vault));
    await withServer(async (s) => { assert.deepEqual(listVault(s.vault), FILES); }, { ...ON, sandbox: sb });
  } finally { sb.cleanup(); }
});

test('SC1 a vault that had notes at its first boot (not seeded, no sidecar) and is later emptied does reseed on the next restart', async () => {
  const sb = sandbox();
  try {
    await withServer(async (s) => {
      assert.deepEqual(listVault(s.vault), ['Mine.md']);
      assert.equal(sidecarBytes(s.vault), null);
      assert.equal((await s.call('DELETE', enc('Mine'))).status, 204);
    }, { ...ON, sandbox: sb, setup: (v) => fs.writeFileSync(path.join(v, 'Mine.md'), 'mine') });
    await withServer(async (s) => {
      assert.deepEqual(listVault(s.vault), FILES);
      assert.equal((await skyOf(s)).samples, 5);
    }, { ...ON, sandbox: sb });
  } finally { sb.cleanup(); }
});

// ---------------------------------------------------------------- front-matter (server-visible parts)
test('the server never parses front-matter: it is part of the note content, and the file name alone decides the title', () => withServer(async (s) => {
  const got = await getNote(s, 'Start here');
  assert.equal(got.body.content, SAMPLES[0].body);
  assert.equal(got.body.title, 'Start here');
  await mk(s, 'Fancy', '---\ntitle: Other name\ntags: [a, b]\n---\nbody text\n');
  const fm = await getNote(s, 'Fancy');
  assert.equal(fm.body.title, 'Fancy');
  assert.equal(fm.body.content, '---\ntitle: Other name\ntags: [a, b]\n---\nbody text\n');
  const titles = (await s.call('GET', '/api/notes')).body.notes.map((n) => n.title);
  assert.ok(titles.includes('Fancy') && !titles.includes('Other name'));
  const search = await s.call('GET', '/api/search?q=sample');
  assert.ok(search.body.results.some((r) => r.title === 'Start here'), 'front-matter text is searchable like any other text');
}, ON));

test('wikilinks inside front-matter still count: they make backlinks, edges and unlit stars', () => withServer(async (s) => {
  const sky = await skyOf(s);
  assert.deepEqual(sky.stars.title, ['Target', 'With front matter']);
  assert.deepEqual(sky.stars.backlinks, [1, 0]);
  assert.deepEqual(sky.unlit.title, ['Hidden ghost']);
  assert.deepEqual(sky.edges, [0, 1, 1, 2]);
  const back = await s.call('GET', '/api/notes/Target/backlinks');
  assert.deepEqual(back.body.backlinks.map((b) => b.title), ['With front matter']);
  assert.equal(back.body.backlinks[0].snippet, 'related: [[Target]]');
}, { setup: (v) => {
  fs.writeFileSync(path.join(v, 'With front matter.md'), '---\nrelated: [[Target]]\nalso: [[Hidden ghost]]\n---\nbody\n');
  fs.writeFileSync(path.join(v, 'Target.md'), 'x');
} }));

test('the age of a sample follows its mtime like any note: a sample older than 90 days has b 0.3 plus its link share', () => retryOnRollover(() => withServer(async (s) => {
  const first = await skyOf(s);
  const t = new Date(first.now - 120 * DAY);
  fs.utimesSync(s.file('Your vault.md'), t, t);
  const sky = await skyOf(s);
  if (sky.now !== first.now) { const e = new Error('rolled'); e.rollover = true; throw e; }
  const i = sky.stars.title.indexOf('Your vault');
  assert.equal(sky.stars.b[i], 0.3, '2 backlinks give 0.4*B = 0.155, below the 0.30 floor');
  assert.equal(sky.stars.mtime[i], first.now - 120 * DAY);
  assert.equal(sky.samples, 5, 'a touched file with the same bytes is still a sample');
}, ON)));
