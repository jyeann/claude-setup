# Owner gates give a verdict per judgement layer, and a redirect goes back only to the failed layer's phase

The two owner gates (spec-approved, accepted) can only wait for a label, so a "no" says nothing about what was wrong and nothing defines what is redone. We judge every product on five **judgement layers** (problem, impression, approach, correctness, craft). At both owner gates the owner gives one **layer verdict** per layer. A verdict of redirect names the failed layer and a reason, and the pipeline goes back only to that layer's phase: problem to discover, impression to ux, approach to design, correctness or craft to build. A gate allows at most 3 redirect rounds, then the run stops and reports. An approval is tied to the hash of the files it approved, so a later change voids it. The **progress summary** published at about 70% of tickets done is not an owner gate and never blocks: silence means carry on, and an owner comment is a **progress response**, not an intervention.

## Considered Options

- **Single yes/no gate**: simple, but "no" does not say which layer failed, so the run cannot know what to redo and the retro cannot count where the process goes wrong. Rejected.
- **Redirect restarts the whole run**: easy to implement, but a wrong look would trigger a rebuild of everything, which is the most expensive way to fix a small problem. Rejected.

## Consequences

- Each redirect makes only the named layer's phase incomplete again; the file-hash freeze is reset only for that phase's outputs.
- Rounds are counted per gate in the run state; a 4th redirect stops the run and reports instead of returning a phase, so a disagreement becomes a conversation, not a loop that burns budget.
- Changing an approved file voids the approval, so the owner never approves one version and receives another.
- A new idea raised at `accepted` is not a redirect: it becomes a new spec issue, and the current result is judged against its own spec.
- The progress summary adds no gate: the build never waits on the owner for a two-way decision, and "Owner gate" stays at exactly two.
- Terms are defined in `GLOSSARY.md`; the pipeline, KPI and retro changes follow in later tickets of spec #44.
