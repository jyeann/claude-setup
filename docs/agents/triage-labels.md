# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker. `afk` and `hitl` come from `.claude/rules/ecc-common/working.md`, so there is one label per role, not two.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `afk`                | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `hitl`               | Requires a human                          |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Owner gates are separate labels, applied only by the owner: `spec-approved` (spec issue, including the chosen look) and `accepted` (spec issue, result accepted against the spec).
