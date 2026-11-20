// Hidden grading tests for Constellation. Rules from spec.md that are easy to miss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Resolved from the working directory so the gate grades the trial's own acceptance/helpers.js and code,
// also when this folder is hidden somewhere else (HARNESS_HIDDEN_DIR).
const here = (...p) => path.join(process.cwd(), ...p);
const H = await import(pathToFileURL(here('acceptance', 'helpers.js')).href);
const {
  withServer, runToExit, sandbox, mk, getNote, putNote, renameNote, enc, listVault, sha32, getSky, skyOf, starMap, unlitMap,
  hashPoint2, titleKeyOf, genVault, writeNotes, wipeNotes, brightnessRef, round3, SIDECAR_NAME, LOCK_NAME, DAY, SAMPLES, SAMPLE_TITLES,
  sampleBytes, sidecarBytes, readSidecarJson, cmp, retryOnRollover, rolloverGuard,
} = H;

const write = (v, name, content) => fs.writeFileSync(path.join(v, `${name}.md`), content);
const code = (res, status, c) => {
  assert.equal(res.status, status, res.text);
  assert.equal(res.body.error.code, c, res.text);
};
const sc = (v) => path.join(v, SIDECAR_NAME);
const own = (t) => hashPoint2(titleKeyOf(t));
const ON = { env: { CONSTELLATION_SAMPLES: undefined } };

test('stars are sorted by titleKey in code-unit order: underscore before letters, tilde after z, surrogate pairs last, stored casing kept', () => withServer(async (s) => {
  const sky = await skyOf(s);
  const titles = ['Zebra', 'apple', 'Mango', '_under', '~tilde', '\u{1F600} smile', 'Apple pie', 'apple-2', '2nd', 'Zoo'];
  const want = [...titles].sort((a, b) => cmp(titleKeyOf(a), titleKeyOf(b)));
  assert.deepEqual(sky.stars.title, want);
  assert.equal(sky.stars.title[0], '2nd');
  assert.equal(sky.stars.title.at(-1), '\u{1F600} smile');
}, { setup: (v) => { for (const t of ['Zebra', 'apple', 'Mango', '_under', '~tilde', '\u{1F600} smile', 'Apple pie', 'apple-2', '2nd', 'Zoo']) write(v, t, 'x'); } }));

test('unlit stars: linkedFrom is a count of distinct notes, existing and invalid targets are never unlit, code links are ignored, unlitTotal matches /api/unlit', () => withServer(async (s) => {
  const sky = await skyOf(s);
  assert.deepEqual(sky.unlit.title, ['Alpha', 'beta two']);
  assert.deepEqual(sky.unlit.linkedFrom, [3, 1]);
  assert.equal(sky.unlitTotal, 2);
  const list = (await s.call('GET', '/api/unlit')).body.unlit;
  assert.equal(list.length, sky.unlitTotal);
  assert.deepEqual(list.map((u) => u.linkedFrom.length), sky.unlit.linkedFrom);
  assert.deepEqual(list[0].linkedFrom, ['a', 'B', 'c']);
  assert.deepEqual(list[0], { title: 'Alpha', linkedFrom: ['a', 'B', 'c'] });
}, { setup: (v) => {
  write(v, 'a', '[[Alpha]] [[alpha]] [[ALPHA]] [[../bad]] [[x/y]]');
  write(v, 'B', '[[ALPHA|label]] `[[Hidden]]` [[beta two]] [[Existing]]');
  write(v, 'c', '[[alpha]]\n```\n[[Fenced]]\n```');
  write(v, 'Existing', 'x');
} }));

