'use strict';

const DEFAULT_LANGUAGE = 'en';
const DEFAULT_TONE = 'formal';
const CODE = /^[a-z][a-z0-9-]{0,15}$/;
const MAX_QUEUE = 65536;

function code(v, fallback) {
  return typeof v === 'string' && CODE.test(v) ? v : fallback;
}

function count(v) {
  return Number.isInteger(v) && v >= 0 ? v : 0;
}

// Milestone for a hello: exact hits only; when several apply the highest-priority one wins.
function milestoneFor(visit, streak) {
  if (streak === 100) return 'streak-100';
  if (visit === 100) return 'visit-100';
  if (streak === 30) return 'streak-30';
  if (visit === 10) return 'visit-10';
  if (streak === 7) return 'streak-7';
  if (visit === 1) return 'first-visit';
  return null;
}

// Whitelist projection: reads ONLY language, tone, visit, streak (and kind === 'core'). Never name, id, greeting.
function anonymise(info) {
  const src = info && typeof info === 'object' ? info : {};
  if (src.kind === 'core') return { language: DEFAULT_LANGUAGE, tone: DEFAULT_TONE, milestone: null, kind: 'core' };
  return {
    language: code(src.language, DEFAULT_LANGUAGE),
    tone: code(src.tone, DEFAULT_TONE),
    milestone: milestoneFor(count(src.visit), count(src.streak)),
  };
}

function createHub({
  now = Date.now, maxClients = 50, maxPerIp = 5, ringSize = 20, heartbeatMs = 15000,
  setInterval: setIv = setInterval, clearInterval: clearIv = clearInterval,
} = {}) {
  let nextId = 1;
  const ring = []; // { id, frame, event }
  const clients = new Set(); // { res, ip }
  const perIp = new Map();
  let timer = null;

  function drop(client) {
    if (!clients.delete(client)) return;
    const n = (perIp.get(client.ip) || 1) - 1;
    if (n <= 0) perIp.delete(client.ip); else perIp.set(client.ip, n);
    if (clients.size === 0 && timer !== null) { clearIv(timer); timer = null; }
  }

  // Returns true when written; drops the client on any failure or slow consumption.
  function send(client, chunk) {
    const { res } = client;
    try {
      if (res.writableEnded || res.destroyed) { drop(client); return false; }
      if (res.writableLength > MAX_QUEUE) {
        drop(client);
        if (typeof res.destroy === 'function') res.destroy();
        return false;
      }
      res.write(chunk);
      return true;
    } catch {
      drop(client);
      return false;
    }
  }

  function heartbeat() {
    for (const c of [...clients]) send(c, ': hb\n\n');
  }

  return {
    publish(info) {
      const id = nextId++;
      const ts = new Date(Math.floor(now() / 1000) * 1000).toISOString();
      const event = { id, ts, ...anonymise(info) };
      const frame = `id: ${id}\nevent: hello\ndata: ${JSON.stringify(event)}\n\n`;
      ring.push({ id, frame, event });
      while (ring.length > ringSize) ring.shift();
      for (const c of [...clients]) send(c, frame);
      return event;
    },
    // Does not write a status for refusals; the caller answers 503. `headers` (security headers) are merged into the 200.
    subscribe(res, { ip = 'unknown', lastEventId, headers = {} } = {}) {
      if (clients.size >= maxClients) return 'full';
      if ((perIp.get(ip) || 0) >= maxPerIp) return 'ip-full';
      const client = { res, ip };
      clients.add(client);
      perIp.set(ip, (perIp.get(ip) || 0) + 1);
      const gone = () => drop(client);
      res.on('close', gone);
      res.on('error', gone);
      try {
        if (!res.headersSent) {
          res.writeHead(200, {
            ...headers,
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-cache, no-store',
            connection: 'keep-alive',
            'x-accel-buffering': 'no',
          });
        }
      } catch { drop(client); return 'ok'; }
      if (!send(client, 'retry: 3000\n\n') || !send(client, ': connected\n\n')) return 'ok';
      const raw = lastEventId === undefined || lastEventId === null ? '' : String(lastEventId).trim();
      const last = /^\d+$/.test(raw) ? Number(raw) : -1;
      for (const e of ring) {
        if (e.id > last && !send(client, e.frame)) return 'ok';
      }
      if (clients.has(client) && timer === null) {
        timer = setIv(heartbeat, heartbeatMs);
        if (timer && typeof timer.unref === 'function') timer.unref();
      }
      return 'ok';
    },
    size: () => clients.size,
    history: () => ring.map((e) => ({ ...e.event })),
    closeAll() {
      for (const c of [...clients]) {
        drop(c);
        try { if (!c.res.writableEnded) c.res.end(); } catch { /* already gone */ }
      }
      if (timer !== null) { clearIv(timer); timer = null; }
    },
  };
}

module.exports = { createHub, anonymise };
