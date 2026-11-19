# Design direction: incident-sim

Source: `brief.md` (success criteria "SC1" to "SC12", Design bar). Companion: `ux.md` (journeys, screens, copy, testid contract, acceptance checks). Stack: vanilla JS, plain CSS in `public/`, SVG plus one canvas, no build step, no web fonts, no external requests, CSP-safe (no inline script or style attributes in markup).

Every choice below carries a number, a hex or a duration so the design-loop evaluator can check it (rubric in section 17). Contrast ratios were computed by hand from the WCAG relative-luminance formula; the automated contrast test (`test/contrast.test.js`, reading `public/tokens.css`) is authoritative and must fail the build if any row below drops under its minimum.

---

## 1. Evidence contract

| Item | Decision |
|---|---|
| Product surface | A browser game: a live system map, alert and log panels, an action menu, then a replay debrief. Static files only, offline after load. |
| User's job | "Spot the cause in the metrics, pick the right fix, learn why the obvious fix backfires." Sessions of about 10 minutes. |
| Primary action | Inspect a node (`i` or click), then apply one action from the action panel. Everything else is secondary. |
| Hierarchy (first viewport, 1280x800) | 1) the system map (at least 45% of the viewport area), 2) the mission clock and pager lamps in the header, 3) the alerts list, 4) the action panel, 5) sparklines, 6) navigation. Nothing above the map except the 56 px header. |
| Target viewports | `1280x800`, `390x844`, `320x640`. Evidence labels must use exactly these strings. |
| Reference observations | (a) `brief.md` Design bar: motion encodes data only, 150-250 ms transitions, 500 dots at 60 fps, tabular mono numerals, body at least 16 px, never colour-only status. (b) `docs/product/wiki/ux.md` and `examples/wiki/public/app.css`: token approach (`:root` custom properties, `prefers-color-scheme` overrides, `.sr-only`, `[hidden]`, 3 px focus ring with 2 px offset, `prefers-reduced-motion` kill switch, 44 px phone targets, 24 px desktop minimum). We keep those mechanics and replace the look. (c) Brief competitor table: SadServers and game-day tools look like terminals; Papers, Please is the feel bar (rules as puzzle, readable minimalism). We borrow the "everything on one desk" density of the second and avoid the raw-terminal look of the first. |
| Local references | Wiki `app.css` token names (`--bg`, `--surface`, `--text`, `--muted`, `--border`, `--accent`) are replaced by the `--c-*` set below because the game needs four status hues and glow, which the wiki does not. |

### Content states (trigger, visible feedback, safe next action)

| State | Where | Trigger | Visible feedback | Safe next action |
|---|---|---|---|---|
| Loading | Boot, scenario fetch | Fetch takes over 300 ms | Skeleton map: dashed node outlines, text "Plugging in the pager..." (role status). No spinner. | Wait; after 8 s turns into the error state with retry |
| Empty | Picker with zero valid scenarios; inspector with no node; empty log; no alerts; no saved runs | See section 14 | Specific sentence plus the next step | The named button or key |
| Error | Scenario load failure, bad scenario file, storage blocked, import rejected, clipboard denied, engine exception | See section 14 | Page-style banner: shape icon, label, what went wrong, how to fix | Retry, Reload, or fix-the-file instruction |
| Partial | Some scenario files invalid; map tick data missing for a node; replay for an old run | Mixed valid and invalid files | Valid ones listed; "Scenario problems (2)" disclosure lists file and field | Play a valid incident; fix the file and restart the server |
| Success | Resolved; export done; import done; copy done | Engine or action result | "Resolved" calm state change, alerts clear one by one; polite live text | Open debrief; Retry this seed |
| Permission | Not applicable for accounts (no accounts, no roles). Clipboard and download permission are handled as Error rows (denied clipboard shows text to copy by hand). | | | |

### Evidence record for the rendered finish gate

The builder produces a local JSON record for `check-evidence.js` with: `contract` = this file; `targetViewports` = `["1280x800","390x844","320x640"]`; one `renderedEvidence` entry per viewport (screenshots of play view mid-incident, debrief, picker, text mode); `accessibility` and `responsive` pass entries; `contentStates` with the six keys above (`permission` is `not-applicable` with the reason in the table). Unavailable access is reported as untested, never as passed.

---

## 2. Purpose, audience, tone

- **Purpose**: make "I know the term" become "I recognised it in the graphs". The interface is an instrument panel you learn to read.
- **Audience**: an interview candidate (reads fast, wants feedback within seconds) and an engineer running a team game-day (wants the same seed to look identical on every screen). Both repeat a loop: scan, inspect, act, watch.
- **Tone**: a mission-control desk at 3 a.m., lit only by indicator lamps, written by someone who has been paged before. Slightly ominous (deep blue-black floor, one warm paper-white light, chroma reserved for meaning), but fun: precise, tidy, a little dry. Think flight-director console and rack-panel stencil labelling, not "dark mode SaaS dashboard".
- **Chroma discipline (the rule that makes it not a generic dark dashboard)**: the interface itself is neutral blue-black plus one warm paper white (`#f4efe6`). Colour appears only when it means something: ok, warn, crit, recovering. A quiet system is almost monochrome; trouble is the only thing with hue. Checkable: with every node `ok`, no more than 15% of non-background pixels on the play screen may be chromatic (saturation above 0.35) apart from the ok-teal.

## 3. The memorable detail and two supporting details

