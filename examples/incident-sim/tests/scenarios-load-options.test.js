// The boot loader must hand safe-json the scenario limits (spec.md resolved ambiguity 24): 64 KB and 12 levels deep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadScenarios } from '../src/scenarios-load.js';
import { parseSafe } from '../public/js/core/safe-json.js';

function dirWith(files) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'is-lo-')));
  for (const [n, v] of Object.entries(files)) fs.writeFileSync(path.join(base, n), v);
  return { dir: base, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test('loadScenarios passes parseSafe exactly { maxBytes: 65536, maxDepth: 12 }', async () => {
  const seen = [];
  const deps = {
    parseSafe: (text, opts) => { seen.push(opts); return { ok: true, value: { id: 'a' } }; },
    validate: (obj, file) => ({ ok: true, scenario: obj, file }),
  };
  const d = dirWith({ 'a.json': '{"id":"a"}' });
  try {
    await loadScenarios(d.dir, deps);
    assert.deepEqual(seen, [{ maxBytes: 65536, maxDepth: 12 }]);
  } finally { d.cleanup(); }
});

const nest = (levels) => `${'['.repeat(levels)}${']'.repeat(levels)}`;

test('with the real parser a document 12 levels deep reaches the validator and 13 levels is rejected as nested too deeply', async () => {
  const validated = [];
  const deps = { parseSafe, validate: (obj, file) => { validated.push(file); return { ok: true, scenario: obj }; } };
  const d = dirWith({ 'ok.json': `{"a":${nest(11)}}`, 'deep.json': `{"a":${nest(12)}}` });
  try {
    const r = await loadScenarios(d.dir, deps);
    assert.deepEqual(validated, ['ok.json']);
    assert.deepEqual(r.errors, [{ file: 'deep.json', field: '(file)', message: 'the file is nested too deeply.' }]);
  } finally { d.cleanup(); }
});
