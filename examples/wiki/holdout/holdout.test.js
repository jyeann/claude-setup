// Hidden grading tests for the wiki. Rules from spec.md that are easy to miss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Resolved from the working directory so the gate grades the trial's own acceptance/helpers.js and code,
// also when this folder is hidden somewhere else (HARNESS_HIDDEN_DIR).
const here = (...p) => path.join(process.cwd(), ...p);
const { withServer, mk, enc, getNote, putNote, listVault, sha32 } = await import(pathToFileURL(here('acceptance', 'helpers.js')).href);
const wikilink = () => import(pathToFileURL(here('public', 'js', 'wikilink.js')).href);
const titlesMod = () => import(pathToFileURL(here('public', 'js', 'titles.js')).href);

const code = (res, status, c) => {
  assert.equal(res.status, status, res.text);
  assert.equal(res.body.error.code, c, res.text);
};
const noLoneSurrogates = (str) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(str);

test('unicode titles are NFC everywhere: lookup, duplicates, links and a decomposed file name on disk', () => withServer(async (s) => {
  const nfd = 'Cafe\u0301';
  const nfc = 'Caf\u00E9';
  assert.deepEqual((await s.call('GET', '/api/notes')).body.notes.map((n) => n.title), [nfc]);
  const got = await getNote(s, nfd);
  assert.equal(got.status, 200);
  assert.equal(got.body.title, nfc);
  assert.equal((await getNote(s, nfc.toUpperCase())).status, 200);
  const dup = await s.call('POST', '/api/notes', { title: `  ${nfd}  ` });
  code(dup, 409, 'title_exists');
  assert.equal(dup.body.error.existing, nfc);
  await mk(s, 'Linker', `see [[${nfd}]] and [[CAF\u00C9|x]]`);
  const back = await s.call('GET', `${enc(nfd)}/backlinks`);
  assert.deepEqual(back.body.backlinks.map((b) => b.title), ['Linker']);
  const put = await putNote(s, nfc, 'edited', got.body.revision);
  assert.equal(put.status, 200);
  const files = fs.readdirSync(s.vault).filter((n) => !n.startsWith('.')).sort();
  assert.deepEqual(files, [`${nfd}.md`, 'Linker.md'].sort(), 'the save went to the existing on-disk file name');
  assert.equal(fs.readFileSync(path.join(s.vault, `${nfd}.md`), 'utf8'), 'edited');
}, { setup: (v) => fs.writeFileSync(path.join(v, 'Cafe\u0301.md'), 'x') }));

test('the 240 byte limit counts UTF-8 bytes of the normalised title, not characters', () => withServer(async (s) => {
  const ok = ['\u20AC'.repeat(80), '\u{1F600}'.repeat(60), 'e\u0301'.repeat(120)];
  for (const title of ok) assert.equal((await s.call('POST', '/api/notes', { title })).status, 201, `${[...title].length} chars`);
  for (const title of ['\u20AC'.repeat(80) + 'a', '\u{1F600}'.repeat(61), '\u00E9'.repeat(200), '\u00E9'.repeat(121), 'a'.repeat(150) + '\u20AC'.repeat(31)]) {
    code(await s.call('POST', '/api/notes', { title }), 400, 'title_too_long_bytes');
  }
  code(await s.call('POST', '/api/notes', { title: '\u00E9'.repeat(201) }), 400, 'title_too_long');
  code(await s.call('POST', '/api/notes', { title: '\u{1F600}'.repeat(201) }), 400, 'title_too_long');
  assert.equal(listVault(s.vault).length, ok.length);
}));

test('reserved device names match the part before the first dot, case-insensitively, and nothing longer or shorter', () => withServer(async (s) => {
  for (const [title, shown] of [['aux', 'aux'], ['Lpt1.backup', 'Lpt1'], ['COM9', 'COM9'], ['nul.txt.bak', 'nul'], ['  Prn  ', 'Prn'], ['cOn.', null]]) {
    const res = await s.call('POST', '/api/notes', { title });
    if (shown === null) { code(res, 400, 'title_trailing_dot'); continue; }
    code(res, 400, 'title_reserved');
    assert.equal(res.body.error.message, `"${shown}" is a reserved name. Choose another title.`);
  }
  for (const title of ['COM10', 'console', 'auxiliary', 'LPT0', 'prn2', 'a.con', 'my con', 'nul\u00E9']) {
    assert.equal((await s.call('POST', '/api/notes', { title })).status, 201, title);
  }
  const { validateTitle } = await titlesMod();
  assert.equal(validateTitle('LPT7.x').code, 'title_reserved');
  assert.equal(validateTitle('LPT7 x').ok, true);
}));

