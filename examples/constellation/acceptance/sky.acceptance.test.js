// GET /api/sky and GET /api/unlit over HTTP (SC2, SC3, SC4, SC8, SC9, SC10, check 53). Acceptance tests are read-only for builders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  withServer, startServer, sandbox, mk, putNote, renameNote, getNote, enc, touch, sleep, sha32, listVault,
  getSky, skyOf, starMap, unlitMap, retryOnRollover, rolloverGuard, brightnessRef, round2, round3, hashPoint2,
  genVault, writeNotes, wipeNotes, mulberry32, titleKeyOf, cmp, median, pad2, pad4, DAY, BUCKET, APP_DIR,
} from './helpers.js';

const STAR_KEYS = ['title', 'x', 'y', 'b', 'backlinks', 'mtime', 'constellation'];
const TOP_KEYS = ['version', 'now', 'stars', 'unlit', 'unlitTotal', 'edges', 'constellations', 'samples'];
const write = (v, name, content) => fs.writeFileSync(path.join(v, `${name}.md`), content);
const setMtime = (v, name, ms) => { const t = new Date(ms); fs.utimesSync(path.join(v, `${name}.md`), t, t); };
const old = (v, name, days = 200) => setMtime(v, name, Date.now() - days * DAY);

// ---------------------------------------------------------------- shape, headers, ETag
test('SC2 an empty vault gives the exact empty body: compact JSON, top-level key order, empty arrays, samples 0', () => withServer(async (s) => {
  const res = await getSky(s);
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body), TOP_KEYS);
  const { now } = res.body;
  assert.equal(res.text, `{"version":1,"now":${now},"stars":{"title":[],"x":[],"y":[],"b":[],"backlinks":[],"mtime":[],"constellation":[]},"unlit":{"title":[],"x":[],"y":[],"linkedFrom":[]},"unlitTotal":0,"edges":[],"constellations":[],"samples":0}`);
  assert.deepEqual((await s.call('GET', '/api/unlit')).body, { unlit: [] });
}));

test('SC2 the sky response carries ETag, no-store and JSON headers; the ETag is the first 32 hex of the sha256 of the body bytes', () => withServer(async (s) => {
  await mk(s, 'Welcome', 'Hello.\n\nSee [[Ideas]].\n');
  const res = await getSky(s);
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers.etag, `"${sha32(res.buffer)}"`);
  assert.match(res.headers.etag, /^"[0-9a-f]{32}"$/);
  assert.equal(res.text, JSON.stringify(res.body), 'compact JSON, no whitespace between tokens');
  assert.equal(res.headers['content-security-policy'].includes("default-src 'none'"), true);
  const unlit = await s.call('GET', '/api/unlit');
  assert.equal(unlit.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(unlit.headers['cache-control'], 'no-store');
}));

test('SC2 now is a 10 minute bucket: a multiple of 600000, at most the current time and less than a bucket old', () => withServer(async (s) => {
  const before = Date.now();
  const sky = await skyOf(s);
  const after = Date.now();
  assert.equal(Number.isInteger(sky.now), true);
  assert.equal(sky.now % BUCKET, 0);
  assert.ok(sky.now <= after, 'never in the future');
  assert.ok(sky.now > before - BUCKET - 5000, `now ${sky.now} is more than a bucket behind ${before}`);
  assert.equal(sky.version, 1);
}));

test('SC2 struct-of-arrays: seven star arrays and four unlit arrays of equal length, key order as specified, x and y finite with at most 2 decimals', () => withServer(async (s) => {
  const sky = await skyOf(s);
  assert.deepEqual(Object.keys(sky), TOP_KEYS);
  assert.deepEqual(Object.keys(sky.stars), STAR_KEYS);
  assert.deepEqual(Object.keys(sky.unlit), ['title', 'x', 'y', 'linkedFrom']);
  const S = sky.stars.title.length;
  assert.equal(S, 12);
  for (const k of STAR_KEYS) assert.equal(sky.stars[k].length, S, k);
  const U = sky.unlit.title.length;
  assert.equal(U, 2);
  for (const k of ['x', 'y', 'linkedFrom']) assert.equal(sky.unlit[k].length, U, k);
  for (const v of [...sky.stars.x, ...sky.stars.y, ...sky.unlit.x, ...sky.unlit.y]) {
    assert.equal(Number.isFinite(v), true);
    assert.equal(Math.round(v * 100) / 100, v, `${v} has more than 2 decimals`);
  }
  for (const [i, m] of sky.stars.mtime.entries()) {
    assert.equal(Number.isInteger(m), true, 'mtime is an integer');
    assert.equal(m, Math.round(fs.statSync(s.file(`${sky.stars.title[i]}.md`)).mtimeMs));
  }
  for (const c of sky.stars.constellation) assert.ok(c === null || Number.isInteger(c));
  assert.ok(sky.unlit.linkedFrom.every((n) => Number.isInteger(n) && n >= 1));
  assert.deepEqual(sky.edges.map((e) => Number.isInteger(e) && e >= 0 && e < S + U), sky.edges.map(() => true));
}, { setup: (v) => {
  const g = genVault(12, 16, 7);
  writeNotes(v, g.notes);
  write(v, 'N00', 'Note N00.\nSee [[N01]] and [[Ghost one]] and [[Ghost two]].\n');
} }));

test('SC2 stars are sorted by titleKey in code-unit order (not localeCompare) and keep the stored casing', () => withServer(async (s) => {
  const sky = await skyOf(s);
  const titles = ['zeta', 'Éclair', 'alpha', 'a b', 'a-b', 'a_b', 'ab', '10', '9', 'Béta', 'Zed', 'a.b', '(paren)', '日本'];
  const want = [...titles].sort((a, b) => cmp(titleKeyOf(a), titleKeyOf(b)));
  assert.deepEqual(sky.stars.title, want);
  const lc = [...titles].sort((a, b) => titleKeyOf(a).localeCompare(titleKeyOf(b)));
  assert.notDeepEqual(want, lc, 'the fixture must tell code-unit order from localeCompare');
}, { setup: (v) => {
  for (const t of ['zeta', 'Éclair', 'alpha', 'a b', 'a-b', 'a_b', 'ab', '10', '9', 'Béta', 'Zed', 'a.b', '(paren)', '日本']) write(v, t, 'x');
} }));

