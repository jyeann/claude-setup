# Spike: gate adapter reports (Vitest, Playwright, Stryker)

Ticket #56, for spec #55. Run on 2026-11-24 in a throwaway project outside the repository: one `.tsx` React component (`src/Slug.tsx`: `slugify`, `isLong`, an untested `double`, and a `Slug` component), tests in `tests/`, one Playwright journey, built app served by a small Node server. Only the captured reports and this note are committed.

**All times below were measured on this machine** (Linux container, 4 CPUs, 15 GB RAM, Node 22.23.5, npm 10.9.9), not on a CI runner.

## Tool versions

| Tool | Version |
|---|---|
| vite / @vitejs/plugin-react | 8.3.8 / 6.3.0 |
| vitest / @vitest/coverage-v8 | 5.1.1 / 5.1.1 (jsdom 31.0.1) |
| @stryker-mutator/core, vitest-runner, typescript-checker | 10.1.1 |
| @playwright/test | 1.63.0 (pre-installed Chromium build 1243) |
| react / react-dom | 19.3.1 |
| typescript | 6.0.3 (7.0.2, the current `latest`, breaks Stryker: see contradiction 5) |

## Captured reports

In `.claude/harness/test/fixtures/reports/`; machine paths replaced by relative ones (project root `.`, report directory `../reports`, gate config `../gate`).

| File | What it is |
|---|---|
| `vitest-pass.junit.xml` | Passing run: 3 passed, 1 skipped |
| `vitest-pass.lcov.info` | lcov of that run with `--coverage.include='src/**'` (`src/main.tsx` present at 0%) |
| `vitest-fail.junit.xml` | Same tests plus one failing test: 5 tests, 1 failure, 1 skipped; exit code 1 |
| `vitest-fail-no-include.lcov.info` | lcov of the failing run without `--coverage.include`: `src/main.tsx` is missing |
| `stryker-mutation.json` | mutation-testing-elements schema 1.0, no checker: 24 mutants, Killed 9, Survived 8, Timeout 3, NoCoverage 2, Ignored 2 |
| `stryker-mutation-tscheck.json` | Same run with `--checkers typescript`: Killed 7, Survived 7, Timeout 3, NoCoverage 1, Ignored 2, CompileError 4 |
| `playwright.junit.xml` | One journey, `J1 typing a title shows its slug`, passed |