test('rename rewrites all case variants and labels with spaces, lists updated notes by key, and skips tilde and four-backtick code', () => withServer(async (s) => {
  await mk(s, 'Old Name', 'self [[old name]]');
  await mk(s, 'zeta', 'z [[OLD NAME|  two  words  ]] [[ Old Name ]]');
  await mk(s, 'Alpha', '[[old name|a]] [[Old Name|]]\n~~~\n[[Old Name]]\n~~~\n[[old NAME]]');
  await mk(s, 'mid', '````\n```\n[[Old Name]]\n```\n````\nafter [[Old Name]]');
  await mk(s, 'codeonly', '~~~md\n[[Old Name]]\n~~~\n`[[Old Name]]`');
  await mk(s, 'plain', 'no links at all\r\n');
  const untouched = ['codeonly.md', 'plain.md'].map((n) => s.read(n));
  const res = await s.call('POST', '/api/notes/old%20name/rename', { title: 'New & Better \u00E9' });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.title, 'New & Better \u00E9');
  assert.deepEqual(res.body.updated, ['Alpha', 'mid', 'zeta']);
  assert.deepEqual(res.body.failed, []);
  assert.equal(s.read('zeta.md').toString(), 'z [[New & Better \u00E9|  two  words  ]] [[New & Better \u00E9]]');
  assert.equal(s.read('Alpha.md').toString(), '[[New & Better \u00E9|a]] [[New & Better \u00E9|]]\n~~~\n[[Old Name]]\n~~~\n[[New & Better \u00E9]]');
  assert.equal(s.read('mid.md').toString(), '````\n```\n[[Old Name]]\n```\n````\nafter [[New & Better \u00E9]]');
  assert.equal(s.read('New & Better \u00E9.md').toString(), 'self [[New & Better \u00E9]]');
  assert.deepEqual(['codeonly.md', 'plain.md'].map((n) => s.read(n)), untouched);
  assert.equal(res.body.revision, sha32(s.read('New & Better \u00E9.md')));
}));

test('links inside tilde fences, longer fences and after a closing fence are classified correctly for backlinks and the graph', () => withServer(async (s) => {
  await mk(s, 'Target', 'x');
  await mk(s, 'Tilde', '~~~\n[[Target]]\n~~~');
  await mk(s, 'Four', '````\n```\n[[Target]]\n```\n````');
  await mk(s, 'NotClosed', '```\n[[Target]]\n``` still code\n[[Target]]');
  await mk(s, 'After', '```\ncode\n```\nreal [[Target]]');
  await mk(s, 'Indented', '   ```\n[[Target]]\n   ```\n    [[Target]] four spaces is not code');
  const back = await s.call('GET', '/api/notes/Target/backlinks');
  assert.deepEqual(back.body.backlinks.map((b) => [b.title, b.snippet]), [
    ['After', 'real [[Target]]'],
    ['Indented', '[[Target]] four spaces is not code'],
  ]);
  const graph = await s.call('GET', '/api/graph');
  assert.deepEqual(graph.body.edges, [['After', 'Target'], ['Indented', 'Target']]);
  const orphans = graph.body.nodes.filter((n) => n.orphan).map((n) => n.title);
  assert.deepEqual(orphans, ['Four', 'NotClosed', 'Tilde']);
}));

