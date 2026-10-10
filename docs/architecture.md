# Architecture

LightOcean is an engine for web applications in the way Unreal Engine is an engine for games: an editor, a runtime, and a project format that the two share.

This document records the decisions taken so far, what is built, and what comes next. It grows alongside the code.

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

The Elm Architecture covers the whole application, not only its DOM.

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

- Undo and redo, once it is decided what one step is (a keystroke in a field is not one).
- Camera controls in the viewport, and a gizmo for moving objects.
- More triggers (on start, on a timer) and program state beyond the objects, such as variables and conditions.
- Saving the document to disk, through a local CLI.
- Moving the viewport's Foldkit wiring, now repeated in the editor and the playground, into a library.
- Browser tests for what Node cannot cover.

## Open questions

- How time reaches `update`: event-driven only, an optional per-frame tick a program subscribes to, or a fixed-rate tick for everyone. Rules triggered by a timer will need an answer.