Report facts the parsers need:
- Vitest JUnit: the root `<testsuites>` has `tests`, `failures`, `errors` but **no `skipped`**; skipped counts are only on each `<testsuite>`. Test names are `describe > test` (`&gt;` escaped), `classname` is the test file. Stdout summary: `Tests  1 failed | 3 passed | 1 skipped (5)`.
- Playwright JUnit: root has `skipped`; `name` is the test title, `classname` the spec file. Stdout (`line` reporter): `1 passed (1.7s)`.
- lcov `SF:` paths are relative to the project root (`SF:src/Slug.tsx`).
- Stryker JSON: `files["src/Slug.tsx"].mutants[].status`; `Ignored` mutants carry the disable comment as `statusReason` (`hint copy is not logic`); all 3 Timeouts here were `Hit limit reached` (Stryker's infinite-loop counter), not wall-clock timeouts. The report also holds the effective `config` (`mutate`, `incremental`, `checkers`), so the gate can confirm its flags were honoured. Stryker exits 0 whatever the score (`thresholds.break` is null); the score must come from the report.

## Commands and flags (no project config edited)

Vitest (tests, JUnit, lcov):
```
npx vitest run --reporter=default --reporter=junit --outputFile.junit=<dir>/junit.xml \
  --coverage.enabled --coverage.provider=v8 --coverage.reporter=lcovonly \
  --coverage.reportsDirectory=<dir>/coverage --coverage.include='src/**' --coverage.reportOnFailure
```
Stryker (no CLI flag exists for the JSON report path, so a gate-owned config file outside the project is passed as the positional argument; it holds only `{"jsonReporter":{"fileName":"<dir>/mutation.json"}}`):
```
npx stryker run <gate-dir>/stryker.gate.json --testRunner vitest --mutate src/Slug.tsx \
  --reporters json --checkers "" --tempDirName <gate-dir>/stryker-tmp
```
`--mutate` also takes ranges (`src/Slug.tsx:3-9`); `--checkers typescript` turns the checker on; `--incremental` is off unless passed. An absolute `--tempDirName` keeps Stryker's sandbox outside the project.

Type check: `npx tsc --noEmit -p tsconfig.json`. Build: `npx vite build`.

Playwright (JUnit file path has no CLI flag; only an environment variable or config):
```
PLAYWRIGHT_JUNIT_OUTPUT_FILE=<dir>/junit.xml npx playwright test --reporter=junit,line --output=<dir>/artifacts
```
The journey ran against `vite build` output served by `server.mjs` (Playwright `webServer`), which exits 0 on SIGTERM (checked: `kill -TERM` gave exit 0).

## Measurements (measured on this machine)

| Step | Wall time |
|---|---|
| Stryker, 24 mutants, no checker (3 runs) | 9.7 s, 9.8 s, 10.0 s |
| Stryker, 24 mutants, `--checkers typescript` (3 runs) | 16.4 s, 16.7 s, 17.0 s (+68%) |
| `npm ci` with an empty npm cache (219 MB `node_modules`) | 6.0 s |
| `tsc --noEmit` | 1.2 s |
| Vitest with coverage | 1.5 s |
| `vite build` + Playwright journey | 2.5 s |
| Stryker (no checker) | 10.2 s |
| **Total install + type check + tests + journey + mutation** | **21.4 s** |

**CI-style minutes (estimate, not measured on a runner):** add checkout and `setup-node` (about 10 s) and a Chromium install, which this machine skipped because a browser is pre-installed (`npx playwright install --with-deps chromium` usually takes 30 to 90 s on a GitHub Linux runner). Stryker scales with CPUs, so a 2-vCPU runner roughly doubles its 10 s. Expected: about **1 to 2 minutes per run**, billed as **2 minutes** (GitHub rounds each job up). The TypeScript checker would add about 7 to 15 s.

## Recommendation: Stryker's TypeScript checker

**Off by default.** On this sample it cost +68% Stryker wall time (about 7 s on 24 mutants) and only reclassified 4 mutants as CompileError, which the score excludes; the score moved from 54.5% to 55.6%. The type check that #55 requires is cheaper as one `tsc --noEmit` before the tests (1.2 s). Keep the checker as an opt-in for a later full run at `accepted` if the owner wants it.

## Contradictions with #55, and what the spec should say instead

1. **Stryker's JSON report path cannot be set by a flag.** #55 says the gate appends reporter, output and mutate flags on the command line. The spec should say: the gate writes its own Stryker config file into the gate-owned report directory (containing `jsonReporter.fileName`) and passes it as the positional config file, plus `--testRunner`, `--mutate`, `--reporters json`, `--checkers` and `--tempDirName` flags. A positional config replaces the project's Stryker config, so the project's `stryker.conf.*` is not read in the gate run at all.
2. **Playwright's JUnit path needs an environment variable.** #55 says "flags appended by the gate, no env var". The spec should allow `PLAYWRIGHT_JUNIT_OUTPUT_FILE`, set only in the journey command's child environment, together with `--reporter=junit,line --output=<dir>`.
3. **Stryker's sandbox lives inside the project by default** (`.stryker-tmp`, left behind after a crashed run here). The spec should add `--tempDirName <gate-dir>/...` (absolute paths work) so nothing from the gate run stays in the project.
4. **Vitest leaves untested files out of lcov** unless `--coverage.include` is passed (`src/main.tsx` was missing), and writes no lcov at all when a test fails unless `--coverage.reportOnFailure` is passed. The spec should say the gate passes `--coverage.include=<srcDir>/**` for each `srcDir` and `--coverage.reportOnFailure`; an entry file such as `main.tsx` then shows as 0% and needs a test or a printed `coverage.exclude`.
5. **TypeScript 7 (npm `latest`) breaks Stryker 10.1.1** even with no checker: `TypeError: ts.parseConfigFileTextToJson is not a function` in Stryker's tsconfig preprocessor, because TypeScript 7 has no JavaScript API. #55 does not name a TypeScript version. The spec should say the `vitest-stryker` fixture pins `typescript` to `^6` until Stryker supports 7, and the adapter catalogue lists this limit.
These five amendments are recorded on #55 in the comment "Spec amendments from the spike"; tickets #57–#61 follow them.

Confirmed as #55 assumes: Killed, Survived, Timeout, NoCoverage, Ignored and CompileError were all produced (RuntimeError was not); Playwright has a JUnit reporter; journey ids can be matched from the JUnit `name`; a non-zero exit is what Vitest returns on a failing test; `--incremental` is off unless asked for.
