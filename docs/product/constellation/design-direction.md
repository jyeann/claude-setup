# Design direction: constellation

Source: `brief.md` (SC1 to SC12 and the Design bar). Companion: `ux.md` (journeys, copy, testids, 60 acceptance checks; check numbers below refer to it). Vanilla CSS and Canvas 2D only: no web fonts, no external requests, no inline `style=` in markup, no build step. Every choice carries a number, a hex or a duration so the design-loop evaluator can check it. Where the two documents disagree, the numbers here win for look and feel, and `ux.md` wins for behaviour and copy.

Contrast ratios in section 9 were computed by hand from the WCAG relative-luminance formula. The builder must re-verify them in a unit test (`contrast.test.js` reads the tokens from `app.css` and fails below the stated floor). Treat every ratio as "at least" the rounded-down value shown.

## 1. Evidence contract

| Item | Value |
|---|---|
| Product surface | Browser app on `http://localhost:<port>`. Two views over one vault: Sky (Canvas 2D, full-bleed) and List (plain DOM). A note panel (editor, preview, backlinks) overlays or sits beside either. |
| User's job | "Capture and link a thought in seconds, and rediscover old ideas by exploring rather than only by searching." |
| Primary action | Create a note (`New star`). Secondary: fly to a note (Ctrl+K), wander (`Random star`). |
| Hierarchy (first viewport, desktop) | 1. The sky itself (about 85% of pixels). 2. The focused star and its card. 3. `New star` (the only filled button). 4. Search. 5. Everything else is quiet ink on glass. |
| Target viewports | 1280x800, 390x844, 320x640. Also 200% text zoom at 1280. |
| Themes | Dark ("night", default) and light ("daylight"), selected only by `prefers-color-scheme`. There is no toggle (themes are a non-goal in the brief; this is system-following, not a feature). |

Reference observations behind the choices (local, from `brief.md`; no external research needed):

| Observation | Design consequence |
|---|---|
| Obsidian's graph is a utility panel, reshuffles on each visit, has no sense of age. | The sky is the product, not a panel. Colour encodes age, size encodes links, positions never move (SC2). |
| Star-map toys have wonder but no tool. | Every pretty thing is backed by a real control and a text path (List view, SC10). |
| Wiki `app.css` uses `system-ui`, small radii, a 3px accent focus ring, and the token names `--bg --surface --text --muted --border --accent`. | Keep those token names and the focus-ring rule so copied code and tests keep working. Add `--sky-*`, `--star-*`, `--glass-*`. |
| Brief risk: "beauty versus usefulness". | A design choice that hides information from keyboard or screen-reader users fails, however good it looks. |

State contract (trigger, visible feedback, safe next action). Full copy is in `ux.md`.

| State | Trigger | Visible feedback | Next action |
|---|---|---|---|
| Loading | First `GET /api/sky` in flight | Sky background and dust already drawn; centred status "Charting the sky..." with a 120px accent sweep line (static when motion is reduced); after 3 s a second line "Still charting. A large vault can take a few seconds." | None needed; header search still works |
| Empty | Zero notes (samples removed, nothing written) | Dust sky plus one hollow dashed ring at the focal point and a glass card (section 13) | `Write the first star` |
| Error | Server unreachable, 5xx | Dust dimmed to 40%, dashed ring, message card | `Try again`; focus moves to the message heading |
| Partial | One note body failed to load, or the sky is fine but a panel request failed | Stars drawn; the panel shows an inline notice for that note only | `Try again` inside the panel; the sky stays usable |
| Success | Create, save, rename, delete, remove samples | Lit-star sequence (create), text in `status-live`, panel save status | The focused editor or the star card |
| Permission | Request with a non-loopback Host or Origin (403) | Plain page, no sky: "This address is not allowed." with the working address | Link to `http://localhost:<port>` |
| Unsupported | `canvas.getContext("2d")` returns null | Auto-switch to List view with a one-line notice | The list is fully functional |

## 2. Purpose, audience, tone

- Purpose: make a body of notes feel like a place you live in and return to, while staying plain `.md` files.
- Audience: a writer, student or researcher with tens to thousands of notes, who uses the keyboard, owns their files, and wants to be surprised by old ideas.
- Tone: **calm, observatory-at-night, a little ceremonial**. An engraved star chart plus a quiet instrument panel. Dense information lives in ink on glass; the sky itself is sparse and slow. Not playful, not neon, not "AI".
- Constraint: tool first. Nothing decorative may cost a keystroke, hide a control, or lower contrast.

## 3. The one memorable detail, and two supporting ones

**The lighting.** When a note is created (its first save to disk) its star is lit exactly once:

1. t=0 ms: a core appears at radius 0 and grows to full size by 600 ms (ease-out).
2. t=0 to 600 ms: one ring starts at the star radius and expands by 48 CSS px, stroke 2px thinning to 0.5px, alpha 0.8 to 0.
3. t=100 to 600 ms: each constellation line that ends at the new star draws toward it from the far end (dash-offset reveal).
4. t=600 ms: the bloom sprite is at its resting size. Nothing loops.

It happens only when motion is allowed. With reduced motion the star is simply present at full brightness, plus a static 2px accent ring that stays for 2 s and then disappears (a timed show and hide is not motion). A screen reader hears "Created Ideas" through `status-live`.

