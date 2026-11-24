---
name: mobbin-references
description: Use the Mobbin MCP server (real app screens and flows) as a design reference when choosing and rendering a product's look, and record a reference link per screen in screens.md. Use in phases 2 (ux) and 4a (spec, look) of orch-product-team when the Mobbin tools are connected; says how to connect and smoke-test it.
metadata:
  origin: local
---

# mobbin-references

[Mobbin](https://mobbin.com) is a library of screenshots and flows from real apps. Its MCP server lets an agent search it while designing. In `orch-product-team` it is an **optional reference source** for the look and the screens. It never replaces the rendered screens that the owner confirms (`screens.md`), and it is never a source of files for the product's repository.

## Connect

The setup below comes from Mobbin's public pages as found by search; the session that wrote this skill could not open `mobbin.com` or `docs.mobbin.com` (network blocked), so **verify each line against Mobbin's own docs** and fix this skill if it differs.

- Server: remote HTTP MCP at `https://api.mobbin.com/mcp`, sign-in through the browser (OAuth). Mobbin states that MCP access is included on paid plans.
- Claude Code (user scope, so no product repository carries it):

```bash
claude mcp add --transport http --scope user mobbin https://api.mobbin.com/mcp
```

- Then open a new session, run `/mcp`, select `mobbin` and choose Authenticate.
- To share it with a product repository instead, copy `.claude/harness/templates/mobbin.mcp.json` to `<product-repo>/.mcp.json`. It holds only the URL, no key or token; the OAuth sign-in stays in each person's own Claude Code.
- Cloud sessions: the host `api.mobbin.com` must be allowed by the environment's network policy, and the sign-in must be done by the owner. An agent never asks for, stores or types credentials.
- The tool names are not assumed here. After connecting, list them (`/mcp`, or ToolSearch for `mobbin`) and write what they are into the smoke-test record below.

## Smoke test

Run once after connecting, in the session that will do the design. A pass is all four:

1. **Listed**: `/mcp` shows `mobbin` as connected and lists its tools.
2. **Search**: one search for a screen pattern the product needs (for example "auction detail", "wallet", "bento dashboard") returns results with a link or an id per screen.
3. **Detail**: one result is opened and shows what the screen contains (app, screen type, patterns).
4. **Recorded**: the tool names, what each returned, and any limit hit are written to `<product-repo>/docs/product/<slug>/mobbin-test.md`.

If a step fails, say which one and why (not connected, not signed in, plan without MCP access, host blocked) and carry on with `Reference: none`. A missing Mobbin connection never blocks a run.

## Use in the run

- **Phase 2 (`ux`)**: for each screen type in `ux.md`, search for the pattern and note 2 to 3 reference screens that show how mature products solve it (empty, loading and error states included). Put the findings in the prompt to `ux-designer`; the orchestrator runs the lookups, because the MCP tools are in the main session.
- **Phase 4a (look)**: build the look variants with the references in view, and say in the variation notes which reference each variant takes its layout from.
- **`screens.md`**: fill the **Reference** column with the Mobbin link (or the app and screen name) for every screen that used one, and `none` otherwise.
- **Never copy**: Mobbin screens belong to their authors and to Mobbin. Do not save, re-host or commit them, and do not trace a screen. Keep links and a one-line note on what was borrowed (a pattern: a sticky bid bar, a bento grid), and render the product's own screens. Check the terms on Mobbin's site before storing anything.
- **Product rules still win**: a reference never overrides `GLOSSARY.md`, the product's original-creature or fake-data rules, or `ux.md` copy.
