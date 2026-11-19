---
description: Set, refresh or change the product's recorded design direction (docs/design/) with the design-director.
---

Parse $ARGUMENTS:
- `init` or empty on a project with no `docs/design/`: set up the direction from the brief.
- `refresh`: re-check dated references and propose updates.
- `review`: check current UI changes against the recorded direction and slop list.
- anything else: treat it as the user's change request and apply it.

Delegate to the `design-director` agent with `description: "[phase:look] ..."`, and follow the `design-direction` skill. Run `node .claude/harness/bin/design-lint.js` afterwards and report the result.