// ---------------------------------------------------------------- fixture U, backlinks, edges
test('SC3 unlit fixture U: Welcome links to a missing Ideas, which is one hollow star with linkedFrom 1', () => withServer(async (s) => {
  const res = await getSky(s);
  const sky = res.body;
  assert.deepEqual(sky.stars.title, ['Welcome']);
  assert.deepEqual(sky.unlit.title, ['Ideas']);
  assert.deepEqual(sky.unlit.linkedFrom, [1]);
  assert.equal(sky.unlitTotal, 1);
  assert.deepEqual(sky.edges, [0, 1]);
  assert.deepEqual(sky.stars.constellation, [null]);
  assert.deepEqual(sky.stars.backlinks, [0]);
  assert.deepEqual(sky.constellations, []);
  assert.equal(sky.samples, 0);
  assert.equal(sky.unlit.x.length, 1);
  assert.equal(Number.isFinite(sky.unlit.x[0]) && Number.isFinite(sky.unlit.y[0]), true);
  const unlit = await s.call('GET', '/api/unlit');
  assert.equal(unlit.status, 200);
  assert.deepEqual(unlit.body, { unlit: [{ title: 'Ideas', linkedFrom: ['Welcome'] }] });
  const graph = await s.call('GET', '/api/graph');
  assert.deepEqual(graph.body, { nodes: [{ title: 'Welcome', orphan: true }], edges: [] }, 'the graph route has no unlit nodes');
}, { setup: (v) => write(v, 'Welcome', 'Hello.\n\nSee [[Ideas]].\n') }));

test('SC3 backlinks counts are distinct other notes with a valid link, equal to the length of the wiki backlinks list', () => withServer(async (s) => {
  const sky = await skyOf(s);
  for (const [i, title] of sky.stars.title.entries()) {
    const wiki = await s.call('GET', `${enc(title)}/backlinks`);
    assert.equal(sky.stars.backlinks[i], wiki.body.backlinks.length, title);
  }
  const by = Object.fromEntries(sky.stars.title.map((t, i) => [t, sky.stars.backlinks[i]]));
  assert.equal(by.Ideas, 3, 'self link, repeated links, code links and invalid targets do not count');
  assert.equal(by.Other, 1);
  assert.equal(by.Zed, 0);
}, { setup: (v) => {
  write(v, 'Ideas', 'self link [[Ideas]]');
  write(v, 'A', '[[ideas]] and [[Ideas|again]] and [[IDEAS]] [[Other]]');
  write(v, 'B', '[[Ideas]]');
  write(v, 'Coded', '```\n[[Ideas]]\n```\n`[[Ideas]]` [[Ideas]]');
  write(v, 'Bad', '[[../Ideas]] [[Ideas/x]] [[a:b]] [[ ]]');
  write(v, 'Other', 'x');
  write(v, 'Zed', '```\n[[Other]]\n```');
} }));

test('SC3 edges: one per unordered pair, mutual links once, self and invalid targets excluded, a < b, sorted by (a, b), unlit indexes follow the stars', () => withServer(async (s) => {
  const sky = await skyOf(s);
  assert.deepEqual(sky.stars.title, ['alpha', 'beta', 'delta', 'gamma', 'solo']);
  assert.deepEqual(sky.unlit.title, ['ghost', 'phantom']);
  assert.deepEqual(sky.unlit.linkedFrom, [2, 1]);
  assert.equal(sky.unlitTotal, 2);
  const S = 5;
  // alpha(0) beta(1) delta(2) gamma(3) solo(4) ghost(5) phantom(6)
  assert.deepEqual(sky.edges, [0, 1, 0, 3, 0, 5, 1, 3, 1, 5, 3, 6]);
  const pairs = [];
  for (let i = 0; i < sky.edges.length; i += 2) pairs.push([sky.edges[i], sky.edges[i + 1]]);
  for (const [a, b] of pairs) assert.ok(a < b && b < S + 2);
  assert.deepEqual(pairs, [...pairs].sort((p, q) => p[0] - q[0] || p[1] - q[1]));
  assert.deepEqual(sky.stars.backlinks, [2, 1, 0, 1, 0]);
}, { setup: (v) => {
  write(v, 'alpha', '[[beta]] [[Alpha]] [[../x]] [[Ghost]]');          // self link, invalid target
  write(v, 'beta', '[[ALPHA|x]] [[gamma]] [[ghost|g]] `[[delta]]`');    // mutual with alpha, code link excluded
  write(v, 'gamma', '[[Phantom]] [[a:b]] [[alpha]]');
  write(v, 'delta', '```\n[[solo]]\n```');
  write(v, 'solo', 'alone');
} }));

test('SC3 unlit selection and fields: title as first written (sorted linking note, then document order), distinct linking notes, invalid targets never unlit', () => withServer(async (s) => {
  const sky = await skyOf(s);
  assert.deepEqual(sky.unlit.title, ['Ghost X', 'ghost y', 'Zzz']);
  assert.deepEqual(sky.unlit.linkedFrom, [2, 1, 1]);
  assert.equal(sky.unlitTotal, 3);
  const unlit = (await s.call('GET', '/api/unlit')).body.unlit;
  assert.deepEqual(unlit, [
    { title: 'Ghost X', linkedFrom: ['A note', 'b note'] },
    { title: 'ghost y', linkedFrom: ['b note'] },
    { title: 'Zzz', linkedFrom: ['A note'] },
  ]);
  assert.ok(unlit.every((u) => Array.isArray(u.linkedFrom)), 'the unlit route holds titles, the sky route a count');
}, { setup: (v) => {
  write(v, 'b note', '[[ghost y]] ... [[GHOST Y]] [[ghost x]] [[../bad]] [[a/b]] [[x:y]] [[Existing]]');
  write(v, 'A note', '[[Ghost X]] [[ghost x]] [[Zzz]] [[ZZZ]]');
  write(v, 'Existing', 'x');
} }));

test('SC3 /api/unlit lists every missing target uncapped, one entry per titleKey, sorted by key, with linkedFrom titles sorted by key', () => withServer(async (s) => {
  const res = await s.call('GET', '/api/unlit');
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body), ['unlit']);
  assert.deepEqual(res.body.unlit.map((u) => u.title), ['Alpha ghost', 'béta', 'Gamma']);
  assert.deepEqual(res.body.unlit[0].linkedFrom, ['a', 'Zed', 'zz']);
  for (const u of res.body.unlit) assert.deepEqual(Object.keys(u), ['title', 'linkedFrom']);
  await mk(s, 'Alpha ghost');
  assert.deepEqual((await s.call('GET', '/api/unlit')).body.unlit.map((u) => u.title), ['béta', 'Gamma'], 'creating the note lights the star');
  fs.writeFileSync(s.file('Gamma.md'), 'outside');
  assert.deepEqual((await s.call('GET', '/api/unlit')).body.unlit.map((u) => u.title), ['béta'], 'an outside write is picked up');
}, { setup: (v) => {
  write(v, 'zz', '[[alpha ghost]] [[Gamma]]');
  write(v, 'Zed', '[[Alpha Ghost]]');
  write(v, 'a', '[[ALPHA GHOST]] [[Béta]]');
} }));