Supporting detail 1, **the sky is a calendar.** Warm white means written lately, ice blue means long ago (ramp in section 5). A week of work is a warm cluster you can see from across the room. A legend in the corner says so in words ("Newer" to "Older").

Supporting detail 2, **star-chart typography.** Constellation names are small caps with 0.18em tracking, like an engraved chart. Numbers (counts, dates) use tabular figures. With the weight choices in section 8 these two details give the system font its character.

## 4. Tokens (CSS custom properties)

All colours below are the single source of truth. Canvas code reads them once with `getComputedStyle(document.documentElement)` at start and on `matchMedia("(prefers-color-scheme: light)")` change, never per frame.

```css
:root {
  color-scheme: dark light;

  /* ---------- Night sky (dark, default). Layers, back to front ---------- */
  --sky-base:      #05080f;                       /* L0 flat base, never #000 */
  --sky-zenith:    #0f1a35;                       /* L1 radial, centre 50% -10%, radius 90% x 70%, to transparent */
  --sky-horizon:   #16233f;                       /* L2 linear from bottom (0%) to transparent at 55% */
  --sky-haze:      rgba(120, 150, 210, 0.05);     /* L3 diagonal band, rotated -22deg, 38% of height thick, baked blurred in an offscreen bitmap */
  --sky-vignette:  rgba(2, 4, 9, 0.55);           /* L4 radial, transparent until 55%, full at 100% */
  --sky-dust:      #c9d6f2;                       /* L5 background star field, drawn at alpha 0.12 to 0.35 */

  /* ---------- Star colour ramp by age (days since modified). Piecewise-linear sRGB ---------- */
  --star-t0:   #fff0c4;   /*   0 d  warm white */
  --star-t1:   #fff8e8;   /*  14 d  white */
  --star-t2:   #dce8ff;   /*  90 d  pale blue */
  --star-t3:   #8fb4ff;   /* 365 d and older: ice blue */
  --star-core-alpha-min: 0.55;   /* core alpha = min + (1 - min) * b ; dark */
  --glow-alpha-min: 0.10;        /* glow alpha = min + 0.35 * b */
  --glow-blend: lighter;         /* canvas globalCompositeOperation for bloom sprites */

  /* ---------- Unlit star and lines ---------- */
  --unlit-ring:    #7f8fb0;               /* 1.5px hollow ring, no fill, no glow */
  --unlit-dash:    3 5;                   /* link to an unlit star: setLineDash([3,5]) */
  --line:          rgba(159, 192, 255, 0.22);   /* constellation line, 1 CSS px */
  --line-active:   rgba(110, 231, 200, 0.70);   /* lines of the focused star, 1.5 CSS px */
  --line-unlit:    rgba(127, 143, 176, 0.50);   /* dashed, 1 CSS px */
  --name-ink:      #b9c6e4;               /* constellation name */
  --label-ink:     #e6ecf8;               /* star label */
  --label-halo:    #05080f;               /* 3px stroke behind every canvas label, alpha 0.85 */

  /* ---------- UI chrome (glass over sky) ---------- */
  --bg:            #05080f;               /* same name as wiki, equals --sky-base */
  --surface:       #0e1424;               /* panel base */
  --surface-2:     #151d31;               /* inputs, buttons */
  --glass:         rgba(14, 20, 36, 0.80);   /* panel over sky; effective worst case #121a2e */
  --glass-solid:   rgba(14, 20, 36, 0.96);   /* fallback, see below */
  --glass-blur:    14px;
  --glass-edge:    rgba(159, 192, 255, 0.16);/* 1px panel edge */
  --text:          #eef2fa;
  --muted:         #a9b4c8;
  --disabled:      #6f7c97;
  --border:        #5d6b8a;               /* controls, 3:1 minimum */
  --accent:        #6ee7c8;               /* THE accent: focus, selection, primary button, current note */
  --accent-muted:  #4fbfa4;               /* missing-link text in the editor preview only */
  --on-accent:     #07101c;
  --danger:        #ff9b8f;
  --danger-bg:     #3a1a17;
  --on-danger:     #1a0a08;
  --mark-bg:       #5c4b00;
  --mark-text:     #fff6cc;
  --backdrop:      rgba(2, 4, 9, 0.72);

  /* ---------- Type ---------- */
  --font-ui:   Seravek, "Gill Sans Nova", Ubuntu, Calibri, "Segoe UI", "DejaVu Sans", system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, "DejaVu Sans Mono", monospace;
  --fs-caption: 0.75rem;   /* 12 / 16, small caps labels, counts */
  --fs-small:   0.875rem;  /* 14 / 20 */
  --fs-body:    1rem;      /* 16 / 24 */
  --fs-lead:    1.125rem;  /* 18 / 26 */
  --fs-h2:      1.375rem;  /* 22 / 28 */
  --fs-h1:      clamp(1.5rem, 1.2rem + 1.2vw, 1.875rem); /* 24 to 30, line-height 1.2 */
  --tracking-caps: 0.18em;
  --tracking-ui-caps: 0.12em;
  --tracking-h1: -0.01em;

  /* ---------- Space (4px grid), radii, elevation ---------- */
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
  --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 64px;
  --r-control: 6px;  --r-panel: 12px;  --r-pill: 999px;   /* no other radius is allowed */
  --e1: 0 4px 16px rgba(0, 0, 0, 0.35);                         /* tooltip, star card */
  --e2: 0 12px 40px rgba(0, 0, 0, 0.45), 0 0 0 1px var(--glass-edge); /* note panel, header */
  --e3: 0 24px 64px rgba(0, 0, 0, 0.60), 0 0 0 1px var(--glass-edge); /* dialogs */

  /* ---------- Focus ---------- */
  --focus-w: 3px;  --focus-offset: 2px;
  /* :focus-visible { outline: var(--focus-w) solid var(--accent); outline-offset: var(--focus-offset); } */

  /* ---------- Motion ---------- */
  --dur-fast: 120ms;  --dur-ui: 200ms;  --dur-lit: 600ms;
  --dur-fly-min: 450ms;  --dur-fly-max: 1200ms;
  --ease-out:    cubic-bezier(0.22, 0.61, 0.36, 1);   /* JS: 1 - (1-t)^3 */
  --ease-in-out: cubic-bezier(0.45, 0, 0.2, 1);       /* JS: t<.5 ? 4t^3 : 1 - (-2t+2)^3/2 */
  --ease-ring:   cubic-bezier(0.16, 1, 0.3, 1);       /* JS: 1 - (1-t)^4 */

  /* ---------- Layout ---------- */
  --header-h: 56px;  --dock-h: 56px;
  --panel-w: clamp(420px, 36vw, 520px);   /* 461px at 1280 */
  --sheet-h: 58vh;                        /* phone bottom sheet */
}

@media (prefers-color-scheme: light) {
  :root {
    /* Daylight sky: pale paper-blue, stars become ink. Same structure, inverted weight. */
    --sky-base:     #e8eef8;
    --sky-zenith:   #f4f7fc;
    --sky-horizon:  #d5e0f1;
    --sky-haze:     rgba(60, 90, 160, 0.06);
    --sky-vignette: rgba(120, 140, 180, 0.18);
    --sky-dust:     #3b4a66;                  /* dust alpha 0.08 to 0.22 */
    --star-t0: #b45309;  --star-t1: #8c5a1e;  --star-t2: #2f55b8;  --star-t3: #1e3a8a;
    --star-core-alpha-min: 0.85;              /* core alpha = 0.85 + 0.15 b : ink must stay dark enough for 3:1 */
    --glow-alpha-min: 0.06;                   /* glow alpha = 0.06 + 0.25 b, blend source-over */
    --glow-blend: source-over;
    --unlit-ring: #55607a;
    --line: rgba(47, 85, 184, 0.28);
    --line-active: rgba(11, 107, 90, 0.80);
    --line-unlit: rgba(85, 96, 122, 0.55);
    --name-ink: #3b4a66;  --label-ink: #101828;  --label-halo: #f2f6fc;
    --bg: #e8eef8;  --surface: #f6f8fc;  --surface-2: #ffffff;
    --glass: rgba(246, 248, 252, 0.86);  --glass-solid: rgba(246, 248, 252, 0.96);
    --glass-edge: rgba(30, 58, 138, 0.16);
    --text: #101828;  --muted: #4a5568;  --disabled: #66728a;  --border: #7a8599;
    --accent: #0b6b5a;  --accent-muted: #0b6b5a;  --on-accent: #ffffff;
    --danger: #b42318;  --danger-bg: #fef3f2;  --on-danger: #ffffff;
    --mark-bg: #fff3b0;  --mark-text: #101828;
    --backdrop: rgba(16, 24, 40, 0.45);
    --e1: 0 4px 16px rgba(16, 24, 40, 0.14);
    --e2: 0 12px 40px rgba(16, 24, 40, 0.16), 0 0 0 1px var(--glass-edge);
    --e3: 0 24px 64px rgba(16, 24, 40, 0.28), 0 0 0 1px var(--glass-edge);
  }
}
```

