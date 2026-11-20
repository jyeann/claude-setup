// Log and diagnostic templates. No Intl: integers are grouped by hand.
import { metric, METRICS } from './model.js';
import { readPath } from './conditions.js';

export function formatInt(n) {
  const v = Math.round(n);
  const neg = v < 0;
  let s = String(neg ? -v : v);
  let out = '';
  while (s.length > 3) {
    out = ',' + s.slice(-3) + out;
    s = s.slice(0, -3);
  }
  return (neg ? '-' : '') + s + out;
}

const TOKEN = /\{([^{}]*)\}/g;
const FORMATS = ['int', 'pct', 'ms'];

// List the placeholders of a template. Anything in braces that is not a known form has kind "unknown".
export function placeholders(template) {
  const out = [];
  for (const mt of template.matchAll(TOKEN)) out.push(parseToken(mt[1], mt[0]));
  return out;
}

function parseToken(body, raw) {
  if (body === 'tick') return { kind: 'tick', raw };
  if (body.startsWith('m:')) {
    const [ref, fmt, ...rest] = body.slice(2).split('|');
    const dot = ref.indexOf('.');
    if (dot > 0 && rest.length === 0 && (fmt === undefined || FORMATS.includes(fmt))) {
      return { kind: 'm', node: ref.slice(0, dot), metric: ref.slice(dot + 1), format: fmt || null, raw };
    }
    return { kind: 'unknown', raw };
  }
  if (body.startsWith('p:')) return body.length > 2 ? { kind: 'p', path: body.slice(2), raw } : { kind: 'unknown', raw };
  if (body.startsWith('rand:')) {
    const r = /^(\d+)-(\d+)$/.exec(body.slice(5));
    if (r && Number(r[1]) <= Number(r[2])) return { kind: 'rand', min: Number(r[1]), max: Number(r[2]), raw };
  }
  return { kind: 'unknown', raw };
}

export const hasRand = (template) => placeholders(template).some((p) => p.kind === 'rand');
export const isKnownMetric = (name) => METRICS.includes(name);

function pct(v) {
  const x = Math.round(v * 1000);
  return `${Math.floor(x / 10)}.${x % 10}%`;
}

function fmtMetric(v, name, format) {
  if (v === null) return 'n/a';
  if (format === 'pct') return pct(v);
  if (format === 'ms') return `${formatInt(v)} ms`;
  if (format === 'int') return formatInt(v);
  return name === 'errorRate' || name === 'saturation' || name === 'hitRate' ? String(v) : formatInt(v);
}

// Resolve placeholders against a state. u in [0,1) is the one draw the engine passes for {rand}.
export function render(template, state, u) {
  return template.replace(TOKEN, (raw, body) => {
    const p = parseToken(body, raw);
    if (p.kind === 'tick') return String(state.tick);
    if (p.kind === 'rand') return String(p.min + Math.floor(u * (p.max - p.min + 1)));
    if (p.kind === 'm') return fmtMetric(metric(state, p.node, p.metric), p.metric, p.format);
    if (p.kind === 'p') {
      const v = readPath(state, p.path);
      return v === undefined ? 'n/a' : String(v);
    }
    return raw;
  });
}
