# TASKS: hello-overkill
Format: id | task | blocked-by | AFK/HITL
- T1 | config.js, rate-limiter.js, security.js, validation.js + unit tests | - | AFK
- T2 | greetings.js (10x4 catalogue), chaos.js, battle.js + unit tests | - | AFK
- T3 | certificates.js (sign/verify), store.js (atomic persist, streaks) + unit tests | T1 | AFK
- T4 | hello.js, router.js, server.js (core contract byte-exact, 429, chaos, 413) | T1,T2,T3 | AFK
- T5 | page.js SPA with all 38 data-testids, CSP hashes; catalogue copy test | T4 | AFK
- T6 | verify.js green incl. holdout | T5 | AFK
- T7 | review, Playwright QA, docs, retro | T6 | AFK
