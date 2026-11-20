# Hello Overkill: visual and interaction redesign ("The Overkill Greeting Office")

Status: design spec for the build phase. It EXTENDS `../ux.md` (v1 behaviour, copy, focus rules, 38 selectors, UC1-UC11) and `../v2/spec.md` (58 v2 selectors, fixed v2 copy). Where this file is silent, `ux.md` rules. Nothing here changes an API, a route, a testid's meaning, or a v1/v2 fixed string.

Build target: `examples/hello-overkill/src/page.js` only. One inline `<style>`, one inline `<script>`, both hashed in the CSP. No web fonts, no `data:` URIs, no `url()` in CSS, no `<img>`, no external anything.

Contrast ratios below were computed by hand from the WCAG relative-luminance formula for the exact hex values listed. RC7 re-checks them in the browser, so a rounding slip here is caught by the test, not shipped.

---

## 1. Direction

**Purpose.** Make saying hello feel like an official act. The product is a joke told with total sincerity: a fictional ministry of correspondence that over-engineers every greeting (signed certificates, battles, a live board, forecasts, haiku, federation). The design has to be so well made that the joke lands because nothing winks.

**Audience.** Developers and reviewers who open the demo for 60 seconds and judge the craft. They test with keyboard, dark mode, a phone and a print preview. They notice 1px misalignments and unconsidered empty states.

**Tone.** Dry, ceremonial, precise. Copy stays plain (v1 copy is kept verbatim). The ministry voice lives in eyebrows, captions, stamps and typography, never in error messages.

**The one memorable idea: every result is a piece of mail that gets stamped.** The greeting arrives as a letter pulled from an envelope and postmarked. The certificate is an engraved, printable document with a guilloche border and a wax-style seal. A verdict is a rubber stamp. A time-machine result is a postmark whose year rolls to the target. Everything else (battle letters on a table, telegram strips, a departure board, a sorting-office floor, a map of sister offices) hangs off that one metaphor. Stamps are the recurring motion: scale down from large, rotate to rest, one soft thud. That single gesture repeats in 6 views and becomes the product's signature.

**Why it fits.** The brief is "overkill hello". Postal ceremony is the natural home for overkill: serial numbers, seals, departments, counters, forms. It also gives us a distinctive palette (paper, ink, postmark red, teal ink, night post) and type (serif display for ceremony, grotesk for UI, mono for serials and data) that cannot be mistaken for a template. Avoided: purple gradients, blobs, glass cards, cards inside cards, hero copy.

**Palette in one line.** Warm paper and black-brown ink, one signature accent (postmark vermilion `#B3301B`), one secondary (deep teal ink `#0F5C5C`). Dark theme is the "night post": blue-black paper, warm-white ink, lit vermilion and lamp-amber.

---

## 2. Design system

All tokens are CSS custom properties declared once. Build `STYLE` as a JS template with `TOKENS_DARK` interpolated three times (system media query, `[data-theme=dark]`, and the `.night` scope), so the dark values exist in one place in source.

### 2.1 Colour tokens

Light theme ("day post") on `:root`; dark theme ("night post"). Ratios are text-or-UI foreground against the background named.

| Token | Role | Light | Dark |
|---|---|---|---|
| `--paper` | page background | `#F4EEE2` | `#12161C` |
| `--surface` | sheets, cards, inputs | `#FBF8F1` | `#1A2029` |
| `--sunken` | wells, table heads, disabled, battle table | `#EAE2D0` | `#0D1015` |
| `--ink` | body text | `#1C1A17` | `#ECE6D8` |
| `--ink-2` | secondary text, captions | `#5A5348` | `#A9A596` |
| `--line` | decorative hairlines (not relied on for meaning) | `#D3C9B5` | `#2D3644` |
| `--control` | borders of inputs, checkbox, secondary buttons | `#7A7061` | `#7C8594` |
| `--accent` | postmark red: primary action, current tab, stamps | `#B3301B` | `#FF7A5C` |
| `--accent-hover` | primary hover | `#9A2615` | `#FF9078` |
| `--accent-ink` | text on accent | `#FBF8F1` | `#12161C` |
| `--teal` | secondary ink: links, focus, guilloche, info | `#0F5C5C` | `#5FC4BC` |
| `--ok` | Authentic, Connected, peer up | `#1E6A38` | `#6FD69A` |
| `--bad` | Forged, errors, peer down | `#9E1B1B` | `#FF8A80` |
| `--warn` | Reconnecting, stale, not-verified | `#8A5A00` | `#F2C14E` |
| `--focus` | focus ring | `#0F5C5C` | `#F2C14E` |
| `--wash-morning` | haiku card wash | `#F7E7C6` | `#2B2518` |
| `--wash-ocean` | haiku card wash | `#D5E8E4` | `#14292B` |
| `--shadow-rgb` | shadow tint (used as `rgb(var(--shadow-rgb) / a)`) | `60 40 10` | `0 0 0` |

`--paper` carries a laid-paper texture: `background-image: repeating-linear-gradient(0deg, rgb(90 70 40 / .03) 0 1px, transparent 1px 4px)` in light, `rgb(255 255 255 / .015)` in dark. Alpha is low enough that contrast against the flat colour holds to two decimals.

**Scoped sets (important).** Two classes re-declare a full token set so some surfaces keep their look in either theme:
- `.paper` re-declares the LIGHT values. Used on the certificate sheet. In dark theme the certificate is a lit paper sheet on a dark table, and it prints correctly regardless of theme.
- `.night` re-declares the DARK values. Used on the Wall board, the SLA control-room panel, and the haiku "night" card. In light theme these are dark instruments set into the page.
Declare `.paper` and `.night` AFTER the theme rules so they win at equal specificity.

**Contrast table (exact).**

| Pair | Light | Dark | Needs |
|---|---|---|---|
| `--ink` on `--paper` | 15.03 | 14.58 | 4.5 |
| `--ink` on `--surface` | 16.37 | 13.16 | 4.5 |
| `--ink` on `--sunken` | 13.47 | 15.3 | 4.5 |
| `--ink-2` on `--paper` | 6.57 | 7.35 | 4.5 |
| `--ink-2` on `--surface` | 7.16 | 6.63 | 4.5 |
| `--ink-2` on `--sunken` | 5.89 | 7.72 | 4.5 |
| `--accent` text on `--paper` | 5.42 | 7.08 | 4.5 |
| `--accent` text on `--surface` | 5.90 | 6.39 | 4.5 |
| `--accent` text on `--sunken` | 4.85 | 7.08+ | 4.5 |
| `--accent-ink` on `--accent` (primary button) | 5.90 | 7.08 | 4.5 |
| `--accent-ink` on `--accent-hover` | 7.44 | 7.5+ | 4.5 |
| `--teal` on `--paper` / `--surface` / `--sunken` | 6.71 / 7.31 / 6.02 | 8.74 / 7.87 / 8.9 | 4.5 |
| `--ok` on `--paper` / `--surface` | 5.73 / 6.24 | 10.16 / 9.17 | 4.5 |
| `--bad` on `--paper` / `--surface` | 6.92 / 7.53 | 7.95 / 7.17 | 4.5 |
| `--warn` on `--paper` / `--surface` | 5.13 / 5.59 | 10.8 / 9.76 | 4.5 |
| `--control` border on `--paper` / `--surface` / `--sunken` | 4.21 / 4.58 / 3.77 | 4.88 / 4.40 / 5.12 | 3.0 (UI) |
| `--focus` ring on `--paper` | 6.71 | 10.8 | 3.0 (UI) |
| `--ink` on `--wash-morning` / `--wash-ocean` | 14.2 / 13.65 | 12.2 / 12.2 | 4.5 |
| `--ink-2` on `--wash-morning` / `--wash-ocean` | 6.2 / 5.97 | 6.16 / 6.2 | 4.5 |

Rules: text never sits on `--line`, never uses `--accent` below 16px regular on `--sunken` in light (4.85 is the floor, still passing). Decorative strokes (guilloche, hairlines, stamp rings) are exempt but all text drawn inside them uses the table above. Status is never colour alone: every state pairs colour with an icon or glyph and a word.

### 2.2 Type

System stacks only (no downloads, no layout shift from font swap):

```
--font-display: "Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Charter,"Bitstream Charter",Cambria,Georgia,ui-serif,serif;
--font-ui:      ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
--font-mono:    ui-monospace,"SF Mono","Cascadia Mono","Roboto Mono",Menlo,Consolas,"Liberation Mono",monospace;
```
CJK: `:lang(ja){--font-display:"Hiragino Mincho ProN","Yu Mincho","Noto Serif CJK JP",ui-serif,serif}` applied through the `lang` attribute the greeting already carries.

| Token | Size | Line height | Face / weight | Use |
|---|---|---|---|---|
| `--t-eyebrow` | `.75rem` | 1.4 | mono 600, `letter-spacing:.14em`, uppercase (decorative elements only, see 2.2 note) | eyebrows, stamp captions |
| `--t-caption` | `.8125rem` | 1.45 | ui 500 | hints, table heads, captions |
| `--t-body` | `1rem` | 1.55 | ui 400 | body, inputs, buttons (600) |
| `--t-lead` | `1.125rem` | 1.5 | ui 400 | ledes |
| `--t-h3` | `1.375rem` | 1.3 | display 600 | section titles |
| `--t-h2` | `1.75rem` | 1.2 | display 600 | h2 |
| `--t-h1` | `clamp(2rem, 1.4rem + 2.6vw, 3rem)` | 1.08 | display 700, `letter-spacing:-.01em` | view title |
| `--t-greeting` | `clamp(1.5rem, 1.1rem + 2.2vw, 2.5rem)` | 1.2 | display 500 italic off | greeting-text, haiku lines |
| `--t-data` | `.875rem` | 1.5 | mono 500, `tabular-nums` | signatures, serials, latencies |
| `--t-numeral` | `1.75rem` | 1.1 | mono 600, `tabular-nums` | SLA tiles, counters |

Rules: `text-wrap:balance` on h1, h2, h3, greeting-text; `text-wrap:pretty` on ledes and captions; `font-variant-numeric:tabular-nums` on every number that updates (counts, timers, latencies, votes). `font-size` for controls is never below `1rem` (stops iOS zoom). **No `text-transform` on any element whose text is a testid target, a label, a button, a nav link or a heading**: Chromium applies it to the accessible name and to `innerText`, which would break `getByLabel`/`innerText` assertions. Uppercase is allowed only on `aria-hidden` decorative spans and CSS-generated content.

### 2.3 Spacing, radii, borders, elevation

Spacing (4px base): `--s-1 .25rem`, `--s-2 .5rem`, `--s-3 .75rem`, `--s-4 1rem`, `--s-5 1.5rem`, `--s-6 2rem`, `--s-7 3rem`, `--s-8 4rem`, `--s-9 6rem`. Page gutter: `--s-4` at 390, `--s-6` at 768+. Vertical rhythm between blocks: `--s-5`.

Radii (stationery is nearly square): `--r-0 2px` (tape, stamps, table), `--r-1 6px` (controls, chips), `--r-2 10px` (sheets), `--r-pill 999px` (lamps, pills). Concentric rule: a nested radius is `outer - padding`, floor 2px. Sheets are `--r-2` with 16px padding, so the controls inside use `--r-1`.

Borders: hairline `1px solid var(--line)` (separation); control `1px solid var(--control)`; letterhead rule `3px double var(--ink)`; error input `2px solid var(--bad)`.

Elevation (layered, tinted by `--shadow-rgb`):
```
--sh-1: 0 1px 0 rgb(var(--shadow-rgb) / .06), 0 1px 2px rgb(var(--shadow-rgb) / .10);
--sh-2: 0 1px 1px rgb(var(--shadow-rgb) / .08), 0 6px 14px -4px rgb(var(--shadow-rgb) / .20);
--sh-3: 0 2px 2px rgb(var(--shadow-rgb) / .08), 0 16px 30px -8px rgb(var(--shadow-rgb) / .32);
```
Dark theme additionally adds `inset 0 1px 0 rgb(255 255 255 / .04)` to `--sh-1/2/3` (edge light) and uses alpha .5/.6 for the big layer.

Focus ring (global): `:focus-visible{outline:3px solid var(--focus);outline-offset:2px}` with `border-radius` inherited so it hugs rounded controls. Never `outline:none`. The h1 (`tabindex=-1`) keeps the same ring. Inside `.night` the ring is amber via the scoped token. In `forced-colors: active` the ring and borders fall back to `CanvasText`/`Highlight`.

Selection: `::selection{background:var(--teal);color:var(--surface)}` (7.31 light / 7.87 dark... dark uses `--paper` as text: 8.74).

### 2.4 Motion tokens

```
--d-instant:90ms; --d-fast:160ms; --d-base:260ms; --d-slow:420ms; --d-ceremony:720ms; --step:60ms;
--ease-out:   cubic-bezier(.22,1,.36,1);     /* enter, default */
--ease-in:    cubic-bezier(.64,0,.78,0);     /* exit, always <=150ms */
--ease-io:    cubic-bezier(.65,0,.35,1);     /* flaps, rails */
--ease-stamp: cubic-bezier(.34,1.56,.64,1);  /* stamp thud (overshoot) */
--spring-soft: cubic-bezier(.34,1.3,.64,1);  /* fallback */
--spring-snap: cubic-bezier(.3,1.4,.6,1);
@supports (transition-timing-function:linear(0,1)){:root{
  --spring-soft: linear(0,.2 5%,.55 12%,.86 21%,1.04 32%,1.06 40%,1.03 50%,.995 63%,1 80%,1);
  --spring-snap: linear(0,.4 7%,.82 16%,1.05 27%,1.03 38%,.995 55%,1)}}
```
Z-index: `--z-base 0`, `--z-lift 1` (lifted letters, stamps), `--z-rail 10` (sticky annex rail), `--z-vt 20` (view-transition group).

Motion rules: motion must guide attention, communicate state, or keep spatial continuity. Animate only `transform`, `opacity`, `clip-path`, `filter: blur()` (<=4px) and SVG `stroke-dashoffset`. Never animate width/height/margin/top/left. No `transition: all`; every transition lists its properties. Entrance is ease-out, exit is `--ease-in` at 150ms max. Hover transforms are gated by `@media (hover:hover)`. Ceremonies finish in <= 1.2 s and are one-shot; the only loops are loading indicators and the Reconnecting lamp.