**ONE memorable detail: the map is the instrument ("traffic you can read").** Request dots flow along edges; their density is the load (baseline 8 dots/s per edge, up to 40 at 5x load). Dots slow and pile up in a stack at the entrance of a saturated node (the pile is at most 24 dots and equals queue depth scaled). Error responses are hollow rings flying backwards. Retries have a short tail. In a stampede you watch dots stack at the cache, then flood the DB edge; in a retry storm the third-party edge visibly fills. Nothing else on screen moves for decoration. Checkable: `map-edge[data-dot-rate]` on the third-party edge at retry-storm peak is at least 3x its pre-incident value; `map-node[data-pile]` on the cache is at least 12 during a stampede.

**Supporting 1: pager lamps.** The pager budget is a row of physical-looking indicator lamps (14 px). Lit = filled warm white with a soft glow; spent = hollow ring with a centre cross. The count is also text ("Pager 4 / 6"). Spending a lamp is a 200 ms flick. It makes cost tangible before you click (the action row previews "Cost 2" and ghost-dims that many lit lamps while the row is focused or hovered).

**Supporting 2: the debrief is a flight recorder.** Two parallel tracks on one time axis, "You" and "Optimal", with lettered marks (D, F, x), a status ribbon, a p99 trace for your run against the optimal run (dashed), and a scrubber that re-simulates the run from the seed so the mini map shows what the system looked like at any second. Determinism is the feature, not a limitation. A short run fingerprint (8 hex characters) lets two teammates see they did the same thing.

Also free: the browser tab title carries status, for example `[CRIT] Cache stampede - incident-sim`, so a backgrounded tab still reads like a pager.

---

## 4. Tokens

Single source: `public/tokens.css`. `app.css` may use only `var(--...)` for colour, space, radius, shadow, font, duration; a raw hex or raw `px` spacing outside tokens fails the rubric. JS-read numeric tokens are unitless so the canvas layer can read them with `getComputedStyle`.

```css
:root {
  color-scheme: dark light;

  /* Surfaces (dark ops console is the default) */
  --c-bg-0: #0b0f14;        /* page and map floor */
  --c-bg-1: #121821;        /* panels */
  --c-bg-2: #1a222d;        /* raised: nodes, menus, toasts, dialogs */
  --c-line-soft: #2a3441;   /* decorative dividers only (not a UI boundary) */
  --c-line-ui: #7a8aa0;     /* control borders, node outlines, 3:1 UI boundary */
  --c-edge: #5d6c80;        /* map edges, spent lamp outline */

  /* Text */
  --c-text: #e8eef5;
  --c-text-muted: #9fb0c3;
  --c-text-disabled: #7a8aa0;

  /* Identity: the one warm light */
  --c-focus: #f4efe6;
  --c-primary-bg: #f4efe6;
  --c-primary-fg: #0b0f14;
  --c-lamp-on: #f4efe6;

  /* Status: colour-blind safe set (blue-green, amber, vermilion, sky). Always paired with a shape and a text label. */
  --c-ok: #3ddbb0;
  --c-warn: #f5b83d;
  --c-crit: #ff6f59;
  --c-recv: #6cb8ff;
  --c-ok-tint: #183335;
  --c-warn-tint: #322e25;
  --c-crit-tint: #332529;
  --c-recv-tint: #1f2e40;
  --c-on-status: #0b0f14;   /* text on a solid status fill */

  /* Traffic */
  --c-dot: #cfe3f7;
  --dot-r: 2.5;             /* unitless, canvas px */
  --dot-r-error: 3.5;
  --dot-speed: 140;         /* px per second along an edge */
  --dot-rate-base: 8;       /* dots per second per edge at baseline load */
  --dot-rate-max: 40;
  --dot-cap: 500;           /* global live-dot ceiling */
  --pile-max: 24;
  --dim-alpha: 0.45;        /* dots on edges downstream of a crit node */

  /* Signal glow (decorative; never the only cue) */
  --glow-ok: 0 0 12px rgba(61, 219, 176, 0.30);
  --glow-warn: 0 0 12px rgba(245, 184, 61, 0.35);
  --glow-crit: 0 0 16px rgba(255, 111, 89, 0.45);
  --glow-recv: 0 0 12px rgba(108, 184, 255, 0.35);
  --glow-lamp: 0 0 8px rgba(244, 239, 230, 0.55);

  /* Typography: system stacks only */
  --font-ui: ui-sans-serif, "Avenir Next", "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --fw-regular: 400;
  --fw-strong: 600;
  --fw-heavy: 700;
  --fs-label: 0.8125rem;    /* 13px: stencil labels, badges, axis ticks */
  --fs-body: 1rem;          /* 16px: prose, logs, table cells */
  --fs-lead: 1.125rem;      /* 18px */
  --fs-h3: 1.25rem;         /* 20px */
  --fs-h2: 1.5rem;          /* 24px */
  --fs-h1: 2rem;            /* 32px */
  --fs-clock: 2.5rem;       /* 40px mission clock */
  --fs-score: 3.5rem;       /* 56px debrief score */
  --lh-body: 1.5;
  --lh-tight: 1.2;
  --track-label: 0.12em;    /* uppercase mono labels */
  --track-head: -0.01em;
  --measure: 72ch;          /* debrief line length cap */

  /* Space (4 px base) */
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
  --sp-5: 24px; --sp-6: 32px; --sp-7: 48px; --sp-8: 64px;

  /* Layout */
  --header-h: 56px;
  --rail-w: 360px;
  --node-w: 144px;
  --node-h: 64px;
  --hit-min: 44px;          /* phone target */
  --hit-min-desktop: 32px;

  /* Radii: squared, instrument-like */
  --r-1: 2px;  --r-2: 4px;  --r-3: 8px;

  /* Elevation (dark UI: lightness first, shadow second) */
  --elev-0: none;
  --elev-1: inset 0 1px 0 rgba(255, 255, 255, 0.04), 0 0 0 1px var(--c-line-soft);
  --elev-2: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 8px 24px rgba(0, 0, 0, 0.45);
  --elev-3: 0 16px 48px rgba(0, 0, 0, 0.60);

  /* Focus */
  --focus-w: 3px;
  --focus-offset: 2px;
  --focus-ring: var(--focus-w) solid var(--c-focus);

  /* Motion */
  --dur-fast: 150ms;
  --dur-base: 200ms;
  --dur-slow: 250ms;
  --dur-signal: 600ms;      /* pulse iteration (signal, not a transition) */
  --dur-shake: 300ms;
  --stagger-clear: 300ms;   /* between alerts clearing */
  --ease-out: cubic-bezier(0.2, 0.7, 0.2, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-std: cubic-bezier(0.4, 0, 0.2, 1);
  --metric-step-reduced: 2;  /* sim seconds between metric repaints under reduced motion */
}

@media (prefers-color-scheme: light) {
  :root {                    /* "Daylight": same structure, no glow */
    --c-bg-0: #f4f1ea;  --c-bg-1: #fbf9f4;  --c-bg-2: #ffffff;
    --c-line-soft: #d6d1c4;  --c-line-ui: #6b7686;  --c-edge: #6b7686;
    --c-text: #14181e;  --c-text-muted: #4a5565;  --c-text-disabled: #6b7686;
    --c-focus: #14181e;  --c-primary-bg: #14181e;  --c-primary-fg: #f4f1ea;  --c-lamp-on: #14181e;
    --c-ok: #0a6f54;  --c-warn: #8a5a00;  --c-crit: #b3261e;  --c-recv: #0b5cad;
    --c-ok-tint: #d8efe7;  --c-warn-tint: #f6e8c8;  --c-crit-tint: #f8dcd8;  --c-recv-tint: #d9e7f6;
    --c-on-status: #ffffff;
    --c-dot: #2d3a4b;
    --glow-ok: none; --glow-warn: none; --glow-crit: none; --glow-recv: none; --glow-lamp: none;
    --elev-1: 0 0 0 1px var(--c-line-soft);
    --elev-2: 0 8px 24px rgba(20, 24, 30, 0.18);
    --elev-3: 0 16px 48px rgba(20, 24, 30, 0.25);
  }
}

@media (prefers-contrast: more) {
  :root { --c-text-muted: #c4d0de; --c-line-soft: #7a8aa0; --c-edge: #8fa0b5; --focus-w: 4px; }
}
@media (prefers-contrast: more) and (prefers-color-scheme: light) {
  :root { --c-text-muted: #2c3541; --c-line-soft: #6b7686; --c-edge: #4a5565; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition-duration: 0s !important; scroll-behavior: auto !important; }
}
@media (forced-colors: active) {
  /* Status shapes and text labels carry meaning; system colours replace the palette. */
  .node, .btn, .tab, .toast { forced-color-adjust: auto; border: 1px solid CanvasText; }
}
```

