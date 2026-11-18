'use strict';

const LABELS = [
  'POST /hello', 'GET /hello', 'GET /', 'GET /healthz', 'GET /api/catalogue', 'GET /api/certificates/:id',
  'POST /api/verify', 'GET /api/battle', 'POST /api/battle/vote', 'GET /api/leaderboard',
  'GET /api/weather', 'GET /api/stream', 'GET /api/sla', 'GET /api/time-machine', 'POST /api/haiku',
  'GET /api/federation', 'GET /api/federation/hello', 'other',
];
const KNOWN = new Set(LABELS);
const STREAM = 'GET /api/stream';

// Fixed label set: ids, query strings and unknown paths never become labels.
function routeLabel(method, path) {
  if (typeof method !== 'string' || typeof path !== 'string') return 'other';
  let p = path.split('?')[0].split('#')[0];
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  const label = /^\/api\/certificates\/[^/]+$/.test(p) ? 'GET /api/certificates/:id' : `${method.toUpperCase()} ${p}`;
  return KNOWN.has(label) && label !== 'other' ? label : 'other';
}

// Nearest rank on an ascending array; null when empty.
function percentile(sortedAsc, p) {
  const n = Array.isArray(sortedAsc) ? sortedAsc.length : 0;
  if (n === 0) return null;
  const idx = Math.ceil((p / 100) * n) - 1;
  return sortedAsc[Math.min(n - 1, Math.max(0, idx))];
}

const r1 = (x) => (x === null ? null : Math.round(x * 10) / 10);
const r4 = (x) => Math.round(x * 10000) / 10000;

function createSla({ now = Date.now, clock = () => performance.now(), windowMs = 300000, maxSamples = 1024 } = {}) {
  const startedAt = now();
  const rings = new Map(); // label -> { buf: [], next }
  let streamsOpened = 0;

  function stats(samples) {
    const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
    const e5 = samples.filter((s) => s.status >= 500).length;
    const e4 = samples.filter((s) => s.status >= 400 && s.status < 500).length;
    const n = samples.length;
    return {
      count: n, errors5xx: e5, errors4xx: e4,
      errorRate: n ? r4(e5 / n) : 0, clientErrorRate: n ? r4(e4 / n) : 0,
      p50: r1(percentile(sorted, 50)), p95: r1(percentile(sorted, 95)), p99: r1(percentile(sorted, 99)),
    };
  }

  return {
    clock,
    streamsOpened: () => streamsOpened,
    record({ route, status, ms }) {
      if (route === STREAM) { if (status === 200) streamsOpened++; return; }
      const label = KNOWN.has(route) ? route : 'other';
      let r = rings.get(label);
      if (!r) { r = { buf: [], next: 0 }; rings.set(label, r); }
      const sample = { t: now(), ms: Number(ms) || 0, status: Number(status) || 0 };
      if (r.buf.length < maxSamples) r.buf.push(sample);
      else { r.buf[r.next] = sample; r.next = (r.next + 1) % maxSamples; }
    },
    snapshot({ streamsOpen = 0 } = {}) {
      const t = now();
      const all = [];
      const routes = [];
      for (const [route, r] of rings) {
        const live = r.buf.filter((s) => t - s.t < windowMs);
        if (live.length === 0) continue;
        all.push(...live);
        const { clientErrorRate, ...rest } = stats(live);
        routes.push({ route, ...rest });
      }
      routes.sort((a, b) => b.count - a.count || (a.route < b.route ? -1 : a.route > b.route ? 1 : 0));
      const { count, errorRate, clientErrorRate, p50, p95, p99 } = stats(all);
      const hello = (rings.get('POST /hello') ? rings.get('POST /hello').buf : [])
        .filter((s) => t - s.t < windowMs && s.status >= 200 && s.status < 300).length;
      return {
        startedAt: new Date(startedAt).toISOString(),
        uptimeSeconds: Math.max(0, Math.floor((t - startedAt) / 1000)),
        windowSeconds: windowMs / 1000,
        total: { count, errorRate, clientErrorRate, p50, p95, p99 },
        helloPerMinute: Math.round((hello / (windowMs / 60000)) * 100) / 100,
        streamsOpen,
        routes,
      };
    },
  };
}

// Wraps (req, res) => Promise; records once on finish/close. Recording failures never reach the response.
function withSla(handler, sla, { clock } = {}) {
  const tick = clock || sla.clock || (() => performance.now());
  return async function slaHandler(req, res) {
    const start = tick();
    const route = routeLabel(req.method, req.url || '');
    let done = false;
    const record = () => {
      if (done) return;
      done = true;
      try { sla.record({ route, status: res.statusCode, ms: tick() - start }); } catch { /* never affects the response */ }
    };
    if (route === STREAM) {
      try { return await handler(req, res); } finally { record(); }
    }
    res.once('finish', record);
    res.once('close', record);
    return handler(req, res);
  };
}

module.exports = { createSla, routeLabel, percentile, withSla, LABELS };
