# Architecture

LightOcean is an engine for web applications in the way Unreal Engine is an engine for games: an editor, a runtime, and a project format that the two share.

This document records the principles the engine stands on, the decisions taken so far, what is built, and what comes next. It grows alongside the code.

The first game to run on the engine is Border, a first-person browser game in its own repository, which links LightOcean as a package. Its needs are what the principles below were measured against.

## Principles

Six principles shape every API. Each builds on the ones before it.

### 1. State: one state, ownership is a type

- A game has one state, described by Effect Schema. It is not split into a rules Model and a simulation world joined by a hand-written bridge, the way Border joins them today.
- The simulation follows the Entity Component System model, after Bevy: an entity is an id, components are the data attached to it, and systems are functions over every entity with given components.
- Every field has exactly one owner, declared in its schema:
  - **Rules** own the facts the game's rules decide, such as health, ammunition, or an open door. Only `update` changes them, through Messages, which are recorded.
  - **Simulation** owns what changes every step, such as positions. Only systems change them.
- A system declares what it reads, what it writes, and what it emits. Writing what it does not own is a compile error, not a runtime bug. Everything is readable by everyone, so nothing is ever copied and kept in sync.
- Events a system emits are applied by the rules at a defined point in the step, so the next step already sees their result. Nothing waits on an asynchronous queue.
- Systems and rules spawn and despawn entities within a step, and declare it: `spawns` lists the components they may create an entity with, whoever owns them, since being born changes no one's state; `despawns` says they may remove one, which takes it out of every component at once. Either takes effect at once, so what runs later in the same step sees it; steps run in order, so nothing needs a queue of commands, as Bevy's parallel systems do. Ids come from the world's own counter, so a replay gives out the same ones, and a despawned id is never given out again.
- What is drawn is never a source of truth: the scene is derived from the state.
- A level is entities too: walls, obstacles, and doors are entities with components, so there is one model for everything the world holds, and an editor and a debugger see a level the way they see the rest. Stores never change in place, so a system may build something from one, such as a spatial index, and keep it for as long as the store is the same.

### 2. Network: an authoritative server, from the start

- The engine is built for multiplayer and for worlds split across many servers, as much as for singleplayer.
- A server is a Cloudflare Durable Object: one object is one world, room, or zone. It simulates the world and sends clients its state. A client predicts its own player so input answers at once, corrects itself when the server disagrees, and interpolates everything else between the server's states.
- Every field declares its network role next to its owner:
  - **Server**: decided by the server and sent to every client.
  - **Predicted**: guessed by the client, confirmed by the server.
  - **Local**: kept on the client only and never sent, such as blood, casings, or a ragdoll after death. Most of what is expensive in Border is local.
- The engine always has the client–server shape. Singleplayer is the same code with the server running in a Web Worker in the browser, the way Minecraft runs an integrated server; switching to multiplayer is configuration. The price is that a singleplayer game also sends its input as commands and marks what is local.
- There is no single player in the API, only the set of players.
- Whether time may stop is the host's policy, not the world's: a local server grants a player's pause, a shared world refuses it. Switching a game to multiplayer turns its pause into a menu that does not stop anything, and the game has to live with that.
- Schemas double as the wire format, and change detection decides what is sent.

### 3. Time: a fixed step, smooth drawing

- The simulation advances in fixed steps. The step rate is a setting of each game, given to `Game.make` and never defaulted by the engine, fixed for the game's lifetime, because tuning and recordings depend on it. Border steps at 60 Hz. A system that needs finer steps, such as a ragdoll, subdivides its own.
- The step rate is one number everywhere: the server, a client predicting, and a replay all take the same steps, or prediction would not match. How often snapshots are sent is a separate, lower number when bandwidth calls for it, such as 20 or 30 Hz; clients interpolate between them.
- Input is read once a step, so a step's length bounds how fast movement answers. Looking around is the client's alone, every frame, outside the simulation; the simulation only receives where the player looks as part of its input.
- A displayed frame reads input, runs as many fixed steps as real time calls for (each step: systems, then events, then rules), interpolates between the last two steps, and draws. The number of steps per frame is capped, so a slow machine slows the game briefly instead of falling ever further behind.
- The world has one time, and it only moves forward, step by step, at the game's rate. Nothing inside the world scales it or stops it; only the host can hold it, by its policy.
- Presentation never changes how the world runs, in singleplayer or multiplayer alike, because a game can always be switched between the two. A client keeps a timeline of recent worlds, which serves three things:
  - interpolation, drawing slightly in the past between two worlds;
  - prediction, going back to a confirmed world to replay what the server has not confirmed;
  - presentations, such as a slowed death, a frozen frame, or a killcam, which play a moment from the timeline at their own pace while the live world goes on, then return to it.
