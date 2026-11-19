# Decision log: incident-sim

| # | Decision | Options | Chosen | Why | By |
|---|----------|---------|--------|-----|----|
| 1 | Which app and concept | habit tracker, redo an example, wiki, system-design-101; boss-fight incident game, architecture playground, metro map | system-design-101 reimagined as an Incident Simulator game | Owner answered the up-front question | human |
| 2 | Design bar | direction only; direction plus design loop | Direction brief + design system first, then a screenshot-scored gan-design loop after the build | Owner asked for a superb design | human |
| 3 | Where it lives | system-design-101 repo; claude-setup/examples | claude-setup/examples/incident-sim, self-contained, linking to the guides | Same CI/gate as other examples; keeps the upstream guide repo untouched | orchestrator |
| 4 | Licence of the source guides | brief said CC BY-NC-SA 4.0; LICENSE.md says CC BY-NC-ND 4.0 | CC BY-NC-ND 4.0 (the source repo's own wording). No guide text or images are copied or adapted (ND forbids derivatives); only original scenario text, links and attribution. Non-commercial only | Scoper's note was wrong; read from LICENSE.md and README | orchestrator |
| 5 | Build, adopt or extend | build; extend | Build | Nothing else is a solo offline incident game | product-scoper |
| 6 | Harness run | start a Stop-hook run; call verify.js directly | Call verify.js directly | The earlier wiki run is still marked active; two products cannot share a run | orchestrator |
| 7 | Test-only dependency `@axe-core/playwright` | allow in test tooling; inject axe-core like the wiki QA | Inject axe-core into the page from a scratch install outside the repo, as in the wiki QA; no dependency added | Zero npm dependencies stays true, including dev | orchestrator |
| 8 | Schema title cap (ux 80 chars vs check 37 needing 300) | 80; 300 | 300 | Check 37 needs a valid 300-character title | architect |
| 9 | Progress format additions | as ux.md; add `actions[].node` and a `scenarioHash` per run | Add both | Detects a changed scenario file and keeps the replay exact | architect |
| 10 | Licence text in brief/ux/design-direction | SA; ND | ND everywhere (replaced by the orchestrator) | Source LICENSE.md says CC BY-NC-ND 4.0 | orchestrator |
| 11 | Remaining ux.md conflicts (design.md section 17, seven minor edits) | edit ux.md; let the spec win | design.md wins; the planner lists them as resolved ambiguities in spec.md | ux.md says engine/server details are decided by design.md | orchestrator |
