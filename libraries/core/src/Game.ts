import { Option } from 'effect';
import type * as Action from '#src/Action.ts';
import type * as Command from '#src/Command.ts';
import type * as Component from '#src/Component.ts';
import type * as Event from '#src/Event.ts';
import type * as Input from '#src/Input.ts';
import type * as Domain from '#src/Domain.ts';
import * as Random from '#src/Random.ts';
import type * as Rule from '#src/Rule.ts';
import type * as System from '#src/System.ts';
import * as World from '#src/World.ts';

/**
 * A game: its fixed step rate and the domains it is made of, and from them everything its state is made of (its components, the actions its players take, and the events its steps emit), the systems that run every step in order, and the rules that handle actions and events. A host and its clients take what to send and decode from it.
 *
 * One step: the tick advances; the step's input is written to the entities it is aimed at; the players' actions are handled by the rules, in the order they came; every system runs in order, each seeing what the ones before it wrote; then every event emitted is handled by the rules, one after another and in the order they happened, each rule seeing what the ones before it decided. Events the rules emit join the end of the line. The next step sees all of it.
 */

export interface Game<
  Components extends Component.Any = Component.Any,
  Actions extends Action.Any = Action.Any,
  Events extends Event.Any = Event.Any,
  Commands extends Command.Any = Command.Any,
> {
  readonly stepRate: number;
  readonly domains: ReadonlyArray<Domain.Any>;
  readonly components: ReadonlyArray<Components>;
  readonly actions: ReadonlyArray<Actions>;
  readonly events: ReadonlyArray<Events>;
  readonly commands: ReadonlyArray<Commands>;
  readonly systems: ReadonlyArray<System.System>;
  readonly rules: ReadonlyArray<Rule.Rule>;
  /** The systems each client runs for itself after every step, in the order of their domains. */
  readonly localSystems: ReadonlyArray<System.System>;
}

/** The names of the domains `Domains` require and do not hold. */
type Missing<Domains extends ReadonlyArray<Domain.Any>> = Exclude<
  Domains[number]['requires'][number]['name'],
  Domains[number]['name']
>;

/** The tags of the actions no rule of `Domains` answers. */
type Unanswered<Domains extends ReadonlyArray<Domain.Any>> = Exclude<
  Domains[number]['actions'][number]['tag'],
  Parts<Domains>['handles']
>;

/** The tags of the events `Domains` declare that nothing emits and nothing handles. */
type Dead<Domains extends ReadonlyArray<Domain.Any>> = Exclude<
  Domains[number]['events'][number]['tag'],
  Parts<Domains>['handles'] | Parts<Domains>['emits']
>;

type Parts<Domains extends ReadonlyArray<Domain.Any>> = NonNullable<Domains[number]['~parts']>;

/** Nothing, when there is none of `Found`; otherwise a field naming them under `name`, which no game has, so it does not compile. */
type Refuse<Name extends string, Found> = [Found] extends [never]
  ? unknown
  : { readonly [K in Name]: Found };

/**
 * What a game of `Domains` must not be: missing a domain one requires, holding an action no rule answers, a player doing something to no effect, or an event nothing emits or handles. An event that is emitted and goes unanswered is a domain's offer to others, and is fine.
 */
type Requirements<Domains extends ReadonlyArray<Domain.Any>> = Refuse<'missing', Missing<Domains>> &
  Refuse<'unanswered', Unanswered<Domains>> &
  Refuse<'dead', Dead<Domains>>;

/**
 * A game made of `domains`: their components, actions, and events, their systems in the order the domains come and then the order each lists them, and their rules likewise. A domain required by one of them and missing from the list, an action no rule answers, and an event nothing emits or handles do not compile.
 */
export const make = <const Domains extends ReadonlyArray<Domain.Any>>(
  game: { readonly stepRate: number; readonly domains: Domains } & Requirements<Domains>,
): Game<
  Domains[number]['components'][number],
  Domains[number]['actions'][number],
  Domains[number]['events'][number],
  Domains[number]['commands'][number]
