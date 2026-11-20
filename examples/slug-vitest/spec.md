# Spec: slug-vitest

## Goal
The same tiny slug library as `examples/slug-ts/` (read its `spec.md` for the exact interface of `slugify`, `isSlug` and `uniqueSlug`), written in TypeScript and tested with **Vitest**. It shows the gate with `"runner": "vitest"`.

Differences from `slug-ts`:
- Imports have no file extension (`'../src/slug'`); Vite resolves them. The erasable-syntax rule still applies, because the mutation step needs it (no `enum`, `namespace` or parameter properties).
- Tests use `it` and `expect` from `vitest`.
- Coverage comes from Vitest's own report, not from Node: the `testCommand` writes Istanbul JSON into `$VERIFY_COVERAGE_DIR`, which the gate sets and reads.

## Acceptance criteria
All in `acceptance/slug.acceptance.test.ts` (read-only for the generator).

## Out of scope
Non-Latin transliteration, JSX/`.tsx`, a build step, publishing.

## Verify command (definition of done)
`node .claude/harness/bin/verify.js` with `verify.config.json`. The project needs `vitest` and `@vitest/coverage-v8` as dev dependencies (the harness installs neither), and a `tsconfig.json` for the optional `typecheck` step; remove the `typecheck` key if you do not want it. For Jest, change `runner` to `"jest"` and use `npx jest --coverage --coverageReporters=json --coverageDirectory="$VERIFY_COVERAGE_DIR"` as the `testCommand`.
