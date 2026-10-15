---
name: generate-domain
description: Adds a domain to a Nitida game — its components, actions, events, commands, rules, and systems, its views, and its stories and scenes — test first, as the engine's rules require. Use when a game needs new components or new behaviour of its own.
---

# Generating a domain

A domain is one part of a game's state: the components it owns, and the actions, events, commands, rules, and systems that change them. This skill adds one, test first. Read the `nitida` skill and the repository's `AGENTS.md` before starting.

## 1. Decide what it owns

Write down, before any code:

- **Components** it owns, each with its owner: `simulation` (systems change it every step), `rules` (rules change it when something happens), or `demand` (players change it, by what they do with their controls); and its network role: `server`, `predicted`, or `local` (a client keeps it for itself).
- **Actions**: what a player does, whatever device they do it with, as facts in the past tense (`PulledTrigger`, `AskedForCube`).
- **Events**: what the game made of something, also in the past tense; the events of other domains it emits or handles.
- **Commands**: anything done outside the game, such as saving to storage, with the results it may come to (`Command.result`), failure included; each result is an action, and a rule must handle it.
- **Requires**: the domains beneath it whose components it reads, spawns, or whose events it emits.

Check the plan against the rules: it writes only its own components, two domains never require each other, every action is handled by a rule, and no unused event, one that nothing emits and nothing handles, is declared.

## 2. Tell its behaviour first

Write `name.story.test.ts` beside the domain, after the exemplar story `AGENTS.md` names:

- `Story.given` a state and names for its entities; `Story.act`, `Story.demand`, `Story.happen`, `Story.resolve`; `Story.step` or `Story.seconds`; then `Story.expect` or `Story.expectEqual`.
- A command never runs in a story: `Story.expectCommand` it, then `Story.resolve` it with one of its results.

Run the tests and see them fail.

## 3. Write the domain

Write `name.ts` after the exemplar domain, in the sections `COMPONENTS`, `ACTIONS`, `EVENTS`, `COMMANDS`, `RULES`, `SYSTEMS`, `DOMAIN`:

- Components with `Component.make`, actions with `Action.make`, events with `Event.make`, commands with `Command.make`, rules with `Rule.on`, systems with `System.make`, and the domain with `Domain.make`.
- A rule's or system's `run` is plain code: randomness and time only from its context, no Effect.
- Modes are tagged unions; absence is `Option`; no `any`, no `as` (but `as const`), no non-null `!`, no sentinels such as `-1`.
- Every export has a doc comment saying what it is and why.
- Add the domain to the game in `Game.make`, after the domains it requires.

Run the stories until they pass.

## 4. Draw it

If it is drawn, write `name.view.ts` after the exemplar views, and `name.scene.test.ts` after the exemplar scene, test first. The domain's own module imports no Three.js.

## 5. Check

`npm run check` and `npm test` pass, with no test file failing as it loads. If the game has a development server running, play the new behaviour through the `nitida-devtools` MCP tools, and turn what you find into a story with `nitida_story`.
