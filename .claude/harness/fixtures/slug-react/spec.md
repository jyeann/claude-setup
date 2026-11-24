# Spec: slug-react

## Goal
A one-page React app (Vite + TypeScript) that shows the URL slug of a title as it is typed. It is the fixture that proves the `vitest-stryker` adapter against the real gate (#60): Vitest for unit tests and coverage, Stryker (vitest runner) for mutation, Playwright for the journey, `tsc --noEmit` as the required type check.

## Interface (exact)
`src/Slug.tsx` exports:

| Export | Behaviour |
|---|---|
| `slugify(title: string): string` | lower-case; accents removed (`Crème` -> `creme`); every run of characters other than `a-z0-9` becomes one `-`; no leading or trailing `-` |
| `isLong(slug: string, max = MAX_SLUG_LENGTH): boolean` | true only when `slug` is longer than `max` |
| `MAX_SLUG_LENGTH` | `40` |
| `Slug` | an input labelled "Title"; below it the slug (`data-testid="slug"`), or "Type a title to see its slug" while it is empty; an alert "Slug is longer than 40 characters" while `isLong` |

`src/main.tsx` exports `mount(container)`, which renders `Slug` into `container` and throws `missing #root element` for `null`, and mounts the app into `#root` when the page has one.

## Acceptance criteria
- Unit tests in `tests/` (Vitest, jsdom); the held-out set in `hidden-tests/` runs only in the gate's holdout step.
- Journey `J1` in `ux.md`, walked by `journeys/slug.spec.ts` (Playwright) against the built app served by `server.mjs`.

## Verify command (definition of done)
From this directory, after `npm ci`: `CLAUDE_PROJECT_DIR=$PWD node ../../bin/verify.js`. TypeScript is pinned to 6 (TypeScript 7 breaks Stryker 10.1.1, spike #56). The journey needs Chromium for Playwright 1.63.0 (`npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to a browser already installed).
