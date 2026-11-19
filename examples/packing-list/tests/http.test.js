'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const H = require('../src/http');

function fakeReq(chunks, headers = { 'content-type': 'application/json' }) {
  const req = Readable.from(chunks.map((c) => Buffer.from(c)), { objectMode: false });
  req.headers = headers;
  return req;
}

test('securityHeaders returns the exact seven headers', () => {
  assert.deepEqual(H.securityHeaders(), {
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  });
});

test('isJsonType accepts parameters and case, refuses other types', () => {
  assert.equal(H.isJsonType('application/json'), true);
  assert.equal(H.isJsonType('Application/JSON; charset=utf-8'), true);
  assert.equal(H.isJsonType('text/plain'), false);
  assert.equal(H.isJsonType('application/jsonp'), false);
  assert.equal(H.isJsonType(undefined), false);
});

test('readJsonBody parses an object split across chunks', async () => {
  const body = await H.readJsonBody(fakeReq(['{"na', 'me":"x"}']), 4096);
  assert.deepEqual(body, { name: 'x' });
});

test('readJsonBody refuses a wrong content type with 415', async () => {
  await assert.rejects(H.readJsonBody(fakeReq(['{}'], { 'content-type': 'text/plain' }), 4096), (e) => e.code === 'bad_content_type' && e.status === 415);
  await assert.rejects(H.readJsonBody(fakeReq(['{}'], {}), 4096), (e) => e.code === 'bad_content_type');
});

test('readJsonBody accepts exactly the cap and refuses one byte more with 413', async () => {
  const pad = (n) => `{"a":"${'x'.repeat(n - 8)}"}`;
  const ok = pad(100);
  assert.equal(Buffer.byteLength(ok), 100);
  assert.deepEqual(Object.keys(await H.readJsonBody(fakeReq([ok]), 100)), ['a']);
  await assert.rejects(H.readJsonBody(fakeReq([pad(101)]), 100), (e) => e.code === 'body_too_large' && e.status === 413);
});

test('readJsonBody counts bytes while streaming, not characters or the declared length', async () => {
  const chunks = ['{"a":"', 'x'.repeat(60), 'x'.repeat(60), '"}'];
  await assert.rejects(H.readJsonBody(fakeReq(chunks), 100), (e) => e.code === 'body_too_large');
  const multibyte = `{"a":"${'é'.repeat(48)}"}`;
  await assert.rejects(H.readJsonBody(fakeReq([multibyte]), 100), (e) => e.code === 'body_too_large');
});

test('readJsonBody refuses a declared length over the cap without reading', async () => {
  await assert.rejects(H.readJsonBody(fakeReq(['{}'], { 'content-type': 'application/json', 'content-length': '5000' }), 4096), (e) => e.code === 'body_too_large');
});

test('readJsonBody gives bad_json for broken or empty JSON', async () => {
  await assert.rejects(H.readJsonBody(fakeReq(['{"a":']), 4096), (e) => e.code === 'bad_json' && e.status === 400 && e.message === 'Request body is not valid JSON.');
  await assert.rejects(H.readJsonBody(fakeReq([]), 4096), (e) => e.code === 'bad_json');
});

test('readJsonBody gives invalid_body for JSON that is not an object', async () => {
  for (const text of ['[]', '"s"', '5', 'null', 'true']) {
    await assert.rejects(H.readJsonBody(fakeReq([text]), 4096), (e) => e.code === 'invalid_body' && e.status === 400, text);
  }
});

test('readJsonBody passes stream errors on', async () => {
  const req = new Readable({ read() { this.destroy(new Error('socket gone')); } });
  req.headers = { 'content-type': 'application/json' };
  await assert.rejects(H.readJsonBody(req, 4096), /socket gone/);
});
