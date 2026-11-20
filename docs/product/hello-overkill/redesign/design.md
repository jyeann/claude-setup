# Redesign code design (architect, saved verbatim)

I read the v2 acceptance test, `security.js` and spec §2.5. For the rest I went by your brief: I did not open §3, §6 or §7 in full, `page.acceptance.test.js`, the two unit test files, or the current `page.js`. The builder should check the test-pinned patterns against those files before cutting code.

---

# Hello Overkill redesign: code design

## 1. Module structure

**Decision: split into `src/page/`, and keep `src/page.js` as a small assembler with the same exports.**

```
src/page.js            assembles HTML, computes hashes, exports { html, styleHash, scriptHash }
src/page/tokens.js     colour, type and motion token table (plain data) + toCss(tokens)
src/page/geometry.js   pure: guilloche(), rosette(), sealPath(), ringGlyphs(), serialFmt()
src/page/style.js      exports STYLE string (built from tokens.toCss())
src/page/markup.js     exports SHELL(svgParts) string: header, nav, 10 views, footer, theme radios
src/page/script.js     exports SCRIPT string (client code as one template literal)
```

`page.js` works out to `'<!doctype html>...<style>'+STYLE+'</style>'+SHELL(geo)+'<script>'+SCRIPT+'</script></body></html>'` and hashes both bodies with the same `sha256-base64` formula `security.js` uses. `security.js` and `router.js` do not change.

Trade-offs:
- **Coverage (60% per file).** Files that only export a string literal are covered just by being required. `geometry.js` and `tokens.js` contain real logic that unit tests run, so they clear 60% easily. A single 2,500-line file would also pass, but the logic would be buried in a string and be hard to review.
- **Mutation testing** changes operators in `src/*.js` outside string literals. All client code sits inside the `SCRIPT` template literal, so it is never mutated, which matches today. The Node-side operators that do get mutated are the geometry and contrast maths, and those have exact-value tests (see section 6), so mutants get killed instead of surviving as noise. Check that the harness glob reaches `src/page/*.js`. If it only matches `src/*.js`, these files are not mutated at all, which is harmless but should be written down.
- **Acceptance regexes** only see the served HTML, so how the files are split makes no difference. Rules for the builder:
  - Write every testid as a literal (`data-testid="x"` in markup, or `'x'` in the script). Never build one by joining strings.
  - Keep `new EventSource('/api/stream')` in exactly that form.
  - Never use a `<script>` or `</style>` substring inside the CSS or JS.
  - Never use template literals with `${}` inside `SCRIPT`. Since it is itself a Node template literal, use string concatenation on the client side.

## 2. Computed geometry

**Decision: precompute in Node when the module loads, and inline the results as static SVG `<path d>` and `<text>` in the markup.**

- `guilloche({bands:13, w, h, amp, freq, phase}) -> string[]` gives one `d` per band (RC11 needs at least 13 paths, each with `pathLength="1"`).
- `rosette({R, r, d, steps}) -> string` gives an epitrochoid polyline `d`.
- `sealPath({teeth, rOuter, rInner}) -> string` gives the scalloped edge.
- `ringGlyphs(text, n=26, r) -> [{x, y, rot, ch}]` places each glyph with x/y/rotate attributes. It must not use `<textPath>`, because RC11 bans it.

Round every coordinate to 2 decimals so the output is the same on every run and the hash stays stable.

Why:
- These are pure functions with unit tests that pin exact values.
- The client script gets about 6 KB smaller.
- Nothing can throw in the browser.
- The certificate renders on first paint, without waiting for the script.

The one value that changes per certificate is the serial and name text. The client fills that in with `textContent`. Per-certificate variation, if wanted, is done with CSS custom-property phase offsets set through `el.style.setProperty` (CSSOM). That is allowed under CSP and is not a `style=""` attribute in the HTML. The spec's `guilloche()`/`seal()` helpers move to Node, so the build budget drops by that amount.

## 3. Client script architecture (one IIFE, `'use strict'`)

Sections, in this order:
0. Theme bootstrap (section 4).
1. **Helpers:**
   - `el(tag, attrs, kids)`: only touches `setAttribute`/`textContent`, and refuses `on*`, `style` and `href` keys.
   - `svg(tag, attrs)` (createElementNS)
   - `icon(name)`: clones a `<template>` symbol, without `<use>`.
   - `setLabel(btn, text)`
   - `busy(btn, on)`: sets `aria-disabled` and swaps the label. Keep the exact behaviour the current unit tests pin.
   - `say(msg)`: the only writer to the live region.
   - `motionOK()`: `matchMedia('(prefers-reduced-motion: reduce)')` returns false.
   - `api(method, path, body)`: fetch, JSON, normalised `{ok, status, data, error}`. Never throws.
   - `cleanText(s, max)`
   - `tween(el, keyframes, opts)`: wraps WAAPI, returns a resolved Promise when `!motionOK()` or `!el.animate`.
2. **Router:**
   - `routes = {hello, certificate, verify, battle, weather, wall, sla, 'time-machine', haiku, federation}`. Each entry is `{enter(param), leave()}`.
   - `go()` on `hashchange`: `runLeave()` (calls the current `leave`, catches and ignores errors), shows the view, focuses `view-title`, then calls `enter`.
   - View transitions: use `document.startViewTransition` only if it exists and `motionOK()` is true (RC10).
   - Wall and SLA start only after `runLeave`.
