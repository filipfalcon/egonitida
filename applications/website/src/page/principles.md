# Principles

Seven principles form the shortest route to a working knowledge of LightOcean. Every system in the engine rests on them, so once they click, the rest of the documentation reads like a sequel rather than a textbook.

## 1. State

A game has exactly one state, described by Effect Schema. Rules and simulation read and write that one state; no hand-written bridge keeps two copies in agreement.

That state follows the Entity Component System model popularized by Bevy. An entity is only an id, components are the data attached to it, and systems are functions that run over every entity holding a given set of components.

Every component has exactly one owner, declared in its schema:

- **Rules** own the facts the game decides, such as health, ammunition, or an open door. Only rules change them, and only when an action or an event happens.
- **Simulation** owns whatever changes every step, such as positions. Only systems change it.
- **Input** owns what players control, such as a tilted stick or a pulled trigger. The engine writes it at the start of each step, and nothing else may.

A game declares everything its state is made of: its components, actions, and events. One schema for the whole world follows from that declaration, covering its components, tick, randomness, and next entity id. Snapshots, saves, recordings, and the debugger all speak that same schema.

A system declares what it reads, writes, and emits; a rule declares what it writes and emits. The type checker holds both to their word, so writing a component they do not own is a compile error, not a runtime bug. Spawning works the same way: each lists the components it may create an entity with, whoever owns them, since being born changes no one's existing state. Everyone can read everything, so nothing is ever copied and nothing drifts out of sync.

State that only a client keeps, such as a ragdoll, blood, or spent casings, lives in the same world as local components, changed by systems that run on that client alone.

What appears on screen is never a source of truth. The scene is derived from the state, never the other way around.

A level is entities, too. Walls, obstacles, and doors are entities with components, so one model covers everything the world holds, and an editor or a debugger sees a level exactly as it sees everything else.
