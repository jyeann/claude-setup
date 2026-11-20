// The dot layer: one canvas, dots only. Three pre-rendered sprites, drawImage per dot, no shadowBlur, no filters, no per-frame
// gradients, devicePixelRatio capped at 2. The simulation lives in core/particles.js; this file owns the frame loop, the sprites
// and the frame-budget governor (rolling 60-frame p95 above 12 ms halves the dot cap: 500, 250, 125; never raised again).
import {
  createParticles, STRIDE, KIND_RETRY, KIND_ERROR, DOT_CAP,
} from '../core/particles.js';
import { setAttr } from './shell.js';

const STALE_MS = 2500; // no new tick for this long = the clock is paused: draw one still frame and stop
const WINDOW = 60;
const BUDGET_MS = 12;
const MAX_SAMPLES = 4000;

const num = (cs, name, dflt) => {
  const v = parseFloat(cs.getPropertyValue(name));
  return Number.isFinite(v) ? v : dflt;
};

export function createDotLayer(host, { seed = 1 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'map-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('data-testid', 'map-canvas');
  canvas.setAttribute('data-dots', '0');
  canvas.setAttribute('data-dot-cap', String(DOT_CAP));
  canvas.setAttribute('data-animating', 'false');
  host.prepend(canvas);
  const ctx = canvas.getContext('2d', { alpha: true });

  let field = createParticles({ seed, cap: DOT_CAP });
  let tokens = readTokens();
  let sprites = null;
  let dpr = 1;
  let cssW = 0;
  let cssH = 0;
  let raf = 0;
  let enabled = true;
  let paused = false;
  let lastTouch = 0;
  let lastFrame = 0;
  let lastAttr = 0;
  let destroyed = false;
  let geometry = null;
  const buf = new Float32Array(DOT_CAP * STRIDE);
  const ring = new Float32Array(WINDOW);
  let ringN = 0;
  let sinceCheck = 0;
  const samples = [];
  let frames = 0;

  function readTokens() {
    const cs = getComputedStyle(host);
    return {
      r: num(cs, '--dot-r', 2.5),
      rErr: num(cs, '--dot-r-error', 3.5),
      speed: num(cs, '--dot-speed', 140),
      cap: num(cs, '--dot-cap', DOT_CAP),
      colour: cs.getPropertyValue('--c-dot').trim() || '#cfe3f7',
      crit: cs.getPropertyValue('--c-crit').trim() || '#ff6f59',
    };
  }

  function makeSprite(size, draw) {
    const c = document.createElement('canvas');
    c.width = Math.ceil(size * dpr);
    c.height = Math.ceil(size * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    draw(g, size);
    return c;
  }

  function buildSprites() {
    const t = tokens;
    const dot = (t.r + 1) * 2;
    const ringSize = (t.rErr + 2) * 2;
    sprites = {
      dotSize: dot,
      ringSize,
      dot: makeSprite(dot, (g, sz) => { g.fillStyle = t.colour; g.beginPath(); g.arc(sz / 2, sz / 2, t.r, 0, Math.PI * 2); g.fill(); }),
      ring: makeSprite(ringSize, (g, sz) => { g.strokeStyle = t.crit; g.lineWidth = 1.5; g.beginPath(); g.arc(sz / 2, sz / 2, t.rErr - 0.75, 0, Math.PI * 2); g.stroke(); }),
    };
  }

  function resize(w, h) {
    cssW = Math.max(1, Math.round(w));
    cssH = Math.max(1, Math.round(h));
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(cssW * dpr);
    const ph = Math.round(cssH * dpr);
    if (canvas.width !== pw) canvas.width = pw;
    if (canvas.height !== ph) canvas.height = ph;
    buildSprites();
    drawFrame();
  }

  function refreshTheme() {
    tokens = readTokens();
    buildSprites();
    drawFrame();
  }

  function clearCanvas() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function drawFrame() {
    if (!sprites) return 0;
    clearCanvas();
    if (!enabled) return 0;
    const count = field.fill(buf);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { dot, ring: rg, dotSize, ringSize } = sprites;
    const hd = dotSize / 2;
    const hr = ringSize / 2;
    let alpha = 1;
    let tails = false;
    for (let i = 0; i < count; i++) {
      const o = i * STRIDE;
      const a = buf[o + 3];
      if (a !== alpha) { ctx.globalAlpha = a; alpha = a; }
      const kind = buf[o + 2];
      if (kind === KIND_ERROR) ctx.drawImage(rg, buf[o] - hr, buf[o + 1] - hr, ringSize, ringSize);
      else {
        ctx.drawImage(dot, buf[o] - hd, buf[o + 1] - hd, dotSize, dotSize);
        if (kind === KIND_RETRY) tails = true;
      }
    }
    if (tails) { // retry tails: one batched stroke
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = tokens.colour;
      ctx.lineWidth = tokens.r;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const o = i * STRIDE;
        if (buf[o + 2] !== KIND_RETRY) continue;
        ctx.moveTo(buf[o] - buf[o + 4] * 10, buf[o + 1] - buf[o + 5] * 10);
        ctx.lineTo(buf[o], buf[o + 1]);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    return count;
  }

  function publish(force, now) {
    if (!force && now - lastAttr < 250) return;
    lastAttr = now;
    setAttr(canvas, 'data-dots', enabled ? field.count() : 0);
    setAttr(canvas, 'data-dot-cap', field.cap);
  }

  function govern(ms) {
    ring[ringN % WINDOW] = ms;
    ringN++;
    if (samples.length < MAX_SAMPLES) samples.push(ms);
    sinceCheck++;
    if (sinceCheck >= WINDOW && ringN >= WINDOW) {
      sinceCheck = 0;
      const sorted = Array.from(ring).sort((a, b) => a - b);
      const p95 = sorted[Math.floor(WINDOW * 0.95) - 1];
      if (p95 > BUDGET_MS && field.cap > 125) field.setCap(Math.max(125, Math.floor(field.cap / 2)));
    }
  }

  function loop(now) {
    raf = 0;
    if (destroyed) return;
    const idle = now - lastTouch > STALE_MS;
    if (!enabled || paused || idle || document.hidden) {
      lastFrame = 0;
      const c = drawFrame();
      setAttr(canvas, 'data-animating', 'false');
      publish(true, now);
      void c;
      return;
    }
    const t0 = performance.now();
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    field.step(dt);
    drawFrame();
    govern(performance.now() - t0);
    frames++;
    setAttr(canvas, 'data-animating', 'true');
    publish(false, now);
    raf = requestAnimationFrame(loop);
  }

  function kick() {
    if (destroyed || raf || !enabled || paused || document.hidden) return;
    raf = requestAnimationFrame(loop);
  }

  const onVisibility = () => { if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; setAttr(canvas, 'data-animating', 'false'); } else kick(); };
  document.addEventListener('visibilitychange', onVisibility);

  const api = {
    canvas,
    setGeometry(edges) { geometry = edges; field.setGeometry(edges); drawFrame(); },
    // view: result of buildMapView(). Feeds densities, errors, piles, dimming.
    setLoads(view) {
      for (const e of Object.values(view.edges)) field.setEdgeLoad(e.key, { rate: e.dotRate, errFrac: e.errFrac, retryFrac: e.retryFrac, dim: e.dim, cut: e.cut });
      for (const n of Object.values(view.nodes)) field.setNodeLoad(n.id, { saturation: n.saturation, pile: n.pile });
      field.commit();
    },
    // A tick arrived: the clock is running, so the dots move.
    touch(now = performance.now()) { lastTouch = now; if (paused) drawFrame(); else kick(); },
    warm(seconds) { if (enabled) { field.warm(seconds); drawFrame(); publish(true, 0); } },
    setPaused(p) { paused = !!p; if (paused) { if (raf) cancelAnimationFrame(raf); raf = 0; drawFrame(); setAttr(canvas, 'data-animating', 'false'); publish(true, 0); } else { lastTouch = performance.now(); kick(); } },
    setEnabled(on) {
      enabled = !!on;
      field.setEnabled(enabled);
      if (!enabled) { if (raf) cancelAnimationFrame(raf); raf = 0; clearCanvas(); setAttr(canvas, 'data-animating', 'false'); }
      publish(true, 0);
      if (enabled) kick();
    },
    resize,
    refreshTheme,
    reseed(s) {
      const cap = field.cap;
      field = createParticles({ seed: s, cap: DOT_CAP });
      field.setCap(cap);
      field.setEnabled(enabled);
      if (geometry) field.setGeometry(geometry);
    },
    stats() {
      const sorted = samples.slice().sort((a, b) => a - b);
      const q = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
      return {
        frames, samples: sorted.length, p50: q(0.5), p95: q(0.95), max: sorted.length ? sorted[sorted.length - 1] : 0, dots: field.count(), cap: field.cap,
      };
    },
    resetStats() { samples.length = 0; frames = 0; },
    get field() { return field; },
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.remove();
    },
  };
  return api;
}
