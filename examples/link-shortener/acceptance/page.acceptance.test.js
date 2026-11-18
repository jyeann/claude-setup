'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, tmpFile } = require('./helpers');

// The user must be able to see and copy the short link they just made.
test('the page shows the created short link with a copy button and lists full short URLs', async () => {
  const s = await startServer(tmpFile());
  try {
    const html = (await s.call('GET', '/')).text;
    assert.match(html, /id="short-link-result"[^>]*role="status"/);
    assert.match(html, /id="short-link"/);
    assert.match(html, /id="copy-link"/);
    assert.match(html, /<th scope="col">Short link<\/th>/);
    assert.match(html, /location\.origin/);
  } finally { await s.stop(); }
});