> => ({
  stepRate: game.stepRate,
  domains: game.domains,
  components: game.domains.flatMap((domain) => domain.components),
  actions: game.domains.flatMap((domain) => domain.actions),
  events: game.domains.flatMap((domain) => domain.events),
  commands: game.domains.flatMap((domain) => domain.commands),
  systems: game.domains.flatMap((domain) => domain.systems),
  rules: game.domains.flatMap((domain) => domain.rules),
  localSystems: game.domains.flatMap((domain) => domain.localSystems),
});

/**
 * `game` with only `systems` and `rules`, for a test told about some of what a game does, such as the undead standing still while a blast is tested. They may be any parts over what the game declares; which domain owns what is not checked here, nor that every action is answered.
 */
export const only = <
  Components extends Component.Any,
  Actions extends Action.Any,
  Events extends Event.Any,
  Commands extends Command.Any,
>(
  game: Game<Components, Actions, Events, Commands>,
  parts: {
    readonly systems: ReadonlyArray<
      System.System<
        NoInfer<Components>,
        NoInfer<Extract<Components, System.SimulationComponent>>,
        NoInfer<Events>,
        NoInfer<Components>
      >
    >;
    readonly rules: ReadonlyArray<
      Rule.Rule<
        NoInfer<Actions> | NoInfer<Events>,
        NoInfer<Extract<Components, Rule.RulesComponent>>,
        NoInfer<Events>,
        NoInfer<Components>,
        NoInfer<Commands>
      >
    >;
  },
): Game<Components, Actions, Events, Commands> => ({
  ...game,
  systems: parts.systems,
  rules: parts.rules,
});

export interface Step<Commands extends Command.Any = Command.Any> {
  readonly world: World.World;
  /** Every event of the step, in the order it happened. */
  readonly events: ReadonlyArray<Event.Tagged>;
  /** Every command the rules issued, in the order they issued them; none of them has run. */
  readonly commands: ReadonlyArray<Command.IssuedOf<Commands>>;
  /** What each part did, in the order they ran, if the step was traced; empty if not. */
  readonly trace: ReadonlyArray<Trace>;
}

/** What one part of a game did in a step: the values it set, the entities it spawned and despawned, the events it emitted, and the commands it issued; a rule, with the event or action it ran for. */
export interface Trace {
  readonly part: Part;
  /** The event or action a rule ran for; none for a system. */
  readonly cause: Option.Option<Event.Tagged>;
  /** Each value it set, once, however often it set it. */
  readonly set: ReadonlyArray<{ readonly entity: World.Entity; readonly component: string }>;
  readonly spawned: ReadonlyArray<World.Entity>;
  readonly despawned: ReadonlyArray<World.Entity>;
  readonly emitted: ReadonlyArray<Event.Tagged>;
  readonly issued: ReadonlyArray<Command.Issued>;
}

export interface StepOptions {
  /** Freezes every value of the world the step leaves, so a system or rule that changes one in place throws at once. For development: it walks the whole world. */
  readonly freeze?: boolean;
  /** Tells what each part did in the step, for a log of it. For development: it keeps a note of every change. */
  readonly trace?: boolean;
}

/** A trace being taken of one part, as it runs. */
interface Tracing {
  readonly part: Part;
  readonly cause: Option.Option<Event.Tagged>;
  readonly set: Array<{ readonly entity: World.Entity; readonly component: string }>;
  readonly setKeys: Set<string>;
  readonly spawned: Array<World.Entity>;
  readonly despawned: Array<World.Entity>;
  readonly emitted: Array<Event.Tagged>;
  readonly issued: Array<Command.Issued>;
}

const tracing = (part: Part, cause: Option.Option<Event.Tagged>): Tracing => ({
  part,
  cause,
  set: [],
  setKeys: new Set(),
  spawned: [],
  despawned: [],
  emitted: [],
  issued: [],
});