Sky background (CSS, on `.sky-stage`, behind a transparent canvas): `background: radial-gradient(90% 70% at 50% -10%, var(--sky-zenith), transparent), linear-gradient(to top, var(--sky-horizon) 0%, transparent 55%), var(--sky-base);`. The haze and vignette are baked once into an offscreen bitmap on resize and drawn first each frame (haze at 0.3x parallax, vignette fixed). The page never uses a flat `#000` or `#fff` background. The canvas is set up and styled through classes and CSSOM only (CSP forbids inline style attributes in markup).

Glass rule: panels use `background: var(--glass); backdrop-filter: blur(var(--glass-blur)) saturate(1.1)`. Inside `@supports not (backdrop-filter: blur(1px))` and `@media (prefers-reduced-transparency: reduce)` use `var(--glass-solid)` and no blur. At most 2 blurred surfaces on screen at once (header and one panel); dialogs use `--surface` solid with `::backdrop` `var(--backdrop)`. Glass exists only where seeing the stars through the surface is useful (panel edge, header); it is never used for cards inside panels.

## 5. Stars: exact mapping

Inputs per note: `ageDays = (now - mtime) / 86400000`, `backlinks` = count of distinct notes linking here.

```
r  = clamp(1 - ageDays / 90, 0, 1)                 // recency, linear over 90 days (brief open question 3)
B  = min(1, log2(1 + backlinks) / log2(17))        // 16+ backlinks saturates
b  = max(0.30, 0.60 * r + 0.40 * B)                // brightness 0.30..1.00, never below 30%
radius (CSS px at zoom 1) = 1.5 + 5.0 * b          // 3.0 at b=.30, 6.5 at b=1
screen radius = radius * clamp(zoom ^ 0.5, 0.6, 2.2)   // stars grow slower than the map
age colour    = lerp over stops (0 d t0, 14 d t1, 90 d t2, 365 d t3), clamped
core          = age colour at alpha (star-core-alpha-min + (1 - star-core-alpha-min) * b)
glow radius   = 3.2 * screen radius ; glow alpha = glow-alpha-min + 0.35 * b   // dark;   0.25 * b in daylight
```