test('SC3 unlit cap: 2,000 drawn by linkedFrom then key, unlitTotal and /api/unlit uncapped (100 notes, 2,500 missing links), edges only to drawn stars', { timeout: 120000 }, () => withServer(async (s) => {
  const sky = await skyOf(s);
  assert.equal(sky.unlit.title.length, 2000);
  assert.equal(sky.unlitTotal, 2501);
  assert.equal(sky.unlit.linkedFrom.length, 2000);
  const expected = ['Zzz popular', ...Array.from({ length: 1999 }, (_, i) => `Ghost ${pad4(i)}`)].sort((a, b) => cmp(titleKeyOf(a), titleKeyOf(b)));
  assert.deepEqual(sky.unlit.title, expected, 'the popular star is kept over 502 low-key ghosts; the rest by key; arrays sorted by key');
  assert.equal(sky.unlit.linkedFrom[sky.unlit.title.indexOf('Zzz popular')], 3);
  const S = sky.stars.title.length;
  assert.equal(S, 100);
  assert.equal(sky.edges.length / 2, 2000 + 2, '1,999 ghost pairs plus 3 pairs to the popular one, minus nothing else');
  assert.ok(sky.edges.every((e) => e < S + 2000));
  const all = await s.call('GET', '/api/unlit');
  assert.equal(all.body.unlit.length, 2501);
  assert.equal(all.body.unlit.find((u) => u.title === 'Ghost 2499').linkedFrom.length, 1);
  assert.ok(sky.stars.constellation.every((c) => c === null), 'unlit stars never join a constellation');
  assert.deepEqual(sky.constellations, []);
}, { setup: (v) => {
  for (let i = 0; i < 100; i++) {
    const links = Array.from({ length: 25 }, (_, k) => `[[Ghost ${pad4(i * 25 + k)}]]`);
    if (i < 3) links.push('[[Zzz popular]]');
    write(v, `Src ${pad2(i)}`, `${links.join(' ')}\n`);
  }
} }));

// ---------------------------------------------------------------- brightness
test('SC4 b is self-consistent for every star: round3(brightness(age of the response now, backlinks)) with age from mtime', () => withServer(async (s) => {
  const sky = await skyOf(s);
  assert.equal(sky.stars.title.length, 9);
  for (const [i, title] of sky.stars.title.entries()) {
    const age = Math.max(0, sky.now - sky.stars.mtime[i]) / DAY;
    assert.equal(sky.stars.b[i], round3(brightnessRef(age, sky.stars.backlinks[i])), title);
  }
  assert.ok(sky.stars.b.every((b) => b >= 0.3 && b <= 1));
}, { setup: (v) => {
  const ages = [0, 1, 3, 7, 14, 30, 60, 100, 400];
  ages.forEach((d, i) => { write(v, `T${i}`, `${'[[T0]] '.repeat(i % 3)}${i > 4 ? '[[T1]]' : ''}`); old(v, `T${i}`, d); });
} }));

test('SC4 worked brightness table: ages 0 to 500 days and 0 to 16 backlinks give the spec values', () => retryOnRollover(() => withServer(async (s) => {
  const first = await skyOf(s);
  const now = first.now;
  const rows = [[0, 0, 0.6], [0, 1, 0.698], [0, 2, 0.755], [0, 4, 0.827], [0, 10, 0.939], [0, 15, 0.991], [0, 16, 1], [7, 0, 0.553], [14, 0, 0.507], [45, 3, 0.496], [52, 0, 0.3], [90, 0, 0.3], [200, 0, 0.3], [500, 0, 0.3]];
  rows.forEach(([age], i) => setMtime(s.vault, `Row ${pad2(i)}`, now - age * DAY));
  const sky = await skyOf(s);
  rolloverGuard(first, sky);
  rows.forEach(([age, links, b], i) => {
    const idx = sky.stars.title.indexOf(`Row ${pad2(i)}`);
    assert.equal(sky.stars.backlinks[idx], links, `row ${i} backlinks`);
    assert.equal(sky.stars.mtime[idx], now - age * DAY);
    assert.equal(sky.stars.b[idx], b, `age ${age} d, ${links} backlinks`);
  });
}, { setup: (v) => {
  const links = [0, 1, 2, 4, 10, 15, 16, 0, 0, 3, 0, 0, 0, 0];
  links.forEach((n, i) => {
    write(v, `Row ${pad2(i)}`, 'target');
    for (let k = 0; k < n; k++) write(v, `Lk ${pad2(i)} ${pad2(k)}`, `[[Row ${pad2(i)}]]`);
  });
} })));

test('SC4 fixture H: ten notes link to Hub, so Hub is bright and big and Orphan stays dim', () => retryOnRollover(() => withServer(async (s) => {
  const sky = await skyOf(s);
  assert.deepEqual(sky.stars.title, ['Hub', ...Array.from({ length: 10 }, (_, i) => `L${pad2(i + 1)}`), 'Orphan']);
  const hub = sky.stars.b[0];
  const orphan = sky.stars.b[11];
  assert.ok(orphan >= 0.598 && orphan <= 0.601, `Orphan ${orphan}`);
  assert.ok(hub >= 0.937 && hub <= 0.94, `Hub ${hub}`);
  assert.ok(hub - orphan >= 0.25);
  assert.ok((1.5 + 5 * hub) / (1.5 + 5 * orphan) >= 1.35);
  assert.deepEqual(sky.stars.backlinks, [10, ...Array(11).fill(0)]);
  assert.deepEqual(sky.stars.constellation, [...Array(11).fill(0), null]);
  assert.deepEqual(sky.constellations, [{ id: 0, name: 'Hub', star: 0, count: 11 }]);
  assert.deepEqual(sky.edges, Array.from({ length: 10 }, (_, i) => [0, i + 1]).flat());
}, { setup: (v) => {
  write(v, 'Hub', 'center');
  for (let i = 1; i <= 10; i++) write(v, `L${pad2(i)}`, '[[Hub]]');
  write(v, 'Orphan', 'alone');
} })));

