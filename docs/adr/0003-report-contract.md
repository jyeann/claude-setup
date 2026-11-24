# The verify gate judges standard reports under trust rules; it does not trust them

The verify gate measured everything itself and only understood `node:test` output, so every new stack would need its own hand-written measurer. We adopt a **report contract**: each stack's own mature tools run the tests and write standard reports, and the gate reads them and decides. Test results come as **JUnit XML** (this ADR, ticket #57); coverage as **lcov** and mutation as the **mutation-testing-elements JSON schema** follow under the same rules (#58, #59). An **adapter** setting in `verify.config.json` chooses how a project is measured; `node` (the default) keeps the built-in `node:test` measuring unchanged.

The gate stays the judge, not the report. The trust rules:

1. **A non-zero exit fails**, whatever the report says.
2. **The gate owns the report location.** A fresh directory outside the project is created after the run starts, for every run (main run, each replicate, holdout, journeys), and deleted after reading. The gate builds the reporter flags itself and appends them to the command; a project's config never chooses the path. Where a tool has no flag for the path (Playwright), the gate sets the variable it reads (`PLAYWRIGHT_JUNIT_OUTPUT_FILE`) only in that one child process (spike amendment 2 on #55).
3. **Only a report written during the run counts.** A missing file, a file modified before the run started (to the whole second, for filesystems with coarse times), or a file that does not parse fails the step, and the message names the flags the gate appended.
4. **Two witnesses must agree.** The JUnit totals (tests, failures, skipped) must equal the runner's own stdout summary, or the gate fails showing both and trusts neither.
5. **Holdout stays hidden.** For the hidden holdout only counts are printed; trust failures are worded without report content, the command or its paths.

Skipped and todo tests fail as before, journey ids are matched against passing JUnit test names, and failing tests are printed as `not ok N - <name>` lines in the existing "Failing tests" block, so the no-progress breaker and failure clustering read them unchanged.

## Considered Options

- **Keep writing a measurer per language**: full control, but every stack is a rewrite of coverage, mutation and output parsing, and the result is weaker than the tools each ecosystem already trusts. Rejected.
- **Trust the project's reports as written**: simplest, but a stale, hand-written or redirected report would pass a broken build. Rejected; the trust rules above exist for this.
- **Parse each runner's console output only**: no files to manage, but console formats change between versions and carry no per-test status we can rely on. Used only as the second witness.
- **An XML library**: the harness stays dependency-free, so `lib/reports/junit.js` is a small reader for the subset runners write and refuses anything else.

## Consequences

- Adding a stack means an adapter (flags in, report out, summary line), not a rewrite; a stand-in runner written in shell proves the gate is not tied to JavaScript.
- Until the lcov and mutation readers land, the `junit` adapter prints coverage, test quality and mutation as "not available" and lists them as not checked on every run; it is a weaker gate and says so.
- Hard to reverse: once products are built against the contract, changing report formats or loosening a trust rule changes every product's gate. Tightening stays cheap.
- Remaining risk: test code runs with the same rights as the tool, so it could write a consistent fake report and a matching summary. The gate-owned path outside the project and the protected config make that deliberate cheating rather than an accident; an independent review is still the backstop.
