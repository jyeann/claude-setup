# Spec-approved page: <product name>

<!-- The one page the owner reads before adding the spec-approved label. Fill it from brief.md, ux.md,
design.md and the one-way rows of decisions.md, save it as spec-approved-page.md in the run's docs folder,
and post it on the spec issue. Plain language only: no code, no commands, no file formats. Replace every
<placeholder>; pipeline.js counts a section that still holds only placeholders as empty. Keep the seven
headings and the Stack part of "The real choices" exactly as they are. -->

## Problem and who it is for

<Who has the problem, what it is today, and why it matters to them. Two or three sentences.>

## Not building

<What this product will not do, so the owner can object now rather than at accepted.>

## The real choices

<The 3 to 4 one-way decisions from decisions.md (rows with Door "one-way"). For each: what was chosen, the
alternatives, and the trade-off in plain words. Two-way decisions stay in decisions.md and are not listed.>

### Stack

<The proposed stack and 1 to 2 alternatives, from the Stack section of design.md. For each: how well the gate
can check it (proven, experimental or planned) and any checks the gate would not run. For a stack with no
adapter, give the three options: a supported alternative, a weaker gate (and which checks it leaves out), or
building the adapter first as its own spec.>

## Screens

<The look contract (from screens.md) in two or three plain sentences, then every screen of screens.md with its
desktop and mobile image and one line on what the screen is for. Every screen id of ux.md appears here: the owner
confirms the whole set, and the built product is later compared with it. Other look variations may be linked
for comparison. "No screens" for a product without a screen.>

## Done means

<What a person can do when it is finished, in user terms, one line per success criterion.>

## What we're unsure about

<What the agents are not sure of: guesses, open questions, risks. This tells the owner where to look.>

## Who judges each layer

| Layer | Judged by | Why |
|---|---|---|
| problem | <owner / checks / developer review / skip> | <reason for this product> |
| impression | <owner / checks / developer review / skip> | <reason> |
| approach | <owner / checks / developer review / skip> | <reason> |
| correctness | <owner / checks / developer review / skip> | <reason> |
| craft | <owner / checks / developer review / skip> | <reason> |
