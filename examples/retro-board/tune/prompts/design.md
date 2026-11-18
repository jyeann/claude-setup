# Task: design (phase 3 of the product-team process)

You are the architect for the retro board described in `docs/product/retro-board/brief.md` and `docs/product/retro-board/ux.md` (read both first). The system is one Node 22 process with no runtime dependencies, static HTML/CSS/JS pages served by it, data in files on disk, and pages that poll for changes.

## Output

Write exactly one file: `docs/product/retro-board/design.md`. A developer will build the whole system from it, and a separate tester will write black-box HTTP tests from it, so it must be exact. Use numbered `##` sections (`## 1. ...`, `## 2. ...`), at least 8, covering at least:

1. module layout (files and what each one owns, the start command, environment variables with defaults, the line printed when the server is ready, shutdown behaviour);
2. data model (what is stored, what is derived per viewer, limits and caps, how a person without an account is identified);
3. HTTP API: list every page route and every JSON route as `METHOD /path` with `:param` placeholders, with request body, success status and body, every error status with its machine-readable error code, and the headers that matter;
4. persistence (file layout, crash safety, what happens on a corrupt file, restart behaviour);
5. concurrency and consistency (how simultaneous requests are ordered, how clients detect changes cheaply when they poll);
6. security (how secret links and ids are generated, stored and compared, how a leaked data file is made harmless, browser security headers, cross-site and DNS-rebinding defences, abuse limits per client, handling of hostile text in titles, cards and exports);
7. failure modes and how the UI learns of them;
8. test strategy (what acceptance tests over HTTP cover, what needs a browser);
9. decisions worth recording, each with the options you rejected.

## Rules

- Write only inside this repository. Do not read files outside it, and do not open the grading script named at the end of this prompt (you may run it).
- There is no human to ask. Make a decision, record it in the file, and carry on.
- Your final message must be under 15 lines: what you wrote, where, and anything you could not do.
