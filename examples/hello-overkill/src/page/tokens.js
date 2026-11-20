'use strict';
// Design tokens for the redesign ("The Overkill Greeting Office"). Colour values are the single source
// for the CSS custom properties and for the contrast tests (see docs/product/hello-overkill/redesign/ux-redesign.md 2.1).

const LIGHT = {
  paper: '#F4EEE2', surface: '#FBF8F1', sunken: '#EAE2D0', ink: '#1C1A17', 'ink-2': '#5A5348', line: '#D3C9B5',
  control: '#7A7061', accent: '#B3301B', 'accent-hover': '#9A2615', 'accent-ink': '#FBF8F1', teal: '#0F5C5C',
  ok: '#1E6A38', bad: '#9E1B1B', warn: '#8A5A00', focus: '#0F5C5C', 'wash-morning': '#F7E7C6', 'wash-ocean': '#D5E8E4',
};

const DARK = {
  paper: '#12161C', surface: '#1A2029', sunken: '#0D1015', ink: '#ECE6D8', 'ink-2': '#A9A596', line: '#2D3644',
  control: '#7C8594', accent: '#FF7A5C', 'accent-hover': '#FF9078', 'accent-ink': '#12161C', teal: '#5FC4BC',
  ok: '#6FD69A', bad: '#FF8A80', warn: '#F2C14E', focus: '#F2C14E', 'wash-morning': '#2B2518', 'wash-ocean': '#14292B',
};

// Pairs the UI relies on: [foreground, background, minimum ratio]. Text 4.5, UI components 3.
const PAIRS = [
  ['ink', 'paper', 4.5], ['ink', 'surface', 4.5], ['ink', 'sunken', 4.5],
  ['ink-2', 'paper', 4.5], ['ink-2', 'surface', 4.5], ['ink-2', 'sunken', 4.5],
  ['accent', 'paper', 4.5], ['accent', 'surface', 4.5], ['accent', 'sunken', 4.5],
  ['accent-ink', 'accent', 4.5], ['accent-ink', 'accent-hover', 4.5],
  ['teal', 'paper', 4.5], ['teal', 'surface', 4.5], ['teal', 'sunken', 4.5],
  ['ok', 'paper', 4.5], ['ok', 'surface', 4.5], ['ok', 'sunken', 4.5],
  ['bad', 'paper', 4.5], ['bad', 'surface', 4.5], ['bad', 'sunken', 4.5],
  ['warn', 'paper', 4.5], ['warn', 'surface', 4.5], ['warn', 'sunken', 4.5],
  ['ink', 'wash-morning', 4.5], ['ink', 'wash-ocean', 4.5], ['ink-2', 'wash-morning', 4.5], ['ink-2', 'wash-ocean', 4.5],
  ['control', 'paper', 3], ['control', 'surface', 3], ['control', 'sunken', 3],
  ['focus', 'paper', 3], ['focus', 'surface', 3], ['focus', 'sunken', 3],
];

const channel = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex));
  if (!m) throw new TypeError(`not a #RRGGBB colour: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(m[1].slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const toCss = (obj) => Object.keys(obj).map((k) => `--${k}:${obj[k]};`).join('');

module.exports = { LIGHT, DARK, PAIRS, luminance, contrast, toCss };
