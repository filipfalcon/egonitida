# Key Terms

LightOcean speaks a small, precise vocabulary, and every page after this one uses it without stopping to explain. The terms fall into three groups: a game's state and the clock that moves it, the primitives a game is written in, and the places a game runs. A game is made of primitives alone; everything else is what the engine makes of them at run time.

## First Things First

A project in LightOcean is a universe full of things, sorted into a few logical groups. Together, those groups are the fundamentals the whole engine is built on.

::FirstThingsFirst

A game in LightOcean holds a **state** full of things. Each thing is an **entity**, and the data it carries, such as where it stands or how much health it has left, sits in its **components**. The game moves forward in **steps**, a fixed number every second, each replacing its state with the next, and a state's **tick** counts how many steps it took to reach it.

During each step, **systems** move whatever moves, while **rules** decide what the players' **actions** and the game's own **events** mean, now and then issuing a **command** for work outside the game. Between steps, **views** draw the result on screen. A **domain** bundles one part of all this, such as a game's weapons, and a **game** is the list of its domains. Finally, a **host** steps the game, and **clients** show it to the players.

That is the whole picture. The sections below take each term in turn.

## The State

What a game holds, and the clock that moves it forward.

### State

A state is an immutable value that records one tick: the entities that exist, the components they hold, and the counters for the next entity ids and for randomness. Nothing a game holds lives anywhere else.

The host holds a state with every component, private ones included; a client holds the last state it received from the host, plus its own local components and, with prediction, its player's predicted components; a snapshot carries the part of the host's state that travels.

A state is never changed, only replaced: on the host, by a step, a player joining or leaving, or a restore or reload; on a client, by a newly received state, a local step, or a prediction step. The state replaced stays as it was, so any past state can be kept, compared, or played again, which is exactly what rewinding and replays do.

::StatePress

### Entity

An entity is a thing in a game: a player, a door, a crate, a wall. On its own, an entity is only a number, its id. Everything it is comes from the components it holds, so a door is simply an entity holding the components that make it a door.

Ids come from a counter in the state, and none is ever given out twice. A replay therefore gives every entity the same id it had the first time.

### Tick

A tick is a state's place in time: the number of steps taken to reach it. A game begins at tick 0, and each step reaches the next tick.

### Step

A step is the passage from one state to the state of the next tick. Each game fixes its step rate, such as 60 steps every second, and its time advances by exactly one step at a time, never by a fraction of one.

There are three kinds of step. The host's step takes the players' input and actions and may write any component. A client's local step takes neither and writes only the client's local components. A prediction step takes the input of the client's own player and writes only that player's predicted components.

The host's step runs in the same order every time. The players' input is written first, and the rules decide on the actions players took. Then every system runs. Finally, the rules decide on the events the systems emitted. By the time the next step begins, every consequence has already landed.

Drawing happens between steps, at whatever rate the display runs, so motion stays smooth at 60, 120, or 144 Hz.

## Primitives

The building blocks a game is written in. Each one is a value made by its own constructor, and nothing joins them implicitly: a game names every part it uses.

### Component

A component is one kind of data an entity can hold, such as a position, an amount of health, or the label a screen reader announces. It is made with `Component.make`, from an Effect Schema that gives it a type, a saved format, and a wire format in one declaration.

Each component also declares two things about itself:

- **Its owner**: the rules, the simulation, or the players' input. Only its owner may change it.
- **Its network role**: whether the server decides it and sends it to every client, a client predicts it, a client keeps it alone, or the server keeps it alone.

When two parts of the same data need different owners, they become two components.

### Action

An action is what a player did: pulled a trigger, chose to restart, clicked a light. It is made with `Action.make` and names the deed rather than the device, so a gamepad, a mouse, and a keyboard can all produce the same action.

Actions read in the past tense, because by the time the game hears of one, it has already happened. Every action has a rule that decides what it means. What a player holds down continuously, such as a tilted stick, travels separately as input, which the player's own components carry.

### Event

An event is what the game made of something: a shot was fired, a level restarted, a body fell. It is made with `Event.make`. Systems and rules emit events, and rules handle them within the same step.

Events are also how one domain asks another for a change. A weapon emits a hit, and the domain that owns health decides what the hit costs. Like actions, events are facts in the past tense.

### System

A system is a function the simulation runs every step over every entity holding certain components: move everything with a velocity, turn every cube with a spin. It is made with `System.make`.

A system declares what it reads, what it writes, and what events it may emit, and it may write only components the simulation owns. It is plain synchronous code that takes time and randomness only from the step it runs in, so the same state and the same inputs always produce the same next state. Together, a game's systems are its simulation.

### Rule

A rule is what the game decides when an action or an event happens: a hit takes health, a click opens a door. It is made with `Rule.on`, naming the action or event it answers.

A rule may read anything, but it writes only components the rules own, and it declares which ones. When its decision needs something done outside the game, it issues a command.

### Command

A command is work a rule needs done outside the game, such as saving a score or asking a service. It is made with `Command.make`, beside the rule that issues it, and it lists the events its result may be, including every failure it can foresee.

A rule issues a command as a value and moves on; the command never runs inside a step. The host runs it afterward, and its result returns to the game as one of its events at a later step. A recording keeps that result, so a replay never runs the command again. Systems never issue commands.

### View

A view is how a client draws the game from its state. Each kind of view answers a different cause:

- **`View.each`** builds an object for every entity holding certain components and draws it every frame.
- **`View.on`** reacts once when an entity gains a component or holds a new value of it, such as playing a sound on a hit.
- **`View.during`** holds a resource for as long as a condition is true, such as music during a fight.

A view only reads the state. The scene it draws is never a source of truth.

### Domain

A domain is one part of a game: its weapons, its doors, its undead. It is made with `Domain.make` and brings the components it owns, the actions and events it declares, the systems and rules that change them, and the domains it requires.

A domain writes only its own components. To change another domain's components, it emits an event that domain declared, and that domain's rules decide what the event means.

### Game

A game is its step rate and the list of its domains, made with `Game.make`. Their systems run in the order of that list, and everything the game's state is made of follows from it.

`Game.make` also checks the game as a whole before it ever runs. A domain required but missing, an action no rule answers, or an event nothing emits or handles is a compile error, not a surprise at run time.

## Where a Game Runs

The engine's own machinery, which a game configures rather than writes.

### Host and Client

The host holds a game's state and steps it. A client joins the host, sends its player's input and actions, and draws the states the host sends back. A session is one player's connection to a hosted game, from joining to leaving.

For a single player, the host runs in a Web Worker beside the page. For many players, it runs on a server, one Cloudflare Durable Object per room; that form is still experimental. The game's own code is the same in both cases.
