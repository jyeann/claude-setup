# The chosen look is a contract: every screen is rendered, confirmed by the owner, and compared with the built product

In the first Gachi Market run the owner approved "D, daisyUI 5 + Tailwind CSS 4, bento-grid dashboard" from a prototype whose centre was a single "Market home" screen. The build used the library and the theme, but the home screen was never built: `ux.md` had no such screen, so no ticket, journey or check named it, and "the look is cosmetic, no test depends on it" meant nothing could fail. The owner found the gap by looking at the running product. We decided the look is a **contract** with three parts:

1. **Every screen is rendered before the gate.** After the look is chosen, every screen id (`S<n>` in the headings of `ux.md`) is rendered in it at desktop and mobile width as a real image and listed in `screens.md` with a **Look contract** (the signature features every screen keeps). A screen shown in the prototype but missing from `ux.md` fails phase 4a, so the approved look and the specified product cannot differ silently.
2. **The owner confirms the whole set at `spec-approved`.** The page's Screens section shows every screen. The images and `screens.md` are hashed with the approval, so changing one voids it. An owner who dislikes any screen gives an impression redirect, which goes back to the ux phase.
3. **The built product is compared with the approved set.** Tickets that touch a screen cite its ids; phase 7 screenshots every built screen and writes `visual-parity.md`. Only `match` passes. An agent never accepts a deviation: the build is fixed, or the owner changes the approved screen.

The Mobbin MCP server is an optional reference source for step 1 (a link per screen in `screens.md`); it is never a source of files for a product repository.

## Considered Options

- **Pixel-diff the built screens against the approved images**: objective, but the approved images come from a throwaway prototype in another stack, so honest builds always differ by pixels. Rejected for now; the parity check is a judged comparison by an agent that did not build the screens, and the owner sees both images at `accepted`.
- **Keep looks as cosmetic and add one home-screen ticket** (the follow-up first proposed for Gachi Market): fixes one product, not the process. Rejected.
- **A third owner gate for the screens**: more waiting. Rejected: the screens are part of the `spec-approved` page, and the impression layer already has a verdict and a redirect.

## Consequences

- Phase 4a does more work: one render pass for every screen of the chosen look, not three variants of one screen. The variants round stays as it was.
- `ux.md` must give every screen an id, including the first screen after sign-in. `Look: none` skips the contract.
- A product already past `spec-approved` without `screens.md` is blocked at `spec`, and at `qa` without `visual-parity.md`. Add the files; the approval is voided only if an approved file changes.
- The check is mechanical about presence (ids, PNG files, verdict words) and judged about content (an agent compares the images). It cannot tell a wrong screenshot from a right one; reviewers and the owner do.