Checkable consequences:

| Case | b | radius | colour |
|---|---|---|---|
| Orphan edited today | 0.60 | 4.50 | #fff0c4 |
| Note edited today with 10 backlinks (B = 0.846) | 0.938 | 6.19 (1.38x the orphan) | #fff0c4 |
| Orphan edited 90+ days ago | 0.30 | 3.00 | #dce8ff at 90 d, toward #8fb4ff after |
| Orphan edited 200 days ago | 0.30 | 3.00 | #bdd3ff (+-1 per channel) |
| Edited 14 days ago, 0 backlinks | 0.507 | 4.04 | #fff8e8 |

The 10-backlink star is at least 1.35x the radius and at least 0.25 higher in `b` than an orphan created the same day (SC4). Recency never lowers a star below 30% (b floor), so old notes stay findable. Unlit stars have no `b`: fixed radius 4.0, ring only.

Twinkle (full motion only): rendered brightness = `b * (1 + 0.10 * sin(2*pi*t/period + phase))`, amplitude 0.10 (the brief caps it at 0.15). `period` is 3.2 to 6.4 s, hashed from the title. `phase` comes from 6 slots 60 degrees apart, assigned greedily so that any two stars closer than 60 world units get different slots. Only the 150 brightest visible stars twinkle. A unit test asserts: same input gives the same slots; no two stars within 60 units share a slot.

## 6. Lines, unlit stars, glow

