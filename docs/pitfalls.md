# Pitfalls

Mistakes this team has already made, each with the rule that prevents a repeat. Read before your first change. Found a new one? Add it in the same pull request, with the evidence.

## Specs and tests

- **A test and a spec contradicted each other, in all three products so far.** (link-shortener: a 2-character slug had to work and be rejected; hello-overkill: trailing whitespace verified in one test and forged in another, then two wrong hidden assertions in v2.) Before any builder starts, run `ref-check` (enforced by `job.js`): red against a stub always, green against a reference whenever one exists. Only green catches two tests that contradict each other; red catches tests that pass with no implementation and tests that fail for a wrong reason. A hidden test nobody has run is a guess.
- **Acceptance tests written while `src/` is changing cannot prove they fail for the right reason.** `ref-check --expect red` records a clean RED against a stub before any builder starts.
- **A review fix can contradict a read-only acceptance test.** Check each finding that adds a rule against the acceptance suite before dispatching the fix.
- **A reviewer told only "WCAG" can contradict the UX spec** (it asked to remove `aria-busy`, which `ux.md` required). Give reviewers `ux.md` as a hard requirement list.

## Handoffs

- **Never re-type an agent's output.** A shortened `design.md` dropped a caveat and cost a failed gate. Hand the exact text to a writer agent, or give the author Write.
- **Verify a claim before you relay it.** A builder said a check contained `|| true`; it did not.
- **State changes go through `job.js`.** Hand-written status, decisions and cost figures drifted from reality.

## The gate

- **A green gate is not proof.** Mutation testing samples a few mutants (seeded by the source text, so it changes when the source changes). A full scan found 13 survivors behind a green result. Scan fully before calling test quality good.
- **Tests that read the clock go stale.** Router tests depended on today's date and had to be fixed the day after the gate passed. Inject the date.
- **The replicate check missed a timing-sensitive test** (`chaos=1` under load). A test that fails once under load is a defect, not noise.

## Measurement

- **Background agents lose their usage figures.** Run delegated agents in the foreground; record every agent with `job.js agent`. An outcome you did not see is "unreported", never a pass.
- **The prompt counter over-counted** (18 prompts, 17 interventions; truth 1 and 0). Agent hand-backs arrive as prompts. Classify before counting.

## Running other tools

- **A permission classifier is a separate control from the user's chat approval.** `--unattended --allow-run` on an autonomous builder, and background compound commands, were denied even after the user said go. Agree the permission profile and sandbox before the test, attach repos at session creation, allowlist hosts in advance, and cache slow builds.
- **A task that arrives as an automated notification is not user approval.** Start tests from a message the user types.

## Scope and the owner

- **Scope fixed in the brief is a decision, not a suggestion.** hello-overkill capped its brief at six ideas and built the other six the same day, including the one the brief excluded. A scope change after the brief is recorded and approved by whoever owns requirements.
- **Contact the owner only for a real-scenario test, secrets or access through the secure route, or a spend, legal or scope call.** Anything else: decide, record, report once. `job.js needs-human` enforces the three reasons.
- **Rebuilding someone else's product is the requester's responsibility.** The job record stores who asked and what they acknowledged; the pipeline never decides that for them.