test('SC4 an Orphan.md with mtime 200 days before the response now has b 0.300', () => retryOnRollover(() => withServer(async (s) => {
  const first = await skyOf(s);
  const t = first.now - 200 * DAY;
  fs.utimesSync(s.file('Orphan.md'), new Date(t), new Date(t));
  const sky = await skyOf(s);
  rolloverGuard(first, sky);
  assert.equal(sky.stars.b[sky.stars.title.indexOf('Orphan')], 0.3);
  assert.equal(sky.stars.mtime[sky.stars.title.indexOf('Orphan')], t);
  assert.ok(sky.stars.b[sky.stars.title.indexOf('Fresh')] >= 0.598);
}, { setup: (v) => { write(v, 'Orphan', 'alone'); write(v, 'Fresh', 'new'); } })));

// ---------------------------------------------------------------- constellations
test('SC4 fixture C2: Alpha and Beta clusters give two constellations ordered by name, with the named star index and counts', () => withServer(async (s) => {
  const sky = await skyOf(s);
  assert.deepEqual(sky.stars.title, ['A1', 'A2', 'A3', 'Alpha', 'B1', 'B2', 'Beta']);
  assert.deepEqual(sky.stars.constellation, [0, 0, 0, 0, 1, 1, 1]);
  assert.deepEqual(sky.constellations, [{ id: 0, name: 'Alpha', star: 3, count: 4 }, { id: 1, name: 'Beta', star: 6, count: 3 }]);
  assert.deepEqual(sky.edges, [0, 3, 1, 3, 2, 3, 4, 6, 5, 6]);
  assert.deepEqual(sky.stars.backlinks, [0, 0, 0, 3, 0, 0, 2]);
  assert.deepEqual(Object.keys(sky.constellations[0]), ['id', 'name', 'star', 'count']);
}, { setup: (v) => {
  write(v, 'Alpha', 'a'); for (const n of ['A1', 'A2', 'A3']) write(v, n, '[[Alpha]]');
  write(v, 'Beta', 'b'); for (const n of ['B1', 'B2']) write(v, n, '[[Beta]]');
} }));

test('SC4 a constellation is named for its member with the highest unrounded b, then most backlinks, then smallest key', () => withServer(async (s) => {
  const sky = await skyOf(s);
  const names = Object.fromEntries(sky.constellations.map((c) => [c.name, c.count]));
  assert.deepEqual(names, { 'Leaf a': 5, Zed: 4, Alpha: 2 });
  assert.deepEqual(sky.constellations.map((c) => c.name), ['Alpha', 'Leaf a', 'Zed'], 'sorted by the titleKey of the name');
  assert.deepEqual(sky.constellations.map((c) => c.id), [0, 1, 2]);
  for (const c of sky.constellations) {
    assert.equal(sky.stars.title[c.star], c.name);
    assert.equal(sky.stars.constellation[c.star], c.id);
    assert.equal(sky.stars.constellation.filter((x) => x === c.id).length, c.count);
  }
}, { setup: (v) => {
  // group 1: all old (b 0.3 each); Zed has 3 backlinks, so it is named even though a1 sorts first
  write(v, 'Zed', '[[Abe]]'); write(v, 'Abe', 'x');
  for (const n of ['a1', 'a2', 'a3']) write(v, n, '[[Zed]]');
  for (const n of ['Zed', 'Abe', 'a1', 'a2', 'a3']) if (n !== 'Abe') old(v, n);
  old(v, 'Abe');
  // group 2: a mutual pair with identical b and backlinks: the smaller key wins
  write(v, 'Beta', '[[Alpha]]'); write(v, 'Alpha', '[[Beta]]');
  old(v, 'Beta'); old(v, 'Alpha');
  // group 3: an old hub with new leaves: the newest (highest b) leaf names it, ties go to the smallest key
  write(v, 'Old hub', 'x'); old(v, 'Old hub');
  for (const n of ['Leaf a', 'Leaf b', 'Leaf c', 'Leaf d']) write(v, n, '[[Old hub]]');
}, }));

test('SC4 isolated notes and notes that only link to unlit stars are in no constellation', () => withServer(async (s) => {
  const sky = await skyOf(s);
  assert.deepEqual(sky.stars.constellation, [null, null, null]);
  assert.deepEqual(sky.constellations, []);
  assert.equal(sky.unlit.title.length, 2);
}, { setup: (v) => { write(v, 'Solo', 'x'); write(v, 'Linker one', '[[Ghost a]]'); write(v, 'Linker two', '[[Ghost a]] [[Ghost b]]'); } }));

test('SC4 a component of exactly 60 notes is one constellation of 60 and an outside add of one more member keeps all constellation fields coherent', () => withServer(async (s) => {
  const sky = await skyOf(s);
  assert.deepEqual(sky.constellations.map((c) => c.count), [60]);
  assert.ok(sky.stars.constellation.every((c) => c === 0));
  write(s.vault, 'C60', '[[C00]]');
  const grown = await skyOf(s);
  assert.equal(grown.stars.title.length, 61);
  const total = grown.constellations.reduce((n, c) => n + c.count, 0);
  assert.equal(total, grown.stars.constellation.filter((c) => c !== null).length, 'counts partition the member notes (a component over 60 may be split)');
  for (const c of grown.constellations) assert.ok(c.count >= 2);
}, { setup: (v) => { for (let i = 0; i < 60; i++) write(v, `C${pad2(i)}`, i === 0 ? 'head' : `[[C${pad2(i - 1)}]]`); } }));

test('SC4 constellations of a large component: counts partition the members, ids follow the name order, and the result does not depend on creation order', { timeout: 120000 }, async () => {
  const build = (v, order) => {
    const notes = new Map();
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < 40; i++) {
        const links = [];
        for (let j = 0; j < 40; j++) if (j !== i && (i + j) % 3 === 0) links.push(`[[K${c}-${pad2(j)}]]`);
        notes.set(`K${c}-${pad2(i)}`, links.join(' ') || 'x');
      }
    }
    notes.set('K0-00', `${notes.get('K0-00')} [[K1-00]]`);
    writeNotes(v, notes, order);
  };
  const skies = [];
  for (const order of ['forward', 'reverse']) {
    await withServer(async (s) => { skies.push(await skyOf(s)); }, { setup: (v) => build(v, order) });
  }
  const [a, b] = skies;
  assert.equal(a.stars.title.length, 80);
  const total = a.constellations.reduce((n, c) => n + c.count, 0);
  assert.equal(total, a.stars.constellation.filter((c) => c !== null).length);
  assert.ok(a.constellations.length >= 1);
  assert.deepEqual(a.constellations.map((c) => c.id), a.constellations.map((_, i) => i));
  assert.deepEqual(a.constellations.map((c) => titleKeyOf(c.name)), a.constellations.map((c) => titleKeyOf(c.name)).sort(cmp));
  for (const c of a.constellations) {
    assert.ok(c.count >= 2);
    assert.equal(a.stars.constellation[c.star], c.id);
    assert.equal(a.stars.title[c.star], c.name);
  }
  assert.deepEqual(a.stars.title, b.stars.title);
  assert.deepEqual(a.stars.constellation, b.stars.constellation, 'independent of input order');
  assert.deepEqual(a.constellations, b.constellations);
  assert.deepEqual(a.stars.x, b.stars.x);
  assert.deepEqual(a.stars.y, b.stars.y);
});

