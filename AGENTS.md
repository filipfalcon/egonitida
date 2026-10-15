# Working on EgoNitida

EgoNitida is an engine for real-time web applications and games: entities and their components, held in a state that systems and rules step at a fixed rate on a server, and drawn by views on clients. Why it is built this way is in [docs/architecture.md](docs/architecture.md); this file is how to work in it.

## Before you write

- Read the exemplar files below for the kind of code you are about to write, and follow them.
- When an API's behaviour matters, read its source rather than guessing: the engine's own in `libraries/`, and Effect's and Three.js's installed sources under `node_modules`.
- Write the test first. A behaviour is done when its test passed after failing.
- The skills in `skills/` walk through the common work: `egonitida` to start, `generate-domain` for a new domain, and `audit-game` to review a game against these rules.

## Checking

- `npm run check` formats, lints, and type-checks everything, and proves the engine's theory; `npm test` runs every test. Both must pass before a commit.
- `verification/` proves in Lean what the principles rest on: the equation, replay, segments, hosts composed through their input, and prediction. A theorem that fails, or rests on `sorry`, fails the check, and `Verification/Principles.lean` states each one again, so none goes missing or weaker unseen. A principle changes together with its proof. Lean comes through elan (`brew install elan-init`), at the version `verification/lean-toolchain` pins.
- Never start a development server. Ask the person to run one and report back.

## The model

A game is one equation: **x′ = f(x, u)**. The state x is the whole game at one tick; the input u is everything that enters a step from outside the state, the players' demands and the actions; the step f turns both into the next state. The same state and the same input give the same next state, and replay, rewind, prediction, and stories all rest on it.

Most rules below keep f a function of x and u alone:

- randomness and time come only from the step's context, or they would be input hidden outside u;
- maths beyond the four operations and roots comes from `Maths`, which every JavaScript engine works out alike, or a host, a client predicting it, and a replay in another browser would step the same state apart;
- systems and rules run no Effect, since work outside the state is output and input, never part of f;
- a rule that needs something done outside issues a command, and its result returns as an action, through u;
- a state is never changed, only replaced, so any past state can be stepped again;
- views only read the state, y = h(x); they never write it, or there would be a second way into x besides f.
- a snapshot is output too, y = h(x), made by the host for each client; a client's prediction can step only what that output holds.

When designing something new, ask first whether it is part of x, u, f, or h: the answer decides whether it is a component, a demand or an action, a system or a rule, or a view.

## The rules

A rule is a type where it can be, a lint rule (`@egonitida/oxlint-plugin`) where it cannot, and written here only where neither can tell. A lint message says what to do instead; do that, rather than silencing it.

**Types.** No `any`, no `as`, no non-null `!`: prove a type where a value is made, never claim it where it is used. `as const` is no claim, only a literal kept as written, and is fine. Absence is `Option`, so what only one entity holds, such as a game's progress, is `Array.head` of a query, an `Option`; modes are tagged unions, never boolean flags beside nullable fields. Hot code indexes plainly and checks for `undefined`; nothing anywhere uses sentinels such as `-1`.

**State.** A game is its domains (`Domain.make`), and its whole state is their components.

- A domain writes only its own components. It changes another domain's components only by emitting an event that domain declares, which that domain's rules decide on. It shares a component (`shares`) only for values many domains change every step, such as where a body is.
- Systems change what the simulation owns, every step; rules change what the rules own, when an action or event happens; players change only demand components, through their demands.
- What only a client keeps, such as a ragdoll or a fire, is a local component, changed by a domain's `localSystems`.
- Where a player's value lives depends on what reads it. One the game reads, or other players must see, is in the state: a choice the player makes once, such as the side she joins, is a rules-owned component set by an action; one that changes every step, such as where she heads or aims, is a demand. One only the page reads is the page's, kept as it keeps its Model: how it turns her devices into demands, such as a camera mode that changes which way her stick aims, reaches the game only as the demands it makes; and how the game is drawn for her, such as where the camera looks from, is the drawing's input, y = h(x, v), given to `View.make` as `input`, which every view's per-frame function receives. What of it changes every frame, such as where a stick turns her to look, the Model never holds: the page plays it on from its devices once a frame, in a plain function, and a Foldkit stage does so for it through `played`. What the drawing must remember of the state over time, such as how far a camera trails, is a local component.
- Requiring is one way: two domains never require each other, so what both need belongs in a domain beneath them.