- What is drawn between two worlds holds the entities of the earlier one until the later one is reached: an entity appears or leaves when its world does, never at a guessed place in between. A drawn frame can be queried like a world, and tells which entities came into the drawing and which left it since the frame before, and which gained or lost a given component, so a game makes and puts away what stands for them without comparing lists itself.
- A moment, such as a hit or a death, is state too: the rules or the simulation give it to what it happened to as a component, such as `Dying { cause, along, since }`, kept for as long as it is shown. It survives a lost snapshot, since the next one carries it, and a presentation playing the past shows it again. Clients receive nothing from the server but worlds.
- A timer is an engine primitive on the world's time, owned by an entity or a state, and it disappears with its owner. Guards against stale completions, like Border's counters, are not needed.

### 4. Determinism: the whole world replays

- Determinism is a cornerstone of the engine. With the same build and the same inputs, the server's world steps to exactly the same result.
- One mechanism serves three purposes: the client's prediction rewinds to the server's state and replays the inputs not yet confirmed; the debugger rewinds the whole world, not only the rules; and games can build replays, spectating, and death cameras on real recordings. A recording also makes a test.
- Systems take randomness only from the engine's `Random` resource and time only from its `Time` resource; `Math.random` and `Date.now` are lint errors there. Asynchronous results enter as recorded events.
- In development the engine replays alongside the running game and compares state fingerprints, reporting the first step and component where the two diverge.
- Cosmetics are deterministic too: an event carries a seed, so every client generates the same blood from it without anything more being sent.
- Rewinding starts from the nearest periodic snapshot and steps forward. A recording carries the fingerprint of the build it is valid for.

### 5. Boundaries: everything is a plugin

- The engine is made of plugins, and its own features (drawing, physics, audio, input, network) are plugins too. A game can do whatever the engine does, and can replace any plugin, as Border would replace physics with its own ragdoll.
- A plugin is an Effect Layer that registers components, systems, and resources and declares the plugins it requires. A missing dependency is a compile error, and tests swap in other Layers.
- Packages come in three layers:
  - **core**: the state, systems, schedule, time, randomness, replay, network protocol, and game rules. It runs everywhere, and it compiles without the DOM's types, so the simulation always runs in a Durable Object.
  - **client**: drawing, audio, input, haptics, cosmetics. Browser only.
  - **server**: hosting a world in a Durable Object, and persistence.
- A game's plugins split the same way, such as a horde's AI in core and its animation in client.
- Imperative islands are allowed for gradual migration: a local, client-only plugin may use Three.js as it likes, but cannot write the state it does not own. Border can move onto the engine by wrapping its current code this way first.

### 6. Frame pacing: measured, never assumed

Frame pacing is a requirement, not a polish pass. A frame is presented on time and motion inside it is placed at the right moment, at whatever rate the display runs.

- **Time from the display.** Interpolation and motion read the timestamp `requestAnimationFrame` hands a frame, the moment it is presented, never the moment code happens to run.
- **No allocation in the hot path.** Nothing that runs every frame or every step creates objects; it works on pools, typed arrays, and preallocated vectors. This is a requirement on how simulation components are stored.
- **The simulation off the main thread.** A singleplayer game's local server runs in a Web Worker, so the main thread only reads input, interpolates, and draws.
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

## Decisions

### Rendering

- Three.js is the only renderer. Everything outside the DOM layer is a Three.js scene.
- WebGPU is the target, through `three/webgpu` and its `WebGPURenderer`. The WebGL 2 fallback is whatever Three.js provides on its own; no effort goes into it, and features that need compute may not work on it.
- Materials and shaders are written in TSL only. No GLSL, `ShaderMaterial`, or `onBeforeCompile`. TSL being a node graph is what makes a Material Editor a natural fit later.

### Language

- Everything is written in Effect, on the 4.x line. The repository pins `effect` at exactly 4.0.0, because Foldkit and its tooling declare that exact version as a peer dependency.
- Effect Schema is the reflection system, the counterpart of Unreal's `UCLASS` and `UPROPERTY`. One schema gives a type its saved format, its validation, and its Details panel.
- GPU resources are acquired and released through `Scope`, so disposal is never manual.

### Program model

The first iteration, built before the principles above: the Elm Architecture over the whole application. It stays for applications whose state is small, and is the base the editor's Play-in-Editor runs on. Games follow the principles above.

- One program has one Model and one `update`, and two views of the Model:
  - `view: Model → Html`, rendered by Foldkit into the DOM.
  - `viewScene: Model → Scene`, rendered by LightOcean into Three.js.
- `Scene` is a declarative tree of keyed nodes. A reconciler applies the difference between two trees to the live Three.js graph, keeping objects whose keys survive.
- A click in the 3D world comes back as a Message: the nearest object under the pointer decides it, an object without a handler blocks it, and a click that hits nothing produces the scene's `onClickNothing`.

### The frame loop

- The scene is rebuilt when the Model changes, not every frame.
- Continuous motion is declared as data on a node, such as a spin. The engine advances it every frame without touching the Model, so the Model holds intent and the engine produces motion.
- The per-frame work is tight synchronous code inside one Effect, with no Effect operation per object.