Spacing rule: only the `--sp-*` scale; panel padding `--sp-4`, gaps `--sp-3`, dense rows `--sp-2`.

## 5. Contrast table (text and UI pairs)

Minimums: 4.5:1 for text, 3:1 for UI boundaries, focus ring and meaningful graphics. "Dark" is the default theme, "Light" is Daylight. Ratios are computed values (rounded); the automated test enforces the "Min" column.

| # | Foreground | Background | Dark | Light | Min |
|---|---|---|---|---|---|
| 1 | `--c-text` | `--c-bg-0` | 16.4 | 15.8 | 4.5 |
| 2 | `--c-text` | `--c-bg-1` | 15.3 | 16.9 | 4.5 |
| 3 | `--c-text` | `--c-bg-2` | 13.7 | 17.8 | 4.5 |
| 4 | `--c-text-muted` | `--c-bg-0` | 8.7 | 6.7 | 4.5 |
| 5 | `--c-text-muted` | `--c-bg-1` | 8.0 | 7.2 | 4.5 |
| 6 | `--c-text-muted` | `--c-bg-2` | 7.2 | 7.6 | 4.5 |
| 7 | `--c-ok` | `--c-bg-0` | 10.9 | 5.5 | 4.5 |
| 8 | `--c-warn` | `--c-bg-0` | 10.8 | 5.3 | 4.5 |
| 9 | `--c-crit` | `--c-bg-0` | 7.0 | 5.8 | 4.5 |
| 10 | `--c-recv` | `--c-bg-0` | 9.1 | 5.9 | 4.5 |
| 11 | `--c-ok` | `--c-bg-2` | 9.1 | 6.2 | 4.5 |
| 12 | `--c-warn` | `--c-bg-2` | 9.0 | 5.9 | 4.5 |
| 13 | `--c-crit` | `--c-bg-2` | 5.9 | 6.5 | 4.5 |
| 14 | `--c-recv` | `--c-bg-2` | 7.6 | 6.7 | 4.5 |
| 15 | each status colour | its own `--c-*-tint` (ok / warn / crit / recv) | 7.6 / 7.6 / 5.4 / 6.5 | 5.1 / 4.9 / 5.1 / 5.3 | 4.5 |
| 16 | `--c-text` | each tint | at least 11.5 | at least 13.7 | 4.5 |
| 17 | `--c-text-muted` | each tint | at least 6.2 | at least 5.8 | 4.5 |
| 18 | `--c-on-status` | each solid status fill (ok / warn / crit / recv) | 10.9 / 10.8 / 7.0 / 9.1 | 6.2 / 5.9 / 6.5 / 6.7 | 4.5 |
| 19 | `--c-primary-fg` | `--c-primary-bg` | 16.8 | 15.8 | 4.5 |
| 20 | `--c-line-ui` | `--c-bg-1` | 5.1 | 4.4 | 3 |
| 21 | `--c-line-ui` | `--c-bg-2` | 4.6 | 4.6 | 3 |
| 22 | `--c-edge` | `--c-bg-0` | 3.6 | 4.1 | 3 |
| 23 | `--c-edge` (spent lamp outline) | `--c-bg-1` | 3.3 | 4.4 | 3 |
| 24 | `--c-focus` | `--c-bg-0` / `--c-bg-1` / `--c-bg-2` | 16.4 / 15.6 / 14.0 | 15.8 / 16.9 / 17.8 | 3 |
| 25 | `--c-dot` | `--c-bg-0` | 14.6 | 10.2 | 3 |
| 26 | `--c-text-disabled` | `--c-bg-2` | 4.6 | 4.6 | 3 (disabled controls also carry a text reason) |