test('an unclosed fence hides every later link from backlinks and rename, but not earlier ones', () => withServer(async (s) => {
  await mk(s, 'Target', 'x');
  await mk(s, 'Src', 'before [[Target]]\n```\n[[Target]] hidden\nmore [[Target]]');
  const back = await s.call('GET', '/api/notes/Target/backlinks');
  assert.deepEqual(back.body.backlinks, [{ title: 'Src', snippet: 'before [[Target]]' }]);
  const res = await s.call('POST', '/api/notes/Target/rename', { title: 'Moved' });
  assert.deepEqual(res.body.updated, ['Src']);
  assert.equal(s.read('Src.md').toString(), 'before [[Moved]]\n```\n[[Target]] hidden\nmore [[Target]]');
  const { scanCode } = await wikilink();
  const text = 'a\n```\nb';
  assert.deepEqual(scanCode(text).map((r) => r.end), [text.length]);
}));

test('inline code uses matching backtick runs; a lone backtick is literal text', () => withServer(async (s) => {
  await mk(s, 'Target', 'x');
  await mk(s, 'Doubles', '``[[Target]]` still code`` and [[Target]]');
  await mk(s, 'Lone', 'a stray ` backtick [[Target]]');
  await mk(s, 'CrossLine', '`open\n[[Target]]`');
  await mk(s, 'OnlyCode', '`[[Target]]` and ``[[Target]]``');
  const back = await s.call('GET', '/api/notes/Target/backlinks');
  assert.deepEqual(back.body.backlinks.map((b) => b.title), ['CrossLine', 'Doubles', 'Lone']);
  const rn = await s.call('POST', '/api/notes/Target/rename', { title: 'T2' });
  assert.deepEqual(rn.body.updated, ['CrossLine', 'Doubles', 'Lone']);
  assert.equal(s.read('Doubles.md').toString(), '``[[Target]]` still code`` and [[T2]]');
  assert.equal(s.read('OnlyCode.md').toString(), '`[[Target]]` and ``[[Target]]``');
  const { parseWikilinks } = await wikilink();
  assert.deepEqual(parseWikilinks('``[[A]]` x`` [[B]]').map((l) => l.target), ['B']);
}));

test('a backlink snippet is the line of the first matching link, trimmed and cut to 160 code points', () => withServer(async (s) => {
  await mk(s, 'Target', 'x');
  await mk(s, 'Two', 'intro\n\t  first [[target]] line  \nsecond [[Target]] line');
  await mk(s, 'Skips', '[[Other]] only on line one\n[[../Target]] invalid\n`[[Target]]` code\nreal [[TARGET|t]]');
  await mk(s, 'Long', `[[Target]] ${'\u{1F600}'.repeat(200)}`);
  const back = await s.call('GET', '/api/notes/target/backlinks');
  assert.deepEqual(back.body.backlinks.map((b) => b.title), ['Long', 'Skips', 'Two']);
  const by = Object.fromEntries(back.body.backlinks.map((b) => [b.title, b.snippet]));
  assert.equal(by.Two, 'first [[target]] line');
  assert.equal(by.Skips, 'real [[TARGET|t]]');
  assert.equal([...by.Long].length, 160);
  assert.equal(by.Long, `[[Target]] ${'\u{1F600}'.repeat(149)}`);
}));

test('graph: mutual links make one edge, labels and case do not matter, orientation follows the key order, stored casing is shown', () => withServer(async (s) => {
  await mk(s, 'beta', '[[ALPHA|x]] and [[alpha]] and [[Beta]]');
  await mk(s, 'Alpha', '[[BETA]]');
  await mk(s, 'gamma', '[[Alpha]] [[alpha|again]]');
  await mk(s, 'Delta', '[[Missing]] [[Delta]] `[[Alpha]]`');
  const res = await s.call('GET', '/api/graph');
  assert.deepEqual(res.body.nodes, [
    { title: 'Alpha', orphan: false }, { title: 'beta', orphan: false }, { title: 'Delta', orphan: true }, { title: 'gamma', orphan: false },
  ]);
  assert.deepEqual(res.body.edges, [['Alpha', 'beta'], ['Alpha', 'gamma']]);
  const back = await s.call('GET', '/api/notes/ALPHA/backlinks');
  assert.deepEqual(back.body.backlinks.map((b) => b.title), ['beta', 'gamma']);
  const found = await s.call('GET', '/api/search?q=ALPHA');
  assert.equal(found.body.results[0].title, 'Alpha');
}));

