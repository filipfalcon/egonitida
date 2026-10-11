<p align="center">
  <img src="docs/Splash.png" alt="A silver-haired warrior with a pearl crown and wings of water, against an ocean of waterfalls and clifftop castles.">
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
</p>

<h3 align="center">Build games agents understand.</h3>

<p align="center">
  <a href="docs/architecture.md"><strong>Architecture</strong></a> · <a href="examples"><strong>Examples</strong></a> · <a href="AGENTS.md"><strong>Rules</strong></a> · <a href="#running-it"><strong>Running it</strong></a> · <a href="https://discord.gg/F3YkynckH"><strong>Discord</strong></a>
</p>

---

LightOcean is an engine for real-time web applications and games. Your world is data: every piece of state has one owner and every change happens in a step, so a game replays, rewinds, runs on a server, and can be played by an agent.

A game is a world of entities and components. Systems and rules step it at a fixed rate on a host, which is a Web Worker for one player or a Cloudflare Durable Object for many. Views draw it on clients with Three.js on WebGPU. The page around it is Foldkit.

> [!WARNING]
> LightOcean is not published yet. It stays private until its architecture is built and Border, the first game on it, runs on it. Names and signatures may still change.

## A game

The smallest game is a cube that turns: one component, one system, one domain.

```ts
import { Component, Domain, Game, System, World } from '@lightocean/core';
import { Schema } from 'effect';

export const Spin = Component.make(
  'Spin',
  Schema.Struct({
    angle: Schema.Finite.annotate({ interpolate: 'angle' }),
    speed: Schema.Finite,
  }),
  { owner: 'simulation', network: 'server' },
);

const turn = System.make({
  name: 'turn',
  reads: [],
  writes: [Spin],
  emits: [],
  run: (context) => {
    for (const [cube, spin] of context.query(Spin)) {
      const angle = spin.angle + spin.speed * Math.PI * 2 * context.time.stepSeconds;
      context.set(cube, Spin, { ...spin, angle });
    }
  },
});

export const domain = Domain.make({
  name: 'Cube',
  requires: [],
  components: [Spin],
  actions: [],
  events: [],
  systems: [turn],
  rules: [],
});

export const game = Game.make({ stepRate: 60, domains: [domain] });

export const [world, cube] = World.spawn(World.empty({ seed: 1 }), [
  Spin.of({ angle: 0, speed: 0.25 }),
]);
```

A view draws every entity that has a `Spin`. It lives in its own module, so the server never imports Three.js:

```ts
import { View } from '@lightocean/client';
import { Effect } from 'effect';
import * as Three from 'three/webgpu';
import * as Cube from '#src/cube.ts';

export const cubes = View.each([Cube.Spin], {
  acquire: () =>
    Effect.acquireRelease(
      Effect.sync(
        () =>
          new Three.Mesh(
            new Three.BoxGeometry(1, 1, 1),
            new Three.MeshStandardNodeMaterial({ color: 0x3fa7d6 }),
          ),
      ),
      (mesh) =>
        Effect.sync(() => {
          mesh.geometry.dispose();
          mesh.material.dispose();
        }),
    ),
  draw: (mesh, held) => {
    mesh.rotation.y = held(Cube.Spin).angle;
  },
});
```

A test steps the game itself. Time is the world's step, so there are no mocks and no fake timers:

```ts
it('turns a cube once every four seconds', () => {
  Story.story(
    Cube.game,
    Story.given(Cube.world, { cube: Cube.cube }),
    Story.seconds(1),
    Story.expect('cube', Cube.Spin, ({ angle }) => expect(angle).toBeCloseTo(Math.PI / 2)),
    Story.seconds(3),
    Story.expect('cube', Cube.Spin, ({ angle }) => expect(angle).toBeCloseTo(Math.PI * 2)),
  );
});
```

The whole example, with the worker and the page that draws it, is in [`examples/spinning-cube`](examples/spinning-cube/src).

## What the structure buys