The `--c-line-soft` colour is decorative only (about 1.9:1) and is never the sole boundary of an interactive control. Hex values in both themes appear only in `tokens.css`.

## 6. Status language (never colour alone)

| Status | Meaning | Colour | Shape (12 px SVG, `<use>`) | Label | Extra cue |
|---|---|---|---|---|---|
| ok | Under every threshold | `--c-ok` | Filled circle `#ic-ok` | `OK` | Plain 2 px outline |
| warn | Over a warn threshold | `--c-warn` | Triangle `#ic-warn` | `WARN` | Outline 2 px |
| crit | Over a crit threshold | `--c-crit` | Diamond with a notch `#ic-crit` | `CRIT` | 3 px outline, diagonal hatch fill (45 deg, 4 px pitch, 12% alpha) in the node, one 300 ms shake on entry |
| recovering | Was warn or crit within the last 10 simulated seconds and now under warn | `--c-recv` | Half-filled circle `#ic-recv` | `RECV` | 2 px outline, one expanding ring on entry |

Rules: badge text is `--fs-label`, mono, uppercase, 700, tracking `--track-label`. A status colour is never used without its shape and label in the same component. Hatch pattern, outline width and the label survive grayscale and forced-colors mode. Colour-blind check: the evaluator applies protanopia, deuteranopia and tritanopia simulation to the rendered play screen and confirms all four statuses stay distinguishable by shape and label; the hue pairs ok/warn differ on the blue-yellow axis and crit/ok differ by 0.21 relative luminance, so colour still helps without being required.

Default thresholds (the scenario file may override; engine spec wins on conflict): saturation warn 70%, crit 90%; error rate warn 1%, crit 5%; p99 warn 1000 ms, crit 2000 ms; queue warn 50% and crit 80% of max; cache hit rate warn under 80%, crit under 50%. A node's status is its worst metric.

Severity labels for pages: `SEV1` and `SEV2` use the crit shape and colour, `SEV3` uses warn. The number is always text.

## 7. The system map

Layers (bottom to top): `canvas` (dots only, `aria-hidden`), then one `svg` (edges, nodes, labels, rings). Laid out in CSS pixels with `viewBox` equal to the container size, no scaling transform, so rendered text is never below 12 px.

Templates: **wide** (container at least 720 px) and **tall** (under 720 px). Wide column order left to right: clients; load balancer; services (1 to 3 stacked); cache and queue (stacked); primary DB, replica DB; consumer and partner API on the right edge. Tall: two columns in flow order, rows of nodes 56 px tall with 16 px row gap, edges routed down and across. The layout function is pure and cached per container size.

**Node** (wide 144x64, tall width `(W - 16)/2` with a 136 px floor at 320, height 56 to 64):
- Body: `--c-bg-2` fill, radius `--r-2`, 1.5 px `--c-line-ui` outline; status outline replaces it (2 px, 3 px for crit) in the status colour.
- Row 1: 16 px glyph (our own 20x20 line icons, 1.5 px stroke, square caps: clients = window with three dots, LB = fork, service = hexagon, cache = stacked thin plates, DB = cylinder, replica = cylinder with a tick, queue = three bars with an arrow, consumer = box with outward arrow, partner API = bracketed square with outward arrow) plus name, 13 px, 600.
- Row 2: status badge (shape plus label) at left; the primary metric at right in mono, tabular, 13 px (for example `91%`).
- Bottom: 4 px saturation bar with tick marks at 70% and 90%; the 90%-100% zone always has the hatch so it reads without colour.
- Glow: a radial gradient disc behind the node, opacity 0 for ok, 0.35 to 0.45 for warn, crit and recv (no SVG filters).
- Selected: 3 px `--c-focus` ring at radius +6 for selection; keyboard focus uses the same ring plus a 2 px gap in `--c-bg-0` (visible focus is the ring; selected-but-unfocused uses a 2 px dashed ring).
- Pulse on a new alert; shake on entering crit; recovery ring on entering recv (section 10).

**Edge**: orthogonal path, 8 px corner radius, 2 px `--c-edge`. Width encodes load against edge capacity: under 40% = 2 px, 40 to 80% = 3 px, over 80% = 4 px. States: normal; loaded (4 px); failing (dash `8 6`, `--c-crit`); cut by an open circuit breaker (dash `2 8`, `--c-line-ui`, with a 10 px perpendicular bar and the tag `BREAKER OPEN`). A small mono label at the midpoint shows rate, for example `1.8k rps`, 12 px minimum.

