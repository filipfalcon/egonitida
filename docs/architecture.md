# Architecture

LightOcean is an engine for web applications in the way Unreal Engine is an engine for games: an editor, a runtime, and a project format that the two share.

This document records the principles the engine stands on, the decisions taken so far, what is built, and what comes next. It grows alongside the code.

The first game to run on the engine is Border, a first-person browser game in its own repository, which links LightOcean as a package. Its needs are what the principles below were measured against.

## Principles

Seven principles shape every API. Each builds on the ones before it.

### 1. State: one state per host, ownership is a type

- Everything a host holds of a game is one state, described by Effect Schema: the facts the rules decide, what the simulation moves, and what the players demand, alike. It is not split into a rules Model and a simulation joined by a hand-written bridge, the way Border joins them today.
- A game may run on many hosts, such as one for each zone, and each holds a state and a tick of its own. No state reaches into another: a host sends another what it needs as a command, and it arrives there as an action, recorded with that host's input like any other. Each host's states therefore replay on their own, and no host's tick waits for another's.
- The simulation follows the Entity Component System model, after Bevy: an entity is an id, components are the data attached to it, and systems are functions over every entity with given components.
- Every component has exactly one owner, declared in its schema:
  - **Rules** own the facts the game's rules decide, such as health, ammunition, or an open door. Only rules change them, when an action or an event happens.
  - **Simulation** owns what changes every step, such as positions. Only systems change them.
  - **Demand** owns what players demand, what they are doing with their controls, such as a stick held to the left or a trigger held halfway. The engine writes it at the start of a step, and nothing else may.
- A game declares everything its state is made of: its components, actions, events, and commands with their results. One schema of the whole state, its components with its tick, randomness, and next entity, follows from the game, and snapshots, saves, recordings, and the debugger all use it.
- A system and a rule each declare what they read, what they write, and what they emit. Writing what it does not own, or reading what it did not declare, is a compile error, not a runtime bug. Everything is readable by everyone, so nothing is ever copied and kept in sync.
- What the client alone keeps, such as a ragdoll, blood, or casings, lives in its state as local components, changed by local systems: the same kind of system, run only on the client after each step, which reads everything but writes and spawns only local components, and draws from its own randomness. A snapshot never replaces local components and a prediction's rewind never takes them back, so they only move forward. A client steps them through every tick the server's state reaches, a lost snapshot included. What they spawn takes ids counting down from -1, which never meet the server's, and what they draw comes of the tick and the state's randomness there, the same on every client; what a client keeps on an entity of the server's goes when the server's state no longer holds it.
- Events a system emits are applied by the rules at a defined point in the step, so the next step already sees their result. Nothing waits on an asynchronous queue.
- Systems and rules spawn and despawn entities within a step, and declare it: `spawns` lists the components they may create an entity with, whoever owns them, since being born changes no one's components; `despawns` says they may remove one, which takes it out of every component at once. Either takes effect at once, so what runs later in the same step sees it; steps run in order, so nothing needs a queue of commands, as Bevy's parallel systems do. Ids come from the state's own counter, so a replay gives out the same ones, and a despawned id is never given out again.
- What is drawn is never a source of truth: the scene is derived from the state.
- A level is entities too: walls, obstacles, and doors are entities with components, so there is one model for everything the state holds, and an editor and a debugger see a level the way they see the rest. Stores never change in place, so a system may build something from one, such as a spatial index, and keep it for as long as the store is the same.

### 2. Network: an authoritative server, from the start

- The engine is built for multiplayer and for games split across many servers, as much as for singleplayer.
- A server is a Cloudflare Durable Object: one object is one game, room, or zone. It steps the game and sends clients its state. A client predicts its own player so what the player does takes effect at once, corrects itself when the server disagrees, and interpolates everything else between the states the server sent.
- Every field declares its network role next to its owner:
  - **Server**: decided by the server and sent to every client.
  - **Predicted**: guessed by the client, confirmed by the server.
  - **Local**: kept on the client only and never sent, such as blood, casings, or a ragdoll after death. Most of what is expensive in Border is local.
  - **Private**: kept on the server only and never sent to any client: what clients do not need, such as the size of a body; and what each builds for itself, such as a level's walls.
- The engine always has the client–server shape. Singleplayer is the same code with the server running in a Web Worker in the browser, the way Minecraft runs an integrated server; switching to multiplayer is configuration. The price is that a singleplayer game also sends its demands and actions to a host and marks what is local.
- There is no single player in the API, only the set of players.
- Whether time may be suspended is the host's policy, not the game's: a local server lets its player suspend it, a shared room refuses. Switching a game to multiplayer turns its pause into a menu that does not stop anything, and the game has to live with that.
- Schemas double as the wire format, and change detection decides what is sent.

### 3. Time: a fixed step, smooth drawing

