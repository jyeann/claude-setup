import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openVault } from '../src/vault.js';
import { Index } from '../src/index.js';
import { revisionOf, parseIfMatch } from '../src/revision.js';

function withIndex(fn, setup = () => {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-idx-')));
  try {
    const vault = openVault(path.join(base, 'v'));
    setup(vault.root);
    const logs = [];
    const index = new Index(vault, (l) => logs.push(l));
    index.scan();
    return fn(index, vault.root, logs);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}
const put = (root, name, text) => fs.writeFileSync(path.join(root, name), text);

test('revisionOf is the first 32 hex of the sha256; parseIfMatch accepts only the quoted form', () => {
  assert.equal(revisionOf(Buffer.alloc(0)), 'e3b0c44298fc1c149afbf4c8996fb924');
  assert.equal(parseIfMatch('"e3b0c44298fc1c149afbf4c8996fb924"'), 'e3b0c44298fc1c149afbf4c8996fb924');
  for (const bad of ['*', 'W/"e3b0c44298fc1c149afbf4c8996fb924"', 'e3b0c44298fc1c149afbf4c8996fb924', '"short"', undefined]) {
    assert.equal(parseIfMatch(bad), null, String(bad));
  }
});

test('scan picks up files added, changed and removed outside the app', () => withIndex((index, root) => {
  assert.deepEqual(index.list().map((e) => e.title), []);
  put(root, 'Ext.md', 'one');
  index.scan();
  assert.deepEqual(index.list().map((e) => e.title), ['Ext']);
  const gen = index.generation;
  index.scan();
  assert.equal(index.generation, gen, 'no change, no new generation');
  fs.appendFileSync(path.join(root, 'Ext.md'), ' two');
  index.scan();
  assert.equal(index.get('ext').content, 'one two');
  assert.equal(index.get('ext').revision, revisionOf(Buffer.from('one two')));
  fs.unlinkSync(path.join(root, 'Ext.md'));
  index.scan();
  assert.equal(index.get('ext'), null);
  assert.ok(index.generation > gen);
}));

test('find rescans on a miss, so a file added a moment ago is found', () => withIndex((index, root) => {
  put(root, 'Late.md', 'x');
  assert.equal(index.find('late').title, 'Late');
  assert.equal(index.find('nope'), null);
}));

test('only valid regular .md files are notes; bad stems and duplicate keys are logged once', () => withIndex((index, root, logs) => {
  index.scan();
  index.scan();
  assert.deepEqual(index.list().map((e) => e.title).sort(), ['Ideas']);
  assert.equal(index.get('ideas').content, 'upper');
  assert.equal(logs.filter((l) => l.includes('bad:name.md')).length, 1);
  assert.equal(logs.filter((l) => l.includes('ideas.md')).length, 1);
  fs.unlinkSync(path.join(root, 'Ideas.md'));
  index.scan();
  assert.equal(index.get('ideas').title, 'ideas');
}, (root) => {
  put(root, 'Ideas.md', 'upper');
  put(root, 'ideas.md', 'lower');
  put(root, 'bad:name.md', 'x');
  put(root, 'notes.txt', 'x');
  fs.mkdirSync(path.join(root, 'sub'));
  put(root, 'sub/Inner.md', 'x');
  fs.symlinkSync('Ideas.md', path.join(root, 'Link.md'));
}));

test('files over 8 MiB are listed but not read, searched or linked', () => withIndex((index) => {
  const e = index.get('huge');
  assert.equal(e.big, true);
  assert.equal(e.content, '');
  assert.deepEqual(e.links, []);
  assert.equal(e.size, 8 * 1024 * 1024 + 1);
  assert.equal(index.list().length, 2);
  assert.equal(index.search('zzzz').total, 0);
  assert.equal(index.search('huge').total, 1);
}, (root) => {
  fs.writeFileSync(path.join(root, 'Huge.md'), Buffer.alloc(8 * 1024 * 1024 + 1, 'z'));
  put(root, 'Small.md', 'tiny');
}));

test('list sorts by modified descending then key', () => withIndex((index, root) => {
  const at = (name, secs) => { const t = new Date(Date.now() - secs * 1000); fs.utimesSync(path.join(root, name), t, t); };
  at('b.md', 10); at('A.md', 10); at('C.md', 100); at('New.md', 1);
  index.scan();
  assert.deepEqual(index.list().map((e) => e.title), ['New', 'A', 'b', 'C']);
}, (root) => { for (const n of ['b', 'A', 'C', 'New']) put(root, `${n}.md`, n); }));

test('backlinks: one per source, first matching line, self excluded, sorted by key, code ignored', () => withIndex((index) => {
  assert.deepEqual(index.backlinksOf('ideas'), [
    { title: 'alpha', snippet: '[[IDEAS]] first' },
    { title: 'Zed', snippet: 'See [[ideas]] and [[Ideas|x]]' },
  ]);
  assert.deepEqual(index.backlinksOf('zed'), []);
}, (root) => {
  put(root, 'Ideas.md', 'me [[Ideas]]');
  put(root, 'Zed.md', 'intro\n  See [[ideas]] and [[Ideas|x]]  ');
  put(root, 'alpha.md', 'x\n[[IDEAS]] first\n[[Ideas]] second');
  put(root, 'Code.md', '`[[Ideas]]`\n```\n[[Ideas]]\n```');
  put(root, 'Bad.md', '[[../Ideas]] [[Ideas/x]]');
}));

test('graph has one edge per linked pair, stored casing, key order and orphans', () => withIndex((index) => {
  assert.deepEqual(index.graph(), {
    nodes: [{ title: 'A', orphan: false }, { title: 'b', orphan: false }, { title: 'C', orphan: false }, { title: 'D', orphan: true }],
    edges: [['A', 'b'], ['A', 'C']],
  });
}, (root) => {
  put(root, 'A.md', '[[b]] [[C]] [[A]] [[Ghost]]');
  put(root, 'b.md', '[[a]]');
  put(root, 'C.md', 'leaf');
  put(root, 'D.md', '`[[A]]`');
}));

test('reload and remove keep the index in step with the app\'s own writes', () => withIndex((index, root) => {
  put(root, 'N.md', 'text');
  const e = index.reload('N.md');
  assert.equal(e.title, 'N');
  assert.equal(index.get('n').content, 'text');
  fs.unlinkSync(path.join(root, 'N.md'));
  assert.equal(index.reload('N.md'), null);
  assert.equal(index.get('n'), null);
  put(root, 'M.md', 'm');
  index.reload('M.md');
  index.remove('m');
  assert.equal(index.get('m'), null);
  assert.equal(index.reload('bad:x.md'), null);
}));