**Particles** (canvas, one pass per frame):
- Spawn rate per edge = `clamp(rps / baselineRps * --dot-rate-base, 0.5, --dot-rate-max)` dots per second, so density is relative to that edge's own healthy load and has 5x headroom. If live dots would exceed `--dot-cap`, spawn probability is scaled down uniformly (relative density preserved).
- Kinds: request = filled circle r 2.5 in `--c-dot`; retry = same with a 10 px tail at 50% alpha; error response = hollow ring r 3.5, 1.5 px `--c-crit`, flying backwards at 1.3x speed. Kind is told by shape and direction, not colour.
- Speed is a constant 140 px/s except the last 24 px before a node whose saturation is above 70%, where speed is scaled by `(1 - saturation)`. When it reaches zero dots queue in a pile (3 px rows, at most `--pile-max`). The numeric queue depth is always in the node as text.
- Dots on edges downstream of a crit node draw at `--dim-alpha` (0.45).
- Counters exposed as attributes: `data-dot-rate` on each edge, `data-pile` on each node, `data-dots` and `data-dot-cap` on the canvas.

**Sparklines** (SVG, one per key signal: checkout p99, error rate, DB saturation, queue depth, cache hit rate): 164x56 desktop, window of the last 60 simulated seconds (60 points). Line 1.5 px in the current status colour; 12% alpha area under the line; a dashed `--c-line-ui` threshold line labelled with its value (`2000 ms`); the final point is a 6 px marker in the status shape; current value in mono 16 px, tabular, with the status label. Y range is fixed per metric (p99 0 to 3000 ms, error rate 0 to 100%, saturation 0 to 100%, hit rate 0 to 100%, queue 0 to scenario max), never auto-scaled, so a graph cannot exaggerate and does not rescale mid-incident.

## 8. Components

- **Panel**: `--c-bg-1`, `--elev-1`, radius `--r-3`, padding `--sp-4`, header row with a stencil label (mono, `--fs-label`, uppercase, `--track-label`, `--c-text-muted`) and optional count. Panels are siblings, never nested in another card. Corner ticks (8 px L-shapes in `--c-line-ui`) appear on the map and the result card only.
- **Buttons**: height 32 px desktop, 44 px phone, radius `--r-2`, 1 px `--c-line-ui` border on `--c-bg-2`, label `--fw-strong`. Primary: `--c-primary-bg` with `--c-primary-fg` (the lit lamp). Danger actions are not coloured red; they are labelled and confirmed. Disabled uses `aria-disabled="true"`, `--c-text-disabled`, dashed border and always a visible reason line.
- **Action row**: name (600), one-line effect (muted, 16 px), cost chip at right (`Cost 2` or `Free`, mono 13 px, outlined). Focus or hover previews cost by ghost-dimming that many lit lamps (also announced by `aria-describedby` text "Costs 2 of your 4 remaining pager").
- **Alert row**: severity label, shape icon, text, `since T+00:06`; firing rows use the status tint; cleared rows use `--c-recv-tint` with "Cleared".
- **Toast** (placed over the top edge of the map, max 3 stacked, 8 s, no controls, `aria-hidden` because the alert list and live region carry the content): `--c-bg-2`, `--elev-2`, 6 px leading bar plus shape plus kicker label. Kinds:

| Kind | Bar and icon | Kicker | Example |
|---|---|---|---|
| page | `--c-crit`, crit diamond | `PAGE` | `SEV2: checkout p99 > 2 s` |
| warn | `--c-warn`, triangle | `WARN` | `Cache hit rate under 80%` |
| clear | `--c-recv`, half circle | `CLEARED` | `checkout p99 back under 2 s` |
| note | `--c-line-ui`, square outline | `NOTE` | `Applied: Add TTL jitter` |

- **Inputs**: 44 px high, 16 px text, 1 px `--c-line-ui` border, 2 px `--c-crit` border plus an inline text error when invalid. Labels are visible, never placeholder-only.
- **Dialog**: native `<dialog>`, `--c-bg-2`, `--elev-3`, radius `--r-3`, backdrop `rgba(0,0,0,0.7)` dark / `rgba(20,24,30,0.5)` light, max width 32rem, full width minus 32 px on phone.
- **Focus**: every focusable element shows `--focus-ring` with `--focus-offset` 2 px. `outline: none` is allowed only where an equal ring replaces it (SVG nodes use a ring element). Sticky headers never hide a focused element (`scroll-padding-top` at least `--header-h` plus 16 px).

## 9. Type rules

- Two voices, both system stacks: `--font-ui` for prose, `--font-mono` for everything measured (clock, metrics, logs, counts, labels).
- Character comes from three moves: (1) stencil labels: mono, uppercase, 13 px, 700, tracking 0.12em; (2) numerals: `font-variant-numeric: tabular-nums slashed-zero` on all mono and every changing number so values never jitter in width; (3) weight contrast: 400 body against 700 headings with tracking -0.01em and line height 1.2.
- Sizes: body, prose, logs, table cells and form text at least 16 px; labels, badges and axis ticks 13 px (never sentences); nothing under 12 px rendered anywhere, including map text.
- Mission clock: `T+02:41`, mono, 40 px, 700, tabular, fixed width `8ch` so it does not shift.
- Debrief prose: `max-width: var(--measure)` (72ch), line height 1.5, paragraphs separated by `--sp-3`.
- Logs: mono 16 px, line height 1.4, timestamp column `5ch`, level word (INFO, WARN, ERR) as text, `overflow-wrap: anywhere` so a 5,000 character line cannot widen the page.
- No web fonts, no `@font-face`, no font requests. `document.fonts.size` is 0.