- The simulation moves on in fixed steps, each one `secondsPerStep` long. The step rate is a setting of each game, given to `Game.make` and never defaulted by the engine, fixed for the game's lifetime, because tuning and recordings depend on it. Border steps at 60 Hz. A system that needs finer steps, such as a ragdoll, subdivides its own.
- The step rate is one number everywhere: the server, a client predicting, and a replay all take the same steps, or prediction would not match. How often snapshots are sent is a separate, lower number when bandwidth calls for it, such as 20 or 30 Hz; clients interpolate between them.
- Demands are read once a step, so a step's length bounds how fast movement responds. Looking around is the client's alone, every frame, outside the simulation; the simulation only receives where the player looks as one of their demands. The page plays it on from the devices once a frame, before the views draw: it reads them, as `Hearing` does, reads the game's controls from them, and hands those to a plain function of the look before, which gives the look after, so the views stay functions of the drawing's input. The controls are read every frame, whatever that function makes of them, so a press counts once, when it is new. A Foldkit stage does this for its page through `played`, and keeps what the controls remember itself; what the player demands of the game in that frame, such as where they head, the stick turned by where the camera faces, `demands` works out from the look and the controls, and the stage sends it before the views draw.
- A displayed frame reads the devices into the player's demands and actions, runs as many fixed steps as real time calls for (each step: the demands are written, the rules handle the actions, the systems run, then the rules handle the events that arose), interpolates between the last two steps, and draws. The number of steps per frame is capped, so a slow machine slows the game briefly instead of falling ever further behind.
- Each state has one time: its tick only moves forward, step by step, at the game's rate. Nothing inside the game scales it or stops it; only its host can suspend it, by its policy.
- Presentation never changes how the game runs, in singleplayer or multiplayer alike, because a game can always be switched between the two. A client keeps a timeline of recent states, which serves three things:
  - interpolation, drawing slightly in the past between two states;
  - prediction, going back to a confirmed state to replay what the server has not confirmed;
  - presentations, such as a slowed death, a frozen frame, or a killcam, which play a moment from the timeline at their own pace while the live state goes on, then return to it.
- What is drawn between two states holds the entities of the earlier one until the later one is reached: an entity appears or leaves once the later state is reached, never at a guessed place in between. A drawn frame can be queried like a state, and tells which entities came into the drawing and which left it since the frame before, and which gained or lost a given component, so a game makes and puts away what stands for them without comparing lists itself.
- A moment, such as a hit or a death, is part of the state too: the rules or the simulation give it to what it happened to as a component, such as `Dying { cause, along, since }`, kept for as long as it is shown. It survives a lost snapshot, since the next one carries it, and a presentation playing the past shows it again. Clients receive nothing from the server but states.
- A timer is an engine primitive on the game's time, owned by an entity or a mode, and it disappears with its owner. Guards against stale completions, like Border's counters, are not needed.

### 4. Determinism: the whole state replays

- A game is one equation, **x′ = f(x, u)**: the step f turns the state x and the input u into the next state x′. The input is everything that enters a step from outside the state: the players' demands and the actions, in the order they arrived. The same state and the same input give the same next state. Determinism is a cornerstone of the engine: on the same build, a host's game steps to exactly the same states.
- What a game shows and what it asks of the world outside is a second equation, **y = h(x)**: views and commands read the state and never write it. The game's course does not depend on it, so it is not part of the foundation.
- The equation is a tool for thinking as much as a definition. Whatever is designed next is first placed in it, and its place decides what it is made as:

| Part     | In the equation | In LightOcean                                        | Made as                                                 |
| -------- | --------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| x        | the state       | the state: entities and their components             | components (`Component.make`)                           |
| u        | the input       | the players' demands, and the actions in their order | demand components, `Action.make`, `Command.result`      |
| f        | the step        | the step: demands written, actions, systems, events  | systems (`System.make`) and rules (`Rule.on`)           |
| y = h(x) | the output      | what is drawn, and what is done outside the game     | views (`View.each`, `on`, `during`, `rig`) and commands |

- Everything that rests on the equation is one of its consequences, and nothing else holds it up:

| What follows          | From the equation                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| Replay                | A segment is a first state, a version, and the input of every step; stepping it again comes to the same states. |
| Rewind                | Any past state is kept, since a state is only replaced, and stepping on from it is stepping it again.           |
| Prediction            | A client steps the host's newest state with the demands it sent that the host has not yet taken in.             |
| Stories               | A test gives a state and an input and expects the next state; no host, clock, or runtime is needed.             |
| The determinism check | A replay beside the running game compares the fingerprints of its states with the host's.                       |

- What keeps f a function of x and u alone is what the rules of `AGENTS.md` enforce: randomness and time come only from the step's context, or they would be input hidden outside u; systems and rules run no Effect, since work outside the state is output and input, never part of f; a rule that needs something done outside issues a command, and its result returns as an action, through u; a state is never changed, only replaced; views only read the state, or there would be a second way into x besides f.
- One mechanism serves three purposes: the client's prediction rewinds to the server's state and replays the demands not yet confirmed; the debugger rewinds the whole game, not only the rules; and games can build replays, spectating, and death cameras on real recordings. A recording also makes a test.
- Systems and rules take randomness and time only from the step's context; `Math.random` and `Date.now` are lint errors there. Asynchronous results enter as recorded actions.
- In development the engine replays alongside the running game and compares the fingerprints of its states, reporting the first step and component where the two diverge.
- Cosmetics are deterministic too: an event carries a seed, so every client generates the same blood from it without anything more being sent.
- Rewinding starts from the nearest periodic snapshot and steps forward.
- The equation holds for one version of the code: exactly, x′ = f_v(x, u), and code changes, by a deployment or a reload while running. A recording is therefore made of segments, one for each version, each with its own first state, the state the host went on from, so each replays with its own version alone. A version is the build the bundler names, which tells every change to the code apart, and the schema of the state, a hash for each component, which tells which components changed. A check of determinism refuses another version, since what it found would mean nothing; a replay by another version, as a recording of a bug after its fix, says so first, and where it comes apart is a change of the code, not a game that is not deterministic.

### 5. Boundaries: everything is a domain