3. **Views:** one section per view.
   - Wall: EventSource, `.close()` on leave and on `pagehide`. It never reads the name field.
   - SLA: `setInterval` at 5000 ms, only while `document.visibilityState === 'visible'`; `clearInterval` on leave and when the page is hidden.
   - Federation: `cleanText` on every peer field, and text only (never links).
4. **Ceremony triggers:**
   - Default is CSS-only. Views toggle classes such as `is-arriving`, `is-stamped` and `is-sorted` on the view root. Keyframes live in `STYLE`, and the reduced-motion media query swaps them for opacity-only versions (RC3).
   - Remove the class on `animationend` and also with a timeout fallback, so nothing is left invisible (RC4).
   - WAAPI is used only for: certificate guilloche stroke draw (`strokeDashoffset` 1 to 0 on `pathLength=1`), seal stamp, wall FLIP reorder, SLA counter tween, and federation dots.
5. **Error containment:**
   - Wrap every `enter`, event handler and stream callback in `guard(fn)`, which runs try/catch, writes the view's `*-error` testid text and calls `say()`.
   - A `window.addEventListener('error')` and an `unhandledrejection` handler log to the status line only.
   - A view never clears its own static markup, so an exception cannot leave a blank view.

## 4. Theme order and avoiding a flash

1. In markup: `<meta name="color-scheme" content="light dark">`, plus two `theme-color` metas, plus `html{background:var(--paper)}`.
2. The first statement in `SCRIPT` is the try/catch `localStorage` read from spec §2.5, before any DOM lookup.
3. The footer radios set `data-theme`, write or remove `ho-theme`, and rewrite the `theme-color` contents.
4. The body transition is disabled until the first `requestAnimationFrame` after bootstrap (a `.theme-ready` class), so a restored override never animates in. This also helps RC2.

Known risk: the script sits at the end of the body, so a large HTML chunk might paint before it runs. To keep that from happening, keep the total HTML under about 100 KB so it arrives in one chunk. Leave the fallback as spec §2.5 describes: a one-frame flash only when the override differs from the system theme.

## 5. Failure modes and security

- **CSP is unchanged.** Hashes are computed in the same place. Inlined SVG paths are part of the hashed HTML, not separate resources, so nothing new loads.
- **localStorage reflected into an attribute.** Only write `data-theme` after the exact checks `t === 'light' || t === 'dark'`. Any other value is ignored and the key is removed. Never pass a stored value to `setAttribute` anywhere else.
- **Hash routes.** Route params (the certificate id) must match `/^[A-Za-z0-9-]{1,64}$/` before use. `setAttribute('href', '#/certificate/' + id)` must start with a literal `'#/` so it satisfies the regex at line 99.
- **Peer and API data** goes through `textContent` only, after `cleanText`. No `href`, no `src`, no `<a>` for federation.
- **`el()` refuses** `on*`, `style` and `href` attribute names, as defence in depth against future edits.
- **No `<use>`, `<textPath>` or `xlink:href`** anywhere (RC11). Icons are cloned inline paths.
- **Mid-stream errors** in EventSource set "Reconnecting..." and never throw. A rejected `fetch` resolves through `api()` to `{ok: false}`.

## 6. Test plan

**Node unit tests (`test/`, run in verify):**
- `page-lint.test.js`: one style and one script; hashes equal `securityHeaders(html)`; the banned-pattern regexes from the acceptance tests run on `html`; no `${` inside `SCRIPT`; no `</script` or `</style` inside the bodies; all 96 testids plus the redesign hook testids are present; HTML size is under budget (style up to 48 KB).
- `geometry.test.js`:
  - `guilloche` returns 13 strings, each starting with `M`.
  - Output is deterministic: the same inputs give the same output, pinned by a snapshot of the first point for each band.
  - `sealPath` has `2*teeth` arc segments.
  - `ringGlyphs` returns 26 entries with radius within 0.01 of `r`.
  - `rosette` closes on itself: the first and last points are equal.
  - Error cases: bad params throw `RangeError`.
- `tokens.test.js`: compute WCAG contrast in Node from the token table for every RC7 pair, in both themes, and assert the minimums. This catches maths slips before Playwright runs. `toCss` must emit every token.
- `page.test.js` / `page-v2.test.js`: update the pinned source patterns to the new code, but keep the behaviour assertions: aria-disabled busy buttons, `say()` as the only live-region writer, `runLeave` before wall and SLA start, wall never reads the name, the SLA 5000 ms visibility gate, federation never links, `cleanText`.

**Playwright (browser), one spec per RC:**
- RC1 theme persistence, RC2 no flash, RC3 reduced motion via `getAnimations()`, RC4 no element left at opacity 0.
- RC5 at 390px: every view, both themes, overflow check and 44px targets.
- RC6 print layout, RC7 computed contrast, RC8 focus, RC9 DOM order equals visual order, RC10 view-transition guard, RC11 certificate artifact.
- RC12 hostile input, RC13 secondary stories.
- Run the v1 and v2 UC suites unchanged as a regression gate.