## 10. Motion principles

Rule: motion only encodes data or marks a state change the player needs to notice. Nothing loops for decoration. UI transitions use 150, 200 or 250 ms; the signal animations below are one-offs and are listed explicitly.

| What moves | Encodes | Duration and easing | Cap | Reduced-motion replacement |
|---|---|---|---|---|
| Request dots along edges | Load: density = rps relative to baseline | Continuous, 140 px/s, linear | 500 live dots, 60 fps target | No dots. Edge thickness (2, 3, 4 px), the midpoint label (`1.8k rps`) and the node queue number carry the same data. `data-dots="0"`. |
| Dot pile-up at a node | Queue depth and saturation | Dots decelerate over the last 24 px | 24 per node | Node shows `Queue 1,240` and a filled backlog bar |
| Error rings flying back | Failed requests | 1.3x speed | within the 500 cap | Edge turns dashed and the edge label shows `err 6%` |
| New alert pulse | An alert fired | Ring scale 1 to 1.35, opacity 0.7 to 0, `--dur-signal` 600 ms, ease-out, 3 iterations | 3 iterations then static `!` tag | Static 3 px outer ring and text tag `NEW PAGE` until the node is selected |
| Failure shake | A node entered crit | translateX 0, -3, 3, -3, 3, 0 px over `--dur-shake` 300 ms, once | once per entry | No shake; hatch fill and `CRIT` label already present |
| Downstream dim | Starved path | Alpha 1 to 0.45 over `--dur-base` | edges only, text never dims | Static dimmed edge plus the label |
| Recovery pulse | Node entered recovering | One ring, `--dur-signal` 600 ms, ease-out; outline colour change `--dur-base` | once | Static ring for 3 s; the `RECV` badge remains |
| Alerts clearing at resolution | The calm state change | Each row fades to cleared tint `--dur-base`, rows staggered `--stagger-clear` 300 ms; no confetti | one per alert | All rows switch at once |
| Pager lamp spent | Budget spent | Fill to hollow `--dur-base` 200 ms | n/a | Instant |
| Toast in/out | Attention | In `--dur-base` (translateY 8 px to 0, opacity), out `--dur-fast` | max 3 | Instant, no translate |
| Panels, tabs, dialogs | Context change | `--dur-base` 200 ms opacity; dialog `--dur-slow` | n/a | Instant |
| Hover and press | Affordance | `--dur-fast` 150 ms colour only | n/a | Instant |
| Sparklines and numbers | Metrics | Repainted every simulated second | n/a | Repainted every `--metric-step-reduced` 2 simulated seconds; `data-updated-at` is always even |
| Replay play | Time travel | Advances 6 simulated seconds per real second | n/a | Play disabled; scrub with the slider |

Allowed properties: `transform` and `opacity` only (plus colour on hover). Layout properties never animate. The pulse and shake are the only animations with keyframes; everything else is a transition. The global `prefers-reduced-motion: reduce` kill switch in section 4 also applies.

## 11. Canvas and SVG rendering budget

1. Two layers only: one canvas for dots, one SVG for structure. No third canvas, no WebGL.
2. SVG node count at most 120 (11 nodes, at most 14 edges, labels, rings, sparklines). The SVG is written once per layout and updated per tick by changing attributes and `textContent` only when the formatted value changed. No per-frame DOM writes.
3. Canvas: dots drawn in at most 3 batches per frame (request, retry, error ring), using 3 pre-rendered sprites on an offscreen canvas and `drawImage`. No `shadowBlur`, no filters, no per-frame gradients. `devicePixelRatio` is capped at 2. Resize through `ResizeObserver`, debounced 100 ms.
4. Frame budget: median script plus draw time at most 4 ms with 500 dots, so 60 fps leaves headroom. A rolling 60-frame p95 above 12 ms halves the effective `--dot-cap` (500, 250, 125); `data-dot-cap` shows the current value. It never raises again within the incident.
5. Simulation tick work (engine step plus DOM update) at most 2 ms on a mid laptop, measured per tick.
6. `requestAnimationFrame` is cancelled when `document.hidden`, when paused (draw one static frame), and in text mode (the canvas is not created). The tick scheduler continues on a timer when hidden so determinism is unaffected.
7. Glow is a pre-made radial gradient with opacity changes. No `filter: drop-shadow` or `feGaussianBlur` on animated elements.
8. Log DOM keeps the last 200 lines; older lines stay in memory for the debrief.
9. Sparkline `points` attributes update once per tick (once per 2 s in reduced motion).

## 12. Debrief: the replay

Reading order at 1280: header (title, status), result card (full width), then a two-column grid: left = flight recorder (flexible), right = story column (prose capped at 72ch).