- The engine is made of domains, and its own features (drawing, physics, audio, devices, network) are domains too. A game can do whatever the engine does, and can replace any domain, as Border would replace physics with its own ragdoll.
- A domain is a part of a game that owns some of its components, as Border's undead, her, and the lab's doors are each one. It is not something optional added to a finished game, as a plugin is in a browser or in Unreal; what is added from outside is a mod, below.
- A domain is a value: the components, actions, events, systems, rules, and commands it brings, and the domains it requires. A game is the list of its domains, flattened by `Game.make` in order, so nothing is wired by hand. The services a domain needs while running, such as storage for its commands or a renderer for its views, are Effect Layers the host provides, and tests swap in other Layers.
- A domain writes only its own components. Any domain reads any component, but changes another domain's components only by emitting an event that domain declared, and that domain's rules decide what it means. Writing another domain's component, or reading one from a domain not in `requires`, is a compile error.
- A domain may share some of its components with the domains that require it, which may then write them too. Sharing is for values many domains change every step, such as where a body is, which no event could carry; each system still declares what it writes, so who changes a shared component can be read off the game.
- Systems run in the order of the domains in the game, then the order each lists them; requiring decides only what a domain may touch, not when it runs. A domain others require may still run last, as one keeping bodies out of walls runs after everything that moves them. Whether this needs named phases, as Bevy's schedules have, waits until a game shows it.
- Packages come in three layers:
  - **core**: the state, systems, schedule, time, randomness, replay, network protocol, and game rules. It runs everywhere, and it compiles without the DOM's types, so the simulation always runs in a Durable Object.
  - **client**: drawing, audio, devices, haptics, cosmetics. Browser only.
  - **server**: hosting a game in a Durable Object, and persistence.
- A game's domains split the same way: a domain's core part in one module, its client part (local systems and views) in a `.view` module, so a worker or a Durable Object never imports Three.js.
- One program runs everywhere, with no annotations saying where: the roles of components and the split of a domain say what runs where.
- Imperative islands are allowed for gradual migration: a local, client-only domain may use Three.js as it likes, but cannot write components it does not own. Border can move onto the engine by wrapping its current code this way first.

### 6. Frame pacing: measured, never assumed

Frame pacing is a requirement, not a polish pass. A frame is presented on time and motion inside it is placed at the right moment, at whatever rate the display runs.

- **Time from the display.** Interpolation and motion read the timestamp `requestAnimationFrame` hands a frame, the moment it is presented, never the moment code happens to run.
- **No allocation in the hot path.** Nothing that runs every frame or every step creates objects; it works on pools, typed arrays, and preallocated vectors. This is a requirement on how simulation components are stored.
- **The simulation off the main thread.** A singleplayer game's local server runs in a Web Worker, so the main thread only reads the devices, interpolates, and draws.
- **The network never jumps.**
  - Other entities are drawn slightly in the past, interpolated by tick number with an adaptive buffer, so irregular arrival and skipped ticks never show.
  - The client's clock follows the server's by speeding up or slowing down playback by a percent or two, never by snapping.
  - A prediction error in the client's own player decays over a few frames instead of teleporting.
- **No compilation hitches.** Shaders and pipelines are compiled and warmed before first use, as an engine service.
- **Any refresh rate.** 60, 120, 144 Hz, and variable refresh rate; nothing assumes 60.
- **No DOM work every frame.** The UI updates when the Model changes, and values that change every frame reach the DOM at a bounded rate.

It is measured, not assumed:

- An in-editor overlay shows the frame-time histogram, missed vsyncs, and long frames, through the Long Animation Frames API.
- Browser tests run a scene for a fixed time and fail when the 99th percentile frame time exceeds the budget or more than a few vsyncs are missed, the way a determinism check fails on divergence.

### 7. Devices: every device a PC has, the gamepad first

A game is played with whatever a player has, and its own state never knows which. The gamepad is preferred, the mouse and keyboard are full peers, and every other device a PC can reach is supported, what it outputs as much as what it reads.

- **The rules know no device.** What a device reads becomes a game's demand components, and what a player does with it once becomes the game's actions, through bindings the game declares as data, which a player can change. An action says what the player did whatever did it, so nothing in the simulation changes with a device.
- **The gamepad first.** Bindings are made for the gamepad before anything else; the device a player last used is the one the game responds to and shows the controls of; and everything a pointer reaches, the accessible mirror and the UI included, can be reached with a pad: the directional pad moves focus, one button presses, another goes back.
- **The mouse and keyboard in full.** Pointer lock with raw movement, every button and the wheel, keys by their place on the keyboard whatever its layout, labels by its layout, and the keyboard held in full screen.
- **Every other device.** The Gamepad API reaches pads, wheels, and flight sticks, those with no standard layout through a layout given as data; WebHID reaches the rest, each through a driver that reads a device's reports into the shapes the engine knows.
- **Output too.** Rumble and haptics, and a peripheral's lights, such as a keyboard's or a mouse's RGB, are drawn from the state of the game the way the scene is: a function of what is drawn, with what happens at a moment, such as a hit, shown once through `View.on`. Lights are reached through WebHID drivers, or through a vendor's own software where it holds the device, as Razer's Chroma does.
- **Where a browser falls short, the game plays on.** WebHID is Chromium's only and asks the player's leave once for each device; what a browser cannot reach is a capability the engine reports, and a game is playable without it.
- Devices are services, so a test gives recorded devices and expects what came of them, with no mocks and no browser.

## Decisions

### Rendering