**Animation-by-class model (keeps JS tiny).** CSS animations play automatically when a node is inserted or when a `hidden` section is un-hidden. JS only picks classes. Every keyframe omits its `to` frame so the end state is the element's natural style, and every animation uses `animation-fill-mode: backwards`. If an animation is cancelled, throttled or never runs, the content is in its final, visible state (no invisible content, ever). Stagger is `animation-delay: calc(var(--i,0) * var(--step))` with `--i` assigned by generated `.stagger > :nth-child(n)` rules for n = 1..8.

| Class | Keyframe `from` | Duration, easing |
|---|---|---|
| `.rise` | opacity 0, translateY(8px) | `--d-base`, ease-out |
| `.rise-lg` | opacity 0, translateY(14px) rotate(.6deg) | `--d-slow`, ease-out |
| `.deal-a` / `.deal-b` | opacity 0, translateX(-24px / 24px) rotate(-4deg / 4deg) | `--d-slow`, spring-soft |
| `.slide-up` | opacity 0, translateY(32px) | 400ms, spring-soft |
| `.flap-open` | scaleY(1) (rests at scaleY(-1)), origin top | 240ms, ease-io (this one rests in a set state: see 4.1) |
| `.stamp-in` | opacity 0, scale(1.7) rotate(-16deg) | 200ms, ease-stamp |
| `.thud` | translateY(1.5px) | 80ms, ease-out |
| `.draw` | stroke-dashoffset 1 (paths use `pathLength="1"`, `stroke-dasharray:1`) | 900ms, ease-io |
| `.tape` | clip-path inset(0 100% 0 0) | 360ms, linear |
| `.flip` | transform perspective(400px) rotateX(90deg), origin top | 300ms, ease-out |
| `.tick` | opacity .4, translateY(-3px) | `--d-base`, ease-out |
| `.shake` | translateX(-4px) ... 3 cycles | 280ms, ease-out |
| `.wash` | background-color accent at 18% alpha | 900ms, ease-out |
| `.pulse` (loop) | opacity .45 to 1 | 1400ms, ease-io, infinite |
| `.spin` (loop) | rotate(360deg) | 1000ms, linear, infinite |

**Reduced motion (single rule set, tested by RC3).** Inside `@media (prefers-reduced-motion:reduce)`:
1. Re-declare every keyframe above with only `from{opacity:0}` (last definition wins), so nothing but opacity animates.
2. Set `--d-fast:120ms; --d-base:120ms; --d-slow:150ms; --d-ceremony:150ms; --step:0ms`.
3. `.pulse,.spin{animation:none}` (loaders become static: dots, a still ring).
4. `:active{transform:none}`, hover transforms off, `scroll-behavior:auto`.
5. JS reads `motionOK()` = `!matchMedia('(prefers-reduced-motion: reduce)').matches` at call time and skips tweens, WAAPI calls, view transitions and moving lamps.

### 2.5 Theme model

- Values: `system` (default, no attribute), `light`, `dark`. Stored in `localStorage['ho-theme']` as `light` or `dark`; `system` removes the key.
- CSS: `:root{light tokens;color-scheme:light}`; `@media (prefers-color-scheme:dark){:root:not([data-theme=light]){dark tokens;color-scheme:dark}}`; `:root[data-theme=dark]{dark tokens;color-scheme:dark}`; `:root[data-theme=light]{color-scheme:light}`.
- Switcher: native radio group in the footer (see 3.2 and 5), after `say-hello` in DOM and visual order, so UC11 is untouched.
- **Avoiding a flash with one script.** The inline script is the last element of `<body>`. Its FIRST statement (before any DOM lookup) is `try{var t=localStorage.getItem('ho-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`. The document is a single small chunk, so this runs before first paint in practice. Two guards for the residual case: (1) `<meta name="color-scheme" content="light dark">` and `html{background:var(--paper)}` make the canvas match the system theme before any CSS paints; (2) the only possible flash is a user whose override differs from the system, for at most one frame. We accept that rather than hide the page behind JS (a blank page when JS fails is worse). RC2 asserts the computed background is already the override at `domcontentloaded`.
- `<meta name="theme-color">` is emitted twice with `media="(prefers-color-scheme: light|dark)"` (`#F4EEE2`, `#12161C`); the script rewrites both `content` values when an override is chosen.
- Theme change transition: `body{transition:background-color var(--d-base) var(--ease-out),color var(--d-base) var(--ease-out)}`; off under reduced motion.

---

## 3. Layout and navigation

### 3.1 Shell (DOM order is also visual order)

```
<div class="shell">                      (overflow-x:clip)
  <div class="airmail" aria-hidden>      6px airmail stripe, top of page
  <header>                               letterhead: crest svg, brand p "Hello Overkill", eyebrow, 
    <nav aria-label="Primary">           nav-hello, nav-battle, nav-verify   <- Tab 1-3
  <main id="main">
    view head: eyebrow p, h1#title[data-testid=view-title], lede p
    <section id="v-..."> (one visible)   <- Tab 4-8 on Hello (name .. say-hello)
    div#status[role=status].sr
  <div class="annex">                    "Other departments" + secondary nav (6 links), AFTER main
  <footer>                               privacy line, appearance radios (theme), AFTER annex
```
Constraint check: nothing focusable precedes `nav-hello`; nothing between `nav-verify` and `name-input` (the eyebrow, h1, lede are static text; h1 is `tabindex=-1`, not a tab stop); the first 8 stops on `/` are exactly `nav-hello, nav-battle, nav-verify, name-input, language-select, tone-select, chaos-toggle, say-hello`. The 9th stop is `nav-weather` when the result card has no focusable child.

`nav-hello` has static `aria-current="page"` in the HTML so the first paint already shows the active tab; the router keeps `aria-current` in sync.

### 3.2 Breakpoints

| Width | Shell | Primary nav | Secondary nav ("Other departments") | Footer |
|---|---|---|---|---|
| 390 to 639 (base) | gutter 16px, single column | brand row (crest 32px, brand, eyebrow), then 3 equal tabs, 48px high | after main, 2-column grid of 6 tiles, 56px high, label + mono caption | privacy text, then appearance radios as 3 equal 44px segments |
| 640 to 1199 | gutter 32px, main `max-width:48rem` centered | brand left, tabs right on one row | after main, 3-column grid of tiles | privacy left, appearance right |
| 1200+ | `max-width:74rem`; grid `minmax(0,1fr) 15rem`; main left, annex rail right, sticky `top:1rem`, `z-index:var(--z-rail)` | same as 640 | vertical list in the rail (tiles stacked, 48px high) | spans both columns |

At 1200+ the rail is to the right of main in both DOM order (main then annex) and visual order (RC9 asserts annex left edge >= main right edge). Nothing is reordered with CSS `order`.

Primary tab: 44px minimum height, `--r-1`, 1px `--line` border, current tab has `font-weight:700` and a 3px `--accent` underline (`box-shadow: inset 0 -3px 0 var(--accent)`) plus `aria-current`. Not colour alone: weight and underline. Hover: `--sunken` background. Secondary tile: label (ui 600) and caption from `::after{content:attr(data-sub) / ""}` in `--t-eyebrow` mono, `--ink-2`. Captions (`data-sub`): Weather "Telegram", Wall "Live board", SLA "Control room", Time machine "Postmarks", Haiku "Print shop", Federation "Sister offices". Link text stays exactly `Weather`, `Wall`, `SLA`, `Time machine`, `Haiku`, `Federation`.

Header details: airmail stripe `repeating-linear-gradient(135deg, var(--accent) 0 12px, var(--paper) 12px 24px, var(--teal) 24px 36px, var(--paper) 36px 48px)`, 6px high, full bleed. Brand: crest (inline static SVG, 32px, envelope with flap, `aria-hidden`), `p.brand` text "Hello Overkill" in display 700 `1.375rem`, eyebrow under it "The Overkill Greeting Office" (mono, `--ink-2`). Under the header a `3px double var(--ink)` rule.

Route change: sections toggle with `hidden`; the entering section plays `.rise` (opacity + 6px) at `--d-base`. Focus moves to the h1 exactly as in v1 (`title.focus()` when not first load). View transitions are used ONLY for hello to certificate (see 4.2).

### 3.3 View composition summary

| View | 390 | 768 | 1280+ (inside main, about 46rem wide) |
|---|---|---|---|
| Hello | form sheet, then result letter | form (21rem) / result (1fr), `min-width:0` on both | same as 768 |
| Certificate | portrait sheet full width, actions below | sheet 34rem centered, actions in a row | same |
| Verify | tray, button, stamp | tray left 1fr, verdict right 18rem | same |
| Battle | two letters stacked, leaderboard below | two letters side by side, leaderboard below | same |
| Weather | form, telegram | form / telegram two columns | same |
| Wall | board full width | board full width | board plus 14rem side legend (lamp states) |
| SLA | tiles 2 columns, sparkline, table | tiles 4 columns | tiles 4 columns, table beside sparkline |
| Time machine | form, rail, postmark card | form / result columns, rail across | same |
| Haiku | form, card | form / card columns | same |
| Federation | notice, map, table, form, results | map left / table right | same |

---

## 4. Per-view spec

Common to every view: an eyebrow (`p.eyebrow`, mono, `--ink-2`), the h1 (`view-title`, display), an optional lede (`p.lede`, `--t-lead`, `text-wrap:pretty`). Common slots: form sheet (`.sheet`, `--surface`, 1px `--line`, `--r-2`, `--sh-1`, padding `--s-5`), inline error slot (`p.err`, `min-height:1.5rem` always reserved so an error appearing never shifts layout; when non-empty it shows a CSS `!` roundel prefix, `--bad`, plus text), loading line, result region. Inputs are 48px high. Hostile content: every dynamic string uses `textContent`, `overflow-wrap:anywhere`, `min-width:0` on every grid/flex child, `hyphens:auto` on greetings. Text with markup characters is shown literally.

Wording rule for new copy on the Hello view and in error states: it must not contain the substring `at ` (the word "at" followed by a space), `Error:` or `{`, because UC8 greps the whole page text for stack-trace shapes. All new copy in section 6 was written to that rule; the builder keeps to it.

Shared icon set: inline SVG built with `createElementNS` (24 grid, `stroke-width:1.75`, round caps/joins, `fill:none`, `stroke:currentColor`, `aria-hidden="true"`, `focusable="false"`, NEVER a `<title>` or `<text>` inside a button, label or testid element so textContent stays exact). Path data: check `M4 12.5l5 5L20 6.5`; cross `M6 6l12 12M18 6L6 18`; envelope `rect x3 y5 w18 h14 rx2` + `M3.5 6.5l8.5 6.5 8.5-6.5`; copy `rect x9 y9 w11 h11 rx2` + `M5 15V6a2 2 0 0 1 2-2h8`; printer `M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z`; sun `circle cx12 cy12 r4` + `M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1`; cloud `M7 18a4 4 0 0 1-.5-7.97A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.25 8.5z`; rain = cloud + `M8 20.5l-1 2M12 20.5l-1 2M16 20.5l-1 2`; wind `M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7`; snow `M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9`; alert `M12 8v5M12 16.5v.01` in a circle r9. The engineer may redraw, keeping the grid and stroke. **No `<use>`, no `<textPath>`, no `xlink:href`, no `setAttribute('href', ...)` except `#/` routes** (the hard constraint). Ring text is built as individual rotated `<text>` glyphs, and gradients are referenced with `fill="url(#id)"` attributes.

Condition to icon mapping (Weather), by lower-cased substring of `condition`: `storm|thunder` alert-bolt (use alert), `rain|shower|drizzle` rain, `snow|flurr` snow, `wind|gust|breez` wind, `cloud|overcast|grey|gray` cloud, `sun|clear|bright|spell` sun, otherwise an 8-point star (stamp motif).

### 4.1 Hello (`#/hello`)

**Layout.** Eyebrow "Counter 1" (mono), h1 "Hello", lede. Left: the form as a "slip" sheet with a mono caption "Form HO-1" in its top-right corner (decorative `::after`). Fields in the v1 order: Name, (error slot), Language, Tone, Chaos row, Say hello. Right (>=768): the result region `#result`, the "envelope" card, `min-height:15rem` (same height in empty, loading, success, error, so no layout shift). At 390 the result sits under the form.

Form details: labels are normal-case `ui 600 .9375rem`, above the field, 8px gap. Select uses `appearance:none` with a two-gradient chevron (`linear-gradient(45deg,transparent 50%,var(--ink) 50%),linear-gradient(135deg,var(--ink) 50%,transparent 50%)`, 6px, no `url()`), 40px right padding. Chaos row: custom 28px checkbox in a 44px-high row with the label to its right; while checked, the row gets a hazard edge (`repeating-linear-gradient(135deg, var(--accent) 0 6px, transparent 6px 12px)` 4px strip on the left). The checkbox check mark is `::after` with `clip-path: polygon(14% 52%,0 66%,38% 100%,100% 22%,86% 8%,38% 72%)` filled `--accent-ink` on `--accent`, scaling in `.6 -> 1` with `--spring-snap` over 180ms. Say hello: primary button, `[icon envelope][label]`, full width at <=480. Button label lives in `<span class="lbl">`; JS sets only that span (`setLabel(btn, text)`), never `btn.textContent`, so the icon survives and the button's text is still exactly "Say hello" / "Greeting..." / "Wait 12s".

**The result region is an envelope.** Its top 36px is a persistent flap strip (static SVG, `aria-hidden`): a triangle polygon (`--sunken`, 1px `--line`) on a body rect (`--surface`). Below it the letter (a `.letter` sheet, `--surface`, `--sh-2`, with a faint fold line at one third height via `linear-gradient(to bottom,transparent calc(33% - 1px),rgb(var(--shadow-rgb)/.06) 33%,transparent calc(33% + 1px))`).