test('search ranges index the snippet including the "..." prefix, and the window never splits a surrogate pair', () => withServer(async (s) => {
  await mk(s, 'Tail', `${'a'.repeat(500)}NEEDLE`);
  await mk(s, 'Emoji', `${'\u{1F600}'.repeat(100)}needle${'\u{1F600}'.repeat(100)}`);
  await mk(s, 'Twice', `${'b'.repeat(150)}Needle and needle again`);
  const res = await s.call('GET', '/api/search?q=needle');
  assert.equal(res.body.total, 3);
  const by = Object.fromEntries(res.body.results.map((r) => [r.title, r]));
  const tailBody = `${'a'.repeat(500)}NEEDLE`;
  assert.equal(by.Tail.snippet, `...${tailBody.slice(386, 506)}`);
  assert.deepEqual(by.Tail.ranges, [[117, 123]]);
  assert.equal(by.Tail.snippet.slice(117, 123), 'NEEDLE');
  assert.ok(by.Emoji.snippet.startsWith('...') && by.Emoji.snippet.endsWith('...'));
  assert.ok(noLoneSurrogates(by.Emoji.snippet), 'no split surrogate pair');
  assert.equal(by.Emoji.ranges.length, 1);
  const [es, ee] = by.Emoji.ranges[0];
  assert.equal(by.Emoji.snippet.slice(es, ee), 'needle');
  assert.ok(es >= 3);
  const twice = by.Twice;
  assert.ok(twice.snippet.startsWith('...'));
  assert.equal(twice.ranges.length, 2);
  for (const [a, b] of twice.ranges) assert.equal(twice.snippet.slice(a, b).toLowerCase(), 'needle');
  assert.ok(twice.ranges[0][1] <= twice.ranges[1][0]);
}));

test('files over 8 MiB are listed but never searched or linked; a file of exactly 8 MiB still is', () => withServer(async (s) => {
  const list = await s.call('GET', '/api/notes');
  const sizes = Object.fromEntries(list.body.notes.map((n) => [n.title, n.size]));
  assert.equal(sizes.Big, 8 * 1024 * 1024 + 1);
  assert.equal(sizes.Edge, 8 * 1024 * 1024);
  const search = await s.call('GET', '/api/search?q=needle');
  assert.deepEqual(search.body.results.map((r) => r.title), ['Edge']);
  const back = await s.call('GET', '/api/notes/Target/backlinks');
  assert.deepEqual(back.body.backlinks.map((b) => b.title), ['Edge']);
  const graph = await s.call('GET', '/api/graph');
  assert.deepEqual(graph.body.edges, [['Edge', 'Target']]);
  assert.equal(graph.body.nodes.find((n) => n.title === 'Big').orphan, true);
}, { setup: (v) => {
  const fill = (head, total) => Buffer.concat([Buffer.from(head), Buffer.alloc(total - Buffer.byteLength(head), 'x')]);
  fs.writeFileSync(path.join(v, 'Big.md'), fill('[[Target]] needle ', 8 * 1024 * 1024 + 1));
  fs.writeFileSync(path.join(v, 'Edge.md'), fill('[[Target]] needle ', 8 * 1024 * 1024));
  fs.writeFileSync(path.join(v, 'Target.md'), 'target');
} }));

test('a file with invalid UTF-8 reads with U+FFFD, and its revision is the hash of the raw bytes', () => withServer(async (s) => {
  const raw = Buffer.from([0x66, 0xff, 0x6f, 0xc3]);
  const got = await getNote(s, 'Binary');
  assert.equal(got.status, 200);
  assert.equal(got.body.content, 'f\uFFFDo\uFFFD');
  assert.equal(got.body.revision, sha32(raw));
  assert.equal((await s.call('GET', '/api/notes')).body.notes[0].size, 4);
  const put = await putNote(s, 'Binary', 'clean', got.body.revision);
  assert.equal(put.status, 200);
  assert.equal(s.read('Binary.md').toString(), 'clean');
}, { setup: (v) => fs.writeFileSync(path.join(v, 'Binary.md'), Buffer.from([0x66, 0xff, 0x6f, 0xc3])) }));

