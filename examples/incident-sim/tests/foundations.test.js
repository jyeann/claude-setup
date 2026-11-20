// T1 foundations: hash, prng, catalogue, guides, banned-API scan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnv1a32, hex8, canonicalJson } from '../public/js/engine/hash.js';
import { next, initial } from '../public/js/engine/prng.js';
import { NODE_IDS, NODE_TYPES, ACTIONS, ACTION_IDS, FIX_IDS, DIAGNOSTIC_IDS, ACTION_BY_ID, DEFAULT_COST, PARAMS, EDGE_PARAMS, EDGE_RULES } from '../public/js/engine/catalogue.js';
import { GUIDES, GUIDE_PATTERN, isAllowedGuide } from '../public/js/engine/guides.js';

const engineDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js', 'engine');

test('fnv1a32 vectors and UTF-8 handling (2-, 3- and 4-byte characters, lone surrogates)', () => {
  assert.equal(hex8(fnv1a32('')), '811c9dc5');
  assert.equal(hex8(fnv1a32('a')), 'e40c292c');
  assert.equal(hex8(fnv1a32('foobar')), 'bf9cf968');
  const ref = (bytes) => bytes.reduce((h, b) => Math.imul(h ^ b, 16777619) >>> 0, 0x811c9dc5);
  const enc = (s) => [...Buffer.from(s, 'utf8')];
  for (const s of ['é', '€', '\u{1F600}x', 'café ☃', '\ud800', 'a\udc00b', '\u{10FFFF}']) assert.equal(fnv1a32(s), ref(enc(s)), JSON.stringify(s));
  assert.equal(fnv1a32('\ud800'), ref([0xef, 0xbf, 0xbd]), 'a lone surrogate hashes as U+FFFD');
});

test('hex8 pads and lowercases; unsigned conversion of negative numbers', () => {
  assert.equal(hex8(0), '00000000');
  assert.equal(hex8(0xabcdef), '00abcdef');
  assert.equal(hex8(-1), 'ffffffff');
});

test('canonicalJson sorts keys, skips undefined and functions, maps non-finite numbers and -0', () => {
  assert.equal(canonicalJson({ b: [1, { d: 1, c: undefined, e: () => 1 }], a: null }), '{"a":null,"b":[1,{"d":1}]}');
  assert.equal(canonicalJson([undefined, NaN, Infinity, -0]), '[null,null,null,0]');
  assert.equal(canonicalJson('a"b\n'), '"a\\"b\\n"');
  assert.equal(canonicalJson(undefined), 'null');
  assert.equal(canonicalJson({ a: true, b: false }), '{"a":true,"b":false}');
});

test('mulberry32 goldens and initial()', () => {
  let s = 1;
  const got = [];
  for (let i = 0; i < 8; i++) { const [ns, u] = next(s); s = ns; got.push(u); }
  assert.deepEqual(got, [0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849, 0.281103502959013, 0.6128388606011868, 0.7207431411370635]);
  assert.equal(initial('cache-stampede', 1), 991975984);
  assert.equal(initial('x', -1), initial('x', 4294967295));
  assert.equal(initial('x', 2 ** 32), initial('x', 0));
  assert.equal(next(0xffffffff)[0], (0xffffffff + 0x6d2b79f5) >>> 0);
});

test('catalogue: node and action tables, frozen, derived id lists', () => {
  assert.equal(NODE_IDS.length, 11);
  assert.equal(NODE_TYPES['third-party'], 'third-party');
  assert.deepEqual(ACTIONS.map((a) => a.id).slice(0, 6), ['inspect', 'trace-request', 'tail-logs', 'compare-dashboards', 'deploy-history', 'scale-service']);
  assert.equal(ACTION_IDS.length, 16);
  assert.equal(FIX_IDS.length, 11);
  assert.equal(DIAGNOSTIC_IDS.length, 5);
  assert.deepEqual({ ...DEFAULT_COST }, { diagnostic: 1, fix: 2 });
  assert.equal(ACTION_BY_ID['add-ttl-jitter'].name, 'Add TTL jitter');
  assert.equal(ACTION_BY_ID['scale-service'].once, false);
  assert.equal(ACTION_BY_ID['failover'].once, true);
  for (const v of [NODE_IDS, NODE_TYPES, ACTIONS, ACTION_IDS, PARAMS, PARAMS.service, PARAMS.service.capacity, EDGE_PARAMS, EDGE_RULES]) assert.ok(Object.isFrozen(v));
  for (const a of ACTIONS) assert.ok(Object.isFrozen(a) && Object.isFrozen(a.appliesTo));
});

test('catalogue: parameter whitelist per type matches the design table', () => {
  const names = (t) => Object.keys(PARAMS[t]).sort();
  assert.deepEqual(names('client'), ['rps']);
  assert.deepEqual(names('queue'), ['baseMs', 'capFactor', 'capacity', 'extraMs', 'instances', 'maxDepth']);
  assert.ok(names('db').includes('hotShare') && names('db').includes('writers') && names('db').includes('conflictRate'));
  assert.equal(PARAMS.db.hotShare.default, undefined, 'hotShare default is 1 / shards, filled by the validator');
  assert.ok(!names('cache').includes('timeoutMs') && !names('cache').includes('shed'));
  assert.ok(names('consumer').includes('workers') && names('consumer').includes('poolSize'));
  assert.ok(!names('third-party').includes('poolSize'));
  assert.deepEqual(Object.keys(EDGE_PARAMS), ['calls', 'share', 'retries', 'backoff', 'breaker', 'fallback', 'missOnly']);
  assert.deepEqual([...EDGE_RULES.client], ['lb']);
  assert.deepEqual([...EDGE_RULES['third-party']], []);
  assert.ok(EDGE_RULES.consumer.includes('service'));
});

test('guides: the 11 allowed URLs only', () => {
  assert.equal(GUIDES.length, 11);
  for (const g of GUIDES) { assert.ok(GUIDE_PATTERN.test(g)); assert.ok(isAllowedGuide(g)); }
  const g0 = GUIDES[0];
  for (const bad of [`${g0}/`, `${g0}\n`, `${g0}?x`, 'https://bytebytego.com/guides/nope', 'https://bytebytego.com/guides/' + 'a'.repeat(121), '', 'http://bytebytego.com/guides/resiliency-patterns']) assert.equal(isAllowedGuide(bad), false, bad);
  for (const v of [null, undefined, 5, {}, [g0]]) assert.equal(isAllowedGuide(v), false);
  assert.equal(isAllowedGuide(`https://bytebytego.com/guides/${'a'.repeat(120)}`), false, 'well formed at the length limit but not listed');
});

test('banned-API scan: engine modules use no clock, randomness, timers, DOM, Intl or transcendental Math', () => {
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const banned = [/Math\.random/, /\bDate\b/, /\bperformance\b/, /\bsetTimeout\b/, /\bsetInterval\b/, /\bcrypto\b/, /\bglobalThis\b/, /\bwindow\b/, /\bdocument\b/, /\bfetch\b/,
    /Math\.(?:exp|log|pow|sin|cos|tan|atan2|cbrt|hypot)/, /\*\*/, /\bIntl\b/, /toLocaleString/, /\bprocess\b/, /from\s+['"]node:/];
  const files = fs.readdirSync(engineDir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 10);
  for (const f of files) {
    const src = strip(fs.readFileSync(path.join(engineDir, f), 'utf8'));
    for (const re of banned) assert.equal(re.test(src), false, `${f} matches ${re}`);
  }
});