test('edge pairs: a < b, sorted by (a, b), mutual links once, unlit indexes start after the last star and shift with it', () => withServer(async (s) => {
  const sky = await skyOf(s);
  assert.deepEqual(sky.stars.title, ['A', 'B', 'C', 'D']);
  assert.deepEqual(sky.unlit.title, ['Ghost']);
  assert.deepEqual(sky.edges, [0, 1, 0, 3, 1, 2, 1, 4, 2, 3]);
  fs.writeFileSync(s.file('AA.md'), '[[Ghost]]');
  const after = await skyOf(s);
  assert.deepEqual(after.stars.title, ['A', 'AA', 'B', 'C', 'D']);
  assert.deepEqual(after.edges, [0, 2, 0, 4, 1, 5, 2, 3, 2, 5, 3, 4]);
}, { setup: (v) => {
  write(v, 'A', '[[B]] [[D]] [[A]]'); write(v, 'B', '[[A]] [[C]] [[Ghost]]'); write(v, 'C', '[[D]]'); write(v, 'D', 'x');
} }));

test('If-None-Match: only the exact ETag gives 304; weak, listed and star forms are 200; /api/unlit and note routes never answer 304', () => retryOnRollover(() => withServer(async (s) => {
  const res = await getSky(s);
  const etag = res.headers.etag;
  assert.equal(etag, `"${sha32(res.buffer)}"`);
  const hit = await s.call('GET', '/api/sky', undefined, { headers: { 'if-none-match': etag } });
  if (hit.status === 200) rolloverGuard(res.body, hit.body);
  assert.equal(hit.status, 304);
  assert.equal(hit.text, '');
  assert.equal(hit.headers['content-type'], undefined);
  assert.equal(hit.headers['cache-control'], 'no-store');
  for (const v of [`W/${etag}`, `${etag}, "other"`, '*', etag.replace(/"/g, ''), 'W/*']) {
    const r = await s.call('GET', '/api/sky', undefined, { headers: { 'if-none-match': v } });
    assert.equal(r.status, 200, v);
  }
  assert.equal((await s.call('GET', '/api/unlit', undefined, { headers: { 'if-none-match': etag } })).status, 200);
  assert.equal((await s.call('GET', '/api/notes', undefined, { headers: { 'if-none-match': '*' } })).status, 200);
  await mk(s, 'More');
  const changed = await s.call('GET', '/api/sky', undefined, { headers: { 'if-none-match': etag } });
  if (changed.status === 304) assert.fail('a stale ETag must not give 304');
}, { setup: (v) => { write(v, 'One', '[[Two]]'); write(v, 'Two', 'x'); } })));

test('Host is compared exactly: other case, a trailing dot, a wrong port or a missing port are 403 (JSON on /api, the HTML page elsewhere)', () => withServer(async (s) => {
  for (const host of [`LOCALHOST:${s.port}`, `localhost.:${s.port}`, `127.0.0.1:${s.port + 1}`, '127.0.0.1', `[::1]`, `127.000.000.001:${s.port}`, ` localhost:${s.port}x`]) {
    const api = await s.call('GET', '/api/sky', undefined, { headers: { host } });
    code(api, 403, 'bad_host');
    const page = await s.call('GET', '/', undefined, { headers: { host } });
    assert.equal(page.status, 403, host);
    assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
    assert.ok(page.text.includes('data-testid="forbidden-page"'));
    assert.ok(!page.text.includes(host.trim()) || host.trim() === '', `the page must not echo ${host}`);
  }
  const apiRoot = await s.call('GET', '/api', undefined, { headers: { host: 'evil.example' } });
  code(apiRoot, 403, 'bad_host');
  assert.equal((await s.call('GET', '/api', undefined)).status, 404);
}));

test('a live .wiki.lock refuses to start, a stale one is ignored and never touched, and Constellation never creates .wiki.lock', async () => {
  const live = sandbox();
  try {
    fs.writeFileSync(path.join(live.vault, '.wiki.lock'), String(process.pid));
    const r = await runToExit({ sandbox: live });
    assert.equal(r.code, 1);
    assert.ok(r.output.includes(`A wiki server is using ${fs.realpathSync(live.vault)}`), r.output);
    assert.equal(fs.readFileSync(path.join(live.vault, '.wiki.lock'), 'utf8'), String(process.pid));
  } finally { live.cleanup(); }
  const stale = sandbox();
  try {
    fs.writeFileSync(path.join(stale.vault, '.wiki.lock'), '2147483000');
    await withServer(async (s) => { assert.equal((await s.call('GET', '/api/notes')).status, 200); }, { sandbox: stale });
    assert.equal(fs.readFileSync(path.join(stale.vault, '.wiki.lock'), 'utf8'), '2147483000');
  } finally { stale.cleanup(); }
  await withServer(async (s) => {
    assert.equal(fs.existsSync(s.file('.wiki.lock')), false);
    assert.equal(fs.readFileSync(s.file(LOCK_NAME), 'utf8').trim(), String(s.child.pid));
  });
});

test('boot deletes only stale .constellation-<pid>-<8hex>.tmp files: .wiki tmp files and near misses stay', () => withServer(async (s) => {
  assert.equal(fs.existsSync(s.file('.constellation-42-0123abcd.tmp')), false);
  for (const keep of ['.wiki-42-0123abcd.tmp', '.constellation-42-0123ABCD.tmp', '.constellation--0123abcd.tmp', '.constellation-42-0123abc.tmp', '.constellation-42-0123abcde.tmp']) {
    assert.equal(fs.existsSync(s.file(keep)), true, keep);
  }
}, { setup: (v) => {
  for (const n of ['.constellation-42-0123abcd.tmp', '.wiki-42-0123abcd.tmp', '.constellation-42-0123ABCD.tmp', '.constellation--0123abcd.tmp', '.constellation-42-0123abc.tmp', '.constellation-42-0123abcde.tmp']) fs.writeFileSync(path.join(v, n), 'x');
} }));

test('the sidecar is not a note: unlisted, unreadable, unwritable and undeletable through /api/notes, and notes writes never change it', () => withServer(async (s) => {
  const before = fs.readFileSync(sc(s.vault));
  assert.deepEqual((await s.call('GET', '/api/notes')).body.notes.map((n) => n.title), ['Note']);
  code(await s.call('GET', '/api/notes/.constellation-sky.json'), 404, 'note_not_found');
  code(await s.call('PUT', '/api/notes/.constellation-sky.json', { content: '{}' }, { headers: { 'if-match': '"x"' } }), 404, 'note_not_found');
  code(await s.call('DELETE', '/api/notes/.constellation-sky.json'), 404, 'note_not_found');
  code(await s.call('POST', '/api/notes', { title: '.constellation-sky.json' }), 400, 'title_leading_dot');
  const n = await getNote(s, 'Note');
  assert.equal((await putNote(s, 'Note', 'changed', n.body.revision)).status, 200);
  assert.deepEqual(fs.readFileSync(sc(s.vault)), before);
}, { setup: (v) => { write(v, 'Note', 'x'); fs.writeFileSync(sc(v), '{"version":1,"samplesSeeded":false,"seeds":{"note":"ideas"}}\n'); } }));

test('rename carries the star: same x and y, exact sidecar bytes, the entry is gone again after renaming back, case-only renames write nothing', () => withServer(async (s) => {
  await mk(s, 'Notes', 'x'); await mk(s, 'Journal link', 'see [[Notes]]'); await mk(s, 'Solo', 'y');
  const before = starMap(await skyOf(s));
  assert.equal((await renameNote(s, 'Notes', 'Journal')).status, 200);
  const mid = starMap(await skyOf(s));
  assert.deepEqual(mid.get('Journal'), before.get('Notes'));
  assert.deepEqual(mid.get('Journal link'), before.get('Journal link'));
  assert.deepEqual(mid.get('Solo'), before.get('Solo'));
  assert.equal(sidecarBytes(s.vault).toString(), '{"version":1,"samplesSeeded":false,"seeds":{"journal":"notes"}}\n');
  const stamp = fs.statSync(sc(s.vault)).mtimeMs;
  assert.equal((await renameNote(s, 'Journal', 'JOURNAL')).status, 200);
  assert.equal(fs.statSync(sc(s.vault)).mtimeMs, stamp);
  assert.equal((await renameNote(s, 'JOURNAL', 'Notes')).status, 200);
  assert.equal(sidecarBytes(s.vault).toString(), '{"version":1,"samplesSeeded":false,"seeds":{}}\n');
  assert.deepEqual(starMap(await skyOf(s)).get('Notes'), before.get('Notes'));
}));

test('a corrupt sidecar is ignored with one log line, never seeds over an empty vault, and the next rename replaces it', async () => {
  await withServer(async (s) => {
    for (let i = 0; i < 3; i++) await skyOf(s);
    assert.equal(s.logs().stderr.split('Ignoring unreadable .constellation-sky.json').length - 1, 1, s.logs().stderr);
    assert.deepEqual(listVault(s.vault), []);
    assert.equal(sidecarBytes(s.vault).toString(), '{"version":"two"}');
  }, { ...ON, setup: (v) => fs.writeFileSync(sc(v), '{"version":"two"}') });
  await withServer(async (s) => {
    assert.deepEqual(starMap(await skyOf(s)).get('Idea two'), own('Idea two'));
    assert.equal((await renameNote(s, 'Idea two', 'Idea three')).status, 200);
    assert.equal(readSidecarJson(s).version, 1);
    assert.deepEqual(starMap(await skyOf(s)).get('Idea three'), own('Idea two'));
  }, { setup: (v) => { write(v, 'Idea two', 'x'); fs.writeFileSync(sc(v), 'garbage'); } });
});

test('an oversized or symlinked sidecar counts as absent (samples still seed), a version 2 sidecar counts as seeded and is never rewritten', async () => {
  await withServer(async (s) => {
    assert.deepEqual(listVault(s.vault), SAMPLE_TITLES.map((t) => `${t}.md`).sort());
    assert.ok(s.logs().stderr.includes('.constellation-sky.json'));
  }, { ...ON, setup: (v) => fs.writeFileSync(sc(v), `{"version":1,"samplesSeeded":true}${' '.repeat(1048577)}`) });
  await withServer(async (s) => {
    assert.deepEqual(listVault(s.vault), SAMPLE_TITLES.map((t) => `${t}.md`).sort());
    assert.equal(fs.readFileSync(path.join(s.base, 'target.json'), 'utf8'), '{"version":1,"samplesSeeded":true}');
  }, { ...ON, setup: (v, sb) => { fs.writeFileSync(path.join(sb.base, 'target.json'), '{"version":1,"samplesSeeded":true}'); fs.symlinkSync(path.join(sb.base, 'target.json'), sc(v)); } });
  const v2 = '{"version":2,"samplesSeeded":false,"seeds":{"aaa":"ideas"}}';
  await withServer(async (s) => {
    assert.deepEqual(listVault(s.vault), ['Aaa.md']);
    assert.deepEqual(starMap(await skyOf(s)).get('Aaa'), own('Aaa'));
    assert.equal((await renameNote(s, 'Aaa', 'Bbb')).status, 200);
    assert.equal(sidecarBytes(s.vault).toString(), v2);
    assert.deepEqual(starMap(await skyOf(s)).get('Bbb'), own('Bbb'));
  }, { ...ON, setup: (v) => { write(v, 'Aaa', 'x'); fs.writeFileSync(sc(v), v2); } });
});

test('sidecar entries need titleKey form and valid titles, are limited to current notes, and __proto__ is an ordinary key', () => withServer(async (s) => {
  const pos = starMap(await skyOf(s));
  assert.deepEqual(pos.get('__proto__'), hashPoint2('ideas'));
  assert.deepEqual(pos.get('Upper'), own('Upper'));
  assert.deepEqual(pos.get('Plain'), own('Plain'));
  assert.deepEqual(Object.keys({}), []);
}, { setup: (v) => {
  for (const t of ['__proto__', 'Upper', 'Plain']) write(v, t, 'x');
  fs.writeFileSync(sc(v), '{"version":1,"samplesSeeded":false,"seeds":{"__proto__":"ideas","Upper":"orphan","plain":"Alpha","nothing":"welcome"}}');
} }));

test('first boot with seeding on: the five exact sample files exist before the ready line, one stdout line, samplesSeeded true, samples 5, sample sky exact', () => withServer(async (s) => {
  for (const x of SAMPLES) assert.deepEqual(fs.readFileSync(s.file(`${x.title}.md`)), Buffer.from(x.body, 'utf8'), x.title);
  assert.equal(s.logs().stdout.split('\n').filter(Boolean).length, 1);
  const sky = await skyOf(s);
  assert.equal(sky.samples, 5);
  assert.deepEqual(sky.stars.backlinks, [1, 2, 4, 1, 2]);
  assert.deepEqual(sky.edges, [0, 1, 0, 2, 1, 2, 2, 3, 2, 4, 3, 4]);
  assert.deepEqual(sky.constellations, [{ id: 0, name: 'Start here', star: 2, count: 5 }]);
  assert.equal(sidecarBytes(s.vault).toString(), '{"version":1,"samplesSeeded":true,"seeds":{}}\n');
}, ON));

test('removing samples: only exact bytes go, an edited one is kept, a user note named Start here is untouched, and removal then restart never reseeds', async () => {
  const sb = sandbox();
  try {
    await withServer(async (s) => {
      const note = await getNote(s, 'Writing a note');
      await putNote(s, 'Writing a note', `${note.body.content}+`, note.body.revision);
      const r = await s.call('DELETE', '/api/samples');
      assert.deepEqual(r.body, { removed: ['Start here', 'How the sky works', 'Links and unlit stars', 'Your vault'], kept: ['Writing a note'] });
      assert.deepEqual(listVault(s.vault), ['Writing a note.md']);
    }, { ...ON, sandbox: sb });
    await withServer(async (s) => {
      assert.deepEqual(listVault(s.vault), ['Writing a note.md'], 'a vault with a note is not seeded');
      fs.unlinkSync(s.file('Writing a note.md'));
    }, { ...ON, sandbox: sb });
    await withServer(async (s) => { assert.deepEqual(listVault(s.vault), [], 'the sidecar marker prevents a reseed'); }, { ...ON, sandbox: sb });
  } finally { sb.cleanup(); }
  await withServer(async (s) => {
    assert.deepEqual((await s.call('DELETE', '/api/samples')).body, { removed: [], kept: [] });
    assert.equal(s.read('Start here.md').toString(), 'mine');
  }, { setup: (v) => write(v, 'Start here', 'mine') });
});

test('CONSTELLATION_SAMPLES: only off (any case, trimmed) disables seeding; on, empty and unusual values keep it on', async () => {
  for (const [value, seeded] of [['off', false], [' Off ', false], ['OFF', false], ['on', true], ['', true], ['no', true], ['false', true]]) {
    await withServer(async (s) => {
      assert.equal(listVault(s.vault).length, seeded ? 5 : 0, JSON.stringify(value));
      if (!seeded) assert.equal(sidecarBytes(s.vault), null);
    }, { env: { CONSTELLATION_SAMPLES: value } });
  }
});

test('DELETE /api/samples: bad Origin or cross-site is 403 bad_origin with the Constellation message, GET is 405 with Allow DELETE, /api/samples/x is 404', () => withServer(async (s) => {
  for (const headers of [{ origin: 'http://evil.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    const r = await s.call('DELETE', '/api/samples', undefined, { headers });
    code(r, 403, 'bad_origin');
    assert.equal(r.body.error.message, 'This request did not come from the Constellation page.');
  }
  assert.equal(listVault(s.vault).length, 5);
  const get = await s.call('GET', '/api/samples');
  assert.equal(get.status, 405);
  assert.equal(get.headers.allow, 'DELETE');
  code(await s.call('DELETE', '/api/samples/x'), 404, 'not_found');
  assert.equal((await s.call('DELETE', '/api/samples', undefined, { headers: { 'content-type': 'text/plain' } })).status, 200);
}, ON));

test('brightness: saturates at 16 backlinks, floors at 0.3 for old notes, and b always equals the rounded formula for the response now and mtime', () => retryOnRollover(() => withServer(async (s) => {
  const first = await skyOf(s);
  const t = new Date(first.now - 400 * DAY);
  fs.utimesSync(s.file('Ancient.md'), t, t);
  const sky = await skyOf(s);
  rolloverGuard(first, sky);
  const by = (title) => sky.stars.b[sky.stars.title.indexOf(title)];
  assert.equal(by('Ancient'), 0.3);
  assert.ok(by('Star') >= 0.999 && by('Star') <= 1, `b(Star) ${by('Star')}`);
  for (const [i, title] of sky.stars.title.entries()) {
    assert.equal(sky.stars.b[i], round3(brightnessRef(Math.max(0, sky.now - sky.stars.mtime[i]) / DAY, sky.stars.backlinks[i])), title);
  }
}, { setup: (v) => {
  write(v, 'Star', 'x'); write(v, 'Ancient', 'x');
  for (let i = 0; i < 16; i++) write(v, `Fan ${String(i).padStart(2, '0')}`, '[[Star]]');
  const now = Date.now(); const t = new Date(now);
  fs.utimesSync(path.join(v, 'Star.md'), t, t);
} })));

test('constellations are named by highest b, then backlinks, then smallest key, ordered by name key, and every star points at its own constellation', () => withServer(async (s) => {
  const sky = await skyOf(s);
  assert.deepEqual(sky.constellations.map((c) => c.name), ['Hubby', 'Pair a', 'Quux']);
  assert.deepEqual(sky.constellations.map((c) => c.count), [4, 2, 3]);
  for (const c of sky.constellations) {
    assert.equal(sky.stars.constellation[c.star], c.id);
    assert.equal(sky.stars.title[c.star], c.name);
  }
  assert.equal(sky.stars.constellation[sky.stars.title.indexOf('Loner')], null);
}, { setup: (v) => {
  const old = (n) => { const t = new Date(Date.now() - 300 * DAY); fs.utimesSync(path.join(v, `${n}.md`), t, t); };
  write(v, 'Hubby', 'x'); for (const n of ['s1', 's2', 's3']) write(v, n, '[[Hubby]]');
  for (const n of ['Hubby', 's1', 's2', 's3']) old(n);
  write(v, 'Pair a', '[[Pair b]]'); write(v, 'Pair b', '[[Pair a]]'); old('Pair a'); old('Pair b');
  write(v, 'Quux', 'x'); write(v, 'Quuz', '[[Quux]]'); write(v, 'Aaa', '[[Quux]]'); old('Quuz');
  write(v, 'Loner', 'x');
} }));

test('a content-only PUT never moves a star: x, y and edges stay, mtime and the ETag change', () => retryOnRollover(() => withServer(async (s) => {
  const a = await getSky(s);
  const n = await getNote(s, 'Q3');
  await putNote(s, 'Q3', 'Q3 rewritten with other words but the same links [[Q4]]', n.body.revision);
  const b = await getSky(s);
  rolloverGuard(a.body, b.body);
  assert.deepEqual(b.body.stars.x, a.body.stars.x);
  assert.deepEqual(b.body.stars.y, a.body.stars.y);
  assert.deepEqual(b.body.edges, a.body.edges);
  assert.notEqual(b.headers.etag, a.headers.etag);
}, { setup: (v) => {
  for (let i = 0; i < 8; i++) write(v, `Q${i}`, i === 3 ? 'old words [[Q4]]' : `[[Q${(i + 1) % 8}]]`);
  for (let i = 0; i < 8; i++) { const t = new Date(Date.now() - 7200000); fs.utimesSync(path.join(v, `Q${i}.md`), t, t); }
} })));

test('P3 over 150 more seeded G(50, 80) vaults: an unlinked newcomer moves nothing by more than 8.01 and nothing farther than 21 units from it at all', { timeout: 240000 }, () => withServer(async (s) => {
  for (let seed = 1001; seed <= 1150; seed++) {
    wipeNotes(s.vault);
    writeNotes(s.vault, genVault(50, 80, seed, `G${seed}-`).notes);
    const before = starMap(await skyOf(s));
    write(s.vault, `Visitor ${seed}`, 'no links');
    const after = starMap(await skyOf(s));
    const [nx, ny] = after.get(`Visitor ${seed}`);
    for (const [t, [x, y]] of before) {
      const [x2, y2] = after.get(t);
      assert.ok(Math.abs(x2 - x) <= 8.01 + 1e-9 && Math.abs(y2 - y) <= 8.01 + 1e-9, `seed ${seed} ${t}`);
      if (Math.hypot(x2 - nx, y2 - ny) > 21) assert.ok(x2 === x && y2 === y, `seed ${seed} ${t} moved`);
    }
  }
}));

test('P5 and P2: lighting an unlit star keeps every position, and the same vault created in reverse order has the same positions', async () => {
  await withServer(async (s) => {
    const before = await skyOf(s);
    const unlit = unlitMap(before);
    const stars = starMap(before);
    assert.equal((await s.call('POST', '/api/notes', { title: 'Missing one' })).status, 201);
    const after = await skyOf(s);
    const lit = starMap(after);
    assert.deepEqual(lit.get('Missing one'), unlit.get('Missing one'));
    for (const [t, xy] of stars) assert.deepEqual(lit.get(t), xy, t);
  }, { setup: (v) => { write(v, 'Root', '[[Missing one]] [[Child]]'); write(v, 'Child', '[[Missing one]]'); write(v, 'Lone', 'x'); } });
  const g = genVault(30, 45, 77);
  const maps = [];
  for (const order of ['forward', 'reverse']) {
    await withServer(async (s) => { maps.push(starMap(await skyOf(s))); }, { setup: (v) => writeNotes(v, g.notes, order) });
  }
  for (const [t, xy] of maps[0]) assert.deepEqual(maps[1].get(t), xy, t);
});

test('wikilinks inside front-matter count, and the server returns front-matter as plain note text', () => withServer(async (s) => {
  const sky = await skyOf(s);
  assert.deepEqual(sky.unlit.title, ['Hidden target']);
  assert.deepEqual(sky.edges, [0, 1]);
  const got = await getNote(s, 'FM');
  assert.equal(got.body.content, '---\ntags: [[Hidden target]]\n---\nbody\n');
}, { setup: (v) => write(v, 'FM', '---\ntags: [[Hidden target]]\n---\nbody\n') }));

test('/api/sky and /api/unlit routing: unknown tails are 404 not_found, other methods 405 with Allow GET, queries are ignored', () => withServer(async (s) => {
  for (const url of ['/api/sky/x', '/api/sky/', '/api/unlit/', '/api/unlit/x', '/api/samples/x']) code(await s.call('GET', url), 404, 'not_found');
  for (const [m, url] of [['POST', '/api/sky'], ['PUT', '/api/unlit'], ['DELETE', '/api/sky'], ['OPTIONS', '/api/sky'], ['HEAD', '/api/unlit']]) {
    const r = await s.call(m, url, m === 'POST' || m === 'PUT' ? {} : undefined);
    assert.equal(r.status, 405, `${m} ${url}`);
    assert.equal(r.headers.allow, 'GET');
  }
  assert.equal((await s.call('GET', '/api/sky?x=1&y=2')).status, 200);
  assert.deepEqual(Object.keys((await skyOf(s))), ['version', 'now', 'stars', 'unlit', 'unlitTotal', 'edges', 'constellations', 'samples']);
}));