/** What a trace taken of a part tells, if the part did anything. */
const traced = (trace: Tracing): ReadonlyArray<Trace> =>
  trace.set.length +
    trace.spawned.length +
    trace.despawned.length +
    trace.emitted.length +
    trace.issued.length ===
  0
    ? []
    : [
        {
          part: trace.part,
          cause: trace.cause,
          set: trace.set,
          spawned: trace.spawned,
          despawned: trace.despawned,
          emitted: trace.emitted,
          issued: trace.issued,
        },
      ];

export const step = <Commands extends Command.Any>(
  game: Game<Component.Any, Action.Any, Event.Any, Commands>,
  world: World.World,
  inputs: ReadonlyArray<Input.Input> = [],
  actions: ReadonlyArray<Event.Tagged> = [],
  options: StepOptions = {},
): Step<Commands> => {
  // The world a step is given is frozen too, so even what it was spawned with fails at once when changed in place.
  const freezing = options.freeze === true ? game.components : [];
  for (const component of freezing) {
    const store = world.stores.get(component.name);
    if (store !== undefined) {
      component.freeze(store);
    }
  }
  const draft = World.draft(world);
  draft.tick += 1;
  // Input only reaches an entity spawned to accept it; anything else a client sends is ignored, not added.
  for (const input of inputs) {
    if (Option.isSome(World.get(draft, input.entity, input.component))) {
      input.writeInto(draft);
    }
  }
  // Everything that happens in the step, in order: the actions first, then what systems and rules emit.
  const line: Array<Event.Tagged> = [...actions];
  // What the rules decided should be done outside the world, in the order they decided it.
  const commands: Array<Command.IssuedOf<Commands>> = [];
  const handled = { count: 0 };
  // Every part by what it is, if the step is traced, and the trace of the part running now.
  const parts = options.trace === true ? Option.some(partsOf(game)) : Option.none();
  const traces: Array<Trace> = [];
  const running: { trace: Option.Option<Tracing> } = { trace: Option.none() };
  /** Runs `run` as `part`, keeping a trace of it if the step is traced. */
  const runAs = (
    part: System.System | Rule.Rule,
    cause: Option.Option<Event.Tagged>,
    run: () => void,
  ) => {
    if (Option.isNone(parts)) {
      run();
      return;
    }
    const trace = tracing(
      Option.getOrElse(Option.fromNullishOr(parts.value.get(part)), () => partOutside(part)),
      cause,
    );
    running.trace = Option.some(trace);
    run();
    running.trace = Option.none();
    traces.push(...traced(trace));
  };
  const note = (keep: (trace: Tracing) => void) => {
    if (Option.isSome(running.trace)) {
      keep(running.trace.value);
    }
  };
  /** Hands every event not yet handled to the rules that handle it, including events those rules emit meanwhile. */
  const settle = () => {
    for (const event of line.slice(handled.count)) {
      handled.count += 1;
      for (const rule of game.rules) {
        if (rule.on.tag === event._tag) {
          runAs(rule, Option.some(event), () => rule.run(context, event));
        }
      }
    }
    if (handled.count < line.length) {
      settle();
    }
  };

  // Systems and rules share one context at run time; their types are what keep each to what it declared.
  const context: System.Context<Component.Any, Component.Any, Event.Any, Component.Any, true> &
    Rule.Context<Component.Any, Event.Any, Component.Any, true, Commands> = {
    time: { tick: draft.tick, stepSeconds: 1 / game.stepRate },
    random: () => {
      const [value, state] = Random.next(draft.random);
      draft.random = state;
      return value;
    },
    get: <Value>(
      entity: World.Entity,
      component: Component.Component<string, Value, Component.Owner>,
    ) => World.get(draft, entity, component),
    query: World.queryIn(draft),
    set: (entity, component, value) => {
      World.write(draft, entity, component, value);
      note((trace) => {
        const key = `${entity}:${component.name}`;
        if (!trace.setKeys.has(key)) {
          trace.setKeys.add(key);
          trace.set.push({ entity, component: component.name });
        }
      });
    },
    emit: (event: Event.Tagged) => {
      line.push(event);
      note((trace) => trace.emitted.push(event));
    },
    command(issued) {
      commands.push(issued);
      note((trace) => trace.issued.push(issued));
    },
    spawn: (instances) => {
      const entity = World.spawnInto(draft, instances);
      note((trace) => trace.spawned.push(entity));
      return entity;
    },
    despawn: (entity) => {
      World.despawnFrom(draft, entity);
      note((trace) => trace.despawned.push(entity));
    },
  };

  // The players' actions are decided before anything moves, so the systems see what the rules made of them.
  settle();
  for (const system of game.systems) {
    runAs(system, Option.none(), () => system.run(context));
  }
  settle();

  return {
    world: World.finish(draft, freezing),
    events: line,
    commands,
    trace: traces,
  };
};

