---
name: audit-game
description: Reviews a LightOcean game or application against the engine's rules, reading only — ownership between domains, messages, commands, views, types, styling, tests, and docs — and reports what breaks them with where and why. Use before a push, or when asked whether a game keeps to the rules.
---

# Auditing a game

This skill reads and reports; it changes nothing. The rules are the repository's `AGENTS.md`, which wins over this list; read it first, and `docs/architecture.md` for why.

## What to read

- The game's `Game.make` and every domain it lists.
- Each domain's module, its views, and its stories and scenes.
- The game's host (its worker or server) and its page.

## What to check

**Ownership.**

- A domain writes, spawns, or despawns only its own components, and changes another's only by an event that domain declares. Shared components are only for state many domains change every step.
- No two domains require each other.
- What only a client keeps is a `local` component, changed by a domain's `localSystems`.

**Messages and commands.**

- Actions and events are facts in the past tense. An action says what a player did, whatever device; an event what the world made of it.
- Every action has a rule; no declared event is both never emitted and never handled.
- Something done outside the world is a command issued by a rule, defined beside it, whose foreseeable failures are among its result events. Systems issue none.

**Steps and frames.** A system's or rule's `run` and a view's `draw` take randomness and time only from their context and run no Effect. `draw` changes only its own object and keeps nothing between frames.

**Drawing.** Each output uses the view its cause calls for: `View.each`, `View.on`, `View.during`, `View.rig` for the camera, or a command. A domain's module imports no Three.js.

**Types.** No `any`; no `as` but `as const`; no non-null `!`; absence is `Option`; states are tagged unions, never boolean flags beside fields that hold only in some state; no sentinels such as `-1`.

**Pages.** Styled with StyleX beside their views; a stylesheet keeps only the document itself. A Foldkit page holds no more of the world than it shows, through projections, and acts on it through Commands.

**Tests.** Behaviour is told as stories, drawing as scenes; a command is expected and resolved in a story, never run; no mocks and no fake timers, services given as Layers that record. `npm run check` and `npm test` pass, and no test file fails as it loads.

**Prose.** Every public export has a doc comment saying what it is and why; nothing tells of earlier attempts or of what something used to be.

## How to report

Group what you find as **Blockers** (breaks a rule in a way a consumer or a player would meet), **Should fix**, and **Minor**. Give each a location (`file:line`, or the commit) and one sentence of why. Say "none" for an empty group. Report what you saw, not what you assume.
