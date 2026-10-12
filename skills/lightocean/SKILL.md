---
name: lightocean
description: How a game or an application is built on LightOcean — entities and their components, held in a state a host steps, drawn by views on clients — and where to look before writing any of it. Use before working in a LightOcean repository, or on a game built on it.
---

# Working on LightOcean

LightOcean is an engine for real-time web applications and games. A game's **state** is its entities and the **components** they hold, stepped at a fixed rate by **systems** and **rules** on a **host**, and drawn by **views** on **clients**. Everything that lives in 3D is held in such a state, an application's as much as a game's; the DOM around it is Foldkit's.

## Read first

1. `AGENTS.md` at the repository's root: the rules, how to check and test, and the exemplar files. It wins over anything here.
2. `docs/architecture.md`: why the engine is built the way it is, and what comes next.
3. The exemplar file for the kind of code you are about to write, named in `AGENTS.md`. Write as it does.
4. When an API's behaviour matters, its source: the engine's under `libraries/`, Effect's and Three.js's under `node_modules`.

## The shape of a game

- **Domains** (`Domain.make`) hold the whole state, as components. A domain writes only its own components; it changes another's components only by an event that domain declares. What both of two domains need lives in a domain beneath them.
- **Actions** say what a player did, **events** what the game made of it; both are facts in the past tense. Every action is handled by a rule; an event that nothing emits and nothing handles is unused.
- **Systems** change what the simulation owns every step; **rules** change what the rules own when an event or action happens; players change only input components.
- **Commands** are how a rule gets something done outside the game, such as saving a score; their results come back as events. Systems issue none.
- **Views** draw: `View.each` for an entity in the drawing, `View.on` for a moment such as a hit, `View.during` for a resource held while a condition holds, `View.rig` for the camera the player looks through.
- A game is wired in `Game.make`, and nowhere else.

## How a change is made

- Test first: a story (`Story.story`) for behaviour, a scene (`Scene.make`) for what views draw. A behaviour is done when its test passed after failing.
- `npm run check` and `npm test` both pass before a commit. Read the whole test output, not only its summary: a test file that fails as it loads is easy to miss.
- With a game's development server running, check the change on the running game through the `lightocean-devtools` MCP tools: read the state, hold and step time, play, and look with a screenshot.
- Commits are Conventional Commits, signed; a change any consumer must follow is marked `!` with a before-and-after table.

## Where to go next

- A new domain: the `generate-domain` skill.
- A review of a game against the rules: the `audit-game` skill.
