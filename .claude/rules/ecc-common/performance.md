# Model and effort

Pick the model by the **task class**, not by a fixed ladder. Every delegated run states its class in its description next to the phase tag (`[phase:build][class:coding]`), so the run log shows why each model was used (the KPI roll-up groups by phase today; grouping by class is a follow-up).

| Class | Examples | Model, effort |
|---|---|---|
| coding | implement a ticket, refactor, debug, new tests through an interface | `opus`, medium (high for debugging, performance and self-verification) |
| judgement | spec review ("built what was asked?"), done/not-done, acceptance, architecture, security review, retro, grilling | `opus`, medium |
| check | CI or ticket status, checklist ticks, standards review against written rules, triage hygiene, merge-size scoring | `sonnet`, low or medium; escalate to `opus` when unsure, never guess |
| small-edit | typo, copy text, a config value, a one-line fix that an existing test covers | `sonnet`, low |
| report | summarise logs, daily check, changelog, generated status | `haiku`, low or medium |
| hardest | one-way-door architecture, sandbox or security design, multi-week planning, incident analysis | `fable`, high, **only after the owner approves** (below) |

Relative weight per million tokens (API list price, input/output): fable 8/40, opus 4/20, sonnet 2/10, haiku 0.10/0.50. On a subscription the same ratios show up as plan usage.

**Fable approval.** Open an issue labelled `needs-fable` with the task, why `opus` is not enough, and a token estimate. Wait. Run only after the owner approves on that issue; record actual tokens next to the estimate.

**Context.** One ticket per session. Start a fresh session past about 150k tokens instead of pushing on.

Effort controls reasoning depth (thinking cannot be disabled on Opus 5.5, Sonnet 5.5 or Fable): `effort:` in agent frontmatter, `/effort <level>`, `--effort`, or `CLAUDE_CODE_EFFORT_LEVEL` (which overrides frontmatter). Per-model defaults go in `modelSettings` in `~/.claude/settings.json`; the older `effortLevel` key does not apply to Opus 5.5 or newer. `MAX_THINKING_TOKENS` is ignored. Docs: https://code.claude.com/docs/en/model-config#adjust-effort-level

Measure instead of guessing when a verify gate exists: `node .claude/harness/bin/tune.js`. A stronger model at lower effort is often cheaper per finished task than a weaker one at high effort.