/** The schema of a whole world of `game`: what saves, recordings, and the debugger carry it in. */
export const schema = (game: Game) => World.schema(game.components);

/**
 * `world` after a client's own step at `tick`: every local system run in order, over the world the server sent and what the client keeps for itself. Nothing the server sends changes. What they spawn is given ids of the client's own, and the numbers they draw come of the tick and the world's randomness there, so every client draws the same at the same tick and the world's own randomness is left as it was.
 */
export const stepLocal = (
  game: Game,
  world: World.World,
  options: { readonly tick: number },
): World.World => {
  const draft = World.draft(world);
  const drawn = { state: (world.random ^ Math.imul(options.tick, 0x9e3779b1)) >>> 0 };
  const context: System.Context<Component.Any, Component.Any, Event.Any, Component.Any, true> = {
    time: { tick: options.tick, stepSeconds: 1 / game.stepRate },
    random: () => {
      const [value, state] = Random.next(drawn.state);
      drawn.state = state;
      return value;
    },
    get: <Value>(
      entity: World.Entity,
      component: Component.Component<string, Value, Component.Owner>,
    ) => World.get(draft, entity, component),
    query: World.queryIn(draft),
    set: (entity, component, value) => World.write(draft, entity, component, value),
    emit: (event) => {
      throw new Error(`a local system emitted ${event._tag}; events are for the server's rules`);
    },
    spawn: (instances) => World.spawnLocalInto(draft, instances),
    despawn: (entity) => World.despawnFrom(draft, entity),
  };
  for (const system of game.localSystems) {
    system.run(context);
  }
  return World.finish(draft);
};

// CHANGES

/** A part of a game that changes its state, with the domain it belongs to: a system, by its name, or a rule, by the event or action it handles and its name if it has one. A part a test gave a game with `only` belongs to no domain. */
export type Part =
  | {
      readonly _tag: 'System' | 'LocalSystem';
      readonly name: string;
      readonly domain: Option.Option<string>;
    }
  | {
      readonly _tag: 'Rule';
      readonly on: string;
      readonly name: Option.Option<string>;
      readonly domain: Option.Option<string>;
    };

export interface ComponentChanges {
  /** The systems that read it. Rules may read anything, so they are never listed. */
  readonly readBy: ReadonlyArray<Part>;
  readonly writtenBy: ReadonlyArray<Part>;
  readonly spawnedBy: ReadonlyArray<Part>;
}

export interface EventChanges {
  readonly emittedBy: ReadonlyArray<Part>;
  readonly handledBy: ReadonlyArray<Part>;
}

export interface CommandChanges {
  readonly issuedBy: ReadonlyArray<Part>;
  /** The tags of the events it may come to. */
  readonly results: ReadonlyArray<string>;
}