**Messages.** Actions and events are facts in the past tense. An action happened once outside the state: what a player did, whatever device did it (`PulledTrigger`, `ChoseRestart`), or what a command came to (`ScoreSaved`); an event arose within a step, what the game made of it (`Shot`, `LevelRestarted`). Every action is handled by a rule; an event that nothing emits and nothing handles is unused, and is removed.

**Effects.** A rule that needs something done outside the game issues a command (`Command.make`, `context.command`), defined beside the rule. Its results are declared beside it (`Command.result`), its failures it can foresee among them, and each comes back as an action that a rule must handle. Systems issue none.

**Steps and frames are plain code.** A system's or rule's `run` and a view's `draw` take randomness and time only from their context, and run no Effect. Effect is for the edges: hosting, transports, services and Layers, commands, and what a view acquires.

**Drawing.** A game draws through views, chosen by what causes the drawing:

| What causes it                                                | Use                                                                                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| A rule decided something should happen outside the game       | a command                                                                                                                     |
| An entity is in the drawing                                   | `View.each`: `acquire` builds, `draw` draws every frame                                                                       |
| An entity just gained a component, or holds a new value of it | `View.on`, for an output that is not part of the state, such as a sound; react to components that change only at such moments |
| A condition is true                                           | `View.during`: a resource held while `when` is true                                                                           |
| Many entities together, or none                               | `View.whole`: one object, drawn every frame from the whole frame, such as one light for every fire                            |
| A value outside the drawing follows the state, time and all   | `View.follow`: `of` works it out every frame, `to` puts it out as it changes, such as a pad's lightbar                        |
| The player looks at the game                                  | `View.rig`: the camera, drawn for the player after every other view, from what they drew                                      |

A view's `draw` changes only the object its view built, from the frame and the page's input to the drawing, and keeps nothing between frames: what must be remembered is a local component. A rig reads the player's own view preferences, such as where they look from, from the drawing's input, never from the state; a Foldkit page follows it from its Model with `Stage.entry`, which never shows the stage anew when it changes, and plays on what changes every frame, such as where a stick turns them to look, with `played`: once each frame it draws, before its views draw, it reads the controls its `bindings` bind from the devices, through `Hearing`, and gives them to a plain `next`, which plays on what the stage keeps, with what the controls must remember, such as how long since a stick was last touched. A plain `drawing` gives the views only what they read of it, with what the page keeps, and the stage sends what `demands` makes of them and the controls as the player's demands, such as where they head, the stick turned by where the camera faces, and what `actions` makes of them as their actions, each made by `Stage.acted`, such as a press throwing a punch, and tells the page what `messages` makes of them, as its Messages, such as the directional pad going through a menu the page shows, which its `update` decides on as it decides a click. Event listeners, timers, animation frames, and sockets live only inside these. A domain's own module imports no Three.js; its views live in its `.view` module.

**Wiring.** Nothing is wired implicitly: no automatic registration, decorators, wiring by file name, or global registries. All wiring is in `Game.make` and domains' `requires`.

**Styling.** A page's elements are styled with StyleX beside their view, through `Styled.attributes`, with colours as tokens in a `tokens.stylex.ts`. A stylesheet keeps only the document itself, which StyleX cannot reach. No plain CSS and no Tailwind.

**Naming and layout.** Modules are PascalCase files exported as namespaces from a barrel `index.ts` that holds only re-exports. What only a host or a test needs is under a package's `/internal` entry. A domain's module is laid out in the sections `COMPONENTS`, `ACTIONS`, `EVENTS`, `COMMANDS`, `RULES`, `SYSTEMS`, `DOMAIN`.