Flight recorder (top to bottom):
1. Status ribbon, 6 px high, one segment per simulated second coloured by worst status with the hatch pattern for crit (so it reads without colour).
2. p99 trace: your run solid 1.5 px `--c-text`, optimal run dashed `--c-line-ui`, threshold line labelled, fixed y range, height 72 px.
3. Two lanes, 40 px each, labelled `You` and `Optimal` (mono labels), on a shared axis with ticks every 10 s labelled `mm:ss` (13 px). Marks are 24 px (44 px hit on phone) with a letter inside: `D` hollow circle (diagnostic), `F` filled circle in `--c-ok` (fix that helped), `x` diamond in `--c-crit` (harmful). Letter, shape and colour all carry meaning. Onset is a vertical line labelled `Onset`; mitigation is a vertical line labelled `Mitigated 02:41`. The gap between your first divergence from optimal and the optimal's corresponding mark is joined by a 1 px connector.
4. Scrubber: a native `input type="range"` labelled `Replay position`, step 1 s, with `aria-valuetext` like `02:41, 3 of 5 actions taken`. Arrow keys move 1 s, Shift+Arrow 10 s, Home and End jump, `[` and `]` jump to the previous and next action mark. A button `Play replay` runs 6 s per second (disabled under reduced motion).
5. Replay map: a static mini system map (same layout function, no dots) showing node status shapes and labels at the scrubbed second. It is computed from the deterministic engine (snapshots per second kept for the run, at most 600), so scrubbing is instant.
6. Narration line under the map: `T+00:42. You scaled the service. DB saturation 61% to 88%.` Harmful steps add the badge `Harmful` and, in the story column, the `Why that step hurt` paragraph.

Text alternative: the same content as a table (`Step`, `You`, `Optimal`, `Effect`) so the replay is fully available without the picture or the slider.

Story column: Root cause (72ch max), The concept (our own words), Why that step hurt (only if a harmful step exists), the guide link as a button-sized link `Read the guide: <name>` followed by `(opens in new tab)`, then the buttons `Copy result`, `Retry this seed`, `Back to incidents`.

## 13. Scoring and the result card

Card (panel with corner ticks): kicker line `INCIDENT #323 · CACHE STAMPEDE` (mono label); headline `Resolved` (32 px, 700) with the ok shape, or `Out of pager budget` with the crit shape; score `87` (mono 56 px, tabular) with `/ 100` at 16 px; tier word (`Textbook`, `Solid`, `Survived`, `Escalated`); a 3-column stat strip with one stat per cell (all stat values mono, tabular):

| Stat | Value shown | Detail line |
|---|---|---|
| Time to mitigate | `02:41` | `Optimal 01:50` |
| Pager left | `4 / 6` plus the lamps | `2 spent` |
| Collateral | `1 harmful step` | `Peak errors 14%` |

Beneath the strip: `Run fingerprint 9c41ab07` (muted, mono). The strip collapses to a single column under 480 px. Out-of-budget card: time shows `Not mitigated`, pager shows `0 / N`, tier `Escalated`; the root cause is revealed in the story column regardless.

Plain-text twin (copied by `Copy result`, also shown in a `pre` so it can be selected by hand; two lines, no emoji, no personal data, no URL):

```
incident-sim #323 cache-stampede  [D F]  5/6 pager  00:41
score 91  optimal 00:35  harmful 0  fp 9c41ab07
```

Rules: two spaces between groups; the grid letters are `D` diagnostic, `F` fix that helped, `x` harmful, `.` no effect, separated by single spaces; `N/M pager` is left over total; the time is time to mitigate as `mm:ss`, or `OUT` when out of budget. Daily runs use `#<n>` where `n` is whole days since 2026-01-01 plus 1 (2026-11-19 is `#323`); practice runs use `seed:<seed>` in the same position. Length at most 160 characters.

## 14. Empty, loading and error states as designed moments

All use the page-style banner: shape icon, stencil kicker, plain sentence, fix step, and one dry line at most (never in the fix step).

| State | Kicker | Text |
|---|---|---|
| Boot loading (over 300 ms) | `BOOTING` | "Plugging in the pager..." on the dashed skeleton map. Static, no spinner. |
| Picker, zero valid scenarios | `EMPTY` | "No incidents on the board. Every scenario file failed validation, so there is nothing to run. Open Scenario problems to see which file and field to fix, then restart the server." |
| Inspector, nothing selected | `INSPECT` | "Select a node to inspect it. Press I, or click one." |
| Log empty | `LOG` | "Quiet. Nothing logged for Cache yet. Logs fill in as traffic flows." |
| Alerts empty | `PAGES` | "No pages. Enjoy it while it lasts." |
| Data, nothing saved | `EMPTY` | "No incidents resolved yet. Your first one is a click away." with a link `Go to the incident board` |
| Scenario load failure | `ERROR` | "Could not load the incidents. Check that the server is still running (node src/server.js), then try again." and `Try again` |
| Storage blocked | `NOTE` | "This browser is blocking storage, so progress will not be saved. You can still play and use Export on the Your data page." |
| Engine exception | `ERROR` | "The simulator hit an unexpected error. Your saved progress is safe. Reload to restart this incident; the seed is 48213." and `Reload` |
| Clipboard denied | `NOTE` | "Could not copy. Select the text above and copy it by hand." (text pre-selected) |
| Import rejected | `ERROR` | "Import rejected: <reason> Your saved progress was not changed." |
| Unknown incident id | `ERROR` | "That incident is not on the board. It may have been renamed, or its file failed validation." and `Back to the incident board` |

Hostile or very long content (scenario text, log lines, imported keys): rendered with `textContent` only; long titles truncate with an ellipsis in lists and wrap in headings; log lines wrap anywhere; no horizontal page scroll at any width; markup is shown literally.

## 15. Responsive behaviour

