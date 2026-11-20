'use strict';
// Shared icon set (24 grid, stroke icons). Rendered as static SVG strings in the markup and passed as data to the
// client script, which builds the same shapes with createElementNS. No <use>, no href, no text inside icons.

const ICONS = {
  envelope: [['rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }], ['path', { d: 'M3.5 6.5l8.5 6.5 8.5-6.5' }]],
  check: [['path', { d: 'M4 12.5l5 5L20 6.5' }]],
  cross: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
  copy: [['rect', { x: 9, y: 9, width: 11, height: 11, rx: 2 }], ['path', { d: 'M5 15V6a2 2 0 0 1 2-2h8' }]],
  printer: [['path', { d: 'M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z' }]],
  sun: [['circle', { cx: 12, cy: 12, r: 4 }], ['path', { d: 'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1' }]],
  cloud: [['path', { d: 'M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.25 8.5z' }]],
  rain: [['path', { d: 'M7 16a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 7.5a4.25 4.25 0 0 1-.25 8.5zM8 19.5l-1 2M12 19.5l-1 2M16 19.5l-1 2' }]],
  wind: [['path', { d: 'M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7' }]],
  snow: [['path', { d: 'M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9' }]],
  alert: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7.5v5.5M12 16.5v.01' }]],
  star: [['path', { d: 'M12 3l2.2 5.6L20 9.5l-4.5 3.8 1.4 5.7L12 16l-4.9 3 1.4-5.7L4 9.5l5.8-.9z' }]],
  loupe: [['circle', { cx: 10.5, cy: 10.5, r: 6 }], ['path', { d: 'M15 15l5.5 5.5' }]],
  clock: [['circle', { cx: 12, cy: 12, r: 9 }], ['path', { d: 'M12 7v5l3 2' }]],
  quill: [['path', { d: 'M20 4c-8 0-13 5-14 13M20 4l-8 8M4 20l2-3' }]],
  duel: [['path', { d: 'M3 6h8v12H3zM13 6h8v12h-8zM3 7l4 4 4-4M13 7l4 4 4-4' }]],
  board: [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }], ['path', { d: 'M3 9h18M3 14h18M9 4v16' }]],
  gauge: [['path', { d: 'M4 17a8 8 0 1 1 16 0M12 17l4-6M7 17h-.01M17 17h-.01' }]],
  network: [['circle', { cx: 12, cy: 12, r: 2.5 }], ['circle', { cx: 4.5, cy: 6, r: 1.75 }], ['circle', { cx: 19.5, cy: 6, r: 1.75 }], ['circle', { cx: 12, cy: 20.5, r: 1.75 }], ['path', { d: 'M6 7l4 3.5M18 7l-4 3.5M12 14.5v4.25' }]],
  teacup: [['path', { d: 'M4 9h12v4a6 6 0 0 1-12 0zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3c0 1.5 1 1.5 1 3M12 3c0 1.5 1 1.5 1 3M19 20.5h.01M21 18h.01' }]],
  lock: [['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }], ['path', { d: 'M8 11V8a4 4 0 0 1 8 0v3' }]],
  calendar: [['rect', { x: 4, y: 5, width: 16, height: 15, rx: 2 }], ['path', { d: 'M4 10h16M8 3v4M16 3v4' }]],
  retry: [['path', { d: 'M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4' }]],
  pause: [['path', { d: 'M8 5v14M16 5v14' }]],
};

const attrs = (o) => Object.keys(o).map((k) => ` ${k}="${o[k]}"`).join('');

// Static markup for an icon; `cls` adds classes (default "ic").
function iconSvg(name, cls = 'ic') {
  const parts = ICONS[name];
  if (!parts) throw new RangeError(`unknown icon: ${name}`);
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${parts.map(([t, a]) => `<${t}${attrs(a)}/>`).join('')}</svg>`;
}

module.exports = { ICONS, iconSvg };