test('SC4 at most 1,000 constellations: the largest counts are kept first, ties by name key, and members of dropped groups get null', { timeout: 180000 }, () => withServer(async (s) => {
  const sky = await skyOf(s);
  assert.equal(sky.constellations.length, 1000);
  assert.equal(sky.stars.title.length, 2300);
  const kept = new Set(sky.constellations.map((c) => c.name));
  for (let i = 0; i < 100; i++) assert.ok(kept.has(`T${pad4(i)}a`), `triple ${i} is kept`);
  for (let i = 0; i < 900; i++) assert.ok(kept.has(`P${pad4(i)}b`), `pair ${i} is kept`);
  for (let i = 900; i < 1000; i++) {
    for (const t of [`P${pad4(i)}a`, `P${pad4(i)}b`]) assert.equal(sky.stars.constellation[sky.stars.title.indexOf(t)], null, t);
  }
  assert.deepEqual(sky.constellations.map((c) => c.id), sky.constellations.map((_, i) => i));
  assert.equal(sky.stars.constellation.filter((c) => c !== null).length, 100 * 3 + 900 * 2);
}, { setup: (v) => {
  for (let i = 0; i < 100; i++) { write(v, `T${pad4(i)}a`, 'head'); write(v, `T${pad4(i)}b`, `[[T${pad4(i)}a]]`); write(v, `T${pad4(i)}c`, `[[T${pad4(i)}a]]`); }
  for (let i = 0; i < 1000; i++) { write(v, `P${pad4(i)}a`, `[[P${pad4(i)}b]]`); write(v, `P${pad4(i)}b`, 'tail'); }
} }));

// ---------------------------------------------------------------- positions (determinism)
test('SC2 reference positions: three unlinked notes sit exactly at their hash points', () => withServer(async (s) => {
  const sky = await skyOf(s);
  const pos = starMap(sky);
  assert.deepEqual(pos.get('Ideas'), [-971.85, -2767.39]);
  assert.deepEqual(pos.get('Orphan'), [-2308.84, 507.13]);
  assert.deepEqual(pos.get('Alpha'), [709.97, 2400.81]);
  assert.deepEqual(hashPoint2('ideas'), [-971.85, -2767.39], 'the test helper agrees with the spec table');
}, { setup: (v) => { for (const t of ['Ideas', 'Orphan', 'Alpha']) write(v, t, 'x'); } }));

test('SC2 reference positions: Welcome and Hub (unlinked) sit at (-2536.32, 1363.31) and (2612.49, 1119.7)', () => withServer(async (s) => {
  const pos = starMap(await skyOf(s));
  assert.deepEqual(pos.get('Welcome'), [-2536.32, 1363.31]);
  assert.deepEqual(pos.get('Hub'), [2612.49, 1119.7]);
}, { setup: (v) => { write(v, 'Welcome', 'x'); write(v, 'Hub', 'x'); } }));

test('SC2 singletons keep their base point: every unlinked note without a neighbour within 12 units is at round2(hashPoint(key)), inside the 3000 disk', () => withServer(async (s) => {
  const sky = await skyOf(s);
  const pos = starMap(sky);
  const titles = [...pos.keys()];
  const base = new Map(titles.map((t) => [t, hashPoint2(titleKeyOf(t))]));
  let checked = 0;
  for (const t of titles) {
    const [bx, by] = base.get(t);
    const crowded = titles.some((u) => u !== t && Math.hypot(base.get(u)[0] - bx, base.get(u)[1] - by) < 30);
    if (crowded) continue;
    assert.deepEqual(pos.get(t), [bx, by], t);
    checked += 1;
  }
  assert.ok(checked >= 35, `only ${checked} singletons were checkable`);
  for (const [x, y] of pos.values()) assert.ok(Math.hypot(x, y) <= 3000.5);
}, { setup: (v) => { for (let i = 0; i < 40; i++) write(v, `Loose ${i} é\u{1F600}`, `n${i}`); } }));

test('SC2 P1 same vault and sidecar give bit-identical positions across a restart and a new port', async () => {
  const sb = sandbox();
  try {
    writeNotes(sb.vault, genVault(50, 80, 11).notes);
    const bodies = [];
    const ports = [];
    for (let run = 0; run < 3; run++) {
      await withServer(async (s) => { const sky = await skyOf(s); bodies.push([sky.stars.title, sky.stars.x, sky.stars.y, sky.edges]); ports.push(s.port); }, { sandbox: sb });
    }
    assert.deepEqual(bodies[1], bodies[0]);
    assert.deepEqual(bodies[2], bodies[0]);
    assert.ok(bodies[0][1].every((x) => Number.isFinite(x)));
    assert.ok(new Set(ports).size >= 1);
  } finally { sb.cleanup(); }
});

test('SC2 P2 a vault built in reverse creation order, with different mtimes, has identical x and y per title', async () => {
  const g = genVault(50, 80, 23);
  const maps = [];
  for (const order of ['forward', 'reverse']) {
    await withServer(async (s) => {
      maps.push(starMap(await skyOf(s)));
    }, { setup: (v) => { writeNotes(v, g.notes, order); let i = 0; for (const t of g.titles) setMtime(v, t, Date.now() - (order === 'forward' ? i++ : 1000 - i++) * 1000); } });
  }
  assert.equal(maps[0].size, 50);
  for (const [title, xy] of maps[0]) assert.deepEqual(maps[1].get(title), xy, title);
});

