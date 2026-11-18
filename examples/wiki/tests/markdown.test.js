import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Doc } from './fake-dom.js';
import { renderMarkdown, tokenizeBlocks, safeHref } from '../public/js/markdown.js';

const doc = new Doc();
const render = (text, resolve) => {
  const root = doc.createElement('div');
  root.appendChild(renderMarkdown(doc, text, { resolve }));
  return root;
};
const tags = (root) => root.descendants().map((e) => e.localName);
const exists = (t) => ({ ideas: 'Ideas' }[t.toLowerCase()] || null);

test('headings shift down one level and clamp at h6', () => {
  const root = render('# One\n## Two\n###### Six');
  assert.deepEqual(root.children.map((e) => e.localName), ['h2', 'h3', 'h6']);
  assert.equal(root.children[0].textContent, 'One');
});

test('raw HTML in a note stays literal text and creates no elements', () => {
  const root = render('<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n<b>bold?</b>');
  assert.deepEqual(tags(root).filter((t) => !['p', 'br'].includes(t)), []);
  assert.match(root.textContent, /<script>alert\(1\)<\/script>/);
  assert.match(root.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.match(root.textContent, /<b>bold\?<\/b>/);
});

test('safeHref allows only http, https and mailto and strips whitespace and control characters', () => {
  assert.equal(safeHref('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeHref('HTTP://x.y'), 'HTTP://x.y');
  assert.equal(safeHref('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(safeHref('java\tscript:alert(1)'), null);
  assert.equal(safeHref(' javascript:alert(1)'), null);
  assert.equal(safeHref('data:text/html,hi'), null);
  assert.equal(safeHref('//evil.example'), null);
  assert.equal(safeHref('/relative'), null);
  assert.equal(safeHref('notes.md'), null);
  assert.equal(safeHref('ht tps://a.b'), 'https://a.b');
});

test('external links open in a new tab with noopener and a screen reader hint', () => {
  const root = render('[ok](https://example.com)');
  const a = root.querySelector('a');
  assert.equal(a.getAttribute('href'), 'https://example.com');
  assert.equal(a.getAttribute('target'), '_blank');
  assert.equal(a.getAttribute('rel'), 'noopener noreferrer');
  assert.match(a.textContent, /^ok \(opens in new tab\)$/);
});

test('javascript, data and relative links become unsafe-link text and never an anchor', () => {
  const root = render('[link](javascript:alert(1)) [d](data:x) [rel](notes.md)');
  assert.equal(root.querySelectorAll('a').length, 0);
  const unsafe = root.querySelectorAll('[data-testid="unsafe-link"]');
  assert.deepEqual(unsafe.map((e) => e.textContent), ['link', 'd', 'rel']);
  assert.ok(unsafe.every((e) => e.localName === 'span' && !e.hasAttribute('href')));
});

test('images are not rendered, the whole markup shows as text', () => {
  const root = render('![alt](https://example.com/x.png)');
  assert.equal(root.querySelectorAll('img').length, 0);
  assert.equal(root.querySelectorAll('a').length, 0);
  assert.equal(root.textContent, '![alt](https://example.com/x.png)');
});

test('wikilinks render exists, missing and invalid states', () => {
  const root = render('[[Ideas]] [[ideas|my ideas]] [[Nope]] [[a/b]]', exists);
  const links = root.querySelectorAll('[data-testid="wikilink"]');
  assert.equal(links.length, 3);
  assert.equal(links[0].getAttribute('data-state'), 'exists');
  assert.equal(links[0].getAttribute('href'), '/n/Ideas');
  assert.equal(links[0].getAttribute('data-target'), 'Ideas');
  assert.equal(links[1].textContent, 'my ideas');
  assert.equal(links[1].getAttribute('data-target'), 'ideas');
  assert.equal(links[1].getAttribute('href'), '/n/Ideas');
  assert.equal(links[2].getAttribute('data-state'), 'missing');
  assert.equal(links[2].getAttribute('href'), '#');
  assert.equal(links[2].getAttribute('aria-label'), 'Nope (create note)');
  const bad = root.querySelector('[data-testid="unsafe-link"]');
  assert.equal(bad.textContent, 'a/b');
  assert.equal(bad.getAttribute('title'), 'Not a valid note title');
});

test('wikilinks inside code spans and fences stay plain text', () => {
  const root = render('`[[Ideas]]` and\n\n```\n[[Ideas]]\n```\n\n[[Ideas]]', exists);
  assert.equal(root.querySelectorAll('[data-testid="wikilink"]').length, 1);
  assert.deepEqual(root.querySelectorAll('code').map((c) => c.textContent), ['[[Ideas]]', '[[Ideas]]']);
  assert.equal(root.querySelector('pre').getAttribute('tabindex'), '0');
});

test('emphasis, strong, code, escapes and line breaks', () => {
  const root = render('a **b** *c* _d_ `e` \\*f\\* x_y_z\nnext');
  const p = root.querySelector('p');
  assert.deepEqual(p.children.map((e) => e.localName), ['strong', 'em', 'em', 'code', 'br']);
  assert.equal(p.textContent, 'a b c d e *f* x_y_z' + 'next');
});

test('unclosed or spaced emphasis markers stay literal', () => {
  assert.equal(render('2 * 3 * 4').querySelectorAll('em').length, 0);
  assert.equal(render('**open').querySelectorAll('strong').length, 0);
  assert.equal(render('snake_case_word').querySelectorAll('em').length, 0);
  assert.equal(render('**bold *nested* text**').querySelector('strong').querySelectorAll('em').length, 1);
});

test('code spans trim one padding space and keep backtick runs', () => {
  assert.equal(render('`` a`b ``').querySelector('code').textContent, 'a`b');
  assert.equal(render('` x `').querySelector('code').textContent, 'x');
});

test('lists: unordered, ordered, one nesting level, continuation lines', () => {
  const root = render('- one\n- two\n  - nested\n  - nested2\n- three\n  more\n\n1. a\n2) b');
  const [ul, ol] = root.children;
  assert.equal(ul.localName, 'ul');
  assert.equal(ul.children.length, 3);
  assert.equal(ul.children[1].querySelector('ul').children.length, 2);
  assert.match(ul.children[2].textContent, /three/);
  assert.equal(ol.localName, 'ol');
  assert.equal(ol.children.length, 2);
});

test('a switch between bullet and number markers starts a new list', () => {
  const blocks = tokenizeBlocks('- a\n1. b');
  assert.deepEqual(blocks.map((b) => [b.type, b.ordered]), [['list', false], ['list', true]]);
});

test('blockquotes nest and do not open fences', () => {
  const root = render('> quote\n> ```\n> more');
  const bq = root.querySelector('blockquote');
  assert.ok(bq);
  assert.equal(bq.querySelectorAll('pre').length, 0);
  assert.match(bq.textContent, /quote/);
});

test('fences keep their text, support tildes and run to the end when unclosed', () => {
  const blocks = tokenizeBlocks('~~~js\nx < y\n~~~\n```\nlast');
  assert.deepEqual(blocks.map((b) => [b.type, b.text]), [['fence', 'x < y'], ['fence', 'last']]);
  assert.equal(blocks[0].info, 'js');
});

test('paragraphs break at headings and a hashtag is not a heading', () => {
  const blocks = tokenizeBlocks('line one\n#tag\n# Head\nafter');
  assert.deepEqual(blocks.map((b) => b.type), ['paragraph', 'heading', 'paragraph']);
  assert.equal(blocks[0].text, 'line one\n#tag');
});

test('links with parentheses, empty labels and labels with formatting', () => {
  const root = render('[**bold**](https://e.com/a_(b)) [](https://e.com)');
  const links = root.querySelectorAll('a');
  assert.equal(links[0].getAttribute('href'), 'https://e.com/a_(b)');
  assert.equal(links[0].querySelectorAll('strong').length, 1);
  assert.match(links[1].textContent, /^https:\/\/e\.com/);
});

test('empty and whitespace text renders nothing', () => {
  assert.equal(render('').children.length, 0);
  assert.equal(render('  \n\n ').children.length, 0);
});

test('CRLF text renders like LF text', () => {
  assert.deepEqual(render('# A\r\n\r\ntext\r\n').children.map((e) => e.localName), ['h2', 'p']);
});