| Viewport | Layout |
|---|---|
| 1280x800 | Header 56 px. Grid: main column fills, rail 360 px at right, 16 px gaps. Main: map (fills remaining height, 360 px minimum) then the sparkline strip (5 tiles, 96 px). Rail: Pages (168 px, scrolls), Inspector (flex, scrolls inside), Actions (docked at the bottom). The whole play view fits the viewport with no page scroll. Map, Pages and Actions bounding boxes all lie inside 1280x800. |
| 1024 to 1279 | Same as above, rail 320 px. |
| 720 to 1023 | One column. Wide map template. Pages, Inspector, Actions, Metrics become tabs under the map. |
| 390x844 | Sticky 48 px mission bar (clock, pager lamps, pause) over a scrolling page. Tall map template (about 400 px). Tab bar `Pages`, `Inspect`, `Actions`, `Metrics` with 44 px targets under the map; tapping a node switches to Inspect; a firing alert adds a count badge to Pages but never steals focus. Sparklines in 2 columns. Dialogs full width minus 32 px. Buttons, tabs, rows at least 44 px high; inputs 16 px. No horizontal scroll (`scrollWidth <= 390`). |
| 320x640 | Same as 390; map nodes at least 136 px wide in 2 columns; mission bar clock and lamps stay on one row (lamps collapse to `Pager 4 / 6` text under 340 px); `scrollWidth <= 320`; only `pre` and the log scroll horizontally if needed (log wraps so it does not). |
| 200% text zoom | Header controls wrap to a second row; nothing clipped or overlapping. |

Target size: desktop at least 32 px high controls (24 x 24 absolute minimum), phone at least 44 px. Map node hit area is the whole node (at least 136 x 56).

## 16. What we refuse to do

1. No generic dark dashboard: no grid of identical rounded stat cards, no card inside a card, no gradient headline numbers.
2. No purple, violet or blue-to-purple gradients; no hue between 250 and 330 degrees appears in any token.
3. No emoji, anywhere (UI, share text, logs). Icons are our own SVG shapes.
4. No stock illustrations, mascots, atmospheric photos or decorative blobs.
5. No hover-only affordances: every hover preview (action cost, node detail) also appears on focus and in the text of the row; no tooltip is the only home of information.
6. No alarm colours alone: red, amber, green and blue always arrive with a shape and a text label (`OK`, `WARN`, `CRIT`, `RECV`).
7. No confetti or celebration spam on resolution; the calm clear-one-by-one sequence is the reward.
8. No decorative animation, no looping idle motion, no parallax, no blinking cursor.
9. No sound. No web fonts, no CDN, no analytics, no external image, no network call at runtime.
10. No tutorial wall, sign-in, cookie banner or modal on first load.
11. No pixel-only information: every value on the map is also available as text (node aria-label, text mode, inspector).
12. No auto-scaling charts that change the story; no truncated numbers without full value in the inspector.
13. No raw hex or ad-hoc pixel spacing in `app.css`.

## 17. How the design-loop evaluator scores this

Score each of 10 dimensions 0 to 10 from rendered evidence at 1280x800, 390x844 and 320x640 (screenshots and DOM probes), not from source alone. PASS requires every dimension at least 8, the total at least 90 of 100, and zero hard fails. Deduct 2 points per failed numbered check inside a dimension; a failed hard rule caps that dimension at 5.

| # | Dimension | Checkable evidence | Hard rule (cap 5) |
|---|---|---|---|
| 1 | Direction fidelity | The memorable detail is observable: retry-storm third-party edge `data-dot-rate` at least 3x baseline; stampede cache `data-pile` at least 12; with all nodes `ok`, at most 15% of non-background pixels are chromatic besides ok-teal; wordmark, lamps and replay present. | Map is only static boxes with no traffic encoding |
| 2 | Token discipline | `grep` of `app.css` finds 0 raw hex colours and 0 raw spacing in px outside token use; every colour in tokens; both themes defined; numeric tokens read by JS. | Any hex outside `tokens.css` |
| 3 | Colour and status | Contrast table rows 1 to 26 pass in both themes by the automated test; every non-ok status has shape plus label (DOM probe: icon `use` href and badge text); no token hue in 250 to 330 degrees; colour-blind simulation keeps four statuses distinguishable. | Any status shown by colour only |
| 4 | Typography | Computed body, prose, log and table text at least 16 px; labels at least 13 px; nothing under 12 px; mono tabular numerals on clock, metrics, logs (`font-variant-numeric`); debrief `max-width` 72ch; `document.fonts.size` is 0. | Any web font or font request |
| 5 | Motion | Every animation in the table in section 10 exists with the stated duration; transitions only 150, 200, 250 ms; 500 dots hold the frame budget; under reduced motion `data-dots` is 0, no animations run, metrics repaint on even seconds. | Any decorative or looping animation; any motion under reduced motion |
| 6 | Layout and responsive | The section 15 table holds: play view fits 1280x800 without page scroll; no horizontal scroll at 390 and 320; targets at least 44 px on phone; map text at least 12 px at every size. | Horizontal page scroll at 320 |
| 7 | States | All states in section 1 and section 14 are reachable and rendered as designed moments with specific text and a next action; partial scenario failure lists valid scenarios and the problems. | Blank screen or raw error in any state |
| 8 | Accessibility | axe (wcag2a, wcag2aa, wcag22aa) reports 0 violations on every screen and dialog; full keyboard play with visible 3 px focus; live regions as in `ux.md`; text mode completes an incident. | Any keyboard trap or invisible focus |
| 9 | Hierarchy and density | First viewport: map area at least 45% of the viewport, clock and lamps in the header, primary action reachable in one key; sparklines fixed-range; no nested cards. | Primary action not visible at 1280x800 |
| 10 | Polish and restraint | Debrief replay works (scrub updates mini map and narration within 100 ms); result card plus plain-text twin; hostile content renders literally; refusals in section 16 all hold; copy matches the voice rules in `ux.md`. | Any item from section 16 present |

The evaluator records each score with the artefact that proves it, and lists untested items (for example a missing browser) as untested rather than passed.