| Element | Style |
|---|---|
| Constellation line | 1 CSS px, `--line`, solid, `lineCap: round`. Three batched paths, one `stroke` each: normal, active (focused star's edges, 1.5 px, `--line-active`), unlit-dashed. |
| Edge density control | Max 6,000 edges drawn per frame. Over the cap, drop edges whose endpoints both have `b < 0.4`, then the lowest combined brightness first. Edges are decorative and fully duplicated in text (backlinks, list), so they are exempt from the 3:1 non-text rule. |
| Constellation name | Small caps, `--name-ink`, 12px, tracking 0.18em, at the cluster centre of mass nudged to the nearest free label slot, 3px halo. Max 12 on screen. |
| Unlit star | Hollow ring: stroke 1.5px `--unlit-ring`, radius 4.0px, no fill, no glow, no twinkle. A 40 degree arc of the ring is left undrawn, so it differs from a lit star by shape and not hue alone. Dashed link line 1px `[3,5]`. Max 2,000 drawn. Tooltip: "Not written yet". |
| Lit star | Glow sprite (below), then the core disc filled with the age colour. Stars with screen radius under 1.2px are drawn as a 1x1 `fillRect` in a per-colour batch without sprites. |
| Selected or focused star | Ring: stroke 2.5px `--accent` at `radius + 6`, plus an inner 1px `--label-halo` ring at `radius + 3.5` so it survives bright glows. Its edges use `--line-active`. |
| Glow / bloom (canvas only) | No CSS filters and no `shadowBlur` (slow). Pre-render glow sprites once to offscreen canvases: 8 colour buckets (the age ramp sampled at 0, 14, 45, 90, 180, 270, 365 days and older) times 4 size buckets (radius 3, 4.5, 6, 7.5) = 32 sprites, each a radial gradient (centre alpha 1, 0.35 at 35% of radius, 0 at 100%). Draw with `drawImage` scaled, `globalAlpha` set to the glow alpha, blend `--glow-blend`. Max 800 sprites per frame (brightest first). |
| Parallax dust | One offscreen 1024x1024 tile, 220 deterministic points (seeded), radius 0.5 to 1.1px, alpha 0.12 to 0.35 (dark) or 0.08 to 0.22 (daylight). Drawn tiled at an offset of `0.3 x camera offset` in screen px. Zoom does not scale it. Never hit-tested, never labelled. Drift (full motion only): 1.5 CSS px per second to the left, added to the offset. |

## 7. Chrome

- **Header** (desktop 56px, glass, `--e2`): wordmark "CONSTELLATION" in small caps 14px tracking 0.18em; search combobox (hint chip "Ctrl K" in `--fs-caption`); `Random star` (quiet button); `New star` (the only filled button: `--accent` background, `--on-accent` text, weight 600); view switch `Sky | List` (two links; the current one has `aria-current="page"`, a 2px accent underline and heavier weight, never colour alone).
- **Note panel** (glass, `--e2`, radius 12px on the sky side only): header with `Close note`, `Centre in sky`, title (h1), save status, `Save`, `Rename`, `Delete`; tabs `Write | Preview`; editor (mono 15px/1.6, `--surface-2`); backlinks.
- **Star card** (solid `--surface`, `--e1`, radius 12px, max 280px wide): title (600, wraps anywhere), meta line in small caps ("EDITED TODAY, 4 LINKS IN"), one action button. The hover tooltip is the same card without the button and with `pointer-events: none`.
- **Buttons**: 44px tall on touch, 32px on desktop (24px minimum target). Radius 6px. Primary is filled accent; secondary is `--surface-2` with a 1px `--border`; danger is filled `--danger`. Disabled keeps `--disabled` text at 4.0:1 and a dashed 1px border, so it is not colour alone.
- **Icons**: inline SVG, 20px, stroke 1.75, `currentColor`, round caps. Icon-only buttons always have `aria-label` and show a text tooltip on focus (not hover only). No emoji, no icon fonts.
- **Hover-free rule**: every affordance that appears on hover also appears on focus and on tap.

## 8. Typography: character from system fonts

No web fonts. Two stacks only: `--font-ui` (humanist sans: Seravek on Apple, Gill Sans Nova on Windows, Ubuntu on Ubuntu, Calibri, Segoe UI, DejaVu Sans) and `--font-mono` for the editor. Humanist faces have open apertures and calligraphic stress, which suits a star chart. The character comes from how the type is set:

| Use | Size / line | Weight | Tracking | Other |
|---|---|---|---|---|
| Note title h1 | 24 to 30 / 1.2 | 300 (falls back to 400 where no light cut exists) | -0.01em | `text-wrap: balance`, wraps anywhere |
| Panel and dialog h2 | 22 / 28 | 600 | 0 | |
| Body, labels | 16 / 24 | 400 | 0 | |
| Meta, hints | 14 / 20 | 400 | 0.01em | `--muted` |
| Constellation names, section labels, wordmark | 12 / 16 (canvas 12px; wordmark 14px) | 600 | 0.18em (UI labels 0.12em) | `font-variant-caps: small-caps`. Canvas: `ctx.fontVariantCaps = "small-caps"; ctx.letterSpacing = "0.18em"`. If unsupported, draw uppercase at 0.82x size with manual per-glyph spacing of 0.18em. |
| Counts, dates, zoom level | 12 to 14 | 500 | 0.02em | `font-variant-numeric: tabular-nums lining-nums` |
| Star labels on canvas | 13 / 1 | 500 | 0.01em | halo stroke 3px |
| Editor | 15 / 1.6 | 400 | 0 | `--font-mono`, `tab-size: 4` |

Inputs and the editor are 16px at 390px wide (prevents iOS zoom). Canvas labels truncate at 24 code points with "…"; the card and tooltip show the full title.

## 9. Contrast table (WCAG 2.2 AA; text 4.5:1, UI 3:1)

Ratios are lower bounds. "Panel" is `--surface` (`#0e1424` dark, `#f6f8fc` daylight). "Worst glass" is the glass over the brightest sky area (dark `#121a2e`, daylight `#f2f6fc`).

| Pair | Dark foreground / background | Dark ratio | Daylight foreground / background | Daylight ratio | Floor |
|---|---|---|---|---|---|
| Body text on panel | #eef2fa / #0e1424 | 16.4 | #101828 / #f6f8fc | 16.6 | 4.5 |
| Muted text on panel | #a9b4c8 / #0e1424 | 8.8 | #4a5568 / #f6f8fc | 7.1 | 4.5 |
| Muted on worst glass | #a9b4c8 / #121a2e | 8.3 | #4a5568 / #f2f6fc | 6.8 | 4.5 |
| Muted text directly on sky (legend, summary) | #a9b4c8 / #16233f | 7.4 | #4a5568 / #d5e0f1 | 5.6 | 4.5 |
| Accent text or link on panel | #6ee7c8 / #0e1424 | 12.2 | #0b6b5a / #f6f8fc | 6.0 | 4.5 |
| On-accent text on accent fill | #07101c / #6ee7c8 | 12.7 | #ffffff / #0b6b5a | 6.4 | 4.5 |
| Danger text on panel | #ff9b8f / #0e1424 | 9.0 | #b42318 / #f6f8fc | 6.2 | 4.5 |
| Mark (search highlight) | #fff6cc / #5c4b00 | 7.8 | #101828 / #fff3b0 | 14.5 | 4.5 |
| Canvas star label on its halo | #e6ecf8 / #05080f | 16.9 | #101828 / #f2f6fc | 15.7 | 4.5 |
| Constellation name on its halo | #b9c6e4 / #05080f | 11.7 | #3b4a66 / #f2f6fc | 8.2 | 4.5 |
| Disabled label (exempt, kept) | #6f7c97 / #151d31 | 4.0 | #66728a / #e3e9f3 | 4.0 | 3.0 |
| Control border / input border | #5d6b8a / worst glass | 3.2 | #7a8599 / #f6f8fc | 3.5 | 3.0 |
| Focus ring (accent) on panel | #6ee7c8 / #0e1424 | 12.2 | #0b6b5a / #f6f8fc | 6.0 | 3.0 |
| Focus ring (accent) on sky | #6ee7c8 / #05080f | 13.0 | #0b6b5a / #d5e0f1 (worst) | 4.8 | 3.0 |
| Dimmest lit star core (coolest colour, b=0.30) on sky | composite #647fb5 / #05080f | 4.9 | composite #586eaa / #d5e0f1 | 3.7 (warmest worst case 3.3) | 3.0 |
| Brightest recent star core | #fff0c4 / #05080f | 16 | #b45309 / #d5e0f1 | 3.8 | 3.0 |
| Unlit ring on sky | #7f8fb0 / #05080f | 6.0 | #55607a / #d5e0f1 | 4.7 | 3.0 |

Rules that keep these true: star core alpha never goes below 0.55 (dark) or 0.85 (daylight); glow never carries meaning on its own; every canvas label has a 3px halo in `--label-halo` at alpha 0.85, so label contrast is measured against the halo; no text sits on a glow without a halo. Dialog buttons sit on `--surface` (solid).

## 10. Motion principles

| Rule | Number |
|---|---|
| What may move | The camera (pan, zoom, flight), the lit-star sequence, panel and dialog slide, twinkle, dust drift, the loading sweep. Stars never move on their own (positions are fixed, SC2). |
| Camera ease | Flights use `--ease-in-out`; pan inertia uses exponential decay; UI uses `--ease-out`. No easing has a control point outside 0 to 1 on the y axis, so nothing overshoots. A unit test samples every curve at 100 points and asserts monotonic output within [0, 1]. |
| Flight duration | `clamp(450 + 120 * log2(1 + distance / viewWidth), 450, 1200)` ms. Never above 1,200 ms (SC8 and the Design bar). For distance above 1.5 view widths the zoom eases down to 0.7x of the lower end zoom at mid-flight and back ("pull back and settle"), still finishing in the same duration. |
| Flight target | The star lands at the centre of the free area (stage minus header, banner, panel), at zoom `clamp(current, 1.0, 2.0)`. |
| Input cancels | Any pointerdown, wheel, key (arrows, +, -, Escape) or touchstart ends the animation in the same frame, keeping the current camera. |
| Pan inertia | On release, velocity v px/s decays as `v * exp(-t/180ms)`; stop under 5 px/s or at 400 ms. Cancelled by any input. |
| Zoom | Wheel factor `exp(-deltaY * 0.0015)` about the cursor; keyboard and buttons x1.25 (or /1.25) about the free-area centre, animated 120 ms `--ease-out`. Range 0.1 to 6. Touch zooms about the pinch midpoint. |
| Lit sequence | Section 3: grow 600 ms `--ease-out`; ring 600 ms `--ease-ring`; lines 500 ms starting at 100 ms. Total 600 ms. |
| Delete | The star fades to 0 over 300 ms `--ease-out`; its lines fade with it. |
| Neighbour settle | When a new note moves existing stars (at most 2% of view width, SC2) they ease to the new place over 300 ms. |
| Panel | Slide 24px and fade, 200 ms `--ease-out` (desktop from the right, phone from the bottom). Dialogs fade 120 ms. |
| Twinkle | Amplitude 0.10, period 3.2 to 6.4 s, staggered in 6 slots; max 150 stars. |
| Ambient loop | 20 fps cap, paused when `document.hidden`. If the rolling frame time exceeds 20 ms for 30 frames, twinkle and drift switch off; above 28 ms, glow sprites are halved. |
| Redraw policy | On demand (dirty flag) when nothing animates. With reduced motion there is no ambient loop at all, so an idle sky draws zero frames (check 33). |

Reduced motion (`prefers-reduced-motion: reduce`, read live via `matchMedia` change events) replaces each item:

| Normal | Reduced |
|---|---|
| Flight | Camera jumps to the final position in one frame |
| Zoom animation, pan inertia | Instant step, no inertia |
| Lit sequence (grow, ring, lines) | Star and lines appear fully drawn at once; static 2px accent ring for 2 s; status text "Created X" |
| First-run fade-in | The whole sample sky appears at once |
| Twinkle, dust drift, neighbour settle, delete fade | Off; instant |
| Panel and dialog slide and fade | `transition-duration: 0s` |
| Loading sweep | Static 120px line |
| Parallax dust (it responds to the person's own pan, not to time) | Stays at 0.3x. Deliberate: it is a direct response to input, not autonomous motion. |

## 11. Canvas rendering budget rules

| Rule | Budget |
|---|---|
| Frame time | p95 under 16.6 ms at 1,000 notes; under 33 ms at 5,000 notes with 10,000 links |
| Pixel ratio | `min(devicePixelRatio, 2)`; canvas pixel size capped at 4,096 per side |
| Draw order | dust and haze bitmap, edges (3 paths), sub-pixel stars (batched `fillRect` per colour bucket), glow sprites (`drawImage`), cores (one path per colour bucket), selection ring, labels. At most about 12 `stroke`/`fill` calls plus 800 `drawImage` per frame. |
| Culling | World space is bucketed in a uniform grid (cell 128 world units). Per frame draw only cells intersecting the viewport plus a 64 CSS px margin. Edges are culled by a segment-versus-viewport test. |
| Level of detail | zoom under 0.4: no glow sprites for `b < 0.5`; edges follow the 6,000 cap rule; stars as dots. zoom under 0.2: constellation names only. |
| Hit testing | Spatial grid lookup, never a scan of all stars. Hit radius `max(12, radius + 6)` CSS px (22 on touch). Nearest star wins; ties go to the brighter star. |
| Labels | Star labels only at zoom 1.4 or more (0.8 when the vault has 12 or fewer stars), or for the hovered or focused star. Order: constellation names first (max 12), then stars by brightness. Each label tries 4 placements (right, left, above, below) at 8px offset; a rect is rejected if it overlaps any placed rect (padding 4px) in a 32px occupancy grid or leaves the safe area (stage minus header and panel). **Max 40 labels total on desktop, 24 at 390px and narrower.** The hover or focus label is drawn last without moving others, with a solid chip background. Label rects are published in `sky-labels` (see `ux.md`), and checks 36, 42 and 43 assert zero overlaps. |
| Label cache | Measure text once per title (`measureText` cached in a `Map`); truncate to 24 code points with "…". |
| Layout | Positions come from the server (stable, cached). The browser never runs a layout. |
| Allocation | No per-frame array or object allocation in the draw loop; typed arrays for x, y, b, colour bucket. |
| Data size | `/api/sky` for 5,000 notes and 10,000 links under 1.5 MB uncompressed (arrays, not an object per edge). |
| Time to interactive | 1,000 notes under 1,000 ms after navigation; 5,000 notes under 3,000 ms. The first frame draws the dust sky before data arrives. |

## 12. First-run sample sky: art direction

Sample notes (all carry `sample: true` front-matter): **Start here** (hub), **How the sky works**, **Writing a note**, **Links and unlit stars**, **Your vault**. Start here links to the other four; each of the others links back to Start here; "How the sky works" links to "Links and unlit stars"; "Writing a note" links to "Your vault". Result: 5 stars, 6 distinct edges, 1 constellation named "START HERE" (the hub has the most backlinks, 4).

- Composition: the constellation fills about 40% of the free-area width, centred in the free area (not under the panel). Initial zoom is the fit zoom clamped to 1.0. Minimum 120 CSS px between any two stars at that zoom; if the seeded layout puts two closer, raise the fit zoom until they are 120 px apart (cap 1.6).
- Colour and size: all five are age 0, so warm white `#fff0c4`. Brightness follows section 5: Start here (4 backlinks) `b = 0.60 + 0.40 * log2(5)/log2(17) = 0.827`, radius 5.6; "How the sky works" and "Writing a note" (1 backlink) b 0.698, radius 5.0; "Links and unlit stars" and "Your vault" (2 backlinks) b 0.755, radius 5.3. A gentle hierarchy, not a spotlight.
- Sequence (full motion, 1,800 ms total from the first data frame): the hub core grows at 200 ms; the other four at 360, 520, 680 and 840 ms (each grows over 400 ms); each edge draws over 300 ms once both its ends have started (all done by 1,500 ms); the name "START HERE" fades in from 1,500 to 1,800 ms; at 1,800 ms the hub receives the focus ring and its star card appears (non-modal, no DOM focus theft). This meets SC1's "within 2 s".
- Banner: a quiet strip under the header (not a modal, not a card over the sky): "This is a sample sky. Write over it, or remove it any time." and `Remove sample notes`. It never covers the focused star (the free area excludes it).

## 13. Empty, loading and error as designed moments

| State | Moment | Spec |
|---|---|---|
| Empty sky | "An unlit room." | Dust sky and haze only. At the focal point a hollow ring, radius 14px, `--unlit-ring`, dashed `[3,5]`, 1.5px. Beside it a glass card (max 320px): h2 "The sky is empty" (22px, weight 300), text "Every note you write becomes a star.", primary `Write the first star`. Static, no pulse. |
| Loading | "Charting the sky" | Dust sky visible at once. Centred text "Charting the sky..." (`--muted`, small caps 12px, tracking 0.18em) over a 120px by 1px accent line that sweeps left to right every 1.6 s (static when reduced). `role=status`. After 3 s a second line: "Still charting. A large vault can take a few seconds." |
| Error | "Lost signal" | Dust dimmed to 40%; the dashed ring sits behind the message card (decoration). h2 "Could not reach Constellation", text "The server may have stopped. Check the terminal where it is running, then try again.", button `Try again`. Role alert. Focus on the card heading (`tabindex=-1`). |
| Permission | "Wrong door" | Plain solid page (no sky): h1 "This address is not allowed", text "Constellation only answers at localhost on this computer.", link to the working address. |
| Partial | | Panel notice, role alert: `Could not load "Start here". Try again.` with `Try again`. The sky keeps working. |
| Canvas unavailable | | List view with notice "This browser cannot draw the sky, so you are seeing the list. Everything still works." |

## 14. Responsive behaviour

| Viewport | Layout |
|---|---|
| 1280x800 | Header 56px glass over sky. Sky stage fills the rest. Note panel docked right, width 461px (`--panel-w`). Free area = stage minus header (top) minus panel (right): 819 x 744. A focused star lands at the free-area centre (x=409.5, y=428). Zoom buttons bottom-left of the free area; legend under them; summary top-left of the free area. List view: left 340px list column, right note pane. |
| 390x844 | Header 56px: wordmark (left), search (flex). Bottom dock 56px: `New star`, `Random star`, `Sky | List` (each at least 44px tall and wide). Zoom buttons (44px) float above the dock at the right. Note panel is a bottom sheet of 58vh (490px) with a decorative 44x4px grab bar (`Close note` is the real control); free area is the top 298px (y 56 to 354), focal centre y = 205. The card is the same component, placed to stay inside the free area. Labels capped at 24. List and editor are single column, 16px inputs, no horizontal scroll (`scrollWidth <= 390`). |
| 320x640 | Same as 390. Wordmark 12px with tracking 0.12em; search placeholder "Search"; dock buttons show text only; legend collapses to one line; sheet 58vh = 371px, free area y 56 to 269 (centre y 162). No horizontal scroll except inside `pre` blocks. |
| 200% text zoom at 1280 | Search wraps below the wordmark; panel buttons wrap; nothing clipped. |

At every size: the panel or sheet never covers the focused star (the camera re-centres on open and on resize); touch targets are 44px; the document does not scroll in Sky view; `touch-action: none` and `overscroll-behavior: contain` apply to the canvas only.

## 15. What we refuse to do

1. Generic dashboard chrome: stat tiles, card sidebars, tables in the Sky view, big KPI numbers.
2. Purple, violet or magenta gradients, "AI glow", neon outlines. Allowed hue bands for chrome and sky: 150 to 240 degrees (teal to blue), plus warm amber for stars and coral for danger. Checkable: no colour token with hue 250 to 330 degrees and saturation above 25%.
3. Emoji or emoji-like icons, icon fonts, stock illustrations, hero art, particle-system backgrounds, decorative blobs.
4. Cards inside cards, glass on glass, more than 2 blurred surfaces at once.
5. Hover-only affordances: every hover reveal also works on focus and on tap.
6. Colour-only meaning: unlit stars differ by shape (hollow, gapped ring) and by the card text; the current note differs by ring and `aria-current`, not only by colour.
7. Animation that loops for its own sake beyond twinkle (max 10%) and dust drift; no bounce, no overshoot, no parallax above 0.3x, no auto-playing sound.
8. Flat `#000` or `#fff` page backgrounds; pure white text on pure black.
9. Web fonts, CDN assets, external images, `unsafe-inline`.
10. Putting any necessary action only on the canvas. Every sky action has a list, button or keyboard equivalent.
11. Marketing copy in the product: no hero text, and no feature descriptions in the UI where a control speaks for itself.

## 16. How the design-loop evaluator scores this

Score each dimension 0 to 10 from rendered screenshots at 1280x800, 390x844 and 320x640 (dark and daylight), the `ux.md` check results, and the token file. Pass needs: every dimension at 7 or more, total at least 80 of 100, and no hard fail.

| # | Dimension | 10 means | 7 means | Evidence |
|---|---|---|---|---|
| 1 | Memorable detail | Lit sequence matches section 3 exactly (ring 600 ms +-50, lines, grow); reduced-motion substitute present | Ring present, timings within +-150 ms | Check 3 and 34 samples of `data-animating`, `data-lit-progress` |
| 2 | Sky legibility | Age ramp readable; the 10-backlink star is at least 1.35x radius; legend present; sample sky matches section 12 | Ramp present but hard to distinguish in dark or daylight | Checks 12 to 14, screenshots |
| 3 | Typography | Both stacks as specified; small caps plus 0.18em on constellation names; tabular figures on counts; no web font request | Stacks right, caps or tracking missing in one place | Check 60, computed styles |
| 4 | Colour and contrast | Every row in section 9 meets its floor in both themes; no token in the purple band | One row within 0.3 of the floor | Contrast unit test, check 58, token scan |
| 5 | Motion discipline | Every duration and easing as in section 10; no overshoot; input cancels in the same frame; reduced motion replaces all | One duration off by more than 20% | Checks 22, 23, 32 to 35, 44, easing unit test |
| 6 | Canvas craft | Budgets in section 11 hold; no label overlap; at most 40 labels (24 on phone); culling and batching evident | Budgets hold at 1,000 notes only | Checks 26 to 28, 42, 43 |
| 7 | States as moments | Empty, loading, error, permission, partial, unsupported all match section 13 with real copy | One state plain but correct | Checks 54 to 57, screenshots of each state |
| 8 | Responsive and touch | Section 14 holds at 1280, 390, 320; panel never covers the focused star; 44px targets; no horizontal scroll | Works but one overlap at 320 | Checks 36 to 40 |
| 9 | Accessibility | Whole product operable by keyboard; List path complete; axe zero serious or critical; focus ring 3px and 3:1 everywhere including canvas | Minor axe moderate findings only | Checks 29 to 31, 45 to 47, 59 |
| 10 | Restraint and originality | None of section 15 appears; looks like a star-chart instrument, not a template | One generic element | Reviewer judgement against section 15 |

Hard fails (score 0 for the iteration): any item in section 15 present; a text or UI contrast row under its floor; two overlapping labels at default zoom; a hover-only affordance; a console CSP violation; any flight over 1,200 ms; twinkle amplitude over 15%; the sky not operable by keyboard; a web font or external request.

The evaluator reports each score with the measured number beside it (for example "ring duration 612 ms", "max labels 38", "label overlaps 0").