- Three.js is the only renderer. Everything outside the DOM layer is a Three.js scene.
- WebGPU is the target, through `three/webgpu` and its `WebGPURenderer`. The WebGL 2 fallback is whatever Three.js provides on its own; no effort goes into it, and features that need compute may not work on it.
- Materials and shaders are written in TSL only. No GLSL, `ShaderMaterial`, or `onBeforeCompile`. TSL being a node graph is what makes a Material Editor a natural fit later.

### Language

- Effect, on the 4.x line, is structural, and used at the edges: hosting, transport, scopes and resources, services and Layers, executing commands, and acquiring what a view draws with. What runs every step or every frame (a system's or rule's `run`, a view's `draw`, interpolation) is plain code, never an Effect per entity or per frame. Effect is used where interruption, resources, services, typed failure, or composition call for it, never for style. The repository pins `effect` at exactly 4.0.0, because Foldkit and its tooling declare that exact version as a peer dependency.
- Values use `Option` for absence; the hot path indexes plainly and checks for `undefined`, which `noUncheckedIndexedAccess` makes as safe without allocating. No sentinel values such as `-1`.
- Effect Schema is the reflection system, the counterpart of Unreal's `UCLASS` and `UPROPERTY`. One schema gives a type its saved format, its validation, and its Details panel.
- GPU resources are acquired and released through `Scope`, so disposal is never manual.

### Program model

Everything that lives in 3D, an application as much as what is played, is a game made of domains. Foldkit keeps the DOM: an application's UI, a game's HUD and menus, and the editor itself. There is one idiom, so a debugger, recordings, and agent tooling are built once.

- The editor's documents are entities with components, its low-code rules are rules on actions, and Play-in-Editor runs a local server, as a game does.
- A game with no systems need not step at its rate while nothing happens; when its host steps it is decided when it is built.

### The frame loop

- Views draw every frame from the frame drawn; continuous motion, such as a spin, is a function of the frame's time or a local component, never data the engine moves on outside the state.
- The per-frame work is tight synchronous code inside one Effect, with no Effect operation per object.

### UI

- Foldkit renders the DOM layer of every application and the editor itself. Forms, text, links, and accessibility come from the DOM, the way Unreal layers UMG over its 3D scene.
- An application meets its game through `@lightocean/foldkit`, and through three of Foldkit's own mechanisms:
  - A session is a **Managed Resource** (`Session.managed`): joined in a worker while the Model wants it, and left once it does not. Commands reach it through the resource, to take the player's actions, such as asking for a cube.
  - The canvas is in the DOM because `view` puts it there; a **Mount** says when it is, and a **Subscription** (`Stage.stream`) shows the game on it: the game's views every frame, a click as `Pointing.Clicked`, and the accessible mirror beside it. A Mount reaches nothing but its element, never a Managed Resource, so showing the game is a Subscription's work. A Model restored after a reload may say the session is joined before it is again; the stage and every projection then say it is not (`onNotJoined`), which puts the Model right, and they run again once it is joined. While the Model says it is not, `Session.whenJoined` looks whether it already is, as it may be when the stage found it not joined a moment before it was.
  - What the page shows of the state is a **projection** (`Projection.stream`): a value read off the state and its player, described by a schema, and told in a Message only when it changes. The Model holds no more of the state than the DOM shows, so `view` stays a function of the Model and Foldkit's DevTools show what changed in what is shown.
- Foldkit's DevTools stay in Inspect mode: going back in time is the rewind beside the host, which the page draws. In development an agent reaches both halves: Foldkit's own MCP relay answers for the page's Model and Messages, and `lightocean-devtools` for the game.

### API

Decided against Foldkit's principles, read as a checklist on 2026-10-10. Each holds for the engine; where Foldkit's own form did not fit a game, the reason is given.

**State.**

- Modes are tagged unions and absence is `Option`, never a boolean flag beside nullable data. The engine carries both through a component end to end: across the wire, and through interpolation, which holds the earlier value when the tag changes and moves fields within one tag. The rule is for the values of components; a view's description may have optional parameters with defaults.
- LightOcean has no router of its own: applications and the editor use Foldkit's. Addresses of hosted games, such as a room's id, are branded schemas, parsed and built from one definition, and refused at the Worker before a Durable Object is reached.

**Messages.**

- Actions and events are named facts in the past tense, never commands. An action says what a player did, whatever device they did it with (`PulledTrigger`, `ChoseRestart`); an event says what the game made of it (`Shot`, `LevelRestarted`). The pair shows where authority lies: what a player claims, and what the server decided.
- Every action a game declares, a player's or a command's result, is handled by at least one rule, since an unhandled action is something that happened outside the state to no effect. An event may go unhandled, since a domain offers its events to others and a game may not hold the one that listens; an event a game declares that nothing emits and nothing handles is unused, and an error. Either is an error in its type where TypeScript bears it, and otherwise when the game is made.
- Which systems and rules write, emit, spawn, and listen for what follows from the game's declarations, as a map of how its components change: in a game of systems there is no single `update` to read, so the declarations are what is read.
- In development the values in a state are frozen, so changing one in place fails at once.

**Commands.** A rule that needs something done outside the game, such as saving progress, returns a command: a declared value with a name, arguments, and the results it may come to (`Command.result`), failure included. Systems never issue them, since they run every step. The host executes a command outside the step with the services of its Layers, and its result enters the game as an action at a later step, recorded, so a replay or a prediction never executes one. A result carries no player, a client cannot send one, and a game whose rules leave one unhandled does not compile. A command is defined beside the rule that issues it.

**Views.** A game's client draws through four primitives over the drawn frame, each releasing what it holds through a `Scope`:

| What causes it                                              | Primitive                                                                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A rule decided something should happen outside the game     | a command                                                                                                                                                    |
| An entity is in the drawing                                 | `View.each(components, { acquire, draw })`: `acquire` builds its objects when the entity comes in, and the scope closes when it leaves or stops matching     |
| An entity just gained a component                           | `View.on`: a one-off output that is not part of the state, such as a sound or a haptic pulse                                                                 |
| A condition is true                                         | `View.during`: a resource held while `when`, a condition over the drawn state and the UI Model, is true, such as music, an `AudioContext`, or pointer lock   |
| Many entities together, or none                             | `View.whole({ acquire, draw })`: one object, built at the first frame and drawn every frame from the whole frame, such as one light for every fire burning   |
| A value outside the drawing follows the state, time and all | `View.follow({ of, to })`: `of` works the value out of every frame, and `to` puts it out as it changes, such as a pad's lightbar or the feel of its triggers |
| The player looks at the game                                | `View.rig(components, draw)`: the camera, drawn for the player's entity after every other view, from what they drew this frame, such as the eyes of a body   |

- What a player chooses or does is in the state when the game reads it, or other players must see it: a choice made once, such as the side the player joins, is a rules-owned component set by an action, and what changes every step, such as where the player heads, is a demand. What only the page reads is the page's, kept as the UI Model is. How the page turns the player's devices into demands, such as a camera mode that changes which way a stick aims, reaches the game only as the demands it makes, and every demand is in u already. What changes only how the game is drawn for that player, such as where the camera looks from, is the drawing's input, y = h(x, v), given to `View.make` as `input`: every view's per-frame function, a rig's `draw` among them, receives it, and reads it rather than the state. Kept in the state, it would come back a step late, and every other client would be sent it for nothing.
- `draw` changes only its own objects, from the drawn values, the UI Model, and the frame's time, in place and without allocating: what is drawn is a function of the state even though the scene is kept between frames. Building and diffing a whole tree every frame would allocate at the display's rate. A view keeps nothing between frames; what it must remember is a local component.
- A view's identity is the pair of its declaration and its entity, and entity ids are never reused, so nothing one entity's objects held carries over to another.
- `addEventListener`, `setInterval`, `requestAnimationFrame`, and `new WebSocket` belong inside these primitives only.
- In an application, the entities a rule handles a click on are mirrored as a hidden list of focusable elements, each read out by the entity's `Label`: Tab moves focus, focus highlights the object, and Enter sends the same action as a click. An interactive entity without a `Label` is an error when the game is made.
- A drawn frame is `Drawing.Frame`. "Presentation" names only playing a moment from the timeline, such as a killcam.

**Testing.** Two harnesses, with no mocks and no browser:

- `Story`, in core, steps a game from a state built with named entities, takes actions, and expects components, events, and commands; a command never executes, and the test resolves it with a result. Files are `*.story.test.ts`.
- `Scene`, in client, plays states through a game's views frame by frame and finds what they drew by view and entity, never by walking the scene graph; outputs such as sounds go through a recording Layer. Files are `*.scene.test.ts`.

**Inspection.** In development the host records a game's first state and, for every step, its input: the demands and the actions, command results among them; everything else follows from them. A log for people and agents adds what each step emitted, issued, and changed, and by which system or rule, and hides the demands unless asked. The debugger rewinds from a keyframe every few steps, keeps a bounded span of time, and draws a past step through the same views. A client's timeline keeps local components with each state, so a presentation of the past shows them as they were, and local systems do not run while it plays. A replay runs beside the game and reports the first step and component where the two diverge. All of it is in `@lightocean/devtools`, which only a development entry imports.

**Agents.** `@lightocean/devtools-mcp` lets an agent read a game's schema and its map of changes, query any step's state, read the log, and compare steps; and, on a local server, suspend time, act as a player through the game's own schemas, step, and turn what it did into a `Story` test. Secrets never enter the state, which travels to clients; credentials stay in the services of Layers, and a secret in a command's arguments is `Schema.Redacted`.

**Enforcement.** A rule is a type where it can be, a lint rule where it cannot, and written down only where neither can tell. `@lightocean/oxlint-plugin` has one rule per convention a type cannot hold, scoped by the call its code sits in rather than by file name, with a message that says what to do instead, and with a fixture it must fail on and one it must pass. The first rules: no `Math.random`, `Date.now`, `performance.now`, `crypto`, or Effect inside a system's or rule's `run` or a view's `draw`; no nullable or optional fields in a component's schema; no `let` or mutable closures in a view; no key derived from an index; no Three.js outside a `.view` module; secrets in commands' arguments are `Schema.Redacted`. CI runs `vp check` and `vp test` on every pull request.

**Conventions.**

- Nothing is wired implicitly: no automatic registration, decorators, wiring by file name, or global registries. All wiring is in `Game.make` and domains' `requires`.
- `AGENTS.md` holds the rules an agent follows and the exemplar files it reads first, under the one name agents' tools read. This document holds why. Agents reach for the runtime's inspection before adding logs.
- A barrel exports only the public API; what only a host or a test needs is under `/internal`, and what is not settled under `/experimental`.
- A domain lives in a folder: `index.ts` as the barrel, `name.ts` with its core part, `name.view.ts` with its client part, and its Story and Scene tests. A domain's file has the sections `COMPONENTS`, `ACTIONS`, `EVENTS`, `COMMANDS`, `RULES`, `SYSTEMS`, and `DOMAIN`.
- Every public export has a doc comment saying what it is and why. Code, tests, and documents carry no notes about discarded attempts.
- A declaration's change (`writes`, `emits`, `requires`) is an architectural change, and is where a review looks first.

**Documentation.**

- `examples/` is the curriculum and the end-to-end tests at once; each example adds one idea: a spinning cube, click to colour, Pong for two, a small horde, saving a score, and Pong over the network. A feature lands with its example.
- Code in documentation comes from compiled, type-checked snippets, except short sketches in design documents of what does not exist yet. Prose leads with its claim, and headings are labels.
- The agent skills live in `skills/`: `lightocean` frames how a game is built and where to read first, `generate-domain` adds a domain test first, and `audit-game` reviews a game against the rules, reading only. They lean on `AGENTS.md` and its exemplar files rather than code of their own. Agents read the sources of Effect and Three.js in `node_modules`, pinned by the lockfile.

**Mods, a direction.** A mod is a domain loaded while the game runs, from outside it: it requires the game's domains, owns only its own components, and reaches the game's only through the events and shared components those domains declare, which make up the game's modding interface without anyone writing one. What types check for a domain today, a game checks when it loads a mod. The first mods are data, not code: rules made in the editor, which the engine carries out as declared actions and which need no sandbox. Mods as code wait on loading code at run time, a sandbox on the server, determinism no lint can hold for code it never saw, and versions; none of it is planned yet.

**Development.** When a file changes, the host keeps its state and swaps in the new game, so a game runs on with the new logic; a state the new schema cannot decode starts over from the initial state, with the reason given. A recording starts a new segment, since a segment holds for one version of the code; going back keeps one stretch of time across every reload, each tick replayed by the build that played it.

### Stability

LightOcean stays private until the architecture above is built and Border runs on it; then its first 0.x versions are published, with changesets from then on.

- Locked: the seven principles and the decisions in this document.
- May change: names and signatures.
- A breaking change is marked with `!` in its commit, whose body gives a before-and-after table, and Border is migrated with it.
- 1.0 means the examples all work, Border runs with no seam where its server takes a client's word, LightOcean has held up in a project outside this repository, and no known flaw in correctness undermines the promise of stability.

### Positioning

LightOcean is sold by its structure, not its stack: _Your game is data. LightOcean gives every component one owner and every change a step, so your app replays, rewinds, runs on a server, and can be played by an agent._ Three.js, WebGPU, Effect, and Durable Objects come after. Each claim is shown by a running example, or it is not made.

- **A strong fit:** real-time 3D applications and games in a browser that need an authoritative server or several players; teams and agents that want shared conventions; developers already on Effect.
- **Think twice when:** you need React and React Three Fiber's ecosystem; you are building a 3D showcase with nothing to simulate, where plain Three.js does; you need a ready physics engine or high-end graphics, where Unity, Godot, or Unreal fit; you need thousands of entities today, before optimization is measured.
- Compared honestly: Three.js and React Three Fiber solve rendering and leave the architecture to you; Bevy has the ECS LightOcean follows, but is not made for the web or an authoritative server; Colyseus is a server without an engine; PlayCanvas and Babylon.js are engines with editors scripted imperatively.
- A `Viewport` embeds in any page or existing application, and existing Three.js code can live as an imperative island while it moves over.
- A `Viewport` draws as bare Three.js does unless told otherwise; what more it does is asked for, one thing at a time: ambient occlusion, antialiasing, and ray tracing (`RayTracing`), which traces indirect light and reflections through the picture just drawn (`Screen`), or through the scene's own triangles held in two levels of bounding volume hierarchy, as ray-tracing hardware holds a scene (`Scene`). Browsers do not yet let a page reach the cores made for rays, so `Scene` traces on the shader cores; its layout is the hardware's, so it can move to them once they are reachable.

### Audience

- The tool serves developers and non-coders alike. The low-code mode is the preferred way to build.
- Developers extending an application write Effect.

### Editor

- The editor runs in the browser. Locally it is served through Alchemy (`npm run dev`), as a Cloudflare website.
- **The document is a state.** Its objects are entities with components, hosted in a worker beside the page; whoever edits it is a player, and every edit is their action, which the document's rules check against the components' schemas before anything changes. What each editor has selected is on their own entity, so an agent sees it too, and editors at one document see each other's.
- **Outliner, Viewport, and Details**, as in Unreal. The panels read the document through projections, and send it every edit as a Command. The Details panel is generated: a schema field annotated with `inspector` shows with the widget it names, and a field without the annotation cannot be edited there.
- **Behaviour is low-code rules.** An object holds reactions of the form _when clicked, make a change to a target_. Each kind of change is itself an annotated schema, so its settings use the same generated form.
- **Play-in-Editor** plays the document in a worker of its own, which the page opens with the document as it is, in a game that has no editing in it: a click makes objects react, and nothing is edited meanwhile. Stopping ends the worker, and everything that happened while playing with it.
- **The debugger is part of the editor**, not a development tool. Beside the game playing, it keeps its last stretch of time and answers the page's questions over the game's own connection, so it works wherever the editor plays: each step in which something happened, what each part changed, and the state after any of them, on the canvas too, while the document's time is suspended.
- Foldkit's own DevTools stay available in development, for debugging the editor itself.

## Repository

- `libraries/core`: the state, components, actions, events, systems, rules, the game, the host, the client, transports, and snapshots; and, as experimental, `SocketTransport`, a connection to a host over a WebSocket.
- `libraries/server`: as experimental, `Room`, a game hosted for players across a network, one room in each Durable Object, standing still while no one is in it, and `Room.Id`, a room's address, refused at the Worker before a Durable Object is reached.
- `libraries/client`: the timeline, interpolation, and the drawing; and, as experimental, `Prediction`, a player's own client playing ahead of its host, its demands sent once a step and replayed on the newest state until the host says it took it in, and what is drawn going over to the host's in a few frames when they disagree.
- `libraries/foldkit`: a game in an application built on Foldkit: `Session`, a player's connection to it, joined in a worker the page starts and held as a Foldkit Managed Resource while the application's Model wants it; and `Stage`, the game shown on a canvas Foldkit keeps, through the game's views, played by a click, and mirrored for the keyboard, while a Subscription runs, with what the application runs beside it, such as serving the canvas to the devtools, or drawn by the page itself on an element of its own, such as with a renderer of its own, its Messages going on to the application (`Stage.run`); `Projection`, what an application shows of a game's state, kept in its Model, told as it is and again only when it changes; and `Styled`, StyleX on Foldkit's elements.
- `libraries/devtools`: `Recording`, a game as a host played it, in a segment for each version of its code, made from what the host lets be watched; `Version`, which code played: its build and the schema of its state; `Fingerprint`, a state told in a hash per component; `Replay`, which plays a recording again, or beside a host as it plays, and says where it comes apart; `Log`, what each step of a recording did, by which system or rule; `Rewind`, going back in a hosted game from keyframes, showing the past to its clients, and playing on from it; `Reload`, a host kept across new builds of its game; `Inspect`, what an agent or a page asks of a hosted game, answered as data, to a page over the game's own connection; `Debugger`, the past kept beside a host and its clients' questions answered, wherever it runs; and `Bridge` and `Relay`, the way an agent's requests travel from a tool to a host and back.
- `libraries/vite-plugin`: the development server as the way to a game's hosts for the tools on the machine: a relay on a loopback port of its own, with a token, and a record of where it is; the MCP server over HTTP at `/__lightocean/mcp`; and a banner saying what is served and where both are reached. `Build` names each build of a game's code, in the module `virtual:lightocean/build`, which a game's worker gives its host.
- `libraries/devtools-mcp`: a running game as MCP tools for an agent, over stdio or over HTTP at a development server, reaching its hosts through the development server's relay; `.mcp.json` offers it over stdio.
- `libraries/reflection`: `Inspector`, the annotations and the reading of them that the Details panel is generated from.
- `skills/`: the agent skills, `lightocean`, `generate-domain`, and `audit-game`.
- `applications/editor`: the editor: a document held as a game's state, edited by its editors' actions; played in a worker of its own; and debugged while it plays.
- `applications/playground`: cubes a player asks for and paints: a game in a worker, drawn on a canvas, with the page around it Foldkit's, and the first application built of the two together.
- `applications/website`: the engine's website: one page saying what LightOcean is, under an ocean of lights that is a game on the engine, swelling and rippling out from a light clicked, and showing the smallest game's files as the repository has them; and the shell the engine's documentation is drawn in, after Foldkit's own, its pages written in markdown and read at build time by `@foldkit/markdown`.
- `examples/spinning-cube`: the first example, a cube that turns: one component, one system, one domain, one view, told as a story and as a scene, and drawn in a browser from a local server in a worker.
- `examples/click-to-colour`: cubes a click paints the next colour of a palette: a game played by clicking what is drawn, through the `Pointing` domain the engine gives.
- `examples/save-score`: a round against the clock whose score is saved: a rule that issues a command, the `Scores` service it needs, a Worker that keeps every score in Cloudflare KV, deployed by Alchemy with the namespace bound to it, and a page on Foldkit that says how the round goes.
- `examples/shared-room`: walkers in a room many players share, steered by the keys: a Worker that sends a page to its room, a Durable Object for each room hosting it with `Room`, and a page that opens it over a WebSocket and predicts its own player with `Prediction`, deployed by Alchemy.
- `examples/horde`: survivors in an arena against a horde that keeps rising: three domains requiring one another and sharing where bodies are, demands and actions, events between domains, randomness, and entities spawned and despawned; what the devtools are shown on.

The packages are `core` (with commands, domains, and `Story`), `client` (with local systems, views, `Viewport`, and `Scene`), `server` (hosting in a Durable Object; persistence is to come), `foldkit`, `reflection`, `devtools`, `devtools-mcp`, `vite-plugin`, and `oxlint-plugin`.

## Development

- Development is test-driven: each behaviour starts as a failing test.
- Tests run in Node. Three.js's scene graph, materials, and raycasting are plain JavaScript and run there unchanged; what needs a real browser (the renderer, the Foldkit wiring) is not covered by tests yet.

## Next

The API above is built in this order, each step test-first, and each breaking one with Border's migration:

1. The game declares its components, actions, and events, and the schema of its whole state follows from it; hosts and clients take them from the game. Tagged unions and `Option` travel in components and interpolate.
2. `Story`, and the engine's own tests moved onto it.
3. The map of changes, frozen states in development, and the fixtures named as facts.
4. Domains: owning their components, requiring one another, every action handled and no event unused, and the `/internal` entry.
5. Commands.
6. Local systems.
7. Views (`View.each`, `View.on`, `View.during`, `View.whole`, `View.follow`, `View.rig`), `Drawing.Frame`, `Scene`, and `Viewport` in `client`, with the first example.
8. The lint plugin, and `AGENTS.md`.
9. Devtools: recording, the log, rewinding, the determinism check, and reloading with the state kept, with the horde example.
10. The agent bridge.
11. Devices: bindings as data, the gamepad, the mouse and keyboard, WebHID, rumble and haptics, and lights, with the horde played on a pad.
12. Applications as games: picking and the `Pointing` domain, the accessible mirror (both built ahead of devices), then the playground and the editor, and `engine` gone, with their examples.
13. Skills, and the example that saves a score.
14. Hosting in a Durable Object and prediction, as experimental, with the example over the network.

Border is eight domains (Level, Body, Player, Progress, Undead, Shooting, Knife, Explosives), and none writes what another owns: what one domain does to another's components goes by an event the other declared, such as a weapon's `Hit` that the undead decide on, and only where bodies are and how they move is shared. Border's seams close along the way, once what each rests on is in the simulation: her health and death (`Died`, and blows the game takes off her health), how she gives herself away (`Presence`, from the lab's lights, her lamp, and her fear), her grenades' flight (`Exploded`), and what she bought (`Stab.deadly`); and pillars and crates become shapes with height, so rounds stop at them.