/** How a game's state changes, read off what its systems and rules declare: by component, by event or action, by command, and what may despawn. */
export interface Changes {
  readonly components: ReadonlyMap<string, ComponentChanges>;
  readonly events: ReadonlyMap<string, EventChanges>;
  readonly commands: ReadonlyMap<string, CommandChanges>;
  readonly despawnedBy: ReadonlyArray<Part>;
}

/**
 * The map of how `game` changes its state. A game of systems has no single `update` to read; its declarations are what is read instead, by people, the debugger, and agents alike. Parts are listed in the order the game runs them.
 */
/** Each system, local system, and rule of `game`, as the part it is, with the domain it belongs to. */
const partsOf = (game: Game): ReadonlyMap<System.System | Rule.Rule, Part> => {
  const domainOf = new Map<System.System | Rule.Rule, string>(
    game.domains.flatMap((domain) =>
      [...domain.systems, ...domain.rules, ...domain.localSystems].map(
        (part) => [part, domain.name] as const,
      ),
    ),
  );
  const domain = (part: System.System | Rule.Rule) => Option.fromNullishOr(domainOf.get(part));
  return new Map<System.System | Rule.Rule, Part>([
    ...game.systems.map((system): [System.System, Part] => [
      system,
      { _tag: 'System', name: system.name, domain: domain(system) },
    ]),
    ...game.localSystems.map((system): [System.System, Part] => [
      system,
      { _tag: 'LocalSystem', name: system.name, domain: domain(system) },
    ]),
    ...game.rules.map((rule): [Rule.Rule, Part] => [
      rule,
      { _tag: 'Rule', on: rule.on.tag, name: rule.name, domain: domain(rule) },
    ]),
  ]);
};

/** `part` as a part of no game's domains, as one a test gave a game with `only` is. */
const partOutside = (part: System.System | Rule.Rule): Part =>
  'on' in part
    ? { _tag: 'Rule', on: part.on.tag, name: part.name, domain: Option.none() }
    : { _tag: 'System', name: part.name, domain: Option.none() };

export const changes = (game: Game): Changes => {
  const named = partsOf(game);
  const partOf = (part: System.System | Rule.Rule) =>
    Option.getOrElse(Option.fromNullishOr(named.get(part)), () => partOutside(part));
  const parts = [
    ...[...game.systems, ...game.localSystems].map((system) => ({
      part: partOf(system),
      reads: system.reads,
      writes: system.writes,
      spawns: system.spawns,
      emits: system.emits,
      handles: [],
      issues: [],
      despawns: system.despawns,
    })),
    ...game.rules.map((rule) => ({
      part: partOf(rule),
      reads: [],
      writes: rule.writes,
      spawns: rule.spawns,
      emits: rule.emits,
      handles: [rule.on],
      issues: rule.commands,
      despawns: rule.despawns,
    })),
  ];
  const by = (has: (part: (typeof parts)[number]) => boolean) =>
    parts.filter(has).map(({ part }) => part);
  return {
    components: new Map(
      game.components.map((component) => [
        component.name,
        {
          readBy: by(({ reads }) => reads.some(({ name }) => name === component.name)),
          writtenBy: by(({ writes }) => writes.some(({ name }) => name === component.name)),
          spawnedBy: by(({ spawns }) => spawns.some(({ name }) => name === component.name)),
        },
      ]),
    ),
    events: new Map(
      [...game.actions, ...game.events].map((event) => [
        event.tag,
        {
          emittedBy: by(({ emits }) => emits.some(({ tag }) => tag === event.tag)),
          handledBy: by(({ handles }) => handles.some(({ tag }) => tag === event.tag)),
        },
      ]),
    ),
    commands: new Map(
      game.commands.map((command) => [
        command.name,
        {
          issuedBy: by(({ issues }) => issues.some(({ name }) => name === command.name)),
          results: command.results.map(({ tag }) => tag),
        },
      ]),
    ),
    despawnedBy: by(({ despawns }) => despawns),
  };
};
