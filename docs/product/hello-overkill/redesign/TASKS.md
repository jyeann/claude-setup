# Redesign tasks

Source: `ux-redesign.md` (spec, with section 9 a11y review), `design.md` (code design). Builder: orchestrator. Test owners: tdd-guide (node unit), e2e-runner (Playwright RC suite).

## Fixed interfaces (tests and build both follow these)

`src/page.js` keeps `module.exports = { html, styleHash, scriptHash }` and assembles parts from `src/page/`:

- `src/page/tokens.js`
  - `LIGHT`, `DARK`: objects mapping token name without `--` (e.g. `paper`, `surface`, `sunken`, `ink`, `ink-2`, `line`, `control`, `accent`, `accent-hover`, `accent-ink`, `teal`, `ok`, `bad`, `warn`, `focus`, `wash-morning`, `wash-ocean`) to `#RRGGBB` hex.
  - `luminance(hex) -> number` (WCAG relative luminance, 0..1), `contrast(a, b) -> number` (>= 1, symmetric), `toCss(obj) -> string` (`--name:value;` for every key).
  - `PAIRS`: array of `[fgToken, bgToken, min]` that must hold in both themes.
- `src/page/geometry.js` (pure, deterministic, every number rounded to at most 2 decimals)
  - `rosette(cx, cy, R, r, d, steps = 360) -> string` SVG path `d`, starts with `M`, ends with `Z`. Points follow the epitrochoid `x = cx + (R)cos t - d cos((R + r)/r * t)` family; throws `RangeError` when `steps < 3` or `r <= 0`.
  - `sealPath(cx, cy, base, amp, teeth, steps = 360) -> string` closed path; every point's distance from (cx, cy) is in `[base - amp, base + amp]` (within 0.01). Throws `RangeError` when `teeth < 1` or `steps < 3`.
  - `sineBand(edge, k, opts) -> string` one band; `edge` in `top|bottom|left|right`, `k` in 0..2. Throws `RangeError` on a bad edge.
  - `guilloche(opts?) -> string[]` all certificate border paths: 2 rules + 12 bands + 4 corner rosettes + 1 watermark = 19 strings, each starting with `M`.
  - `ringGlyphs(text, r, cx, cy) -> {ch, x, y, rot}[]`, one per character, `rot = i * 360 / n`, `hypot(x - cx, y - cy) = r` within 0.01.
- `src/page/style.js` exports `STYLE` (string), `src/page/markup.js` exports `body(parts)` (string), `src/page/script.js` exports `SCRIPT` (string).

## Slices

1. Tokens + geometry modules with unit tests (tdd-guide writes the tests first).
2. Style: tokens, type, shell, components, motion, reduced motion, print.
3. Markup: shell, 10 views, annex, footer appearance radios, certificate art inlined from geometry.
4. Script: helpers, theme, router, hello ceremony, certificate, verify, battle, the six v2 views.
5. Update builder-owned unit tests `test/page.test.js`, `test/page-v2.test.js` for moved source patterns, keeping the behaviours they protect.
6. Verify gate green. Then review (4 reviewers), QA (`qa/walkthrough.js` regression + `qa/redesign.js` RC suite + screenshots), retro.
