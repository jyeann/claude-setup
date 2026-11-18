import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { formatModified, truncateQuery, createListView, buildHome } from '../public/js/notes.js';
import { segmentSnippet, snippetNodes, countText } from '../public/js/search.js';
import { prepareGraph, linksText, graphSummary, buildGraphList } from '../public/js/graph.js';
import { titleErrorMessage } from '../public/js/dialogs.js';
import { renamedMessage } from '../public/js/app.js';
import { backlinksHeading, buildBacklinkItems } from '../public/js/note-view.js';
import { h, clear, plural, byTestId, srOnly, replaceChildren } from '../public/js/dom.js';
import { ApiError } from '../public/js/api.js';
import { Doc, loadBody, byId } from './fake-dom.js';
import { INDEX_HTML } from './backend.js';

const PUBLIC = path.resolve(import.meta.dirname, '..', 'public');

test('formatModified prints local time as YYYY-MM-DD HH:mm and survives bad input', () => {
  const d = new Date(2026, 10, 18, 14, 5);
  assert.equal(formatModified(d.toISOString()), '2026-11-18 14:05');
  assert.equal(formatModified(new Date(2026, 0, 2, 3, 4).toISOString()), '2026-01-02 03:04');
  assert.equal(formatModified('nonsense'), '');
});

test('truncateQuery keeps 40 characters and adds three dots', () => {
  assert.equal(truncateQuery('short'), 'short');
  assert.equal(truncateQuery('x'.repeat(40)), 'x'.repeat(40));
  assert.equal(truncateQuery('x'.repeat(41)), `${'x'.repeat(40)}...`);
});

test('segmentSnippet splits text around ranges and skips bad ranges', () => {
  assert.deepEqual(segmentSnippet('hello world', [[0, 5]]), [{ text: 'hello', mark: true }, { text: ' world', mark: false }]);
  assert.deepEqual(segmentSnippet('a b a', [[0, 1], [4, 5]]).map((p) => [p.text, p.mark]), [['a', true], [' b ', false], ['a', true]]);
  assert.deepEqual(segmentSnippet('abc', []).map((p) => p.text), ['abc']);
  assert.deepEqual(segmentSnippet('abc', [[2, 9], [1, 1], [0, 2], [1, 3], ['x', 2], null]).map((p) => [p.text, p.mark]), [['ab', true], ['c', false]]);
  assert.deepEqual(segmentSnippet('', []), []);
});

test('snippetNodes builds mark elements and text nodes, never HTML', () => {
  const doc = new Doc();
  const nodes = snippetNodes(doc, '<b>quarterly</b>', [[3, 12]]);
  assert.deepEqual(nodes.map((n) => n.nodeType), [3, 1, 3]);
  assert.equal(nodes[1].localName, 'mark');
  assert.equal(nodes[1].textContent, 'quarterly');
  assert.equal(nodes[0].textContent, '<b>');
});

test('countText uses the singular and the empty form', () => {
  assert.equal(countText(0), 'No notes match');
  assert.equal(countText(1), '1 note matches');
  assert.equal(countText(3), '3 notes match');
});

test('prepareGraph maps titles to indexes, drops unknown and self edges and sorts neighbours', () => {
  const data = { nodes: [{ title: 'A' }, { title: 'B' }, { title: 'C' }], edges: [['A', 'C'], ['A', 'B'], ['A', 'A'], ['A', 'Zed']] };
  const prep = prepareGraph(data);
  assert.deepEqual(prep.edges, [[0, 2], [0, 1]]);
  assert.deepEqual(prep.neighbors, [[1, 2], [0], [0]]);
});

test('graph text helpers', () => {
  assert.equal(graphSummary(4, 2), '4 notes, 2 links');
  assert.equal(graphSummary(1, 0), '1 note, 0 links');
  assert.equal(graphSummary(2, 1), '2 notes, 1 link');
  assert.equal(linksText([]), 'No links');
  assert.equal(linksText(['B', 'C']), 'Links to B, C');
  const doc = new Doc();
  const ul = buildGraphList(doc, [{ title: 'A' }, { title: 'B' }], [[1], [0]]);
  assert.equal(ul.children[0].textContent, 'ALinks to B');
  assert.equal(ul.children[1].querySelector('a').getAttribute('href'), '/n/B');
});

test('titleErrorMessage trusts title_ codes only', () => {
  assert.equal(titleErrorMessage(new ApiError(400, 'title_dotdot', 'A title cannot contain "..".'), 'fallback'), 'A title cannot contain "..".');
  assert.equal(titleErrorMessage(new ApiError(409, 'title_exists', 'A note called "X" already exists.'), 'fallback'), 'A note called "X" already exists.');
  assert.equal(titleErrorMessage(new ApiError(500, 'title_x', 'boom'), 'fallback'), 'fallback');
  assert.equal(titleErrorMessage(new ApiError(0, 'network', 'down', {}, true), 'fallback'), 'fallback');
  assert.equal(titleErrorMessage(new ApiError(503, 'storage_error', 'disk'), 'fallback'), 'fallback');
  assert.equal(titleErrorMessage(null, 'fallback'), 'fallback');
});

test('renamedMessage covers none, one, many and failures', () => {
  assert.equal(renamedMessage({ title: 'X', updated: [], failed: [] }), 'Renamed to X.');
  assert.equal(renamedMessage({ title: 'X', updated: ['A'], failed: [] }), 'Renamed to X. Updated links in 1 note.');
  assert.equal(renamedMessage({ title: 'X', updated: ['A', 'B', 'C'], failed: [] }), 'Renamed to X. Updated links in 3 notes.');
  assert.equal(renamedMessage({ title: 'X', updated: ['A'], failed: [{ title: 'A' }, { title: 'B' }] }), 'Renamed, but 2 notes could not be updated: A, B. Fix those links by hand.');
  assert.equal(renamedMessage({ title: 'X', updated: [] }), 'Renamed to X.');
});