**Comments and prose.** Every public export has a doc comment saying what it is and why. Prose leads with its claim, in plain words; headings are labels. The website's documentation is written in American English, in an academic register with the vocabulary of the trade, and stays easy and fun to read: short sentences, active verbs, precise terms, and no phrase that says nothing. Code, tests, and documents carry no notes about earlier attempts or what something used to be.

## Testing

- A game's behaviour is told as a story (`Story.story`), stepping the game itself, in a `*.story.test.ts` file. A command never runs in a story: expect it, then resolve it with one of its results.
- What views draw is told as a scene (`Scene.make`, `scene.show`, `scene.find`), in a `*.scene.test.ts` file, found by view and entity, never by walking the scene graph. The drawing's input is given to `Scene.make`, as the page gives it, never spawned into the state.
- An application's page is told with Foldkit's own `Story` over its `update`, its Commands expected and resolved, never run; the game it shows is told by the game's stories.
- No mocks and no fake timers: time is the game's step, effects are values, and services are given as Layers that record.
- A number that comes of arithmetic, such as a position, an angle, or a camera's direction, is compared within a tolerance (`toBeCloseTo`, or a vector by its distance or the dot product with what is expected), never with `toEqual`: that tells -0 from 0, and 0.1 + 0.2 from 0.3. `toEqual` is for what is counted or chosen, such as ticks, tags, and ids.

## A running game

- With a game's development server running and its page open, the `egonitida-devtools` MCP server (in `.mcp.json`) reaches its host. Start with `egonitida_hosts` and `egonitida_describe`; read the state with `egonitida_state`, `egonitida_compare`, and `egonitida_log`; suspend and step time with `egonitida_suspend` and `egonitida_step` to look closely, and resume it with `egonitida_resume`; and play, as one player or many, with `egonitida_join`, `egonitida_demand`, and `egonitida_act`.
- Check a change on the running game yourself rather than asking the person to: suspend time, step, and read what came of it, and see how it looks with `egonitida_screenshot`, after `egonitida_seek` to see the past. Asking them is for what neither tells, such as how it feels to play.
- What you find by playing becomes a test: `egonitida_story` writes a stretch as the source of a story test. Keep the expectations that tell the behaviour, drop the rest, and name the entities for what they are.
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
- An application built of a game and Foldkit: its page's Model, Messages, and Commands in `applications/playground/src/main.ts`, told in `main.test.ts`; the game's session joined, shown, and projected in `applications/playground/src/session.ts`; where the player looks from kept in the Model and read by a rig as the drawing's input, its `viewpoint` in `main.ts`, the rig `looking` in `cubes.view.ts`, told in `cubes.scene.test.ts`; looking around by a stick every frame, played by the stage beside it, in `look.ts` and `session.ts`, told in `look.test.ts`
- A rule that issues a command, the service the command needs, and the Worker behind it: `examples/save-score/src/score.ts`, `scores.ts`, and `server.ts`
- A delivered model reshaped by a game's dials, its morph targets turned and its bones lengthened as the state holds them: `examples/figure/src/figure.view.ts`, told in `figure.scene.test.ts`
- An anatomical body read from its model as the game is built, her pose worked out by reaching from what the state holds, in the step and in the view alike, and a ball struck by what touches it: `examples/baller-trickster/src/body.ts`, `baller.ts`, and `baller.view.ts`, told in `baller.story.test.ts` and `baller.scene.test.ts`
- A document that is a state, edited by its editors' actions and played in a worker the page opens with it: `applications/editor/src/editing.ts`, `playing.ts`, and `play.worker.ts`
- The engine's own tests: `libraries/core/src/Game.test.ts`, `libraries/client/src/View.test.ts`
- A lint rule and its test: `libraries/oxlint-plugin/src/rules/pureSteps.ts`, `pureSteps.test.ts`
