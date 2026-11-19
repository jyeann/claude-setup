# Decision log: constellation

| # | Decision | Options | Chosen | Why | By |
|---|----------|---------|--------|-----|----|
| 1 | Which app and concept | habit tracker, redo an example, wiki; star sky, garden, dungeon | Wiki reimagined as Constellation (star sky) | Owner answered the up-front question | human |
| 2 | Design bar | direction only; direction plus design loop | Direction brief + design system first, then a screenshot-scored gan-design loop after the build | Owner asked for a superb design | human |
| 3 | Build, adopt or extend | build; extend wiki core | Extend: copy the wiki core into examples/constellation, replace the UI, add /api/sky | Keeps the reviewed security and vault behaviour; reuse is cheaper than re-deriving | product-scoper |
| 4 | Harness run | start a Stop-hook run; call verify.js directly | Call verify.js directly | The earlier wiki run is still marked active and only a human can switch it off; two products cannot share a run | orchestrator |
| 5 | ux.md "decisions to confirm" 1-5 (ring fires on create, random star shows card, tap shows card, Tab ring of 60 stars, daylight is system preference only) | accept; change | Accept all | None conflicts with soundness | orchestrator |
| 6 | Check 39 garbled clause | leave; fix | Fixed: dock controls top >= innerHeight - 60 | Intent stated by the author | orchestrator |
| 7 | Lock name keeps wiki and Constellation apart? | different lock names only; also refuse to start when a live `.wiki.lock` exists | Refuse to start when a live `.wiki.lock` exists (and vice versa is not our concern) | Different names alone let both run on one vault | architect, orchestrator |
| 8 | Two wiki acceptance tests cannot pass unedited (empty vault vs sample seeding; testid source) | edit wiki's; port a copy | A separate test-owner agent ports the suite into examples/constellation/acceptance before the build (env `CONSTELLATION_SAMPLES=off` for the SC1-style checks) | Acceptance stays read-only for the builder; the wiki's own suite is not touched | architect, orchestrator |
| 9 | Twinkle stagger with 6 slots cannot always hold in dense clusters | add slots; stars without a free slot do not twinkle | Stars without a free slot do not twinkle; unit test covers twinkling stars only | Keeps the motion calm and the rule testable | architect |
| 10 | Draw-call budget vs per-star alpha | exact alpha; bucketed | Bucket cores by colour and 4 alpha steps (at most 32 fills) | Keeps 60 fps at 1,000 stars | architect |
| 11 | Samples after removal and restart | reseed each start; seed once per vault | Seed once per vault (marker in the sidecar) | Removed samples must not come back | architect |
| 12 | Non-loopback Host | JSON error everywhere; HTML permission page on non-API paths | HTML page on non-API paths, JSON `bad_host` on /api | Matches ux.md copy and the API contract | architect |