### UI

- Foldkit renders the DOM layer of every application and the editor itself. Forms, text, links, and accessibility come from the DOM, the way Unreal layers UMG over its world.
- The 3D viewport joins Foldkit through two of its own mechanisms:
  - A **Mount** on the canvas acquires the renderer for exactly as long as the canvas is in the DOM.
  - A **Subscription** that stays alive across Model changes runs the frame loop, draws the latest scene, and turns clicks into Messages.

### Audience

- The tool serves developers and non-coders alike. The low-code mode is the preferred way to build.
- Developers extending an application write Effect.

### Editor

- The editor runs in the browser. Locally it is served through Alchemy (`npm run dev`), as a Cloudflare website.
- **Outliner, Viewport, and Details**, as in Unreal. The Details panel is generated: a schema field annotated with `inspector` shows with the widget it names, and every edit is checked against the field's schema before it reaches the document. A field without the annotation cannot be edited there.
- **Behaviour is low-code rules.** An object holds rules of the form _when clicked, do an action to a target_. Each action is itself an annotated schema, so its settings use the same generated form.
- **Play-in-Editor** turns the document into a running program: the world is the Model, a click is a Message, and the rules are `update`. Stopping discards everything that happened while playing.
- **The debugger is part of the editor**, not a development tool. While playing it shows every event, what each changed, and the Model at any of them. Selecting a past event shows the world as it was, the 3D view included, because the scene is only a function of the Model.
- Foldkit's own DevTools stay available in development, for debugging the editor itself.

## Repository

- `libraries/engine`: the `Scene` description, `SceneHost` (reconciler, picking, motion, resource lifetimes), and `Viewport` (the renderer on a canvas).
- `libraries/reflection`: `Inspector`, the annotations and the reading of them that the Details panel is generated from.
- `applications/editor`: the editor.
- `applications/playground`: the first proof that one Model drives both the DOM and the 3D world.

## Development

- Development is test-driven: each behaviour starts as a failing test.
- Tests run in Node. Three.js's scene graph, materials, and raycasting are plain JavaScript and run there unchanged; what needs a real browser (the renderer, the Foldkit wiring) is not covered by tests yet.

## Next

- Closing the seams where Border's server still takes its client's word, while what they rest on is still the game's: her health and death (`Died`, and blows the game takes off her health), how she gives herself away (`Presence`, from the lab's lights, her lamp, and her fear), her grenades' flight (`Exploded`), and what she bought (`Stab.deadly`). Each goes once what it rests on moves into the simulation.
- Pillars and crates as shapes with height, so rounds stop at them as they do in the game.
- Prediction, once a client plays a server across a network.

Later, for the editor:

- Undo and redo, once it is decided what one step is (a keystroke in a field is not one).
- Camera controls in the viewport, and a gizmo for moving objects.
- More triggers (on start, on a timer) and program state beyond the objects, such as variables and conditions.
- Saving the document to disk, through a local CLI.
- Moving the viewport's Foldkit wiring, now repeated in the editor and the playground, into a library.
- Browser tests for what Node cannot cover.

Optimization waits until the raw engine works: an interpolation buffer, binary encoding, and sending each client only what is near it are tuned against something real, not ahead of it.

## Findings

The Durable Object spike (`applications/net-spike`) answered whether Durable Objects can host a fixed-step server. They can.

- Stepping once per timer firing ran the world 9 % slow, because a timer always fires late and stalls swallow whole intervals. Taking as many steps as real time owes, capped at five, keeps the world at its real rate.
- Deployed on Cloudflare, two clients over 20 seconds: the room took every step on time and gave none up, round trips had a median of 25 ms, and snapshots arrived 33 ms apart at the median. The stalls of about 300 ms seen under `alchemy dev` did not happen.
- The irregularity is on the way to the client: 5 % of snapshots arrived about 100 ms after the one before, in bunches. Over TCP one lost packet holds back everything behind it, which is the case for WebTransport's datagrams; Wi-Fi power saving can bunch packets too. It was one run from one network.
- A snapshot of two players is about 210 bytes of JSON, so a datagram fits about ten players before encoding has to become binary.

Border, played on a local server in a Web Worker at 60 Hz and drawn a step behind it without prediction, had no latency its player could feel. Prediction waits for play across a network, where the round trip adds to that step.

Border's whole fight runs in the simulation: her body, the lab's progress and doors, the undead with their senses, chase, and blows, her shots, her knife, and every blast. The game only draws it, and keeps for itself what happens round her body once she is dead. With a wave of 22 of the undead up, a whole snapshot is 11.5 kB of JSON; applying one takes 0.18 ms and a step 0.24 ms, measured in Node, so snapshots carrying only what changed can wait.

## Open questions

- Whether Foldkit can apply game rules synchronously inside a step, or whether rules need their own loop with Foldkit kept for UI.
- How simulation components are stored so per-step work does not copy immutable data, while their schemas still describe them.
