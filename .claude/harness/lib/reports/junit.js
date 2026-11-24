'use strict';
// JUnit XML reader for the report contract (ADR-0003). Pure and dependency-free: it reads the small XML subset
// test runners write (elements, attributes, text, CDATA, comments, the XML declaration) and refuses anything it
// cannot read with certainty. Error messages never quote report content, so a hidden test's name cannot leak
// through a malformed holdout report.

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

class JUnitError extends Error {}
const fail = (why) => { throw new JUnitError(`malformed JUnit report: ${why}`); };

function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return fail('invalid character reference'); }
    }
    if (!(ref in ENTITIES)) fail(`unknown entity &${ref.slice(0, 20)};`);
    return ENTITIES[ref];
  });
}

const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/gy;

function parseTag(body) {
  const name = /^[\w:.-]+/.exec(body);
  if (!name) fail('a tag has no name');
  const attrs = {};
  let rest = body.slice(name[0].length);
  rest = rest.trimEnd();
  let pos = 0;
  while (pos < rest.length) {
    const ws = /\s+/y;
    ws.lastIndex = pos;
    const space = ws.exec(rest);
    if (!space) fail(`<${name[0]}> has unreadable attributes`);
    pos = ws.lastIndex;
    if (pos >= rest.length) break;
    ATTR.lastIndex = pos;
    const m = ATTR.exec(rest);
    if (!m) fail(`<${name[0]}> has unreadable attributes`);
    attrs[m[1]] = decode(m[2] ?? m[3]);
    pos = ATTR.lastIndex;
  }
  return { name: name[0], attrs };
}

// A minimal tree: { name, attrs, children, text }.
function parseXml(xml) {
  if (typeof xml !== 'string' || xml.trim() === '') fail('the file is empty');
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = xml.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    const textEnd = lt === -1 ? xml.length : lt;
    if (textEnd > i) {
      const text = xml.slice(i, textEnd);
      if (stack.length === 1 && text.trim() !== '') fail('text outside the root element');
      stack[stack.length - 1].text += decode(text);
    }
    if (lt === -1) break;
    const closeAt = (marker, what) => {
      const end = xml.indexOf(marker, lt);
      if (end === -1) fail(`unterminated ${what}`);
      return end;
    };
    if (xml.startsWith('<!--', lt)) { i = closeAt('-->', 'comment') + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = closeAt(']]>', 'CDATA section');
      if (stack.length === 1) fail('CDATA outside the root element');
      stack[stack.length - 1].text += xml.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) { i = closeAt('?>', 'processing instruction') + 2; continue; }
    if (xml.startsWith('<!', lt)) { i = closeAt('>', 'declaration') + 1; continue; }
    const gt = closeAt('>', 'tag');
    const raw = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      const open = stack.pop();
      if (stack.length === 0 || open.name !== name) fail(`closing tag </${name.slice(0, 40)}> does not match`);
      continue;
    }
    const selfClosing = raw.endsWith('/');
    const { name, attrs } = parseTag(selfClosing ? raw.slice(0, -1) : raw);
    if (stack.length === 1 && root.children.length > 0) fail('more than one root element');
    const node = { name, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1) fail(`<${stack[stack.length - 1].name}> is never closed (truncated file?)`);
  if (root.children.length === 0) fail('no root element');
  return root.children[0];
}

const firstLine = (text) => (text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';

function readCase(node) {
  const name = node.attrs.name;
  if (typeof name !== 'string') fail('a <testcase> has no name');
  const failure = node.children.find((c) => c.name === 'failure' || c.name === 'error');
  const skipped = node.children.some((c) => c.name === 'skipped');
  if (failure) return { name, classname: node.attrs.classname ?? '', status: 'failed', message: failure.attrs.message || firstLine(failure.text) };
  return { name, classname: node.attrs.classname ?? '', status: skipped ? 'skipped' : 'passed', message: '' };
}

function collect(node, cases) {
  for (const child of node.children) {
    if (child.name === 'testcase') cases.push(readCase(child));
    else if (child.name === 'testsuite') collect(child, cases);
  }
}

// Counts come from the <testcase> elements; a declared `tests` total that disagrees with them means the file
// was cut short or edited, so it is refused rather than trusted either way.
function parseJUnit(xml) {
  const root = parseXml(xml);
  if (root.name !== 'testsuites' && root.name !== 'testsuite') fail(`the root element is <${root.name.slice(0, 40)}>, expected <testsuites> or <testsuite>`);
  const cases = [];
  collect(root, cases);
  if (root.attrs.tests !== undefined) {
    const declared = Number(root.attrs.tests);
    if (!Number.isInteger(declared) || declared !== cases.length) fail(`the root declares ${root.attrs.tests.slice(0, 20)} tests but holds ${cases.length} <testcase> elements`);
  }
  const count = (status) => cases.filter((c) => c.status === status).length;
  return { tests: cases.length, passed: count('passed'), failures: count('failed'), skipped: count('skipped'), cases };
}

module.exports = { parseJUnit, JUnitError };
