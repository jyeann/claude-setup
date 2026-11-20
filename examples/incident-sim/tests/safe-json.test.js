// core/safe-json.js: pinned reasons, order of checks, pollution safety.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSafe, utf8Length } from '../public/js/core/safe-json.js';

const NESTED = { ok: false, reason: 'the file is nested too deeply.' };
const NOT_JSON = { ok: false, reason: 'the file is not valid JSON. Export a fresh file from this page and try again.' };
const key = (k) => ({ ok: false, reason: `the file contains the key "${k}", which is not allowed.` });

test('utf8Length counts 1, 2, 3 and 4 byte characters and lone surrogates like TextEncoder', () => {
  for (const s of ['', 'abc', 'é', '€', '\u{1F600}', 'a\ud800b', '\udc00', 'x'.repeat(10)]) assert.equal(utf8Length(s), Buffer.byteLength(s, 'utf8'), JSON.stringify(s));
  assert.equal(utf8Length('\u0080'), 2);
  assert.equal(utf8Length('߿'), 2);
  assert.equal(utf8Length('ࠀ'), 3);
});

test('valid JSON parses; objects come back prototype-less and compare equal through JSON.stringify', () => {
  const r = parseSafe('{"a":[1,{"b":null}],"c":"x"}');
  assert.equal(r.ok, true);
  assert.equal(Object.getPrototypeOf(r.value), null);
  assert.equal(Object.getPrototypeOf(r.value.a[1]), null);
  assert.ok(Array.isArray(r.value.a));
  assert.equal(JSON.stringify(r.value), '{"a":[1,{"b":null}],"c":"x"}');
  assert.deepEqual(parseSafe('5'), { ok: true, value: 5 });
  assert.deepEqual(parseSafe('"s"'), { ok: true, value: 's' });
  assert.deepEqual(parseSafe('null'), { ok: true, value: null });
});

test('size limit: 262,144 bytes pass, 262,145 fail with the rounded-up KB message; maxBytes moves it', () => {
  const pad = (n) => `"${'a'.repeat(n - 2)}"`;
  assert.equal(parseSafe(pad(262144)).ok, true);
  assert.deepEqual(parseSafe(pad(262145)), { ok: false, reason: 'the file is 257 KB and the limit is 256 KB.' });
  assert.equal(parseSafe(pad(300000)).reason, 'the file is 293 KB and the limit is 256 KB.');
  assert.equal(parseSafe('"abc"', { maxBytes: 5 }).ok, true);
  assert.equal(parseSafe('"abcd"', { maxBytes: 5 }).ok, false);
  assert.equal(parseSafe('"é"', { maxBytes: 4 }).ok, true);
  assert.equal(parseSafe('"éé"', { maxBytes: 5 }).ok, false, 'six bytes, though only four characters');
  assert.equal(parseSafe(`"${'x'.repeat(70000)}"`, { maxBytes: 65536 }).reason, 'the file is 69 KB and the limit is 64 KB.');
});

test('nesting: depth 8 is fine, 9 is rejected before parsing, structural characters in strings do not count', () => {
  assert.equal(parseSafe('[[[[[[[[1]]]]]]]]').ok, true);
  assert.deepEqual(parseSafe('[[[[[[[[[1]]]]]]]]]'), NESTED);
  assert.deepEqual(parseSafe('['.repeat(100)), NESTED);
  assert.deepEqual(parseSafe('{"a":'.repeat(30) + '1' + '}'.repeat(30)), NESTED);
  assert.equal(parseSafe('[[[[[[[[1],[2]],[3]]]]]]]').ok, true, 'siblings do not add depth');
  assert.equal(parseSafe(`["${'['.repeat(50)}"]`).ok, true);
  assert.equal(parseSafe(`["\\"${'['.repeat(50)}"]`).ok, true);
  assert.equal(parseSafe(`["a\\\\", [1]]`).ok, true, 'an escaped backslash ends the escape before the closing quote');
  assert.equal(parseSafe(`{"k":"${'{,'.repeat(30000)}"}`).ok, true);
  assert.deepEqual(parseSafe('[[[[[[[[[[ not json'), NESTED);
  assert.equal(parseSafe('[[[[[[[[1]]]]]]]]', { maxDepth: 7 }).reason, NESTED.reason);
  assert.equal(parseSafe('[[[[[[[[1]]]]]]]]', { maxDepth: 12 }).ok, true);
});

test('token limit: 20,000 structural tokens are too many (an object of 20,000 or 25,000 keys, an array of 21,000 items), 5,000 are fine', () => {
  const obj = (n) => `{${Array.from({ length: n }, (_, i) => `"${i}":1`).join(',')}}`;
  assert.deepEqual(parseSafe(obj(25000)), NESTED);
  assert.deepEqual(parseSafe(obj(20000)), NESTED);
  assert.equal(parseSafe(obj(19998)).ok, true);
  assert.deepEqual(parseSafe(`[${Array.from({ length: 21000 }, () => '1').join(',')}]`), NESTED);
  assert.equal(parseSafe(`[${Array.from({ length: 5000 }, () => '1').join(',')}]`).ok, true);
  assert.equal(parseSafe(`[${Array.from({ length: 30 }, () => '1').join(',')}]`, { maxTokens: 20 }).reason, NESTED.reason);
});

test('invalid JSON gets the pinned reason and non-strings are treated as invalid', () => {
  for (const bad of ['{bad', '', 'undefined', '[1,]', 'NaN', "{'a':1}", '<html><script>alert(1)</script></html>', '{"a":1}}', '﻿{}']) assert.deepEqual(parseSafe(bad), NOT_JSON, JSON.stringify(bad));
  for (const v of [undefined, null, 5, {}, []]) assert.deepEqual(parseSafe(v), NOT_JSON);
});

test('forbidden keys at any depth are rejected and Object.prototype stays clean', () => {
  const clean = () => { assert.equal(Object.keys(Object.prototype).length, 0); assert.equal(({}).polluted, undefined); };
  clean();
  for (const [text, k] of [['{"__proto__":{"polluted":true}}', '__proto__'], ['{"a":[{"b":{"constructor":{"prototype":{"polluted":true}}}}]}', 'constructor'], ['{"prototype":1}', 'prototype'],
    ['[{"x":{"y":[{"__proto__":1}]}}]', '__proto__'], ['{"\\u005f_proto__":{"isAdmin":true}}', '__proto__']]) assert.deepEqual(parseSafe(text), key(k), text);
  clean();
  assert.equal(parseSafe('{"proto":1,"constructors":2,"__proto":3}').ok, true);
  const long = 'k'.repeat(50);
  assert.equal(parseSafe(`{"${long}":1}`).ok, true);
  clean();
});

test('checks run in order: size, nesting, syntax, forbidden keys', () => {
  assert.match(parseSafe('x'.repeat(300000)).reason, /^the file is 293 KB/);
  assert.equal(parseSafe('[[[[[[[[[[ not json').reason, NESTED.reason);
  assert.deepEqual(parseSafe('{"__proto__":1,'), NOT_JSON);
  assert.equal(parseSafe('[[[[[[[[[{"__proto__":1}]]]]]]]]]').reason, NESTED.reason);
});