test('PUT stores CRLF, BOM, lone CR and a missing final newline byte for byte', () => withServer(async (s) => {
  let rev = (await mk(s, 'Eol')).revision;
  for (const content of ['a\r\nb\r\n\r\n', '\uFEFFbom\r\n', 'no newline', '\r', 'mixed\r\nunix\nold\rend\r\n', '', '  \t trailing  ']) {
    const put = await putNote(s, 'Eol', content, rev);
    assert.equal(put.status, 200);
    rev = put.body.revision;
    assert.deepEqual(s.read('Eol.md'), Buffer.from(content, 'utf8'), JSON.stringify(content));
    const got = await getNote(s, 'Eol');
    if (!content.startsWith('\uFEFF')) assert.equal(got.body.content, content);
    assert.equal(got.body.revision, sha32(Buffer.from(content, 'utf8')));
  }
  const created = await s.call('POST', '/api/notes', { title: 'Eol2', content: 'x\r\ny\r\n' });
  assert.deepEqual(s.read('Eol2.md'), Buffer.from('x\r\ny\r\n'));
  assert.equal(created.body.revision, sha32(Buffer.from('x\r\ny\r\n')));
}));

test('If-Match accepts only one quoted strong revision: lists, unquoted, upper-case, weak and empty values are mismatches', () => withServer(async (s) => {
  const { revision } = await mk(s, 'Doc', 'v1');
  assert.match(revision, /[a-f]/, 'test needs a letter in the revision to check case');
  const forms = [revision, `"${revision}", "${'0'.repeat(32)}"`, `"${'0'.repeat(32)}", "${revision}"`, `"${revision.toUpperCase()}"`,
    `w/"${revision}"`, 'W/' + `"${revision}"`, '""', '"', `'${revision}'`, `"${revision.slice(0, 31)}"`, `"${revision}0"`];
  for (const value of forms) {
    const put = await s.call('PUT', '/api/notes/Doc', { content: 'x' }, { headers: { 'if-match': value } });
    code(put, 412, 'conflict');
    assert.equal(put.body.error.currentRevision, revision, value);
    const del = await s.call('DELETE', '/api/notes/Doc', undefined, { headers: { 'if-match': value } });
    code(del, 412, 'conflict');
  }
  assert.equal(s.read('Doc.md').toString(), 'v1');
  assert.equal((await putNote(s, 'Doc', 'v2', revision)).status, 200);
  const rev2 = sha32(Buffer.from('v2'));
  assert.equal((await s.call('DELETE', '/api/notes/Doc', undefined, { headers: { 'if-match': `"${rev2}"` } })).status, 204);
  assert.deepEqual(listVault(s.vault), []);
}));

test('the search query length is counted in code points after NFC and trim', () => withServer(async (s) => {
  const decomposed200 = 'e\u0301'.repeat(200);
  const ok = await s.call('GET', `/api/search?q=${encodeURIComponent(decomposed200)}`);
  assert.equal(ok.status, 200, 'decomposed text that normalises to 200 characters is allowed');
  assert.equal(ok.body.query, '\u00E9'.repeat(200));
  code(await s.call('GET', `/api/search?q=${encodeURIComponent('e\u0301'.repeat(201))}`), 400, 'bad_request');
  assert.equal((await s.call('GET', `/api/search?q=${encodeURIComponent('\u{1F600}'.repeat(200))}`)).status, 200);
  code(await s.call('GET', `/api/search?q=${encodeURIComponent('\u{1F600}'.repeat(201))}`), 400, 'bad_request');
  assert.equal((await s.call('GET', `/api/search?q=${encodeURIComponent(`  ${'a'.repeat(200)}\n`)}`)).status, 200);
}));

test('shared wikilink module: rewriting keeps an untrimmed label and parse offsets address the original text', async () => {
  const { rewriteWikilinks, parseWikilinks } = await wikilink();
  const text = 'x [[Ideas|  two words  ]] y [[ ideas ]]\r\n`[[Ideas]]`';
  const out = rewriteWikilinks(text, 'ideas', 'New');
  assert.deepEqual(out, { text: 'x [[New|  two words  ]] y [[New]]\r\n`[[Ideas]]`', count: 2 });
  for (const l of parseWikilinks(text)) assert.ok(text.slice(l.start, l.end).startsWith('[['));
  assert.equal(parseWikilinks(text).length, 2);
});