| State | Visual treatment | Notes |
|---|---|---|
| Empty | Flap closed (scaleY 1). Letter area shows an outlined blank sheet (dashed `--line`), centered text `result-empty`: "No greeting yet. Say hello to someone." in `--ink-2` display italic | static, no motion |
| Validation error | Name input border `2px --bad`, input plays `.shake` once, error slot shows roundel + text (v1 copy), focus to name input, status announces | no layout shift: slot is reserved |
| Loading | `result-loading` "Warming up the greeting..." (`aria-busy`). Flap closed, a pen line (SVG path, `stroke-dasharray` loop, `.spin`-class family named `.write`, 1200ms linear infinite) draws on the blank sheet. Button label "Greeting...", `aria-disabled`, a 16px ring spinner replaces the envelope icon | loop only while loading; reduced motion: static 3-dot line |
| Success | see choreography. Letter shows: greeting-text (display, `--t-greeting`, `lang` set), meta row: `visit-count` and `streak-count` as ledger chips (mono, `--sunken`, 1px `--line`), a 7-dot streak strip (decorative, filled dots = min(streak,7), `aria-hidden`), `greeting-ref` "Ref 6628 4870" (mono `--ink-2`, first 8 hex of the certificate id in two groups of 4, uppercase via data not CSS), the circular postmark (`greeting-stamp`, `aria-hidden`), and the `cert-link` ("View certificate", secondary button with envelope-arrow icon) | focus stays on Say hello; status announces "Greeting ready for <name>." |
| 418 | `error-message` sheet: left edge 6px `--warn`, a teacup icon (SVG, tilted -12deg, spill droplets) and the two v1 lines; `retry-btn` (secondary). Flap stays closed and the envelope tilts `rotate(-1.2deg)` once (`.shake`-family 280ms) | focus to `retry-btn`, ring visible |
| Generic error / network | same sheet, envelope-with-cross icon (`--bad`), v1 generic copy, `retry-btn` | no raw text ever |
| 429 | `rate-limit-message` is a queue ticket: dashed border, a 56px countdown ring (SVG circle `r=24`, `stroke-dasharray` 150.8, per-second `stroke-dashoffset` step with `transition: stroke-dashoffset 1s linear`), the v1 sentence beside it. Say hello shows "Wait 12s" in the busy style. The ring and button label tick silently (not live); only the final "You can say hello again." is announced | reduced motion: ring jumps each second (no transition) |
| Partial/other | none: hello has no partial state | |
| Hostile | 40 x "W" or `<img onerror>` as literal text, wraps inside the letter (`overflow-wrap:anywhere`), card never wider than its column | RC12 |

**Choreography: "The Dispatch" (success, 840 ms total, one-shot).** All start from the moment the letter DOM is inserted (t = 0). Times are `animation-delay`; the greeting text is in the DOM and readable from the first frame it starts to fade.