test('SC2 P3 adding one unlinked note moves no star more than 8.01 on either axis and none beyond 21 units of it at all (200 seeded G(50, 80) vaults)', { timeout: 240000 }, () => withServer(async (s) => {
  let moved = 0;
  let extentChecks = 0;
  for (let seed = 1; seed <= 200; seed++) {
    wipeNotes(s.vault);
    const prefix = `V${seed}-`;
    const g = genVault(50, 80, seed, prefix);
    writeNotes(s.vault, g.notes);
    const before = await skyOf(s);
    assert.equal(before.stars.title.length, 50, `seed ${seed}`);
    const newTitle = `Newcomer ${seed}`;
    write(s.vault, newTitle, 'no links in or out');
    const after = await skyOf(s);
    assert.equal(after.stars.title.length, 51);
    const a = starMap(before);
    const b = starMap(after);
    const [nx, ny] = b.get(newTitle);
    const xs = before.stars.x;
    const extent = Math.max(...xs) - Math.min(...xs);
    for (const [t, [x, y]] of a) {
      const [x2, y2] = b.get(t);
      assert.ok(Math.abs(x2 - x) <= 8.01 + 1e-9 && Math.abs(y2 - y) <= 8.01 + 1e-9, `seed ${seed} ${t} moved (${x2 - x}, ${y2 - y})`);
      if (Math.hypot(x2 - nx, y2 - ny) > 21) assert.ok(x2 === x && y2 === y, `seed ${seed} ${t} moved although ${Math.hypot(x2 - nx, y2 - ny).toFixed(1)} from the new star`);
      if (x2 !== x || y2 !== y) moved += 1;
      if (extent >= 401) { assert.ok(Math.abs(x2 - x) <= 0.02 * extent + 1e-9, `seed ${seed} ${t} check 8`); extentChecks += 1; }
    }
  }
  assert.ok(extentChecks > 0);
  assert.ok(moved >= 0);
}));

test('SC2 P3 a new unlinked note dropped within 12 units of a star nudges it by at most 8.01 (hand case)', () => withServer(async (s) => {
  const before = starMap(await skyOf(s));
  // find a title whose base point is near Ideas' base point: search deterministically with the spec hash
  const [ix, iy] = before.get('Ideas');
  let near = null;
  for (let i = 0; i < 400000 && !near; i++) {
    const t = `Probe ${i}`;
    const [px, py] = hashPoint2(titleKeyOf(t));
    if (Math.hypot(px - ix, py - iy) < 9) near = { t, px, py };
  }
  if (!near) return; // no such title among the candidates: the 200-seed test covers the property
  write(s.vault, near.t, 'x');
  const after = starMap(await skyOf(s));
  const [x2, y2] = after.get('Ideas');
  assert.ok(Math.abs(x2 - ix) <= 8.01 + 1e-9 && Math.abs(y2 - iy) <= 8.01 + 1e-9, `moved (${x2 - ix}, ${y2 - iy})`);
  const [px, py] = after.get(near.t);
  assert.ok(Math.hypot(px - x2, py - y2) >= 6, 'the two stars are pushed apart');
  for (const [t, xy] of before) if (t !== 'Ideas') assert.deepEqual(after.get(t), xy, t);
}, { setup: (v) => { for (const t of ['Ideas', 'Orphan', 'Alpha']) write(v, t, 'x'); }, timeout: 120000 }));

test('SC2 a content-only PUT keeps every x and y, changes mtime and therefore the body and the ETag, and never reruns the layout', () => retryOnRollover(() => withServer(async (s) => {
  const before = await getSky(s);
  const note = await getNote(s, 'N03');
  const put = await putNote(s, 'N03', 'Rewritten words, with exactly the same links as before.\nSee [[N04]].\n', note.body.revision);
  assert.equal(put.status, 200);
  const after = await getSky(s);
  rolloverGuard(before.body, after.body);
  assert.deepEqual(after.body.stars.x, before.body.stars.x);
  assert.deepEqual(after.body.stars.y, before.body.stars.y);
  assert.deepEqual(after.body.edges, before.body.edges);
  const i = after.body.stars.title.indexOf('N03');
  assert.ok(after.body.stars.mtime[i] > before.body.stars.mtime[i]);
  assert.notEqual(after.headers.etag, before.headers.etag);
  assert.notDeepEqual(after.buffer, before.buffer);
}, { setup: (v) => {
  const g = genVault(10, 0, 3);
  g.titles.forEach((t, i) => write(v, t, `Note ${t}.\n${i === 3 ? 'See [[N04]].\n' : i < 9 ? `See [[N${pad2(i + 1)}]].\n` : ''}`));
  for (const t of g.titles) setMtime(v, t, Date.now() - 3600000);
} })));

test('SC2 adding or removing a link changes the layout input, so positions may move only inside the touched component', () => withServer(async (s) => {
  const before = starMap(await skyOf(s));
  const n = await getNote(s, 'N00');
  await putNote(s, 'N00', 'Note N00.\nSee [[N01]].\nSee [[N45]].\n', n.body.revision);
  const after = starMap(await skyOf(s));
  assert.equal(after.size, before.size);
  let same = 0;
  for (const [t, xy] of before) if (after.get(t)[0] === xy[0] && after.get(t)[1] === xy[1]) same += 1;
  assert.ok(same >= 40, `only ${same} of 50 stars kept their position when one link was added`);
}, { setup: (v) => writeNotes(v, genVault(50, 40, 5).notes) }));

test('SC3 P5 writing an unlit star keeps its exact position and every other position unchanged', () => withServer(async (s) => {
  const before = await skyOf(s);
  assert.deepEqual(before.unlit.title, ['Ideas', 'Plans']);
  const unlitPos = unlitMap(before);
  const stars = starMap(before);
  const created = await s.call('POST', '/api/notes', { title: 'Ideas' });
  assert.equal(created.status, 201);
  const after = await skyOf(s);
  assert.deepEqual(after.unlit.title, ['Plans']);
  const lit = starMap(after);
  assert.deepEqual(lit.get('Ideas'), unlitPos.get('Ideas'), 'the star lights up in place');
  for (const [t, xy] of stars) assert.deepEqual(lit.get(t), xy, t);
  assert.deepEqual(unlitMap(after).get('Plans'), unlitPos.get('Plans'));
  assert.equal(after.unlitTotal, 1);
  assert.ok(after.stars.constellation[after.stars.title.indexOf('Ideas')] !== null, 'the new star joins the constellation of its linkers');
}, { setup: (v) => {
  write(v, 'Welcome', 'See [[Ideas]] and [[Plans]]');
  write(v, 'Other', 'See [[Ideas]]');
  write(v, 'Loner', 'x');
  write(v, 'Pair a', '[[Pair b]]'); write(v, 'Pair b', 'x');
} }));