Later, for the editor:

- Undo and redo, once it is decided what one step is (a keystroke in a field is not one).
- Camera controls in the viewport, and a gizmo for moving objects.
- More triggers (on start, on a timer) and program data beyond the objects, such as variables and conditions.
- Saving the document to disk, through a local CLI.
- Browser tests for what Node cannot cover.

Later, for the model:

- Output for each client, yₚ = hₚ(x). A snapshot is the host's output for a client, and today it is the same for every client: the state without its private and local components, so private hides a thing from every player, the one who should see it included. A game would declare what each client sees as a function of the state and the player, and the host would make each client's snapshot by it, the roles staying the h of every game that declares nothing more: a player's own hand in a card game, fog of war, only what is near a player in a large world, and stealth. The check of predictions would then count what a given client does not receive among what it does not hold.
- Messages between hosts. A game may run on several hosts that talk by commands and actions, but a host cannot yet take in a message from another: there is no input for one and no kind of action for it. It needs that input, a third kind of action beside a player's and a command's result, and a way to address a host.
- Migrating a state between versions: a save made by an earlier version, read by one whose schema changed. Today a state the new schema cannot read starts over; a version could instead declare how it reads the states of the one before.
- Entity ids a client predicts. A step gives out ids from one counter, so a part spawning from what a client does not hold moves the ids every part after it gives out, and a predicted component holding the id of another entity would differ on the client. Ids by part, as randomness is drawn, would close it.

