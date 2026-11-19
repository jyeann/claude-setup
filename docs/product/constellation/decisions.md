# Decision log: constellation

| # | Decision | Options | Chosen | Why | By |
|---|----------|---------|--------|-----|----|
| 1 | Which app and concept | habit tracker, redo an example, wiki; star sky, garden, dungeon | Wiki reimagined as Constellation (star sky) | Owner answered the up-front question | human |
| 2 | Design bar | direction only; direction plus design loop | Direction brief + design system first, then a screenshot-scored gan-design loop after the build | Owner asked for a superb design | human |
| 3 | Build, adopt or extend | build; extend wiki core | Extend: copy the wiki core into examples/constellation, replace the UI, add /api/sky | Keeps the reviewed security and vault behaviour; reuse is cheaper than re-deriving | product-scoper |
| 4 | Harness run | start a Stop-hook run; call verify.js directly | Call verify.js directly | The earlier wiki run is still marked active and only a human can switch it off; two products cannot share a run | orchestrator |
| 5 | ux.md "decisions to confirm" 1-5 (ring fires on create, random star shows card, tap shows card, Tab ring of 60 stars, daylight is system preference only) | accept; change | Accept all | None conflicts with soundness | orchestrator |
| 6 | Check 39 garbled clause | leave; fix | Fixed: dock controls top >= innerHeight - 60 | Intent stated by the author | orchestrator |