// ---------------------------------------------------------------- ETag and 304
test('SC2 two requests in one bucket with no change return byte-identical bodies and the same ETag', () => retryOnRollover(async () => {
  await withServer(async (s) => {
    const a = await getSky(s);
    const b = await getSky(s);
    rolloverGuard(a.body, b.body);
    assert.deepEqual(a.buffer, b.buffer);
    assert.equal(a.headers.etag, b.headers.etag);
    await sleep(50);
    const c = await getSky(s);
    rolloverGuard(a.body, c.body);
    assert.equal(c.headers.etag, a.headers.etag);
  }, { setup: (v) => writeNotes(v, genVault(20, 25, 2).notes) });
}));

test('SC2 If-None-Match with exactly the current ETag is 304 with an empty body, no content type and the security headers; every other form is a normal 200', () => retryOnRollover(() => withServer(async (s) => {
  const res = await getSky(s);
  const etag = res.headers.etag;
  const ok = await s.call('GET', '/api/sky', undefined, { headers: { 'if-none-match': etag } });
  rolloverGuard(res.body, ok.body ?? res.body);
  assert.equal(ok.status, 304);
  assert.equal(ok.text, '');
  assert.equal(ok.buffer.length, 0);
  assert.equal(ok.headers.etag, etag);
  assert.equal(ok.headers['cache-control'], 'no-store');
  assert.equal(ok.headers['content-type'], undefined);
  assert.equal(ok.headers['x-content-type-options'], 'nosniff');
  assert.equal(ok.headers['content-security-policy'].includes("frame-ancestors 'none'"), true);
  const stale = `"${'0'.repeat(32)}"`;
  for (const value of [`W/${etag}`, `${etag}, ${stale}`, `${stale}, ${etag}`, '*', stale, etag.slice(1, -1), `${etag} `.trim() + 'x', '']) {
    const r = await s.call('GET', '/api/sky', undefined, { headers: { 'if-none-match': value } });
    assert.equal(r.status, 200, JSON.stringify(value));
    assert.equal(r.headers.etag, etag);
    assert.ok(r.buffer.length > 100, JSON.stringify(value));
  }
}, { setup: (v) => writeNotes(v, genVault(8, 10, 4).notes) })));

test('SC2 the ETag follows the vault: a stale ETag misses after a change, and only /api/sky honours If-None-Match', () => retryOnRollover(() => withServer(async (s) => {
  const first = await getSky(s);
  await mk(s, 'Newcomer', 'fresh');
  const second = await getSky(s);
  rolloverGuard(first.body, second.body);
  assert.notEqual(second.headers.etag, first.headers.etag);
  const miss = await s.call('GET', '/api/sky', undefined, { headers: { 'if-none-match': first.headers.etag } });
  assert.equal(miss.status, 200);
  assert.equal(miss.headers.etag, second.headers.etag);
  const hit = await s.call('GET', '/api/sky', undefined, { headers: { 'if-none-match': second.headers.etag } });
  assert.equal(hit.status, 304);
  const listed = await s.call('GET', '/api/notes', undefined, { headers: { 'if-none-match': '*' } });
  assert.equal(listed.status, 200);
  const unlit = await s.call('GET', '/api/unlit', undefined, { headers: { 'if-none-match': second.headers.etag } });
  assert.equal(unlit.status, 200);
  const graph = await s.call('GET', '/api/graph', undefined, { headers: { 'if-none-match': '*' } });
  assert.equal(graph.status, 200);
  const note = await getNote(s, 'Newcomer');
  const cond = await s.call('GET', '/api/notes/Newcomer', undefined, { headers: { 'if-none-match': `"${note.body.revision}"` } });
  assert.equal(cond.status, 200);
}, { setup: (v) => writeNotes(v, genVault(6, 6, 9).notes) })));

test('check 53: files added, changed, removed, in subfolders or as .txt show up in /api/sky and /api/unlit without a restart', () => withServer(async (s) => {
  assert.deepEqual((await skyOf(s)).stars.title, []);
  write(s.vault, 'Ext', 'one [[Later]]');
  let sky = await skyOf(s);
  assert.deepEqual(sky.stars.title, ['Ext']);
  assert.deepEqual(sky.unlit.title, ['Later']);
  fs.writeFileSync(s.file('notes.txt'), 'not a note [[Nope]]');
  fs.mkdirSync(s.file('sub'));
  fs.writeFileSync(path.join(s.vault, 'sub', 'Deep.md'), '[[Ext]] [[Deeper]]');
  sky = await skyOf(s);
  assert.deepEqual(sky.stars.title, ['Ext'], 'subfolders and .txt files are not stars');
  assert.deepEqual(sky.unlit.title, ['Later']);
  write(s.vault, 'Later', 'now written; links [[Ext]]');
  sky = await skyOf(s);
  assert.deepEqual(sky.stars.title, ['Ext', 'Later']);
  assert.deepEqual(sky.unlit.title, []);
  assert.deepEqual(sky.edges, [0, 1]);
  const before = sky.stars.mtime[0];
  await sleep(15);
  fs.appendFileSync(s.file('Ext.md'), ' more words');
  sky = await skyOf(s);
  assert.ok(sky.stars.mtime[0] > before, 'a changed file shows a new mtime');
  fs.unlinkSync(s.file('Later.md'));
  sky = await skyOf(s);
  assert.deepEqual(sky.stars.title, ['Ext']);
  assert.deepEqual(sky.unlit.title, ['Later']);
  assert.deepEqual((await s.call('GET', '/api/unlit')).body.unlit.map((u) => u.title), ['Later']);
  fs.unlinkSync(s.file('Ext.md'));
  sky = await skyOf(s);
  assert.deepEqual([sky.stars.title, sky.unlit.title, sky.edges], [[], [], []]);
}));

