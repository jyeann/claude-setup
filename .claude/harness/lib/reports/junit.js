'use strict';
// JUnit XML reader for the report contract (ADR-0003). Pure and dependency-free: it reads the small XML subset
// test runners write (elements, attributes, text, CDATA, comments, the XML declaration) and refuses anything it
// cannot read with certainty. Error messages give a character offset at most and never any text from the report
// (no test, tag, entity or attribute content), so a hidden test's name cannot leak through a malformed report.

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

class JUnitError extends Error {}
const fail = (why) => { throw new JUnitError(`malformed JUnit report: ${why}`); };
const at = (offset) => `at offset ${offset}`;

function decode(text, offset) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, ref) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      try { return String.fromCodePoint(code); } catch { return fail(`invalid character reference ${at(offset)}`); }
    }
    if (!(ref in ENTITIES)) fail(`unknown entity ${at(offset)}`);
    return ENTITIES[ref];
  });
}

const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;

function parseTag(body, offset) {
  const name = /^[\w:.-]+/.exec(body);
  if (!name) fail(`a tag has no name ${at(offset)}`);
  const attrs = {};
  const rest = body.slice(name[0].length).trimEnd();
  let pos = 0;
  while (pos < rest.length) {
    const ws = /\s+/y;
    ws.lastIndex = pos;
    if (!ws.exec(rest)) fail(`unreadable attributes ${at(offset)}`);
    pos = ws.lastIndex;
    ATTR.lastIndex = pos;
    const m = ATTR.exec(rest);
    if (!m) fail(`unreadable attributes ${at(offset)}`);
    attrs[m[1]] = decode(m[2] ?? m[3], offset);
    pos = ATTR.lastIndex;
  }
  return { name: name[0], attrs };
}

// The `>` that ends a tag, skipping any `>` inside a quoted attribute value; -1 if the tag never ends.
function tagEnd(xml, from) {
  let quote = null;
  for (let i = from; i < xml.length; i += 1) {
    const ch = xml[i];
    if (quote) { if (ch === quote) quote = null; } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
  }
  return -1;
}

// A minimal tree: { name, attrs, children, text, offset }.
function parseXml(xml) {
  if (typeof xml !== 'string' || xml.trim() === '') fail('the file is empty');
  const root = { name: '#document', attrs: {}, children: [], text: '', offset: 0 };
  const stack = [root];
  let i = xml.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    const textEnd = lt === -1 ? xml.length : lt;
    if (textEnd > i) {
      const text = xml.slice(i, textEnd);
      if (stack.length === 1 && text.trim() !== '') fail(`text outside the root element ${at(i)}`);
      stack[stack.length - 1].text += decode(text, i);
    }
    if (lt === -1) break;
    const closeAt = (marker, what) => {
      const end = xml.indexOf(marker, lt);
      if (end === -1) fail(`unterminated ${what} ${at(lt)}`);
      return end;
    };
    if (xml.startsWith('<!--', lt)) { i = closeAt('-->', 'comment') + 3; continue; }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = closeAt(']]>', 'CDATA section');
      if (stack.length === 1) fail(`CDATA outside the root element ${at(lt)}`);
      stack[stack.length - 1].text += xml.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) { i = closeAt('?>', 'processing instruction') + 2; continue; }
    if (xml.startsWith('<!', lt)) { i = closeAt('>', 'declaration') + 1; continue; }
    const gt = tagEnd(xml, lt + 1);
    if (gt === -1) fail(`unterminated tag ${at(lt)}`);
    const raw = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (raw.startsWith('/')) {
      const open = stack.pop();
      if (stack.length === 0 || open.name !== raw.slice(1).trim()) fail(`closing tag does not match its opening tag ${at(lt)}`);
      continue;
    }
    const selfClosing = raw.endsWith('/');
    const { name, attrs } = parseTag(selfClosing ? raw.slice(0, -1) : raw, lt);
    if (stack.length === 1 && root.children.length > 0) fail(`more than one root element ${at(lt)}`);
    const node = { name, attrs, children: [], text: '', offset: lt };
    stack[stack.length - 1].children.push(node);
    if (!selfClosing) stack.push(node);
  }
  if (stack.length !== 1) fail(`the element opened ${at(stack[stack.length - 1].offset)} is never closed (truncated file?)`);
  if (root.children.length === 0) fail('no root element');
  return root.children[0];
}

const firstLine = (text) => (text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';

function readCase(node) {
  const name = node.attrs.name;
  if (typeof name !== 'string') fail(`a <testcase> has no name ${at(node.offset)}`);
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
  if (root.name !== 'testsuites' && root.name !== 'testsuite') fail('the root element is not <testsuites> or <testsuite>');
  const cases = [];
  collect(root, cases);
  if (root.attrs.tests !== undefined && Number(root.attrs.tests) !== cases.length) {
    fail(`the root's declared total of tests does not match the ${cases.length} <testcase> elements it holds`);
  }
  const count = (status) => cases.filter((c) => c.status === status).length;
  return { tests: cases.length, passed: count('passed'), failures: count('failed'), skipped: count('skipped'), cases };
}

module.exports = { parseJUnit, JUnitError };
