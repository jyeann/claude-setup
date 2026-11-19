# Spec: hello-overkill

Build exactly what `docs/product/hello-overkill/design.md` specifies (interface, config, data model, security) and satisfy `docs/product/hello-overkill/ux.md` (38 data-testids, hash routes) and the 11 success criteria in `brief.md`.

Zero runtime dependencies, Node 22 built-ins only. Start: `node src/server.js`; prints `listening on <port>` once accepting connections; exits 0 on SIGTERM/SIGINT (needed for coverage). House style: copy `examples/link-shortener/src/rate-limiter.js`, follow its server/store patterns.

Done = `verify.js` exits 0 (acceptance + unit tests, coverage, test quality, mutation, hidden holdout). Acceptance tests in `acceptance/` are read-only; add unit tests in `test/`.
