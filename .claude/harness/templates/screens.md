# Screens: <product name>

<!-- The look contract (ADR-0004). Written in phase 4a, after the look is chosen, from ux.md. Every screen of
ux.md (the S<n> ids in its headings) is rendered in the chosen look at desktop and mobile width, as a real
image, never a description. The owner confirms this whole set at spec-approved; qa later compares the built
screens with it. Images live under screens/ beside this file. Replace every <placeholder>. -->

Look: <the chosen look, as recorded on the "Look:" line of decisions.md>

## Look contract

<The signature features of the chosen look that every screen keeps, one per line. Name the layout pattern, the
hero element of the main screen, the component library and theme, and what the look is NOT (for example "no
plain list pages: the home is a bento grid with a live-auction hero tile"). A builder and the qa phase read
this as a hard requirement list.>

## Screen set

| Screen | Desktop | Mobile | Source | Reference |
|---|---|---|---|---|
| S1 <name> | [desktop](screens/s1-desktop.png) | [mobile](screens/s1-mobile.png) | <the prototype file or section that renders it> | <Mobbin or other reference link, or "none"> |
