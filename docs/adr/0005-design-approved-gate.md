# A third owner gate, design-approved, before the system is designed

Until spec #148 the look was chosen in phase 4a and approved together with everything else at `spec-approved`. Design review is the slowest owner step and the one most often sent back, so each design round held up, and could void, the approval of scope and system design. We add a third **owner gate**, `design-approved`, between the experience phase (`ux`) and system design (`design`). Its phase, `look`, renders look variations and the key screens with the chosen look onto one page, `design-approved-page.md`, with the rendered files in `screens/` beside it. The gate works exactly like the other two: a label on the spec issue that only the owner adds, layer verdicts, redirects (an impression redirect here redoes only the `look` phase), at most 3 rounds, and an approval tied to the hashes of the page and the screens. `spec-approved` no longer asks about the look: its page links the approved design.

## Considered Options

- **Keep the look inside `spec-approved`**: no new gate, but every design round keeps blocking scope and system design, which is the problem the owner raised. Rejected.
- **A design gate after system design**: the system would be planned before the screens it serves are settled, and a look redirect could void system design. Rejected.
- **A separate design issue for the gate**: the owner would review two issues for one product. Rejected: the spec issue is opened in the `look` phase and carries all three gate labels.

## Consequences

- The spec issue is opened earlier, in the `look` phase, because the gate's label goes on it; phase 4a completes it.
- A product whose kickoff choice is "none; standard components throughout" has no `look` phase and no `design-approved` gate; its look is approved at `spec-approved` as before.
- Whether a run has the gate is decided once, at its first check by a harness that has it, and kept in the run's gate state. A run already past the experience phase when its harness is updated (system design written, an approval given, or its spec issue pinned) keeps its old walk: it is never sent backwards and no approval is voided. A later edit of the kickoff file only warns.
- A redirect at `design-approved` on a layer whose phase comes after the gate (approach, correctness, craft) is not read, as correctness and craft are not read at `spec-approved`.
- The gate-label guard, the Stop hook's waiting line and `setup-repo.js` all know the third label. A product set up before this change is asked once to run `setup-repo.js` again for the new label before its next run starts.
- Not decided here: carrying on with other work while the gate waits, change runs, freezing the screens for the build, and how strictly the build is held to them (tickets #151 to #154 of spec #148). ADR-0002's "exactly two owner gates" now reads three.
