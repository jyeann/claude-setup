# Spec: slug-ts

## Goal
A tiny TypeScript library that turns titles into URL slugs. It runs on Node's native type stripping (Node 22.18+ / 23.6+), with no build step and no runtime dependencies.

## Interface (exact)
`src/slug.ts` exports, with explicit parameter and return types:

| Export | Behaviour |
|---|---|
| `slugify(title: string, options?: { maxLength?: number }): string` | lower-case; accents removed (`Crème` -> `creme`); every run of non-alphanumeric characters becomes one `-`; no leading or trailing `-`; if `maxLength` is set the result is cut to that length and a trailing `-` is dropped. Throws `TypeError` for a non-string title and `RangeError` if `maxLength` is not a positive integer. |
| `isSlug(value: string): boolean` | true only for non-empty strings made of `a-z`, `0-9` and single `-` between them |
| `uniqueSlug(title: string, taken: ReadonlySet<string>): string` | `slugify(title)`, or `slug-2`, `slug-3`, ... for the first value not in `taken`; an empty slug becomes `untitled` first |

Use only erasable TypeScript syntax (types, interfaces, `import type`, `as`); no `enum`, `namespace` or parameter properties, because Node strips types and does not transform them. Import sibling files with the `.ts` extension.

## Acceptance criteria
All in `acceptance/slug.acceptance.test.ts` (read-only for the generator).

## Out of scope
Non-Latin transliteration, JSX/`.tsx`, a build step, publishing.

## Verify command (definition of done)
`node .claude/harness/bin/verify.js` with `verify.config.json`. Its `typecheck.command` (`npx tsc --noEmit`) needs a `tsconfig.json` and `typescript` installed in the project (a `devDependency`); remove the `typecheck` key if you do not want that step. The harness itself never installs or bundles `tsc`.