| t (ms) | Element | Motion | Duration | Easing |
|---|---|---|---|---|
| 0 | envelope flap polygon | `.flap-open`: scaleY 1 to -1, origin top center; it stays open (rest state is scaleY(-1), set as the element's natural style when `data-state=ready`) | 240 | ease-io |
| 120 | letter sheet | `.slide-up` from translateY(32px), opacity 0 to 1 | 400 | spring-soft |
| 300 | greeting-text | opacity 0 to 1, `filter: blur(3px)` to 0, translateY 6px to 0 | 420 | ease-out |
| 440, 500, 560, 620 | meta row items in order: visit, streak, ref, cert-link (`.rise`, `--i` 0..3, `--step` 60ms) | opacity + 8px | 260 | ease-out |
| 620 | postmark `greeting-stamp` | `.stamp-in`: scale 1.7 to 1, rotate -16deg to -7deg, opacity 0 to .92 | 200 | ease-stamp |
| 820 | letter sheet | `.thud`: translateY 0 to 1.5px to 0 (synchronised with the stamp landing at 820) | 80 | ease-out |

Last frame at about 900 ms (cert-link settles at 880). The postmark: 72px circle, double ring in `--accent` (2px + 1px, `mix-blend-mode:multiply` in light only), centre shows UTC day, 3-letter month, year in mono `<text>` (three `<text>` nodes only, no ring text on this view), plus a 5-line wavy cancellation mark to its left (`<path>`, sine, amplitude 3). `cert-link` is interactive from the moment it exists (opacity animation never blocks pointer events).

**Reduced motion.** Everything above becomes a single `opacity 0 to 1` over 150 ms with `--step:0` (the letter, text, chips and stamp appear together); flap is set open with no motion; ring and pen loops are static.

### 4.2 Certificate (`#/certificate/<id>`)

**Layout.** Eyebrow "Issued by the Greeting Office", h1 "Certificate of Hello" (screen only; hidden in print and repeated decoratively inside the sheet as an `aria-hidden` engraved title). Below: `.cert-sheet.paper` (the artifact), then the actions row, then the pasteable text.

**The artifact (portrait, always light paper).** `aspect-ratio: 566 / 800`, `width:100%`, `max-width:34rem`, centered, `--r-2`, `--sh-3`. Background `--surface` (light) plus the laid-paper texture. Layers, back to front:
1. `svg.cert-guilloche` (`data-testid=cert-guilloche`, `aria-hidden`, `viewBox="0 0 566 800"`, `preserveAspectRatio="xMidYMid meet"`, absolute, inset 0), built by `guilloche()` in JS with `createElementNS`:
   - Outer rule: `rect x=10 y=10 w=546 h=780 rx=4`, stroke `--ink` 2.
   - Inner rule: `rect x=18 y=18 w=530 h=764`, stroke `--teal` .75.
   - Three sine bands per edge, centreline inset 28, phase offsets 0, 2pi/3, 4pi/3: top/bottom `y = 28 (or 772) + 6*sin(2pi*(x-36)/38 + k*2pi/3)` for `x = 36..530` step 2; left/right `x = 28 (or 538) + 6*sin(2pi*(y-36)/38 + k*2pi/3)` for `y = 36..764` step 2. Stroke `--teal`, .7 width, opacity .85, `vector-effect:non-scaling-stroke`.
   - Four corner rosettes (epitrochoid): `x = cx + 17.5*cos(t) - 4*cos(7t)`, `y = cy + 17.5*sin(t) - 4*sin(7t)`, `t = 0..2pi` in 360 steps, centres (36,36), (530,36), (36,764), (530,764); stroke `--accent` .8, opacity .9.
   - Watermark rosette at (283,400): same curve scaled to `R=90, d=18` (x = 108cos t - 18cos 7t... i.e. `(R+r)=108`, `r=R/6=15`, `d=18`), stroke `--teal`, .5 width, opacity .14.
   - Every `<path>` has `pathLength="1"`, class `draw`, `stroke-dasharray:1`, and `--i` for stagger.
2. HTML content (`.cert-body`, padding 14% 11% 22%, grid, centered text), in order: crest (static envelope-in-laurel SVG, 40px), eyebrow "The Overkill Greeting Office" (mono), decorative engraved title "Certificate of Hello" (display 700 `1.75rem`, `aria-hidden`, double text-shadow `0 1px 0 rgb(255 255 255/.7), 0 -1px 0 rgb(0 0 0/.15)` for the engraved look), a short rule with a diamond, then the `dl`:
   - `dt` "Name" in `--t-eyebrow` mono (visible text kept, no text-transform, rendered small and spaced instead), `dd[cert-name]` display `2.25rem` italic, `overflow-wrap:anywhere`, `text-wrap:balance`.
   - `dt` "Greeting", `dd[cert-greeting]` display `1.25rem`, wrapped by decorative curly quotes via `::before{content:"“" / ""}` `::after{content:"”" / ""}`.
   - `dt` "Date", `dd[cert-date]` mono `tabular-nums`.
   - `dt` "Signature", `dd[cert-signature]` mono `.75rem`, `overflow-wrap:anywhere`, inside a `--sunken` plate with 1px `--line`, 6px padding.
   - `p[cert-serial]` "Serial 6628-4870-0B08-0BEE": 16 hex id upper-cased in 4 groups, mono `--ink-2`.
3. `svg.cert-seal` (`data-testid=cert-seal`, `aria-hidden`, 104px at >=640, 88px at 390, absolute, bottom 6%, left 50%, translateX(-50%) rotate(-8deg)), viewBox `0 0 120 120`: scalloped body `r(t) = 52 + 4*cos(28t)` (360 points) filled `--accent` with an overlaid radial gloss (`radialGradient` white .22 to 0 at 30% 30%, referenced via `fill="url(#seal-g)"`); inner ring r44, stroke `--accent-ink` 1.5; ring text of 26 glyphs `AUTHENTIC * GREETING OFFICE *` at r34, 9px, each `<text>` `transform="rotate(i*360/26 60 60)"`; centre monogram "HO" display 700 28px `--accent-ink`; two ribbon tails (polygons, `--accent-hover`) below the disc. In print the seal prints in colour (`print-color-adjust:exact`).

Below the sheet (`.cert-actions`, hidden in print): the existing controls restyled:
- `label[for=cert-text-box]` "Certificate text" + `cert-text` textarea (readonly, mono `.875rem`, `--sunken` bg, ruled lines via `background-image: repeating-linear-gradient(transparent 0 calc(1.5rem - 1px), var(--line) calc(1.5rem - 1px) 1.5rem)` with `background-attachment:local`, `line-height:1.5rem`).
- `cert-copy` "Copy certificate" (primary, copy icon), `cert-print` "Print certificate" (secondary, printer icon; new), `cert-verify-link` "Verify this certificate" (secondary link).

| State | Visual | Notes |
|---|---|---|
| Loading | "Loading certificate..." under a skeleton sheet: same aspect ratio, dashed `--line` frame, `.pulse` opacity .6 to 1; reduced: static | |
| Success | choreography below; status "Certificate loaded." | focus stays on h1 (route rule) |
| Not found | "dead letter" sheet: slate sunken sheet, a rotated "Returned to sender" stamp (decorative CSS, `--bad`, double border, -6deg) over a blank guilloche frame, v1 copy "We could not find that certificate. Go back and say hello again." + `Back to Hello` link | stamp uses `.stamp-in`; status announces "We could not find that certificate." |
| Error / 429 | `error-message` sheet + `retry-btn` (v1 copy) | `retry-btn` focuses after retry per v1 |
| Copy result | button icon crossfades copy to check (160ms, opacity + scale .8 to 1) and a `Copied` pill (`aria-hidden`, `--ok`, 2s) appears next to the button; status says "Certificate copied." or "Select the text and copy it yourself." | pill never replaces the button label |
| Hostile | 40-char name wraps inside the sheet; `scrollWidth <= clientWidth` (RC12) | |

**Choreography: "The Engraving" (arrives with the data, 1,100 ms).** Triggered when `renderCert` inserts the sheet (class `.is-arriving` is not needed; the animations run on insertion).

| t (ms) | Element | Motion | Duration | Easing |
|---|---|---|---|---|
| 0 | sheet | opacity 0 to 1, translateY 24px to 0 | 420 | ease-out |
| 120 + 100*i | guilloche paths (13 bands/rosettes in drawing order: outer rule, inner rule, 3 top bands, 3 bottom, 3 left, 3 right, then corners and watermark share the last two slots) | `.draw` stroke-dashoffset 1 to 0 | 900 | ease-io |
| 360 + 60*i | crest, eyebrow, title, rule, dt/dd pairs (i = 0..9) | `.rise` | 260 | ease-out |
| 700 | seal | `.stamp-in` scale 1.8 to 1, rotate -18deg to -8deg, opacity 0 to 1 | 240 | ease-stamp |
| 700 | seal ripple (circle r54 stroke accent .5) | scale 1 to 1.6, opacity .5 to 0 | 500 | ease-out |
| 940 | sheet | `.thud` | 80 | ease-out |

Ends at about 1,100 ms. **Shared-element enhancement (optional).** On `cert-link` click, if `document.startViewTransition` exists and `motionOK()`, wrap the route swap: give the greeting postmark `view-transition-name: stamp` and the certificate seal the same name, so the stamp flies from the hello letter into the seal position (`::view-transition-group(stamp){animation-duration:420ms;animation-timing-function:var(--ease-out);z-index:var(--z-vt)}`, root cross-fade 160ms). Only that one navigation uses it. Guard: after 600 ms call `transition.skipTransition()`; if the API is absent or reduced motion is on, navigate normally. The route's DOM update and `title.focus()` run inside the update callback so UC5 and focus rules are unchanged. Only one element may hold a given `view-transition-name` at a time (the hidden section is `display:none`, so this holds).

**Reduced motion.** Sheet opacity 150ms; bands, text and seal visible immediately; no draw, no ripple, no view transition.

**Print layout (final).**
```
@page{size:portrait;margin:10mm}
@media print{
  :root{color-scheme:light}
  html,body{background:#fff!important;color:#000}
  .airmail,header,.annex,footer,#status,.view-head,.cert-actions,.eyebrow,
  button,.btn,textarea,label[for=cert-text-box]{display:none!important}
  *{animation:none!important;transition:none!important;box-shadow:none!important;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}
  #v-cert{display:block!important}
  .cert-sheet{width:min(100%,176mm);margin:0 auto;border:0;break-inside:avoid;page-break-inside:avoid}
  .cert-body .eng-title{display:block}   /* the decorative title becomes the visible title */
}
```
176 x 249 mm fits both A4 (190 x 277 printable) and US Letter (196 x 259). The sheet is always `.paper` tokens, so a dark-theme user prints dark ink on white. A one-line printed footnote (`.cert-foot`, screen-hidden): "To check this certificate, paste its certificate text into the Verify page of the issuing office." Only the certificate view is printable meaningfully; other views print with chrome hidden.

### 4.3 Verify (`#/verify`)

**Layout.** Eyebrow "Counter 3", h1 "Verify", lede "Paste a certificate. The examiner checks the seal." The "specimen tray": `label` "Certificate text", then the ruled mono textarea (same ruled background as the certificate text box, `min-height:9rem`), hint "Paste a certificate to check it.", error slot, Verify button (primary, loupe icon: circle r6 at 10,10 plus `M15 15l5 5`). At >=768 the verdict panel is a right-hand column (18rem); below it at 390.

| State | Visual |
|---|---|
| Empty | tray + hint; verdict panel shows a ghost stamp ring (dashed `--line`, aria-hidden) |
| Empty submit | error slot "Paste a certificate first.", textarea `2px --bad`, `.shake`, focus on textarea |
| Too long | error slot v1 copy, same treatment |
| Loading | button label "Checking...", `aria-disabled`; a 2px `--accent` scan line sweeps the tray top to bottom (`transform:translateY`, 700ms linear infinite); reduced: static 2px line at top |
| Authentic | `verify-result` is the stamp: 3px double `--ok` border, `--r-2`, rotated -3deg, contains an SVG check (not a text glyph) and `<strong data-testid=verify-verdict>Authentic</strong>` in display 700 `2rem`, mixed case (no `text-transform`). `verify-result`'s own text is therefore exactly "Authentic". Reason line "This certificate was signed by this server." sits under it. Colour `--ok` on `--surface` 6.24 / 9.17 |
| Forged | same stamp in `--bad`, SVG cross, "Forged", reason "The signature does not match. The certificate was changed or was not made here." Stamp is rotated +4deg |
| Unreadable | Forged stamp plus "This is not a readable certificate." |
| Error / 429 / 418 | `error-message` / `rate-limit-message` sheet with v1 copy; no stamp |
| Hostile | 100 KB paste stays in the textarea (scrolls inside, never grows the page); verdict text wraps |

**Choreography: "The Verdict" (480 ms).**
| t | Element | Motion | Duration | Easing |
|---|---|---|---|---|
| 0 | stamp | `.stamp-in` scale 2.2 to 1, rotate (-10deg to -3deg) or (10deg to 4deg), opacity 0 to 1 | 200 | ease-stamp |
| 200 | panel/tray | `.thud` translateY 2px | 80 | ease-out |
| 200 | impact ring (circle stroke `--ok`/`--bad`, decorative) | scale 1 to 1.5, opacity .4 to 0 | 400 | ease-out |
| 240 | reason line | `.rise` | 260 | ease-out |
| Forged only, 280 | stamp | `.shake` translateX -4, 4, -3, 3, 0 | 280 | ease-out |

**Reduced motion.** Stamp and reason fade 150ms; no shake, no ring, no scan line motion.

### 4.4 Battle (`#/battle`)

**Layout.** Eyebrow "Counter 2", h1 "Battle", lede "Two greetings enter. Pick the one you would rather receive." The "table": `--sunken` well with 1px `--line`, `--r-2`, padding `--s-5`, holding two letters. At >=768 they sit side by side, rotated -1.2deg and +1deg; at 390 stacked (rotation halved). Then the leaderboard.

Letter (`button.opt`): `--surface`, `--sh-2`, `--r-1`... radius `--r-2`, padding `--s-5`, min-height 8rem, text-align left. Top-left tab: a 28px wax tab with the letter "A" or "B" (decorative `::before`, `--accent`, `--accent-ink`, `aria-hidden` through the alt-content syntax). The button's text is exactly `Vote for A: <greeting>`: markup `<span class="opt-tag">Vote for A:</span> <span class="opt-text">greeting</span>` (the space is a real text node, so `textContent` = "Vote for A: greeting"). `opt-tag` is `--t-eyebrow` mono; `opt-text` is display `--t-greeting` (scaled `1.25rem` min), wraps with `overflow-wrap:anywhere`. Hover (`hover:hover`): translateY(-3px), rotate(0), `--sh-3`, 160ms ease-out. Press: `scale(.985)` 90ms.

| State | Visual |
|---|---|
| Loading | "Finding two greetings..." inside the well with two ghost letters (dashed `--line`, `.pulse`); leaderboard "Loading leaderboard..." |
| Ready | two letters (choreography); status "Battle ready. Choose a greeting." |
| Voting | the clicked letter shows `aria-disabled` and its tab spins; vote error keeps both buttons, `note` text "Your vote was not saved. Try again." with roundel |
| Voted | well shows two static, non-button letters (no testids): winner lifted (`translateY(-6px)`, `--sh-3`, "Your pick" stamp in `--accent` rotated -6deg), loser settled (`translateY(4px) scale(.98)`, border `--line`, text stays full contrast). Below: "Thanks, vote counted." then `battle-next` "Next battle" (primary) which takes focus immediately; status "Vote counted for <greeting>." Both `battle-option-*` are removed from the DOM |
| Error | "Could not load the battle. Try again." sheet + `retry-btn` |
| Leaderboard empty | "No votes yet. Cast the first one." |
| Leaderboard | real `<table data-testid=leaderboard>`, caption "Top 10 greetings", columns Rank / Greeting / Votes, `table-layout:fixed` (rank 3.5rem, votes 4.5rem), rank in display `1.25rem`, votes mono tabular right-aligned; rank-1 row has a 3px `--accent` left edge and bold rank; row hairlines `--line` |
| Long text | greetings wrap in letters and cells |

**Choreography: "Two letters on a table" (ready, 520 ms).** A: `.deal-a` (from translateX -24px, rotate -4deg to rest -1.2deg) at t=0, B: `.deal-b` at t=90, both 380ms spring-soft. **Vote (440 ms):** t=0 winner lifts (220ms spring-snap), loser settles (300ms ease-out), "Your pick" stamp `.stamp-in` at 160 (200ms), thanks line `.rise` at 160, Next battle `.rise` at 240; leaderboard: the voted row's background `.wash` (accent 18% alpha to transparent, 900ms) and its vote number plays `.tick` (260ms); reordering is instant (no FLIP). **Reduced motion:** letters and stamp fade 150ms, no lift, no rotation at rest (rest rotation is a static `rotate(-1.2deg)`, an allowed non-animated style, but at reduced motion it is 0), row wash becomes a 150ms opacity.

### 4.5 Weather (`#/weather`) "the telegram"

**Layout.** Eyebrow "Telegraph desk", h1 "Hello Weather", lede "A simulated forecast, delivered as a telegram." Form sheet: Place, Date, Name, error slot, `weather-go` "Get forecast" (primary, sun icon). Result: `#weather-out`, a telegram form: `--surface` sheet with a mono header band (decorative `::before` "TELEGRAM" left, `::after` "SIMULATED" right on a `--sunken` strip), then three ticker-tape strips (`--sunken`, `--r-0`, 1px `--line`, display text), then a barometer and the meta line.

| State | Visual / copy |
|---|---|
| Empty | `weather-forecast` shows "Pick a place to see today's greeting forecast." on a blank strip with dotted leader lines (decorative); barometer hidden |
| Loading | "Reading the sky..." line; three ghost strips sliding clip loop (`.tape`-loop, 1200ms linear infinite); reduced: static ghost strips |
| Success | strips in order: `weather-forecast`, `weather-chance` ("Chance of warm regards: 70%"), `weather-greeting`; a barometer bar under the chance strip (see below); condition icon (sun/cloud/rain/wind/snow/star, 40px, `--teal`, `aria-hidden`) at the header band's right; meta line (place, date, condition, temp, wind, "Simulated forecast, not real weather.") in `--t-data` |
| Error 400 | `weather-error` v2 text, `2px --bad` on the offending field, focus to place input |
| 429 / generic | sheet with v1 copy; focus unchanged (matches v2 behaviour) |
| Hostile | place such as `<b>Rome</b>` or 40-char string appears literally in the meta line and wraps; strips `overflow-wrap:anywhere` |

Barometer: `div[data-testid=weather-meter]` (decorative, `aria-hidden`), track `--sunken` 10px high `--r-pill`, fill `--teal` using `transform: scaleX(var(--q))` origin left. `--q` comes from `data-q` quantised to 5% steps via 21 generated rules `[data-q="70"]{--q:.7}` (no inline style, no `.style` access). The exact figure is the visible text in `weather-chance`, never only the bar. The fill's contrast against the track is 3:1 or better in both themes (teal vs sunken: 6.02 light, 8.9 dark).

**Choreography: "The tape prints" (900 ms).** Icon: scale .6 to 1 `--spring-snap` 300ms at t=0. Strips: `.tape` clip-path reveal left to right, 360ms linear, at t = 0, 140, 280 (forecast, chance, greeting). Barometer fill: `scaleX(0 to --q)`, 520ms ease-out, at 160. Meta line `.rise` at 420. Reduced: all fade 150ms, bar at final scale.

### 4.6 Wall (`#/wall`) "the sorting floor / departure board"

**Layout.** Eyebrow "Sorting floor", h1 "Live Hello Wall", lede (existing) "Hellos appear here as they happen. Names are never shown." The board is a `.night` panel (dark in both themes), `--r-2`, 1px `--line`, inner shadow `inset 0 2px 8px rgb(0 0 0 / .5)`, a decorative "LIVE BOARD" mono caption top-left (`::before`). Header row: status lamp + `wall-status` text, `wall-count` (mono amber numerals), `Reconnect` button (secondary, only when closed/full). Below: `wall-empty` or `wall-list`.

Row (`li[data-testid=wall-item]`): text is exactly the v2 string ("A es/pirate hello", plus " (streak-7 milestone)"). Visuals are CSS-only: a time cell from `li::before{content:attr(data-time) / ""}` (HH:MM:SS from the event `ts`, set by JS in a `data-time` attribute), mono tabular, on a flap plate (`--sunken`, hairline split at the middle via `linear-gradient(transparent 49%, rgb(0 0 0/.5) 49% 51%, transparent 51%)`); main text mono `1rem`, `--ink`; milestone rows (`data-milestone`) get a 3px `--accent` left edge and `--warn` text for the parenthetical is not separable (the text is one node), so the whole row text stays `--ink` and the milestone is marked by the edge, plus a CSS `::after` "MILESTONE" tag (decorative, alt-empty). Row height 44px.

| State | Visual (always lamp + words) |
|---|---|
| Connecting | amber ring lamp, `wall-status` "Connecting..." |
| Connected | solid `--ok` lamp with a check inside, "Connected" |
| Reconnecting | `--warn` lamp, `.pulse`, "Reconnecting..." |
| Empty | `wall-empty` "No hellos yet. Say hello and watch it appear." over three ghost rows (dashed, decorative) |
| Full / blocked | `--bad` lamp with a cross, "Wall is full, try later" and Reconnect |
| Disconnected | `--bad` lamp, "Disconnected. Reconnect to keep watching." and Reconnect (focus goes to `wall-status` after Reconnect per v2) |
| Hostile | event fields pass through `cleanText`; any value wraps; row never exceeds the board |
| Cap | at 51 rows the oldest is removed instantly (no exit animation) |

**Choreography: "A new flap" (per event, 420 ms).** JS inserts the `li`, then (if `motionOK()`) runs one WAAPI call on the `ul`: `ul.animate([{transform:'translateY(-'+h+'px)'},{transform:'none'}],{duration:240,easing:'cubic-bezier(.22,1,.36,1)'})` where `h` is the new row's `offsetHeight`, so existing rows slide down smoothly while the new row appears at the top (a FLIP in one line). The new row: `li` `.rise` 200ms; its time plate `.flip` rotateX(90 to 0) 300ms; row `.wash` 600ms (amber 18%). Lamp does one `.tick`. No event is announced (status region stays connection-only). **Reduced:** no `ul` slide, no flip; row fades 150ms.

### 4.7 SLA (`#/sla`) "the control room"

**Layout.** Eyebrow "Control room", h1 "Hello SLA", lede (existing) "The last five minutes. Refreshes every 5 seconds while this view is open." A `.night` panel holds: `sla-error` slot, tile grid (`dl.stats`, 2 columns at 390, 4 at >=768), the sparkline, the routes table. Tiles: `--sunken` on `.night`, 1px `--line`, `--r-1`, `dt` (`--t-caption`, `--ink-2`), `dd` (`--t-numeral`, `--ink`, tabular). Order and ids as v2: Uptime, Requests, Server errors, p50, p95, p99, Hellos.

Sparkline: `figure` with `svg` (`data-testid=sla-spark`, `aria-hidden`, viewBox `0 0 240 56`, polyline `--teal`, 2px, area fill teal 12%) of the last 24 `p95` samples collected in this tab (one per poll, 5 s each, so 2 minutes). `figcaption`: "p95, last 2 minutes in this tab" (`--t-caption`). With fewer than 2 samples the caption reads "Collecting samples..." and the svg is empty. The numbers are the data; the sparkline is decoration.

| State | Visual |
|---|---|
| Loading | tiles show `-` (existing) with `.pulse` on the dd; table row "Loading..." |
| Success | numbers with `.tick` when changed; table rows (`sla-row`) with route (mono, wraps), count, p95; "No requests in the last 5 minutes." row when empty |
| Elevated errors | when `sla-error-rate` is above 0%, the dd takes `--warn` and a `data-alert` attribute adds a `▲ ` prefix via `::before{content:"▲ " / ""}` (value text unchanged) |
| Stale / fetch error | `sla-error` message with roundel; panel keeps the last numbers; a dashed `--warn` border and a "Stale" pill (`::after` on the panel, decorative; the error text is the accessible signal). Text is never dimmed (contrast preserved) |
| Locked (401) | `sla-error` "The SLA dashboard is locked. A token is required." with a padlock icon; tile values `-`; tile backgrounds get diagonal hatch (`repeating-linear-gradient(135deg, var(--line) 0 2px, transparent 2px 8px)`) |
| Hostile | route labels come from a fixed set but still `cleanText`; wrap with `overflow-wrap:anywhere` |

**Choreography.** Panel `.rise` 260ms on entering. Each changed number: `.tick` (opacity .4 to 1, translateY -3px to 0, 260ms) when the text changes (JS toggles the class by removing and re-adding on the next frame only if the value differs). Sparkline path `.draw` once on first render (700ms ease-io), later updates swap the path with no animation. **Reduced:** tick becomes a 120ms opacity; no draw.

### 4.8 Time machine (`#/time-machine`) "postmarks through the eras"

**Layout.** Eyebrow "Archive of postmarks", h1 "Greeting Time Machine". Form sheet: Date (`input#tm-date`, `min="1900-01-01"`, `max` = today by script), Name, error slot, `tm-go` "Travel" (primary, clock icon: circle r9 plus `M12 7v5l3 2`). Under the form: the era rail (decorative, `aria-hidden`, `data-testid=tm-rail`): 7 equal cells with mono year labels 1900, 1920, 1946, 1970, 1990, 2000, 2020 (era names are not repeated here; `tm-era` already says it) and a marker triangle in `--accent`. At >=640 the rail labels sit above the cells; at 390 only the years are shown (7 x about 36px fits 358px). Result card `#tm-out` shows: the postmark SVG (`data-testid=tm-postmark`, `aria-hidden`, 96px; ring, wavy cancellation lines, date lines "02", "MAY", rolling year), then `tm-era`, `tm-greeting`, `tm-streak`.

**Era styling (CSS only, keyed by `data-era` on `#tm-out`).** The era string maps to a key by lower-case substring: `edwardian` e1, `radio` e2, `atomic` e3, `disco` e4, `web 1.0` e5, `social` e6, `now` e7, else e0. Only font stack, border and radius change, so every colour pair stays in the 2.1 table.

| Key | Greeting font | Card border / radius |
|---|---|---|
| e1 Edwardian telegram | display, italic | `3px double var(--ink)`, 2px |
| e2 radio age | display, `letter-spacing:.06em`, `font-variant-caps:small-caps` | `1px solid var(--ink)` plus inner `outline` (offset -6px, 1px `--line`), 2px |
| e3 atomic age | ui, 700 | `2px solid var(--teal)`, radius `28px 4px 28px 4px` |
| e4 disco and dial-up dawn | mono | `2px dashed var(--control)`, 6px |
| e5 web 1.0 | `"Times New Roman",Times,serif` | `3px ridge var(--control)`, 0 |
| e6 social era | ui, 600 | `1px solid var(--line)`, 16px, `--sh-2` |
| e7 now / e0 default | display | letter default |
Rail marker: `data-pos="0..6"` (set from the era key) and `--pos` generated by 7 attribute rules; marker is `transform: translateX(calc(var(--pos) * 100%))` of one cell width, with `transition: transform 520ms var(--spring-soft)` so it slides from the previous era.

| State | Visual |
|---|---|
| Empty | card text "Pick a date to hear what the greeter said back then." with a blank postmark ring (dashed) and marker hidden |
| Validation | `tm-error` "Pick a date between 1900-01-01 and today." roundel, date field `2px --bad`, focus on date |
| Loading | "Warming up the flux capacitor..." line; postmark year digits flick through random years every 70ms (aria-hidden, `JS tick`); reduced: year shows `----`, static |
| Success | era key applied, rail marker moved, postmark year landed, texts shown. Status "Greeting from <era> ready." |
| Streak lines | `tm-streak` text per v2 vocabulary; prefixed by a small calendar glyph, no colour meaning |
| 400 / 429 / generic | `tm-error` text, v1 message sheet for 429/generic |
| Hostile | name and greeting wrap; era string `cleanText`ed |

**Choreography: "The year rolls" (success, 1,100 ms).** t=0 card `.rise` 260ms; t=0 to 640 the postmark year digits tween from the last random value to the target year with `requestAnimationFrame` (ease-out cubic) and `textContent` on the aria-hidden `<text>`; t=200 rail marker slides (520ms spring-soft); t=640 postmark `.stamp-in` (scale 1.4 to 1, rotate -10deg to -6deg, 200ms ease-stamp) plus `.thud`; t=700, 780, 860 `tm-era`, `tm-greeting`, `tm-streak` `.rise` (260ms). The final year is also the real text in `tm-era`/date field, so skipping the tween loses nothing. **Reduced:** year set instantly, marker jumps, all fade 150ms together.

### 4.9 Haiku (`#/haiku`) "the print shop"

**Layout.** Eyebrow "Print shop", h1 "Hello Haiku". Form sheet: Name, Theme (select Morning/Ocean/City/Night), "Syllables in your name" number input (hint kept), error slot, `haiku-go` "Write haiku" (primary, quill icon: `M20 4c-8 0-13 5-14 13M20 4l-8 8M4 20l2-3`). Result: `#haiku-out`, a typeset card (`data-testid=haiku-card`): `--r-0`, 1px `--line`, `--sh-2`, padding `--s-7 --s-5`, wash by theme via `data-haiku` (`morning` `--wash-morning`, `ocean` `--wash-ocean`, `city` `--surface`, `night` the `.night` scope), centered block `max-width:22rem`. Lines are the three `p[data-testid=haiku-line]`, display `--t-greeting`, `line-height:1.5`, each with a syllable marginal note from `p::after{content:attr(data-n) / ""}` (mono `.75rem`, `--ink-2`, hanging in the right margin; at 390 it moves under the line end inline). Below the lines: `haiku-counts` as a seal pill (`haiku-seal`): check icon + "5-7-5 verified" in `--ok`, `--r-pill`, 1px `--ok` border; unverified: alert icon + "<x-y-z> not verified" in `--warn`. Limit line in `--ink-2` `--t-caption`.

| State | Visual |
|---|---|
| Empty | card shows ghost 5-7-5 dot rows (5, 7, 5 dots, `--line`) and "Enter a name to compile a 5-7-5 haiku." |
| Validation | `haiku-error` ("Enter a name so we can write your haiku." etc.), field `2px --bad`, focus on the field |
| Loading | "Counting syllables on our fingers..." plus the ghost dot rows filling in sequence (17 dots, 80ms each, looping, `.pulse`-family; reduced: all dots static) |
| Success | card with 3 lines, marginal counts, verified pill, limit line |
| Not verified | pill in `--warn` with alert icon and the counts, limit line emphasised |
| 422 / 400 / 429 | `haiku-error` text (name-related 4xx focus the name input) |
| Hostile | name inside a line wraps (`overflow-wrap:anywhere`); lines never exceed the card |

**Choreography: "Typesetting" (1,500 ms).** Lines: `.rise` variant with `filter: blur(4px)` to 0 and translateY 4px, 420ms ease-out, at t = 0, 320, 640 (so each line "presses in" after the last). At t = 960 the card plays one 120ms `box-shadow` impression (inset 0 2px 6px rgb(var(--shadow-rgb)/.12) then back, opacity of a pseudo-element, not the shadow property itself). At 1,060 the verified pill `.stamp-in` (scale 1.5 to 1, 160ms). Limit line `.rise` at 1,240. **Reduced:** all fade 150ms together.

### 4.10 Federation (`#/federation`) "sister offices"

**Layout.** Eyebrow "Sister offices", h1 "Federation". `fed-notice` is a notice sheet: 2px double `--warn` border, alert icon, text exactly "Your name is sent to the listed peers. Each peer records a visit under that name." (the v2 fixed sentence stays the opening). Then the map and the peer table side by side at >=768 (map 20rem), stacked at 390. Then the "Greet the peers" form and results.

Map (`svg[data-testid=fed-map]`, `aria-hidden`, viewBox `0 0 320 220`, decorative duplicate of the table): home office node at (160,110), r 16, `--accent`, "HQ" mono label (two `<text>` glyphs; allowed here, not in a testid element); up to 8 peers on an ellipse `cx=160 + 110*cos(a)`, `cy=110 + 74*sin(a)`, `a = -90deg + i*360deg/n`; node r 10; connecting lines: up = solid `--teal` 2px, down = dashed `--bad` 2px (`stroke-dasharray:4 4`) with a cross inside the node; index number inside each node (`<text>` 1..8) that matches an index shown in the table via a CSS counter (`tr::before{counter-increment:peer;content:counter(peer) / ""}`), so the map and table connect without relying on colour.

| State | Visual / copy |
|---|---|
| Not configured | `fed-empty` "No peers configured. Set HELLO_PEERS." under a map that shows only HQ and a dashed empty ring; health and greet controls remain visible; status "No peers configured." |
| Idle (configured, not checked) | map with neutral grey-line nodes, `fed-summary` empty; Check peers button prominent |
| Health loading | `fed-health-btn` "Checking...", peer nodes `.pulse` |
| Health success | `fed-summary` "N of M peers up."; table `fed-peer-table` (caption "Peer health", columns Peer / Status), cells `fed-peer-origin` (plain text, mono, wraps), `fed-peer-status` ("Up (42 ms)" with check icon / "Down: timed out" with cross icon) |
| Partial | summary "1 of 2 peers up."; mixed solid and dashed lines; the table is the source of truth |
| All down | summary "0 of N peers up." in `--bad` with a cross icon |
| Greet loading | `fed-loading` "Asking the peers..."; button "Greeting..." |
| Greet success | `fed-result` list: each `li.peer` has a 6px left edge (`--ok` or `--bad`), origin `<strong>` mono, `fed-result-greeting` or `fed-result-error`, plus an icon; summary line "N of M peers answered." |
| Errors | `fed-health-error` or `fed-name-error` v2/v1 copy; 429 shows the v1 sentence |
| Hostile | peer-supplied greeting wraps, shown as text only, never a link; origin never an anchor |

**Choreography: "Letters go out" (greet success path, about 1.1 s; health check just pulses).** On submit (loading), nothing moves except the button ring. On response, for each peer i (cap 8): a 6px `--accent` dot created in the SVG at HQ runs to the node via WAAPI `circle.animate([{transform:'translate(0,0)'},{transform:'translate(dx px, dy px)'}],{duration:520,delay:i*120,easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards'})`; on finish the node gives one `.tick` pulse (scale 1.25 to 1) and keeps the up/down style; the result list items `.rise` with `--i` stagger (60ms). Dots are removed after the last finishes. **Reduced:** no dots; nodes and list items fade 150ms.

---

## 5. Microinteractions

| Element | Rest | Hover (`hover:hover`) | Press | Disabled / busy | Focus |
|---|---|---|---|---|---|
| Primary button | `--accent` bg, `--accent-ink` text, `--sh-1`, 48px, `--r-1`, 1px border `--accent` | bg `--accent-hover`, translateY(-1px), `--sh-2`, 160ms ease-out | `scale(.97)` 90ms, `--sh-1` | `aria-disabled=true`: `--sunken` bg, `--ink` text, 1px `--control` border, `cursor:not-allowed`, spinner or countdown in the label; stays focusable | 3px ring, 2px offset |
| Secondary button / link-button | transparent, 1.5px `--accent` border, `--accent` text (5.42 on paper) | bg `--sunken` | `scale(.98)` | same busy treatment | same |
| Tabs, tiles | see 3.2 | bg `--sunken` | `scale(.98)` | | same |
| Input / textarea / select | `--surface`, 1px `--control` (4.58), `--r-1`, 48px | border `--ink-2` | | | border `--teal` and ring |
| Invalid input | `2px --bad` border, `.shake` 200ms once | | | | ring unchanged |
| Checkbox / radio | 28px box, `--control` 2px border; checked: `--accent` fill, check scales in (180ms spring-snap) | | `scale(.94)` | | ring on the box |
| Letters (battle) | see 4.4 | lift | `scale(.985)` | | ring |

Buttons are never `transition: all`; their transition list is `transform, background-color, box-shadow` at `--d-fast` `--ease-out`. Numbers that change (countdown, counts, latencies, votes, wall count) use `tabular-nums` so width is stable.

**Copy confirmation.** Icon crossfade copy to check (opacity + `scale(.8 to 1)`, 160ms), `Copied` pill for 2 s (`aria-hidden`), status announcement via `say()`. If the clipboard is blocked: no pill; status "Select the text and copy it yourself." and the textarea text is selected (`ta.select()`).

**Countdown.** Button label "Wait Ns" (tabular, ticks each second, not announced), ring on the ticket decreases linearly; at zero: label returns to "Say hello", ring removed, status "You can say hello again." exactly once.

**Toasts.** None. The single `role=status` live region is the only announcement channel; inline pills and the ticket carry the visual confirmation.

**Appearance control (footer).** `fieldset` with `legend` "Appearance" and three native radios `name=theme`: System, Light, Dark, each a 44px-high segment (the label is the hit area, input visually inside). The selected one has `--accent` fill and `--accent-ink` text (5.90) plus a check icon (not colour alone). Arrow keys move between options (native radio behaviour); selecting applies immediately, writes `localStorage`, updates `theme-color` metas and calls `say('Theme set to light.')` (or "dark", or "Theme follows your device.").

**Live-region discipline.** `say()` is unchanged (clear then set after 60ms). Decorative stamps, tickers, lamps, sparkline and map are `aria-hidden`. No decorative element is ever focusable.

---

## 6. Compatibility table (96 testids)

"unchanged" means same tag, same text/semantics as ux.md/v2; the only edits are classes, wrappers and CSS. Buttons keep their exact accessible text (an icon is an extra `aria-hidden` svg and the label lives in `span.lbl`).

### v1 (38)

| # | testid | Element in the new design | Change |
|---|---|---|---|
| 1 | nav-hello | link in primary tabs | unchanged (also static `aria-current`) |
| 2 | nav-battle | link in primary tabs | unchanged |
| 3 | nav-verify | link in primary tabs | unchanged |
| 4 | status | `div[role=status]` visually hidden | unchanged |
| 5 | name-input | `input#name` on the form slip | unchanged |
| 6 | language-select | `select#language` | unchanged |
| 7 | tone-select | `select#tone` | unchanged |
| 8 | chaos-toggle | `input[type=checkbox]#chaos` (custom drawn) | unchanged |
| 9 | say-hello | submit button, icon + `span.lbl` | unchanged |
| 10 | name-error | `p.err` (reserved slot) | unchanged (roundel via CSS) |
| 11 | result-empty | div in the envelope card | unchanged |
| 12 | result-loading | div in the envelope card | unchanged |
| 13 | greeting-text | `p` in the letter, `lang` set | unchanged |
| 14 | visit-count | span ledger chip | unchanged |
| 15 | streak-count | span ledger chip | unchanged |
| 16 | cert-link | secondary link button | unchanged |
| 17 | error-message | sheet div (418 / generic / cert / battle) | unchanged |
| 18 | retry-btn | secondary button | unchanged |
| 19 | rate-limit-message | queue-ticket div | unchanged |
| 20 | cert-name | `dd` on the certificate | unchanged |
| 21 | cert-greeting | `dd` on the certificate | unchanged |
| 22 | cert-date | `dd` on the certificate | unchanged |
| 23 | cert-signature | `dd` on the certificate | unchanged |
| 24 | cert-text | readonly textarea below the sheet | unchanged |
| 25 | cert-copy | primary button with icon | unchanged |
| 26 | cert-verify-link | secondary link | unchanged |
| 27 | verify-input | `textarea#cert-input`, ruled tray | unchanged |
| 28 | verify-btn | primary button, icon + `span.lbl` | unchanged |
| 29 | verify-result | the stamp div; its text is exactly the verdict word | unchanged (glyph is now an SVG, not text) |
| 30 | verify-verdict | `strong` inside the stamp | unchanged |
| 31 | battle-option-a | letter button, text "Vote for A: <greeting>" | unchanged |
| 32 | battle-option-b | letter button, text "Vote for B: <greeting>" | unchanged |
| 33 | battle-next | primary button | unchanged |
| 34 | leaderboard | real `table`, caption "Top 10 greetings" | unchanged |
| 35 | leaderboard-row | `tr` | unchanged |
| 36 | lb-greeting | `td` | unchanged |
| 37 | lb-votes | `td` | unchanged |
| 38 | view-title | `h1#title`, `tabindex=-1` | unchanged |

### v2 (58)

| testid | Element in the new design | Change |
|---|---|---|
| nav-weather | tile link in the annex | unchanged text; caption is CSS only |
| weather-place-input | `input#weather-place` | unchanged |
| weather-date-input | `input[type=date]#weather-date` | unchanged |
| weather-name-input | `input#weather-name` | unchanged |
| weather-go | primary button | unchanged |
| weather-forecast | forecast tape strip `p` | unchanged (empty text kept) |
| weather-greeting | greeting tape strip `p` | unchanged |
| weather-chance | chance tape strip `p` | unchanged |
| weather-error | `p.err` | unchanged |
| nav-wall | annex tile | unchanged |
| wall-list | `ul` inside the board | unchanged |
| wall-item | `li` (repeated); text identical, time cell is CSS | unchanged |
| wall-status | board header `p`, `tabindex=-1` | unchanged text set |
| wall-count | board header `p` | unchanged |
| wall-empty | `p` over ghost rows | unchanged |
| nav-sla | annex tile | unchanged |
| sla-uptime | tile `dd` | unchanged |
| sla-total-count | tile `dd` | unchanged |
| sla-error-rate | tile `dd` | unchanged (`data-alert` added when above 0) |
| sla-p50 | tile `dd` | unchanged |
| sla-p95 | tile `dd` | unchanged |
| sla-p99 | tile `dd` | unchanged |
| sla-hello-rate | tile `dd` | unchanged |
| sla-table | real `table` | unchanged |
| sla-row | `tr` (repeated) | unchanged |
| sla-route | `td` | unchanged |
| sla-count | `td` | unchanged |
| sla-row-p95 | `td` | unchanged |
| sla-error | `p.err` | unchanged |
| nav-time-machine | annex tile | unchanged |
| tm-date-input | `input[type=date]#tm-date`, `min="1900-01-01"`, `max` today | unchanged |
| tm-name-input | `input#tm-name` | unchanged |
| tm-go | primary button | unchanged |
| tm-era | `p` in the era card | unchanged ("Era: ...") |
| tm-greeting | `p` in the era card | unchanged |
| tm-streak | `p` in the era card | unchanged |
| tm-error | `p.err` | unchanged |
| nav-haiku | annex tile | unchanged |
| haiku-name-input | `input#haiku-name` | unchanged |
| haiku-theme-select | `select#haiku-theme` | unchanged |
| haiku-syllables-input | `input[type=number]#haiku-syl` | unchanged |
| haiku-go | primary button | unchanged |
| haiku-line | `p` x3 in the card | unchanged |
| haiku-counts | verified pill `p` ("5-7-5 verified") | unchanged text; icon is an svg sibling |
| haiku-error | `p.err` | unchanged |
| nav-federation | annex tile | unchanged |
| fed-notice | notice sheet `p` | unchanged text start; wording extended only after the verbatim sentence |
| fed-health-btn | secondary button | unchanged |
| fed-summary | `p` | unchanged |
| fed-peer-row | `tr` (repeated) | unchanged |
| fed-peer-origin | `td`, plain text | unchanged |
| fed-peer-status | `td` | unchanged |
| fed-name-input | `input#fed-name` | unchanged |
| fed-hello-btn | primary button | unchanged |
| fed-result | `li.peer` (repeated) | unchanged |
| fed-result-greeting | `p` | unchanged |
| fed-result-error | `p` | unchanged |
| fed-empty | `p` ("No peers configured. Set HELLO_PEERS.") | unchanged |

Required ids that stay: `name`, `language`, `tone`, `chaos`, `cert-input`; `input#tm-date` keeps `min="1900-01-01"`.

### Added testids (design hooks, not part of the 96; tests for the redesign may rely on them)

`theme-system`, `theme-light`, `theme-dark` (radios), `greeting-ref`, `greeting-stamp`, `cert-sheet`, `cert-guilloche`, `cert-seal`, `cert-serial`, `cert-print` (button "Print certificate"), `weather-meter`, `wall-lamp`, `sla-spark`, `tm-postmark`, `tm-rail`, `haiku-card`, `haiku-seal`, `fed-map`. Hooks are always on decorative or presentational elements, so none changes a v1/v2 meaning.

### Copy added (everything else is verbatim)

| Where | Text |
|---|---|
| Brand eyebrow | The Overkill Greeting Office |
| Secondary nav label | Other departments (replaces "More views") |
| Appearance | legend "Appearance"; radios System, Light, Dark; status "Theme set to light.", "Theme set to dark.", "Theme follows your device." |
| Eyebrows | Counter 1 (Hello), Counter 2 (Battle), Counter 3 (Verify), Issued by the Greeting Office (Certificate), Telegraph desk (Weather), Sorting floor (Wall), Control room (SLA), Archive of postmarks (Time machine), Print shop (Haiku), Sister offices (Federation) |
| Ledes | Hello: "Pick a language and a tone. We will dispatch your greeting and stamp it." Battle: "Two greetings enter. Pick the one you would rather receive." Verify: "Paste a certificate. The examiner checks the seal." Weather: "A simulated forecast, delivered as a telegram." |
| Form caption | Form HO-1 (decorative) |
| Greeting ref | "Ref 6628 4870" (label "Ref" plus 8 hex chars) |
| Certificate | button "Print certificate"; serial "Serial 6628-4870-0B08-0BEE"; print footnote "To check this certificate, paste its certificate text into the Verify page of the issuing office."; decorative "Returned to sender" stamp; pill "Copied" |
| Battle | stamp "Your pick" (decorative) |
| SLA | caption "p95, last 2 minutes in this tab"; "Collecting samples..."; pill "Stale" (decorative) |
| Federation notice tail | existing sentence unchanged |
| Time machine | none beyond v2 |

---

## 7. New UI acceptance checks (RC)

Environment as `ux.md`: temp data file, `HELLO_SIGNING_SECRET=test`, `HELLO_RATE_LIMIT` raised for loops. Use `getByTestId`. All UC1 to UC11 still pass unchanged; RC checks are additive. `lum(rgb)` helper = WCAG relative luminance; `ratio(a,b)` standard.

**RC1 (theme override and persistence).**
1. Context `colorScheme:'light'`. Goto `/`. Expect `document.documentElement.dataset.theme` undefined and body background `rgb(244, 238, 226)`.
2. Scroll to the footer. Click `theme-dark`. Expect `data-theme="dark"`, body background `rgb(18, 22, 28)`, `localStorage['ho-theme']` `dark`, `status` contains "Theme set to dark."
3. Reload. Expect still dark. Click `theme-system`. Expect `data-theme` removed, key removed, body background `rgb(244, 238, 226)`.
4. Context `colorScheme:'dark'`, no override: body background `rgb(18, 22, 28)`. Click `theme-light`: background `rgb(244, 238, 226)` regardless of system.

**RC2 (no flash).** `addInitScript` sets `localStorage['ho-theme']='dark'` under `colorScheme:'light'`. Goto with `waitUntil:'domcontentloaded'`. Expect `getComputedStyle(document.body).backgroundColor === 'rgb(18, 22, 28)'` on the first evaluate (no transition: the test also sets reduced motion so the body transition is 0).

**RC3 (reduced motion is opacity only).**
1. `emulateMedia({reducedMotion:'reduce'})`. Fill "Ada", click `say-hello`, wait for `greeting-text`.
2. Evaluate `document.getAnimations()`; for every animation assert each keyframe object has only the keys `offset, easing, composite, computedOffset, opacity`.
3. Assert no animation has `iterations === Infinity`.
4. Repeat for `#/certificate/<id>` (greet first, click `cert-link`), `#/verify` (Authentic), `#/battle` (vote), `#/haiku`, `#/time-machine`. Same assertions. `document.startViewTransition` must not have been called (spy via `addInitScript`).

**RC4 (motion completes, nothing left invisible).**
1. Default motion. Greet "Ada". Wait 1,200 ms.
2. Evaluate: for every element with a `data-testid` that is rendered (`getClientRects().length`), compute the product of `opacity` up the ancestor chain; assert 1 (allow `wall-empty`/ghost decor excluded by `[aria-hidden=true]`).
3. Assert `document.getAnimations().filter(a=>a.playState==='running' && a.effect.getTiming().iterations!==Infinity)` is empty.
4. Repeat after: certificate arrival (wait 1,500), verify stamp (wait 800), haiku (wait 1,800), weather (wait 1,100), time machine (wait 1,400).
5. Assert `greeting-stamp` is visible and its bounding box overlaps `greeting-text`'s card.

**RC5 (390px: no overflow, 44px targets, every view, both themes).**
1. For `colorScheme` in `light, dark` at 390x844 and for each hash in `#/hello, #/battle, #/verify, #/certificate/<id>, #/weather, #/wall, #/sla, #/time-machine, #/haiku, #/federation` (populate data first: one greeting, one vote):
   - Expect `document.documentElement.scrollWidth <= window.innerWidth`.
   - Every `a, button, select, input:not([type=checkbox]):not([type=radio]), textarea` that is visible has `getBoundingClientRect().height >= 44`.
   - For checkboxes and radios, the associated `label[for]` row has height >= 44.
2. Hello with a 40 x "W" name and with `<img src=x onerror=window.__x=1>`: `greeting-text` right edge <= its card right edge; `window.__x` undefined.

**RC6 (certificate print layout).**
1. Greet "Ada", open the certificate. `page.emulateMedia({media:'print'})`.
2. Expect not visible: `nav-hello`, `nav-weather`, `cert-copy`, `cert-print`, `cert-text`, `cert-verify-link`, `status` text, footer. Expect visible: `cert-sheet`, `cert-name`, `cert-greeting`, `cert-date`, `cert-signature`, `cert-serial`, `cert-seal`, `cert-guilloche`.
3. Body background `rgb(255, 255, 255)`; `cert-sheet` width <= 176 mm (about 665 CSS px) and `cert-sheet` aspect ratio within 1% of 1:1.414.
4. With `data-theme="dark"` set before printing: `cert-sheet` background is still light (`rgb(251, 248, 241)` or white) and `cert-name` colour has contrast >= 7:1 against it.
5. `page.pdf({format:'A4'})`: assert the PDF has exactly 1 page (count `/Type /Page` objects that are not `/Pages`).
6. A 40 x "W" name: `cert-sheet.scrollWidth <= cert-sheet.clientWidth` in print media.

**RC7 (contrast spot checks, both themes).** For each `colorScheme` run `check(sel, fgProp, bgSel, min)` using computed colours (resolve the bg by walking ancestors until a non-transparent colour). Pairs and minimums:
- body text on page: 4.5; `lede`/`eyebrow` on page: 4.5.
- `say-hello` text on its own background: 4.5; `nav-hello` (current) text on its background: 4.5.
- After a blank submit, `name-error` colour on the sheet: 4.5.
- `name-input` border colour vs the sheet background: 3.0.
- Tab to `say-hello`: computed `outline-color` vs page background: 3.0, `outline-width` >= 2px.
- Authentic then Forged: `verify-verdict` colour on the stamp background: 4.5.
- `#/wall` after one event: `wall-item` text on board: 4.5; `wall-status`: 4.5.
- `#/sla`: `sla-p95` on its tile: 4.5.
- `lb-votes` on the row: 4.5.
- Disabled (aria-disabled) `say-hello`: text on its background: 4.5.
- Certificate (in both themes): `cert-name`, `cert-signature` on the sheet: 4.5.

**RC8 (v1 focus rules survive).** (a) After a greeting, `document.activeElement` is `say-hello`. (b) With `chaos=418`, `retry-btn` is focused. (c) Vote: `battle-next` focused. (d) Every nav click moves focus to `view-title` and the focus ring is visible (`:focus-visible` outline width >= 2px). (e) Blank name focuses `name-input`. (f) Copy certificate: focus stays on `cert-copy`.

**RC9 (order: DOM equals visual).**
1. Tab 12 times from page start on `/`. Expect the first 8 per UC11, then `nav-weather`, `nav-wall`, `nav-sla`, `nav-time-machine`, then `nav-haiku` (9th to 13th), and later `theme-system` is after `nav-federation`.
2. At 1280x800: annex left edge >= main right edge; footer top >= both. At 390 and 768: annex top >= main bottom; footer top >= annex bottom.
3. No element outside the footer before `say-hello` in DOM order is focusable except the 7 allowed; `document.querySelectorAll('[tabindex]:not([tabindex="-1"])')` is empty.

**RC10 (view transition guard).** (a) `addInitScript` deletes `document.startViewTransition`: hello to certificate still works (UC5 passes). (b) With the API present and normal motion: after clicking `cert-link`, `cert-name` is visible within 1,500 ms and `view-title` is focused. (c) With reduced motion: the spy shows zero calls.

**RC11 (certificate artifact).** After arrival (wait 1,500): `cert-guilloche` contains >= 13 `path` elements, each with `pathLength="1"`; `cert-seal` contains 26 ring `text` glyphs; `cert-serial` text matches `^Serial [0-9A-F]{4}(-[0-9A-F]{4}){3}$`; no `<use>`, `<textPath>`, `[href]` other than `#/...` anywhere in the document.

**RC12 (constraint lint on the HTML string).** On `page.html`: exactly one `<style>` and one `<script>`; no `style=`, no `\son\w+=`; no `data:` and no `url(` in the CSS; no `http://` or `https://` in any `href` or `src`; script contains none of `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval(`, `new Function`, `.href =`, `.style.`, `xlink:href`; every `setAttribute('href'` argument starts with `'#/` or is built from `'#/certificate/'`; no `<link>`; no `@import`; no `<img>`; page text (`document.body.innerText`) in every Hello state has no `Error:` and no `{`.

**RC13 (secondary stories).**
1. Wall: with an `EventSource` stub emitting 3 events, `wall-item` count is 3, each row text matches `^A [a-z]{2}/\w+ hello`; `status` is updated only for connect (check with a `MutationObserver`: at most 2 mutations).
2. Rate limit: 11th hello shows `rate-limit-message` and `say-hello` text matching `^Wait \d+s$`; `status` mutates at most once during 3 seconds of ticking; at zero `status` contains "You can say hello again."
3. Time machine: choose `1987-05-02`; after 1,400 ms `tm-out` has `data-era="e4"`, `tm-postmark` year text is `1987`, `tm-rail` marker has `data-pos="3"`; with reduced motion the same state is reached within 300 ms.
4. Weather: after a forecast, `weather-meter` has `data-q` a multiple of 5 and `weather-chance` shows the exact percent; `<b>x</b>` as the place is displayed literally.
5. Federation without peers: `fed-empty` visible, `fed-map` contains only the HQ node. With a stubbed `/api/federation` response of one up and one down: `fed-summary` "1 of 2 peers up.", the map has one solid and one dashed line.
6. Haiku: `haiku-card` has `data-haiku` equal to the chosen theme; `haiku-counts` text "5-7-5 verified" beside a visible icon.

---

## 8. Open questions resolved (for decisions.md)

1. **Which art direction?** Chose the suggested "Overkill Greeting Office", sharpened to one recurring gesture (the stamp). Alternatives (terminal/hacker, brutalist, soft pastel SaaS) were rejected because they either need a monospace-only or gradient look that reads as a template, or conflict with the product's joke.
2. **Fonts without web fonts.** System serif stack (Iowan/Palatino/Charter/Cambria/Georgia) for ceremony; system UI for controls; system mono for data. Zero downloads, zero shift, CSP-safe. Trade-off: appearance varies by OS; the stacks were chosen so every platform lands on a real serif.
3. **Theme switcher placement.** Footer radio group, after `say-hello` in DOM and visual order. A header toggle would break UC11 (first 8 tab stops). Radios (not a toggle button) because three states (system, light, dark) map to native radio semantics with arrow-key support.
4. **Theme storage and flash.** `localStorage['ho-theme']`, applied by the first statement of the single script. Accepting at most one frame of flash for override-vs-system mismatch, with `color-scheme` and a system-matching canvas as mitigations. Hiding the page until JS runs was rejected (blank page if JS fails).
5. **Secondary nav placement.** After `main` as "Other departments" tiles (right rail at 1200+, grid below). Required by UC11; also reads as a sensible "more" area.
6. **Certificate orientation.** Portrait, A-series ratio 1:1.414, always light paper. One orientation means one SVG viewBox, one print size, and it fits a phone. Dark theme shows a lit sheet on a dark table.
7. **Ring text without `textPath`.** `textPath` needs `href="#id"`, which violates the hard "href only with `#/`" rule. Chose per-glyph rotated `<text>` nodes (26 glyphs). Gradients are referenced with `fill="url(#id)"`, which is not an `href`.
8. **No `text-transform` on asserted text.** It changes `innerText` and accessible names in Chromium. Uppercase only on aria-hidden decoration and CSS-generated content. The verdict glyph is an SVG so `verify-result`'s text equals the verdict.
9. **Percent meters without inline styles.** `data-q` quantised to 5% with 21 generated CSS rules; the exact number is always visible text. Avoids `style=` and any `.style` access.
10. **Reduced-motion implementation.** Redefine every keyframe as opacity-only inside the media query plus shortened duration tokens; loops off; JS tweens skipped. Verified by an objective test (RC3) over `document.getAnimations()` keyframes.
11. **View Transitions.** Used only for the hello-to-certificate stamp morph, gated by feature detection, `motionOK()` and a 600 ms skip. Not used for every route because the root snapshot can intercept pointer events during a transition and make clicks flaky; ordinary route changes use the `hidden`-toggle fade.
12. **Animation model.** CSS animations that run on node insertion with `fill-mode: backwards` and no `to` frames, so the natural style is the end state. Nothing can be left at opacity 0. JS only adds classes and runs three WAAPI/tween effects (wall FLIP, federation dots, time-machine year).
13. **Wall list motion.** One WAAPI translate on the `ul` (FLIP in a line) instead of per-row layout animation; no scroll container, so no extra tab stop.
14. **Wall rows keep exact text.** Time cell comes from a `data-time` attribute through `::before{content:attr() / ""}`, so `wall-item.textContent` is the v2 string.
15. **Time-machine era look.** Era changes only font stack, border and radius (never colour) so every contrast pair stays in the table and each era is recognisable without images.
16. **Disabled buttons.** Keep `aria-disabled` (focusable, announced) rather than `disabled`, as today; a busy button uses the `--sunken` look with `--ink` text (13.47:1) so the countdown stays legible.
17. **Dark instruments in light theme.** Wall board and SLA panel are `.night`-scoped in both themes so "instrument" surfaces keep high contrast and a distinct identity.
18. **Status colour.** `--accent` (action) and `--bad` (error) are different reds (`#B3301B` vs `#9E1B1B`), but meaning never relies on hue: every error and verdict carries an icon and a word.
19. **No toasts.** The single live region is the announcement channel; inline pills and tickets give visual confirmation, avoiding a second live region and focus traps.
20. **Print.** Added a "Print certificate" button (calls `window.print()`) and a portrait 176 x 249 mm sheet that fits A4 and Letter; backgrounds force-print via `print-color-adjust:exact` for the guilloche and seal.
21. **SLA sparkline.** Built from in-tab samples only (no new API field). It is decorative and `aria-hidden`; numbers remain the data.
22. **Copy additions.** Kept to eyebrows, short ledes and captions that obey the `at `/`Error:`/`{` rule from UC8, and never altered fixed v1/v2 strings.

Build budget: `STYLE` about 40 to 48 KB, `SCRIPT` grows by about 20 KB (helpers: `svg()`, `icon()`, `guilloche()`, `seal()`, `postmark()`, `ringDots()`, `tween()`, `motionOK()`, `setLabel()`, theme handler, wall FLIP, fed dots). Recompute `styleHash` and `scriptHash` as today; `security.js` is unchanged.

---

## 9. Accessibility review (a11y-architect)

Scope: WCAG 2.2 Level AA review of sections 1 to 8 against the v1 contract in `../ux.md` (journeys, focus rules, UC1-UC11 unchanged) and the fixed build constraints (one inline style, one inline script, hash CSP, no web fonts, no `style=`, first 8 Tab stops, all testids and copy kept). Nothing below asks for a change to a v1/v2 string, testid meaning, route, or the first 8 Tab stops. Fixes that add copy or a control say so.

Method note: no shell was available in this session, so every contrast ratio was recomputed by hand from the WCAG relative-luminance formula, not by script. RC7 remains the machine check. Naming note: the focus-appearance rule is SC 2.4.13 (AAA); the AA criterion that applies is SC 2.4.11 Focus Not Obscured (Minimum), together with 2.4.7 Focus Visible. This review audits 2.4.7 and 2.4.11 and treats 2.4.13 as advisory.

### 9.1 Contrast result (tokens)

Recomputed every pair in the 2.1 table, both themes, plus the `.paper` (light values) and `.night` (dark values) scopes. All agree with the spec within 0.02 and none falls below 4.5:1 (text) or 3:1 (non-text). Tightest margins: `--warn` on `--sunken` light 4.59, `--accent` on `--sunken` light 4.86, `--control` on `--sunken` light 3.77, `--control` on `--surface` dark 4.40. No token hex needs to change. The failures are in derived states (opacity floors, gradient overlays, idle strokes): see A11Y-17 to A11Y-19 and 9.3.

### 9.2 Findings

| ID | Severity | WCAG SC | Issue | Required fix |
|---|---|---|---|---|
| A11Y-01 | CRITICAL | 2.3.1 | Wall (4.6): every SSE event triggers a row `.rise`, a time-plate `.flip` (rotateX), a `.wash` (amber 18% luminance pulse on the row), a lamp `.tick` and a `ul` slide. The spec has no rate cap and the feed is shared, so a burst of events stacks washes and flips across up to 51 full-width rows: more than 3 luminance flashes per second over an area above the general-flash threshold. | Add a flash budget in the script: animate at most 1 inserted row per 500 ms (2 per second). Rows arriving inside the window are inserted without animation and batched in one `requestAnimationFrame`. Remove the `.wash` background-colour pulse; mark a new row with a 3px edge that appears and fades over 2 s through opacity only (no luminance swing on the row body). Run `.flip` only when no other animated row started in the last 500 ms. The budget applies in normal motion too, not only under reduced motion. Add RC14: stub 20 events in 1 s, assert no more than 3 started row animations in any 1 s window and zero `background-color` keyframes. |
| A11Y-02 | HIGH | 1.4.11, 1.4.1, 4.1.2 | Forced-colors / Windows High Contrast: the only forced-colors rule is a one-line mention in 2.3. Backgrounds are overridden, so the chaos checkbox check mark (`::after` filled `--accent-ink` on `--accent`) and the hazard edge disappear and a checked box looks unchecked. The current-tab underline is a `box-shadow`, which forced colours drops. The meter fill, Haiku/Verify state fills and the selected theme segment fill also vanish. | Add `@media (forced-colors:active)`. Checkbox: `input[type=checkbox]:checked{border-color:Highlight}` and `input[type=checkbox]:checked::after{forced-color-adjust:none;background:Highlight}` (or `CanvasText`). Current tab: add `border-bottom:3px solid Highlight` (keep `aria-current` and `font-weight:700`). Selected theme segment: keep the check icon (it uses `currentColor`, so it survives) and add `border:2px solid Highlight`. Buttons keep a real `1px` border so they stay visible. Meters and sparklines are decorative and may disappear. Add an RC (Playwright `forcedColors:'active'`): checked `chaos-toggle` and current tab differ from unchecked/non-current in a computed-style or screenshot assertion. |
| A11Y-03 | HIGH | 1.4.10, 1.4.4, 1.4.12 | Certificate sheet (4.2) has a fixed `aspect-ratio:566/800`, `.cert-body` padding `14% 11% 22%`, an absolutely positioned seal at `bottom:6%`, and a guilloche SVG with `meet` scaling. At 320 px the content box is about 225 x 260 px; a 40-character name at `2.25rem`, the greeting, the 64-hex signature plate and the serial need far more height. The box grows past the ratio, the seal then overlaps the signature or serial text, and the border art no longer matches the sheet. The same happens at 200% text size. | Make `.cert-body` a flex column with the seal in normal flow (`margin-block-start:auto`, `position:static`), the sheet `min-height` from the ratio (keep `aspect-ratio` only as a minimum, never `height`), and the guilloche SVG `preserveAspectRatio="none"` (the bands already use `vector-effect:non-scaling-stroke`; draw the four corner rosettes as a separate square-viewBox SVG per corner so they do not distort). Reduce padding to `10% 7% 8%` below 480 px. RC5/RC6 additions: at 320 and 390 with the 40 x "W" name and a 64-char signature, no overlap between `cert-seal` and any `dd` or `cert-serial` bounding box, and 200% text zoom keeps `scrollWidth <= clientWidth`. Print keeps the 176 mm ratio sheet. |
| A11Y-04 | HIGH | 2.4.11, 1.4.4, 1.4.10 | Sticky right rail at 1200+ (3.2): `top:1rem` with no height guard. It does not overlap main horizontally, so on a normal viewport focus is not obscured. But the rail is about 400 px tall (heading, 6 tiles at 48 px, gaps) and grows with text size. On a short window (about 450 px or less) or at large text size it is taller than the viewport, sticks to the top, and its lower tiles can never be scrolled into view; keyboard focus on `nav-federation` or `nav-haiku` lands off-screen. | Gate the sticky rule: `@media (min-width:1200px) and (min-height:640px){.annex{position:sticky;top:1rem}}`; otherwise `position:static`. Add `scroll-padding-block:1rem` on `html`. Use `min-height` (not `height`) on tiles. Do not make the rail an overflow scroller (it would add a scroll container around focusable children). RC9 addition: at 1280x420, Tab to `nav-federation` and assert its rect is inside the viewport; at 1280x800 assert no focused element rect intersects the rail unless it is in the rail. |
| A11Y-05 | MEDIUM | 1.1.1, 4.1.2 | Certificate seal (4.2) is `aria-hidden` and carries a visible claim (AUTHENTIC GREETING OFFICE ring text, monogram). Screen reader users get no equivalent. The 26 per-glyph `<text>` nodes would be read letter by letter if the svg were exposed carelessly. | Set on `svg.cert-seal`: `role="img"` and `aria-label="Seal of the Overkill Greeting Office"` (`setAttribute`, not a `<title>`, so no text node is added inside a testid element); remove `aria-hidden` from the svg. Wrap the ring glyphs, monogram, ribbon and ripple in `<g aria-hidden="true">` so they are never exposed even by engines that traverse `role=img` children. The label must not say "verified" or "authentic" (only the Verify page decides that). Keep `focusable="false"`. Crest svgs (header, certificate) stay `aria-hidden`. RC11 is unaffected (still 26 `text` glyphs). Add a check: `getByRole('img',{name:'Seal of the Overkill Greeting Office'})` is found once. |
| A11Y-06 | MEDIUM | 2.3.3, 2.2.2 | Reduced motion (2.4) is incomplete. (a) The choreography delays are literal ms values (440, 620, 820, 960, 1,060, 1,240, `120+100*i`); only `--step` is zeroed, so under reduced motion content sits at opacity 0 for up to about 1.3 s because of `backwards` fill. (b) Literal transitions survive: era-rail marker `520ms`, countdown ring `1s linear`, `scaleX` barometer. RC13.3 expects the marker to jump. (c) Re-declaring `.shake`, `.tick`, `.thud`, `.flip`, `.wash`, `.deal-*` as `from{opacity:0}` makes an input, a row or a stat value blink out and back, which is itself a flicker. | In the reduced block add: `*,*::before,*::after{animation-delay:0s!important;transition-delay:0s!important}` and `transition-property:opacity,background-color,color,border-color` (drop transform and stroke-dashoffset transitions). For motion-only effects (`.shake`, `.thud`, `.tick`, `.flip`, `.wash`, `.deal-*` rest rotation) use `animation:none` instead of an opacity keyframe; keep the opacity fade only for entrances (`.rise`, `.stamp-in`, `.slide-up`, `.draw`, `.tape`). Extend RC3: every animation has `delay===0` and no `transform` or `stroke-dashoffset` transition runs. |
| A11Y-07 | MEDIUM | 2.2.2 | Auto-updating and looping content with no user control: Wall rows arrive and shift continuously with no pause; SLA values refresh every 5 s; `.pulse` on the Reconnecting lamp loops forever; the Verify scan line, the pen line (`.write`), the 17-dot Haiku loader and the Time-machine year flick can run longer than 5 s on a slow response. Only reduced motion stops them. | Wall: add a `Pause updates` / `Resume updates` toggle button (`aria-pressed`, testid `wall-pause`, new copy, it sits inside the board so the first 8 Tab stops are untouched) that buffers events and applies them on resume; the count and status still update. Loops: set `animation-iteration-count` to 4 (about 6 s at 1.4 s) on `.pulse`, `.write`, scan line, ring dots, then rest in the static state; the time-machine year flick stops after 3 s and shows the `----` fallback. SLA refresh is essential data and stays. |
| A11Y-08 | MEDIUM | 4.1.3 | Loading states are silent. The button label changes to "Greeting..." and the card shows `result-loading` with `aria-busy`, but `aria-busy` on a non-live node announces nothing. A chaos `delay` run holds this for 2 to 4 s; a screen reader user hears nothing between pressing Say hello and the result. | Reuse the existing loading strings, no new copy: if a request is still pending after 1,000 ms, call `say()` once with the same text as the loading element ("Warming up the greeting...", "Checking...", "Finding two greetings...", "Loading certificate...", "Reading the sky...", etc.). Fast responses never announce, so the later "Greeting ready for Ada." is not doubled. Clear the pending timer on completion. UC2 and UC6 still pass (they check `contains`). |
| A11Y-09 | MEDIUM | 2.4.2 | The redesign does not say the document title changes with the hash route. One title for ten views fails Page Titled for a single-page app, and the h1 focus alone does not update the tab or history title. | In the router set `document.title` to the h1 text plus ` - Hello Overkill` (Hello view stays exactly `Hello Overkill`). Do this inside the route update callback so it also runs inside the view-transition update. |
| A11Y-10 | MEDIUM | 1.4.10, 1.4.4, 1.4.12 | Fixed heights are specified as heights: tabs "48px high", secondary tiles "56px high", wall rows "Row height 44px", inputs "48px high". Wall rows with wrapped text, tiles with a wrapped caption at 320, and large text or user text-spacing will clip or overflow. | Every such value becomes `min-height` (with vertical `padding` and `line-height`, never `height`, never `overflow:hidden` on text containers). Tile captions may wrap; the `::after` caption is `display:block` with `overflow-wrap:anywhere`. Applies to RC5: the 44 px check stays a minimum. |
| A11Y-11 | MEDIUM | 1.4.10 | SLA tiles (4.7) are 2 columns at 390 and below, with `--t-numeral` at `1.75rem` mono. At 320 a tile content width is about 100 px and a value such as `1234 ms` needs about 118 px, so numerals overflow or clip. | Tile grid `repeat(auto-fit,minmax(9rem,1fr))` (one column under 360 px), `dd{font-size:clamp(1.25rem,5.5vw,1.75rem);overflow-wrap:anywhere}`. Add 320 to RC5 for every view. |
| A11Y-12 | MEDIUM | 3.1.2 | `lang` is set only on `greeting-text`. The same translated greeting is shown in the certificate, battle letters, haiku, time-machine and federation results with no `lang`, so a screen reader pronounces Spanish, Swahili or Japanese with the page (English) voice. The `:lang(ja)` font rule also never applies there. | Wherever the response knows the language, set `lang` on the node (`cert-greeting`, `battle-option-*` greeting span, `tm-greeting`, `haiku-line` block). If the certificate or battle payload has no language field, ask the architect to add an additive `language` field (no contract change); do not guess in the client. Peer greetings (`fed-result-greeting`) have unknown language: leave unset. Add a UC-style check: `cert-greeting` has `lang="es"` for the Spanish greeting. |
| A11Y-13 | MEDIUM | 1.3.1, 4.1.2 | Federation numbering uses `tr::before{counter-increment:peer;content:counter(peer) / ""}` (4.10). Generated content on a `tr` becomes an anonymous table cell, so each body row has one more cell than the header and the columns misalign, and AT may expose an extra empty cell. | Attach the counter to the first cell: `td:first-child::before{counter-increment:peer;content:counter(peer) / ""}` with `counter-reset:peer` on the `tbody`. The number is a visual link to the aria-hidden map only; the table text remains the source of truth. |
| A11Y-14 | MEDIUM | 1.3.1, 1.1.1 | Battle voted state: which letter was picked is shown only by a lift and the decorative "Your pick" stamp. Both static letters stay in the DOM with no marker, and the status "Vote counted for <greeting>." is transient. | Render "Your pick" as real visible text inside the winner (a `<span class="pick">`, not `aria-hidden`, not generated content). The static letters become a `ul` with two `li` so the pick is read in context. The loser needs no marker. |
| A11Y-15 | MEDIUM | 2.4.7, 2.5.8 | Theme radios (5): "input visually inside" the label segment. If the native input is visually hidden or sized 1 px, the global `:focus-visible` ring lands on the invisible input and keyboard focus is not visible on the segment. | Keep the input in the accessibility tree: `position:absolute;inset:0;width:100%;height:100%;opacity:0;margin:0` inside a 44 px high segment (so the whole segment is the target). Draw the ring on the segment: `.seg:has(input:focus-visible){outline:3px solid var(--focus);outline-offset:2px}` (fallback for engines without `:has`: place the input before the face element and use `input:focus-visible + .seg-face`). Never `display:none` or `visibility:hidden`. Semantics themselves are correct: `fieldset`/`legend`, native radios with one `name`, one Tab stop, arrow keys. |
| A11Y-16 | MEDIUM | 2.4.7, 2.4.11 | `.night` panels (Wall, SLA, Haiku night card) re-scope `--focus` to amber `#F2C14E`. If a control sits at the panel edge or the panel has `overflow:hidden`/`clip-path`, the 3px ring plus 2px offset is clipped, or is drawn over the light page where amber on `#F4EEE2` is 1.45:1. | `.night` containing focusable controls must have at least 8 px inner padding on every side and must not use `overflow:hidden` or `clip-path` on an ancestor of a focusable element. Check Reconnect, Pause and the Haiku card. RC8 addition: focus each control inside a `.night` panel in light theme and assert the ring box lies inside the panel box. |
| A11Y-17 | LOW | 1.4.3 | `.pulse` runs opacity `.45 to 1` on text such as the SLA `dd` placeholder "-" and loading lines. At the trough, `--ink` on dark `--sunken` falls to about 3.8:1. `.tick` starts at `.4` for 260 ms. | Pulse floor `.7` (about 8:1 on dark sunken; at `.6` it is still about 5.4:1) and prefer pulsing a lamp or skeleton block rather than text. `.tick` floor `.6`. |
| A11Y-18 | LOW | 1.4.3, 1.4.11 | Seal gloss `radialGradient` white `.22` lightens the accent under the 9 px ring text near (30%,30%): `--accent-ink` on the blended colour is about 3.9:1 at the peak. | Gloss opacity `.12` (about 4.8:1) or clip the gloss to outside the r44 text ring. Needed because A11Y-05 exposes the seal as an image. |
| A11Y-19 | LOW | 1.4.11 | Federation Idle state uses "neutral grey-line nodes" in `--line` (about 1.5:1 on `--surface`); node positions and the idle state are informational in the visual map. | Idle node and line stroke `--control` (4.58 light on `--surface`, 4.40 dark). Up and down keep teal solid and `--bad` dashed with a cross (not colour alone, already specified). |
| A11Y-20 | LOW | 1.1.1, 1.3.1 | SLA sparkline: `figure` with an `aria-hidden` svg and a visible `figcaption` "p95, last 2 minutes in this tab". A screen reader announces a caption for a chart with no data. The `▲` prefix on elevated error rate is generated content and not exposed. | Either mark the whole `figure` `aria-hidden="true"` (the tiles and table are the data) or make the caption carry the data ("p95, last 2 minutes in this tab: now 42 ms"). Elevated error rate is conveyed to AT by the number itself; `▲` stays decorative, colour is not the only cue for sighted users. |
| A11Y-21 | LOW | 4.1.3 | Theme radios: arrow keys change the selection immediately, the screen reader already announces "Dark, radio button, 3 of 3", and `say('Theme set to dark.')` announces again. | Call `say()` only for pointer activation (`event.detail > 0` on the `click` that follows `change`); keyboard users get the native announcement. Copy strings unchanged. |
| A11Y-22 | LOW | 4.1.3 | Duplicate-announcement guard for ceremonies and errors. The spec correctly keeps one live region, but it does not forbid other roles. On validation error focus moves to the field AND `say()` announces AND `aria-describedby` reads the same text. | Document as known and accepted (the v1 focus and status rules are fixed). Rules: no `role="alert"`, `aria-live` or `role="status"` on `error-message`, `rate-limit-message`, `.err`, `wall-status`, `wall-count`, `fed-summary`, `sla-*`, `result-loading`; ceremonies (stamp, seal, flap, ripple) never call `say()`; one `say()` per user action. Add to RC12: `querySelectorAll('[role=alert],[aria-live],[role=status]')` has length 1 (the `status` div). |
| A11Y-23 | LOW | 1.3.1, 2.4.8 | Tile lists and the wall `ul` use `list-style:none` and custom `display`, which drops list semantics in Safari/VoiceOver. `aria-current` on annex tiles is not mentioned (only the primary nav). | Add `role="list"` to the wall `ul` and the tile `ul`s; the router also sets `aria-current="page"` on the matching annex tile. The annex container must be a `<nav aria-label="Other departments">`, distinct from "Primary". |
| A11Y-24 | LOW | 1.3.1 (print), 2.4.6 | Print (4.2): the real h1 is hidden (`.view-head`) and the decorative title is `aria-hidden`, so a tagged PDF has no heading. The rule `.eyebrow{display:none}` also hides the in-sheet "The Overkill Greeting Office" eyebrow if it uses that class. `.cert-foot` is "screen-hidden" but the print block never sets `display:block` for it. The certificate text box is hidden, yet the footnote tells the reader to paste "its certificate text" that is not on the page. | Scope the rule to `.view-head .eyebrow`; add `.cert-foot{display:block}` to the print block; keep the visible h1 in print and hide the engraved duplicate instead (or drop `aria-hidden` on the engraved title and hide the h1 in print). Print the serial in the footnote and reword only if the architect approves new copy. Add `color-scheme:light` on `.paper` and `color-scheme:dark` on `.night` so native scrollbars match the scope. |
| A11Y-25 | LOW | 1.3.1 | CSS `attr()` and generated-content inventory. Pass with conditions: `data-sub` captions (decor), `data-n` haiku counts (the same counts are real text in `haiku-counts`), weather header band `TELEGRAM`/`SIMULATED` ("Simulated forecast, not real weather." is real text), certificate quotes, roundels, "Form HO-1", "MILESTONE", "Stale": all decorative or duplicated. One real gap: wall `data-time` is information (event time) that exists only as generated content, and `content:attr(x) / ""` is dropped entirely by engines without the alt-text syntax. | Rule for the build: generated content never carries unique information and never replaces text. Wall time: keep as supplemental, add `aria-description` with the HH:MM:SS on the `li` as progressive enhancement (not `aria-label`, which would replace the row text), and declare a plain `content:attr(data-time)` line before the `/ ""` line so older engines still render it visually. |
| A11Y-26 | LOW | 2.2.2, 2.3.3 | Rapid motion even in normal mode: `.shake` runs 3 cycles in 280 ms (about 10 Hz position oscillation on an input or a verdict stamp), and the time-machine year flick changes every 70 ms (about 14 changes per second, small area so it does not breach 2.3.1). | `.shake`: 2 cycles, 400 ms, 3px amplitude. Year flick: 150 ms steps. Neither is announced (already `aria-hidden`). |
| A11Y-27 | LOW | 1.3.5 | Name fields have no `autocomplete` decision. The Hello name is the visitor's own name in most journeys (streaks), the Weather/Time/Haiku/Federation name fields are the same concept. | Hello `#name` `autocomplete="given-name"`; other name inputs `autocomplete="off"` if the product treats them as a third party's name. Document the choice (3.3.7 does not apply: the views are separate tasks). |

Counts: CRITICAL 1, HIGH 3, MEDIUM 12, LOW 11 (27 findings).

### 9.3 Areas reviewed with no finding (conditions kept)

- Target size 2.5.8: all controls are 44 px or more; the 28 px checkbox sits in a 44 px label row; radio segments are 44 px high. Inline links are exempt. After A11Y-10 the sizes are minimums.
- Focus Not Obscured 2.4.11: no sticky or fixed header, footer or toast; the rail is disjoint from main (see A11Y-04 for the short-viewport case); the view-transition snapshot lives 420 ms with a 600 ms skip and does not cover a focus target.
- Data-q meters: `aria-hidden`, exact figure is visible text in `weather-chance`, bar contrast above 3:1 (teal on sunken 6.02 light, 8.9 dark). Pass.
- Guilloche: decorative, `aria-hidden`, no text. Pass. No `<title>` or text inside testid elements. Pass.
- Theme radio semantics: native radios in a `fieldset` with `legend`, single `name`, arrow-key navigation, one Tab stop after `nav-federation`. Pass, subject to A11Y-15 and A11Y-21. RC9 expects `theme-system` after `nav-federation` only when System is the stored choice; otherwise the Tab stop is the checked radio.
- Departure-board row design (colour, lamp words, no colour-only status): pass apart from A11Y-01 and A11Y-07.
- Labels in name 2.5.3: buttons keep exact `span.lbl` text with an `aria-hidden` icon; tile captions are generated and the name stays "Weather". Pass.
- Reflow 320/390 elsewhere: leaderboard `table-layout:fixed` with wrapping cells, era rail 7 cells fit in 288 px, `min-width:0` everywhere, hostile strings wrap. Pass except A11Y-03, A11Y-10 and A11Y-11.

### 9.4 Corrected values

No colour token in 2.1 needs a new hex. Parameter corrections (not hex):

| Item | Spec value | Corrected |
|---|---|---|
| `.pulse` opacity floor | `.45` | `.7` (ratio at trough about 8:1 on dark `--sunken`) |
| `.tick` opacity start | `.4` | `.6` |
| Seal gloss white alpha | `.22` | `.12` (blended 9 px ring text about 4.8:1) |
| Federation idle node and line stroke | `--line` | `--control` (4.58 light on `--surface`, 4.40 dark) |
| `--t-numeral` on SLA tiles | `1.75rem` | `clamp(1.25rem, 5.5vw, 1.75rem)` |
| Wall animated rows | unlimited | at most 1 per 500 ms |
| `.shake` | 3 cycles, 280 ms | 2 cycles, 400 ms |
| Time-machine year flick | 70 ms | 150 ms, stops after 3 s |

If RC7 later reports a computed value below the spec, the lowest-margin tokens to adjust first are light `--warn` (`#8A5A00`, 4.59 on `--sunken`; darken toward `#7F5300`) and light `--accent` text on `--sunken` (4.86).
