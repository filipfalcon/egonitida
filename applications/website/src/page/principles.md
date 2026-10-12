# Principles

Seven principles form the shortest route to a working knowledge of LightOcean. Every system in the engine rests on them, so once they click, the rest of the documentation reads like a sequel rather than a textbook.

The principles use the engine's own vocabulary throughout; [Key Terms](/key-terms) defines every word of it.

## 1. State

A host holds exactly one state of a game at each tick, described by Effect Schema. Systems and rules read that one state and write the next; no hand-written bridge keeps two copies in agreement. A game that spans many hosts, one for each zone, is many such states, each with its own tick, and they reach each other only through commands that leave one and actions that arrive at another.

The state follows the Entity Component System model popularized by Bevy: entities hold components, and systems run over every entity holding the components they ask for.

Every component has exactly one owner, declared in its schema:

- **Rules** own the facts the game decides, such as health, ammunition, or an open door. Only rules change them, and only when an action or an event happens.
- **Simulation** owns whatever changes every step, such as positions. Only its systems change it.
- **Demand** owns what players demand, what they are doing with their controls, such as a tilted stick or a trigger held halfway. The engine writes it at the start of each step, and nothing else may.

A game declares everything its state is made of: its components, actions, events, and commands with their results. One schema for the whole state follows from that declaration, covering its components, its tick, and its counters for the next entity id and for randomness. Snapshots, saves, recordings, and the debugger all speak that same schema.

A system declares what it reads, writes, and emits; a rule declares what it writes and emits. The type checker holds both to their word, so writing a component they do not own is a compile error, not a runtime bug. Spawning works the same way: each lists the components it may create an entity with, whoever owns them, since being born changes no one's existing components. Everyone can read everything, so nothing is ever copied and nothing drifts out of sync.

What only a client keeps, such as a ragdoll, blood, or spent casings, lives in that client's state as local components, written by systems that run on that client alone.

What appears on screen is never a source of truth. The scene is derived from the state, never the other way around.

A level is entities, too. Walls, obstacles, and doors are entities with components, so one model covers everything a state holds, and an editor or a debugger sees a level exactly as it sees everything else.
