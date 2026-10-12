# Working on LightOcean

LightOcean is an engine for real-time web applications and games: a world of entities and components, stepped at a fixed rate by systems and rules on a server, drawn by views on clients. Why it is built this way is in [docs/architecture.md](docs/architecture.md); this file is how to work in it.

## Before you write

- Read the exemplar files below for the kind of code you are about to write, and follow them.
- When an API's behaviour matters, read its source rather than guessing: the engine's own in `libraries/`, and Effect's and Three.js's installed sources under `node_modules`.
- Write the test first. A behaviour is done when its test passed after failing.
- The skills in `skills/` walk through the common work: `lightocean` to start, `generate-domain` for a new domain, and `audit-game` to review a game against these rules.

## Checking

- `npm run check` formats, lints, and type-checks everything; `npm test` runs every test. Both must pass before a commit.
- Never start a development server. Ask the person to run one and report back.

## The rules

A rule is a type where it can be, a lint rule (`@lightocean/oxlint-plugin`) where it cannot, and written here only where neither can tell. A lint message says what to do instead; do that, rather than silencing it.

**Types.** No `any`, no `as`, no non-null `!`: prove a type where a value is made, never claim it where it is used. `as const` is no claim, only a literal kept as written, and is fine. Absence is `Option`; states are tagged unions, never boolean flags beside nullable fields. Hot code indexes plainly and checks for `undefined`; nothing anywhere uses sentinels such as `-1`.

**State.** A game is its domains (`Domain.make`), and its whole state is their components.

- A domain writes only its own components. It changes another domain's state only by emitting an event that domain declares, which that domain's rules decide on. It shares a component (`shares`) only for state many domains change every step, such as where a body is.
- Systems change what the simulation owns, every step; rules change what the rules own, when an event or action happens; players change only input components.
- What only a client keeps, such as a ragdoll or a fire, is a local component, changed by a domain's `localSystems`.
- Requiring is one way: two domains never require each other, so what both need belongs in a domain beneath them.

**Messages.** Actions and events are facts in the past tense. An action says what a player did, whatever device did it (`PulledTrigger`, `ChoseRestart`); an event says what the world made of it (`Shot`, `LevelRestarted`). Every action has a rule; an event nothing emits and nothing handles is removed.

**Effects.** A rule that needs something done outside the world issues a command (`Command.make`, `context.command`), defined beside the rule. Its failures it can foresee are among its result events. Systems issue none.

**Steps and frames are plain code.** A system's or rule's `run` and a view's `draw` take randomness and time only from their context, and run no Effect. Effect is for the edges: hosting, transports, services and Layers, commands, and what a view acquires.

**Drawing.** A game draws through views, chosen by what causes the drawing:

| What causes it                                                | Use                                                                                                               |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| A rule decided something should happen outside the world      | a command                                                                                                         |
| An entity is in the drawing                                   | `View.each`: `acquire` builds, `draw` draws every frame                                                           |
| An entity just gained a component, or holds a new value of it | `View.on`, for an output that is not state, such as a sound; react to components that change only at such moments |
| A condition holds                                             | `View.during`: a resource held while it holds                                                                     |

A view's `draw` changes only the object its view built, from the frame, and keeps nothing between frames: what must be remembered is a local component. Event listeners, timers, animation frames, and sockets live only inside these. A domain's own module imports no Three.js; its views live in its `.view` module.

**Wiring.** Nothing is wired implicitly: no automatic registration, decorators, wiring by file name, or global registries. All wiring is in `Game.make` and domains' `requires`.

**Styling.** A page's elements are styled with StyleX beside their view, through `Styled.attributes`, with colours as tokens in a `tokens.stylex.ts`. A stylesheet keeps only the document itself, which StyleX cannot reach. No plain CSS and no Tailwind.

**Naming and layout.** Modules are PascalCase files exported as namespaces from a barrel `index.ts` that holds only re-exports. What only a host or a test needs is under a package's `/internal` entry. A domain's module is laid out in the sections `COMPONENTS`, `ACTIONS`, `EVENTS`, `COMMANDS`, `RULES`, `SYSTEMS`, `DOMAIN`.

**Comments and prose.** Every public export has a doc comment saying what it is and why. Prose leads with its claim, in plain words; headings are labels. The website's documentation is written in American English, in an academic register with the vocabulary of the trade, and stays easy and fun to read: short sentences, active verbs, precise terms, and no phrase that says nothing. Code, tests, and documents carry no notes about earlier attempts or what something used to be.

## Testing

- A game's behaviour is told as a story (`Story.story`), stepping the game itself, in a `*.story.test.ts` file. A command never runs in a story: expect it, then resolve it with one of its results.
- What views draw is told as a scene (`Scene.make`, `scene.show`, `scene.find`), in a `*.scene.test.ts` file, found by view and entity, never by walking the scene graph.
- An application's page is told with Foldkit's own `Story` over its `update`, its Commands expected and resolved, never run; the world it shows is told by the world's stories.
- No mocks and no fake timers: time is the world's step, effects are values, and services are given as Layers that record.

## A running game

- With a game's development server running and its page open, the `lightocean-devtools` MCP server (in `.mcp.json`) reaches its host. Start with `lightocean_hosts` and `lightocean_describe`; read the world with `lightocean_world`, `lightocean_compare`, and `lightocean_log`; hold and step time with `lightocean_hold` and `lightocean_advance` to look closely; and play, as one player or many, with `lightocean_join`, `lightocean_input`, and `lightocean_act`.
- Check a change on the running game yourself rather than asking the person to: hold time, step, and read what came of it, and see how it looks with `lightocean_screenshot`, after `lightocean_seek` to see the past. Asking them is for what neither tells, such as how it feels to play.
- What you find by playing becomes a test: `lightocean_story` writes a stretch as the source of a story test. Keep the expectations that tell the behaviour, drop the rest, and name the entities for what they are.
- A game serves its host this way through `Devtools.plugin()` in its Vite config, `Beside.host` in its worker, and `Page.serve` in its page, in development.

## Commits

- Conventional Commits, signed. A change any consumer must follow is marked `!`, and its body gives a before-and-after table; Border, the game on the engine, is migrated with it.
- Nothing is pushed without the person's say.

## Exemplar files

- A game's domain: `examples/spinning-cube/src/cube.ts`
- Its views: `examples/spinning-cube/src/cube.view.ts`
- A story: `examples/spinning-cube/src/cube.story.test.ts`
- A scene: `examples/spinning-cube/src/cube.scene.test.ts`
- A local server and a page drawing from it: `examples/spinning-cube/src/simulation.worker.ts`, `examples/spinning-cube/src/entry.ts`
- A local server with the devtools beside it in development, and the Vite config that serves them: `examples/horde/src/simulation.worker.ts`, `examples/horde/vite.config.ts`
- An application built of a world and Foldkit: its page's Model, Messages, and Commands in `applications/playground/src/main.ts`, told in `main.test.ts`; the world joined, shown, and projected in `applications/playground/src/world.ts`
- A rule that issues a command, the service the command needs, and the Worker behind it: `examples/save-score/src/score.ts`, `scores.ts`, and `server.ts`
- A document that is a world, edited by its editors' actions and played in a worker the page opens with it: `applications/editor/src/editing.ts`, `playing.ts`, and `play.worker.ts`
- The engine's own tests: `libraries/core/src/Game.test.ts`, `libraries/client/src/View.test.ts`
- A lint rule and its test: `libraries/oxlint-plugin/src/rules/pureSteps.ts`, `pureSteps.test.ts`