test('backlink helpers', () => {
  const doc = new Doc();
  assert.equal(backlinksHeading(2), 'Backlinks (2)');
  const items = buildBacklinkItems(doc, [{ title: 'Welcome', snippet: 'See [[Ideas]]' }]);
  assert.equal(items[0].getAttribute('data-title'), 'Welcome');
  assert.equal(items[0].querySelector('a').getAttribute('href'), '/n/Welcome');
  assert.equal(byId(items[0], 'backlink-snippet').textContent, 'See [[Ideas]]');
});

test('dom helpers build elements, ignore empty props and plural words', () => {
  const doc = new Doc();
  const el = h(doc, 'button', { testid: 'x', class: 'a', hidden: true, nope: false, gone: null, text: 'Hi', on: { click: () => {} } }, ['t', null, h(doc, 'i')]);
  assert.equal(el.getAttribute('data-testid'), 'x');
  assert.equal(el.getAttribute('hidden'), '');
  assert.equal(el.hasAttribute('nope'), false);
  assert.equal(el.hasAttribute('gone'), false);
  assert.equal(el.children.length, 1);
  assert.equal(h(doc, 'div', {}, [undefined, false, null, 'x']).childNodes.length, 1, 'only real children are added');
  assert.equal(h(doc, 'svg', { svg: true }).namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(clear(el).childNodes.length, 0);
  assert.equal(replaceChildren(el, h(doc, 'b'), null).children.length, 1);
  assert.equal(byTestId(h(doc, 'div', {}, [h(doc, 'p', { testid: 'q' })]), 'q').localName, 'p');
  assert.equal(srOnly(doc, 'hidden').getAttribute('class'), 'sr-only');
  assert.equal(plural(1, 'note', 'notes'), '1 note');
  assert.equal(plural(0, 'note', 'notes'), '0 notes');
});

test('the list view switches between loading, notes, results and messages', () => {
  const doc = new Doc();
  const region = doc.createElement('div');
  const list = createListView(doc, region);
  list.loading();
  assert.equal(list.mode, 'loading');
  assert.ok(byId(region, 'list-loading'));
  list.showNotes([], null);
  assert.equal(byId(region, 'note-list-empty').textContent, 'No notes yet.');
  list.showNotes([{ title: 'A', modified: new Date().toISOString() }, { title: 'B', modified: new Date().toISOString() }], 'B');
  assert.equal(region.querySelectorAll('[aria-current="page"]').length, 1);
  list.setCurrent('A');
  assert.equal(region.querySelector('[aria-current="page"]').getAttribute('data-title'), 'A');
  list.setCurrent(null);
  assert.equal(region.querySelectorAll('[aria-current="page"]').length, 0);
  assert.equal(list.linkFor('B').textContent, 'B');
  assert.equal(list.linkFor('Z'), null);
  list.showMessage('search-empty', 'none');
  assert.equal(list.mode, 'message');
  list.setCurrent('A');
  assert.equal(byId(region, 'search-empty').textContent, 'none');
  list.setData([{ title: 'C', modified: '' }]);
  list.showNotes();
  assert.equal(list.notes.length, 1);
  assert.equal(list.firstLink().textContent, 'C');
});

test('home screens: empty vault offers creation, otherwise a prompt', () => {
  const doc = new Doc();
  let opened = null;
  const empty = buildHome(doc, { empty: true, onCreate: (el) => { opened = el; } });
  assert.equal(empty.getAttribute('data-testid'), 'empty-vault');
  byId(empty, 'empty-create').click();
  assert.equal(opened.getAttribute('data-testid'), 'empty-create');
  const some = buildHome(doc, { empty: false, onCreate: () => {} });
  assert.equal(some.getAttribute('data-testid'), 'no-selection');
  assert.equal(some.querySelector('h1').textContent, 'Wiki');
});

test('no file in public/js builds HTML from strings', () => {
  const sinks = /\binnerHTML\b|\bouterHTML\b|\binsertAdjacentHTML\b|document\s*\.\s*write\b|\beval\s*\(|new Function\s*\(/;
  const dir = path.join(PUBLIC, 'js');
  const files = fs.readdirSync(dir).filter((n) => n.endsWith('.js'));
  assert.ok(files.length >= 14, `found ${files.length} files`);
  for (const f of files) assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), sinks, f);
});

test('index.html is one shell with landmarks, a skip link first, lang en and no inline code or style', () => {
  assert.match(INDEX_HTML, /<html lang="en">/);
  assert.doesNotMatch(INDEX_HTML, /<style|\sstyle=|\son\w+=|<script(?![^>]*\ssrc=)/i);
  assert.match(INDEX_HTML, /<script type="module" src="\/js\/app\.js">/);
  const doc = loadBody(new Doc(), INDEX_HTML);
  assert.equal(doc.querySelectorAll('main').length, 1);
  assert.equal(doc.querySelector('nav').getAttribute('aria-label'), 'Notes');
  assert.equal(doc.querySelector('a').getAttribute('data-testid'), 'skip-link');
  assert.equal(doc.querySelector('a').textContent, 'Skip to main content');
  assert.equal(byId(doc, 'status-live').getAttribute('aria-live'), 'polite');
  assert.equal(byId(doc, 'alert-live').getAttribute('role'), 'alert');
  assert.equal(byId(doc, 'search-status').getAttribute('role'), 'status');
  assert.equal(doc.querySelector('label[for="search-input"]').textContent, 'Search notes');
  assert.equal(doc.querySelectorAll('h1').length, 0, 'h1 lives in the main pane screens');
});
