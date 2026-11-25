# CI runs the full gate only on ready PRs; a push to main gets the fast checks

On 2026-11-25 the owner's personal account ran out of GitHub Actions minutes: every job ran on every PR event and again on every push to `main`. On gachi-market that day 338 billed minutes went to 20 runs; 112 were the full gate re-running after merges on code its PR had already passed, and 44 were runs cancelled by a newer push (#105). We split CI into **fast checks**, which run on every event, and the **full gate**, which runs only where it decides a merge.

## The rules

| Event | Fast checks | Full gate |
|---|---|---|
| Draft PR (opened, pushed to) | run | job skipped |
| PR not a draft: `opened`, `reopened`, `synchronize`, `ready_for_review` | run | runs; its steps skip on a docs-only change |
| Push to `main` (a merge) | run | job skipped |
| `workflow_dispatch` | run | runs, never docs-only |

- Fast checks: in the template `protected-files` (PRs only, as before) and `secret-scan`; in this repository `harness-tests` and `secret-scan`.
- The template has no separate typecheck or unit-test job: its tests run only inside `verify`. A draft PR and a push to `main` in a template project therefore run no tests. That is deliberate here, because a fast test job costs minutes on every event and adds a job name. A project that wants one adds a job such as `unit` (for example `verify.js --fast`) and adds it to its ruleset in the same PR. This is left as an owner decision on #105.
- Full gate: in the template `verify`; in this repository `gate-retro-board`, `gate-slug-react` and `eval-kit-selftest`. Each has the job condition `github.event_name == 'workflow_dispatch' || (github.event_name == 'pull_request' && !github.event.pull_request.draft)`.
- Job names do not change, so every ruleset's required checks keep matching. `concurrency` with `cancel-in-progress` stays for PRs.
- Agents open PRs as drafts and mark them ready when their work is done (CI README, `git-workflow.md`, the PR steps in the runbook and `/harness-improve`).

## Why skipping after the merge is safe

The ruleset sets `strict_required_status_checks_policy: true`: a PR merges only when it is up to date with `main` and its required checks passed on that head. With strict checks and no merge queue, the tree that lands on `main` is the tree the gate passed, so a second full run only repeats a result. `workflow_dispatch` still runs everything on demand, for example after a ruleset change or a direct admin push.

## Why no mergeable PR passes on a skipped heavy job

GitHub counts a skipped required check as passing.

- **Drafts.** A heavy job is skipped on a draft, and a draft cannot merge. Marking it ready fires `ready_for_review`, whose run reports the heavy jobs again on the same head commit, and every later push (`synchronize`) does too. A ready PR always has a run of its latest head with the heavy jobs in it, unless that run was cancelled, which fails the check.
- **Push and dispatch** are not PR events, so they do not decide a merge.
- **Docs-only** is the one designed skip; see below. The job still runs and reports success with its gate steps skipped.

The workflow tests (`test/ci-triggers.test.js`) read both workflow files and evaluate each job's `if:` for a draft, a ready PR on each event, a push to `main` and a manual run, and fail if a required check does not report on a mergeable PR.

## The docs-only rule, and why a mixed change can never take it

The skip is computed **inside each heavy job**, by a step (`bin/docs-only.js`), not by `paths-ignore` on the trigger. `paths-ignore` would stop the whole workflow, so a required check never reports and the PR is blocked, and it cannot exclude docs that are gate inputs.

- The step lists every file the PR changes (`git diff --name-only --no-renames origin/<base>...HEAD`, NUL-separated). A move lists the old path too, so moving code into `docs/` is not docs-only.
- A file is documentation when it ends in `.md`, or is under `docs/` with a documentation extension, **and** it is not a gate input: not under any protected path (`.claude/`, `.github/`, `acceptance/`, `spec.md`, `verify.config.json`, `.harness-protected`, plus the base branch's `.harness-protected` list and adapter configs, read from the base so the PR cannot shrink them), and not under a path the workflow names with `--keep`. This repository passes `--keep testbench/`, because `eval-kit-selftest` grades the Markdown golden artifacts and prompts under `testbench/`.
- The change is docs-only only when **every** changed file is documentation and there is at least one. One non-doc file means the full gate.
- It fails closed. The later steps carry `if: steps.scope.outputs.docs_only != 'true'`, so they run unless the step wrote exactly `true`; a skipped step (manual run) or a `false` runs the gate. An error in the step (a bad ref, a git failure) exits 2 and fails the job, so the required check is red and blocks the merge; a re-run is needed. The step runs only on `pull_request`, so a manual run never skips.
- Under `docs/`, only documentation extensions count (`.md`, `.mdx`, `.markdown`, `.txt`, `.rst`, `.adoc` and images); `docs/site.js` or `docs/package.json` runs the gate. A project whose tests read Markdown fixtures (for example `tests/fixtures/*.md`) lists that path in `.harness-protected` or passes `--keep`.

Trust: the step runs from the PR's tree, like the rest of the workflow. A PR that edits the classifier changes `.claude/`, which is never docs-only, and which `protected-files` flags for a human (see the CI README's Limits: workflow files come from the PR).

## Considered options

- **`paths-ignore` on the trigger.** No runner at all for a docs PR, but the required checks never report and block the merge, and gate inputs cannot be excepted. Rejected.
- **A separate `changes` job that the heavy jobs `need`.** It saves the runner minute each heavy job spends on a docs-only PR, but costs a minute on every ready-PR event, adds a job name, and a failed `changes` job skips its dependants, which counts as passing. Rejected: code PRs are the common case.
- **Run the full gate on `main` after merges as a safety net.** That is the 112 minutes a day this ADR removes; strict checks make it redundant.
- **Skip on drafts with a label instead of the draft flag.** Anyone with triage rights can add a label; the draft state is the PR author's own signal and blocks merging by itself.

## Consequences

- A draft PR costs only the fast checks; the full gate is paid when a PR is ready and again on each later push to it. Agents should push their work, then mark the PR ready, rather than push many small commits to a ready PR.
- Each heavy job on a docs-only PR still uses a runner for about a minute (checkout and the docs-only step).
- Existing projects get the new triggers by copying the template again (CI README). The required checks do not change.
- Expected saving on gachi-market's 2026-11-25 pattern: from 338 to about 120 to 150 billed minutes a day (estimate from #105).
- **Measured saving:** to be filled in from the first real PRs after the change. The proving runs on the PR for #105 are recorded on that issue; the per-run and monthly measurement is the companion spec #106.
- Two-way door: reverting the workflow files restores the old triggers.
