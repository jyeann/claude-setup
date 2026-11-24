# Working agreement

- **English** for discussion with the owner and for docs. Product text shown to users stays in their languages.
- **Shared language.** `GLOSSARY.md` holds the project's terms; code and docs use them. A PR that introduces or changes a term updates the glossary. Hard-to-reverse decisions get an ADR in `docs/adr/`.
- **Align before building.** New work starts with questions (`grill-with-docs`) until scope and "done" are agreed; looks are chosen from rendered variations (`prototype`), never described in words.
- **Tracker.** Specs and tickets are GitHub issues (spec issue with ticket sub-issues, labels `afk` or `hitl`). No hand-written status files; status is generated from issues, PRs and CI.
- **Limits.** One ticket per session. At most 3 open PRs per repo. At most 5 live feature flags, each with an owner and a removal date in the issue that added it.
- **Spike before build.** A new external service (host, deploy target, engine, API) is proven against its real endpoint in a short spike before code depends on it. Steps only a human can do become a `wizard` script.
- **Prefer checks to rules.** A mistake that a type, lint, test or CI step could catch becomes that check, not a sentence in a rule file.

## Approvals
- **Owner decides categories, once:** spend above the agreed envelope, secrets and access, legal, scope. Record each in the project's owner-decisions file, written or approved by the owner.
- **Product gates:** the owner approves the spec (label `spec-approved`, including the chosen look) and accepts the result against the spec (label `accepted`).
- **Merge danger:** every PR states one-way or two-way door, blast radius and size (S up to 50 changed lines, M up to 200, L up to 500, XL above). One-way doors, L or XL, and anything touching auth, payments, data migrations, `.github/`, deploy, secrets, settings or published user text need a human. Agents merge nothing until the owner switches agent merges on after a shadow period.
- **Silence:** on a two-way item, proceed and log it; on a one-way item, wait.