- **One owner for every field.** A component says whether the rules or the simulation own it, and whether it is sent to clients, kept on the client, or kept on the server. A system that writes what it does not own does not compile.
- **Domains instead of a pile of code.** A game is a list of domains. A domain writes only its own components and changes another's state by emitting an event that domain declares. Asking who changes a component is one call to `Game.changes`.
- **Determinism.** Systems take randomness and time only from their context; a lint rule enforces it. The same build and the same inputs give the same world, which is what rewinding, recordings, and the determinism check in development rest on.
- **One shape for one player and many.** A singleplayer game runs its server in a Web Worker. The same game can be hosted for players across a network in a Durable Object; that hosting is experimental, and prediction for it is planned.
- **Effects at the edges.** Steps and frames are plain synchronous code. Effect runs the hosting, the transports, the services, and the commands a rule issues when it needs something done outside the world, such as saving a score.
- **Tools for agents.** In development, the `lightocean-devtools` MCP server lets an agent read the running world, hold and step time, play as one player or several, take screenshots, and turn what it played into a test.

## Built on

| Part           | What it does here                                                         |
| -------------- | ------------------------------------------------------------------------- |
| Effect 4       | Schemas for every component, services and Layers, hosting, and transports |
| Three.js       | The only renderer, on WebGPU, with materials written in TSL               |
| Foldkit        | The DOM: an application's UI, a game's HUD and menus, and the editor      |
| Cloudflare     | Durable Objects host rooms over a network (experimental)                  |
| Vite+, Alchemy | Development servers, checks, tests, and deployment                        |

## When to use something else

- You need React and the React Three Fiber ecosystem.
- You are building a 3D showcase with no state; plain Three.js does that.
- You need a ready physics engine or high-end graphics; Unity, Godot, or Unreal fit better.
- You need thousands of entities today. Performance has not been measured and optimized yet.

## Repository

| Path                       | What is in it                                                                  |
| -------------------------- | ------------------------------------------------------------------------------ |
| `libraries/core`           | The world, components, systems, rules, the game, hosts, clients, and `Story`   |
| `libraries/client`         | The timeline, interpolation, views, `Viewport`, and `Scene`                    |
| `libraries/server`         | `Room`: a world hosted in a Durable Object (experimental)                      |
| `libraries/foldkit`        | A world inside a Foldkit application: `World`, `Stage`, `Projection`, `Styled` |
| `libraries/devtools`       | Recording, replay, the step log, rewinding, and reloading with the world kept  |
| `libraries/devtools-mcp`   | A running game as MCP tools                                                    |
| `libraries/vite-plugin`    | The development server as the way tools reach a game                           |
| `libraries/reflection`     | Schema annotations the editor's Details panel is generated from                |
| `libraries/oxlint-plugin`  | Lint rules for what the types cannot enforce                                   |
| `applications/editor`      | The editor: a document that is a world, played and debugged in the browser     |
| `applications/playground`  | Cubes a player asks for and paints, with the page around them in Foldkit       |
| `examples/spinning-cube`   | A cube that turns                                                              |
| `examples/click-to-colour` | Cubes a click paints                                                           |
| `examples/save-score`      | A round whose score a rule saves through a command, to a Worker over KV        |
| `examples/horde`           | Survivors against a horde: several domains, input, randomness, spawning        |
| `examples/shared-room`     | Walkers in a room many share across the network, each player's own predicted   |
| `skills`                   | Agent skills for starting out, adding a domain, and auditing a game            |

## Running it

LightOcean needs Node 24.15 or later and npm 12.

```bash
npm install
```

Format, lint, and type-check everything:

```bash
npm run check
```

Run every test:

```bash
npm test
```

Serve the playground, the editor, the save-score example with its Worker, and the network spike through Alchemy:

```bash
npm run dev
```

Serve one example on its own:

```bash
npm run dev -w @lightocean/example-horde
```

## Contributing

Read [`AGENTS.md`](AGENTS.md) first. It holds the rules for types, state, messages, drawing, and tests, and it applies to people as much as to agents. Each behaviour starts as a failing test. Commits follow Conventional Commits and are signed.

Why the engine is built this way, and what comes next, is in [`docs/architecture.md`](docs/architecture.md).

## License

LightOcean is released under the MIT License. The full terms are in the [LICENSE](LICENSE) file at the root of this repository. Unless stated otherwise, every contribution submitted to this project is licensed under the same terms.