test('SC6 hostile and special note names and titles are data: prototype names, emoji, RTL and quotes come back byte for byte in valid JSON', () => withServer(async (s) => {
  const res = await getSky(s);
  const titles = ["O'Brien & Sons", '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'école ‮ rtl \u{1F600}'.normalize('NFC')];
  for (const t of titles) assert.ok(res.body.stars.title.includes(t), t);
  assert.equal(Object.getPrototypeOf(res.body.stars), Object.prototype);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(res.body.unlit.title, ['valueOf']);
  const bad = await s.call('POST', '/api/notes', { title: '<img src=x onerror=alert(1)>' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'title_char');
  assert.deepEqual(listVault(s.vault).length, titles.length);
}, { setup: (v) => {
  write(v, "O'Brien & Sons", '[[__proto__]] [[constructor]]');
  write(v, '__proto__', '[[toString]] [[valueOf]]');
  write(v, 'constructor', '[[hasOwnProperty]]');
  write(v, 'toString', 'x');
  write(v, 'hasOwnProperty', '[[__proto__]]');
  write(v, 'école ‮ rtl \u{1F600}'.normalize('NFC'), 'x');
} }));

test('SC2 the sky routes: query strings are ignored, /api/sky/x and /api/unlit/ are 404 not_found, other methods are 405 with Allow GET', () => withServer(async (s) => {
  assert.equal((await s.call('GET', '/api/sky?foo=bar')).status, 200);
  assert.equal((await s.call('GET', '/api/unlit?x=1')).status, 200);
  for (const [method, url] of [['GET', '/api/sky/x'], ['GET', '/api/unlit/'], ['GET', '/api/sky/'], ['POST', '/api/sky/x'], ['DELETE', '/api/samples/x']]) {
    const res = await s.call(method, url, method === 'POST' ? {} : undefined);
    assert.equal(res.status, 404, `${method} ${url}`);
    assert.equal(res.body.error.code, 'not_found');
  }
  for (const [method, url] of [['POST', '/api/sky'], ['PUT', '/api/unlit'], ['DELETE', '/api/sky'], ['HEAD', '/api/sky'], ['OPTIONS', '/api/unlit']]) {
    const res = await s.call(method, url, method === 'POST' || method === 'PUT' ? {} : undefined);
    assert.equal(res.status, 405, `${method} ${url}`);
    assert.equal(res.headers.allow, 'GET');
  }
  const viaIp = await s.call('GET', '/api/sky', undefined, { headers: { host: `127.0.0.1:${s.port}` } });
  assert.equal(viaIp.status, 200);
  const evil = await s.call('GET', '/api/sky', undefined, { headers: { host: 'evil.example' } });
  assert.equal(evil.status, 403);
  assert.equal(evil.body.error.code, 'bad_host');
}));

test('constraint: src/sky-layout.js and src/sky-seeds.js use only + - * / and Math.sqrt (no trigonometry, log, exp, pow, hypot, cbrt or **)', () => {
  for (const f of ['sky-layout.js', 'sky-seeds.js']) {
    const src = fs.readFileSync(path.join(APP_DIR, 'src', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
    assert.doesNotMatch(src, /Math\s*\.\s*(sin|cos|tan|atan|atan2|log|log2|log10|exp|pow|hypot|cbrt|sinh|cosh|tanh|asin|acos)\b/, f);
    assert.doesNotMatch(src, /\*\*/, f);
  }
});

// ---------------------------------------------------------------- performance (SC9)
const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim minim veniam quis nostrud'.split(' ');
function paragraph(seed, minLength) {
  let out = '';
  let k = seed;
  while (out.length < minLength) { k = (k * 31 + 7) % 9973; out += `${LOREM[k % LOREM.length]} `; if (k % 17 === 0) out += '\n'; }
  return out;
}

test('SC9 perf: 1,000 notes give GET /api/sky in under 1 s, every time, with the exact star and edge counts', { timeout: 120000 }, () => withServer(async (s) => {
  const times = [];
  let last;
  for (let i = 0; i < 4; i++) {
    const t0 = performance.now();
    last = await getSky(s);
    times.push(performance.now() - t0);
  }
  assert.ok(Math.max(...times) < 1000, `GET /api/sky took ${times.map((t) => t.toFixed(0)).join(', ')} ms`);
  const sky = last.body;
  assert.equal(sky.stars.title.length, 1000);
  assert.equal(sky.edges.length / 2, 2000);
  assert.equal(sky.stars.constellation.every((c) => c === 0), true, 'a ring with chords is one component');
  assert.ok(sky.constellations.length >= 1);
}, { setup: (v) => {
  for (let i = 0; i < 1000; i++) write(v, `Note ${pad4(i)}`, `Links to [[Note ${pad4((i + 1) % 1000)}]] and [[note ${pad4((i + 2) % 1000)}|two]].\n${paragraph(i, 300)}\n`);
} }));

test('SC9 perf: 5,000 notes with 10,000 links and 2,000 unlit stars: ready within 3 s, body at most 1,500,000 bytes, warm sky median under 300 ms, a cold-layout sky under 1 s, search median under 300 ms', { timeout: 300000 }, () => withServer(async (s) => {
  assert.ok(s.readyMs < 3000, `ready line after ${s.readyMs.toFixed(0)} ms`);
  const first = await getSky(s);
  assert.ok(first.buffer.length <= 1500000, `body is ${first.buffer.length} bytes`);
  assert.equal(first.body.stars.title.length, 5000);
  assert.equal(first.body.unlit.title.length, 2000);
  assert.equal(first.body.unlitTotal, 2000);
  assert.equal(first.body.edges.length / 2, 10000 - 0);
  const warm = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    const res = await getSky(s);
    warm.push(performance.now() - t0);
    assert.equal(res.status, 200);
  }
  assert.ok(median(warm) < 300, `warm median ${median(warm).toFixed(0)} ms (${warm.map((t) => t.toFixed(0)).join(', ')})`);
  // one PUT that adds a link, then a cold-layout GET
  const note = await getNote(s, 'Note 2500');
  const put = await putNote(s, 'Note 2500', `${note.body.content}\nAlso see [[Note 0042]].\n`, note.body.revision);
  assert.equal(put.status, 200);
  const t0 = performance.now();
  const cold = await getSky(s);
  const coldMs = performance.now() - t0;
  assert.ok(coldMs < 1000, `cold sky took ${coldMs.toFixed(0)} ms`);
  assert.equal(cold.body.edges.length / 2, 10001);
  const search = [];
  for (let i = 0; i < 3; i++) {
    const s0 = performance.now();
    const res = await s.call('GET', '/api/search?q=quarterly');
    search.push(performance.now() - s0);
    assert.equal(res.body.total, 100);
  }
  assert.ok(median(search) < 300, `search median ${median(search).toFixed(0)} ms`);
}, { setup: (v) => {
  // 10,000 links: notes 0..1999 link to one live note and one missing note, the others to two live notes
  for (let i = 0; i < 5000; i++) {
    const links = i < 2000
      ? [`[[Note ${pad4((i + 1) % 5000)}]]`, `[[Missing ${pad4(i)}]]`]
      : [`[[Note ${pad4((i + 1) % 5000)}]]`, `[[Note ${pad4((i + 7) % 5000)}]]`];
    const marker = i % 50 === 0 ? ' quarterly ' : ' ';
    write(v, `Note ${pad4(i)}`, `${links.join(' ')}\n${paragraph(i, 700)}${marker}${paragraph(i + 1, 700)}\n`);
  }
} }));