Optimization waits until the raw engine works: an interpolation buffer, binary encoding, and sending each client only what is near it are tuned against something real, not ahead of it.

## Findings

A spike that hosted a game in a Durable Object answered whether Durable Objects can host a fixed-step server. They can.

- Stepping once per timer firing ran the game 9 % slow, because a timer always fires late and stalls swallow whole intervals. Taking as many steps as real time owes, capped at five, keeps the game at its real rate.
- Deployed on Cloudflare, two clients over 20 seconds: the room took every step on time and gave none up, round trips had a median of 25 ms, and snapshots arrived 33 ms apart at the median. The stalls of about 300 ms seen under `alchemy dev` did not happen.
- The irregularity is on the way to the client: 5 % of snapshots arrived about 100 ms after the one before, in bunches. Over TCP one lost packet holds back everything behind it, which is the case for WebTransport's datagrams; Wi-Fi power saving can bunch packets too. It was one run from one network.
- A snapshot of two players is about 210 bytes of JSON, so a datagram fits about ten players before encoding has to become binary.

Border, played on a local server in a Web Worker at 60 Hz and drawn a step behind it without prediction, had no latency its player could feel. Prediction waits for play across a network, where the round trip adds to that step.

Border's whole fight runs in the simulation: her body, the lab's progress and doors, the undead with their senses, chase, and blows, her shots, her knife, and every blast. The game only draws it, and keeps for itself what happens round her body once she is dead. With a wave of 22 of the undead up, a whole snapshot is 11.5 kB of JSON; applying one takes 0.18 ms and a step 0.24 ms, measured in Node, so snapshots carrying only what changed can wait.

Split into eight domains, Border grew by 3 % and from ten events to fifteen; no domain writes another's components any more, where sixteen systems and rules did, and what a hit does to one of the undead is one rule instead of three slightly different ones. Asking who changes a component is answered by one line of `Game.changes`. Two costs are known and watched rather than fixed: some events only relay a decision to the domain that owns what it changes, such as `Fell` and `Rose` setting whether a body is in the way; and an event emitted by a system is handled after every system has run, so what it starts happens a step later, as a tank lit by a round now goes up one step (a sixtieth of a second) after it is hit. If relays multiply, components derived from others may answer them; if a step's delay shows, so may handling some events between systems.

The playground answered how Foldkit and a game meet. Rules keep their own loop, in a host, and Foldkit keeps the UI: its `update` decides what the page does and asks the game through Commands, never steps it. Of Foldkit's mechanisms, a Mount reaches only its element, so the canvas Mount says only that the canvas is there, and a Subscription, which reaches Managed Resources, shows the game; what the page shows of its state arrives as projections, a Message only when a value changes, so the page's Model stays as small as what it shows.

## Open questions

- How simulation components are stored so per-step work does not copy immutable data, while their schemas still describe them.
