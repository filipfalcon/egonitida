import { Option } from 'effect';
import type * as Action from '#src/Action.ts';
import type * as Command from '#src/Command.ts';
import type * as Component from '#src/Component.ts';
import type * as Event from '#src/Event.ts';
import * as Input from '#src/Input.ts';
import type * as Domain from '#src/Domain.ts';
import * as Random from '#src/Random.ts';
import type * as Rule from '#src/Rule.ts';
import type * as System from '#src/System.ts';
import * as State from '#src/State.ts';

/**
 * A game: its fixed step rate and the domains it is made of, and from them everything its state is made of (its components, the actions its players take, the events its steps emit, and the commands its rules issue, with the results they come to), the systems that run every step in order, and the rules that handle actions and events. A host and its clients take what to send and decode from it.
 *
 * A step turns a state and an input into the state of the next tick: the same state and the same input give the same next state. The host's step takes the players' demands and the actions; a client's local step takes no input and changes only local components; a prediction step takes an input of its player's demand and no actions, and changes only that player's predicted components.
 *
 * Within the host's step, the order is fixed: the tick moves on to the next; the demands are written to the entities they are on; the actions are handled by the rules, in the order they arrived; every system runs in order, each seeing what the ones before it wrote; then every event emitted is handled by the rules, one after another and in the order they arose, each rule seeing what the ones before it decided. Events the rules emit join the end of the line. The next step sees all of it.
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
  /** The results its commands may come to, each once, in the order of their commands. */
  readonly results: ReadonlyArray<Commands['results'][number]>;
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

/** The tags of the actions no rule of `Domains` handles: the players' and the results of their commands. */
type Unhandled<Domains extends ReadonlyArray<Domain.Any>> = Exclude<
  | Domains[number]['actions'][number]['tag']
  | Domains[number]['commands'][number]['results'][number]['tag'],
  Parts<Domains>['handles']
>;

/** The tags of the unused events `Domains` declare: those that nothing emits and nothing handles. */
type Unused<Domains extends ReadonlyArray<Domain.Any>> = Exclude<
  Domains[number]['events'][number]['tag'],
  Parts<Domains>['handles'] | Parts<Domains>['emits']
>;

type Parts<Domains extends ReadonlyArray<Domain.Any>> = NonNullable<Domains[number]['~parts']>;

/** Nothing, when there is none of `Found`; otherwise a field naming them under `name`, which no game has, so it does not compile. */
type Refuse<Name extends string, Found> = [Found] extends [never]
  ? unknown
  : { readonly [K in Name]: Found };

/**
 * A game is rejected if it is missing a domain that another domain requires, declares an unhandled action, a player's or a command's result, since every action must be handled by a rule, or declares an unused event: one that nothing emits and nothing handles. One with an unpredictable component, which a client cannot step as its host does, is refused when it is made, since following a component through every read is a fixed point the type checker is not given: a domain keeps its systems' and rules' declarations out of its type.
 */
type Requirements<Domains extends ReadonlyArray<Domain.Any>> = Refuse<'missing', Missing<Domains>> &
  Refuse<'unhandled', Unhandled<Domains>> &
  Refuse<'unused', Unused<Domains>>;

/** The names that come more than once among `names`, each once. */
const repeated = (names: ReadonlyArray<string>): ReadonlyArray<string> => [
  ...new Set(names.filter((name, index) => names.indexOf(name) !== index)),
];

/** Throws, naming them, if `names` repeat: two things of one name that a state or a step could not tell apart. */
const refuseRepeated = (names: ReadonlyArray<string>, what: string) => {
  const twice = repeated(names);
  if (twice.length > 0) {
    throw new Error(`a game declares two ${what} ${twice.join(', ')}`);
  }
};

/** Why a part, a component, or an event depends on what a client does not hold as its host does: the source itself, or what wrote it from what. */
type Taint =
  | { readonly _tag: 'Unshared' }
  | { readonly _tag: 'Written'; readonly by: string; readonly from: string };

/**
 * The predicted components of `game` that a client cannot predict, each with why: those that follow, through any chain of reads, writes, and events, from a component its clients do not hold as its host does, one kept by the host alone (`private`) or by each client alone (`local`).
 *
 * A prediction step runs the systems and the rules for events, but no actions, over the state a client holds. A part that reads anything tainted taints all it writes, spawns, and emits, and a rule handling a tainted event taints all it writes; repeated until nothing more is tainted, so the order the parts run in does not matter. What is left untainted is exactly what the proof `prediction_matches_host` in `verification/Verification/Prediction.lean` calls clean: held alike by host and client, and written only from what is clean. That theorem shows a client's step then gives every clean predicted component exactly as the host's does, from the same input, so this check is enough.
 */
const unpredictable = (game: Game): ReadonlyArray<string> => {
  const tainted = new Map<string, Taint>(
    game.components
      .filter(({ network }) => network === 'private' || network === 'local')
      .map(({ name }) => [name, { _tag: 'Unshared' }]),
  );
  const taintedEvents = new Map<string, Taint>();
  const parts = [
    ...game.systems.map((system) => ({
      name: system.name,
      reads: [...system.reads, ...system.writes].map(({ name }) => name),
      handles: Option.none<string>(),
      writes: [...system.writes, ...system.spawns].map(({ name }) => name),
      emits: system.emits.map(({ tag }) => tag),
    })),
    // A prediction step hands the rules no actions, so only those for events run in it.
    ...game.rules
      .filter((rule) => rule.on._tag === 'Event')
      .map((rule) => ({
        name: Option.getOrElse(rule.name, () => `the rule on ${rule.on.tag}`),
        reads: [...rule.reads, ...rule.writes].map(({ name }) => name),
        handles: Option.some(rule.on.tag),
        writes: [...rule.writes, ...rule.spawns].map(({ name }) => name),
        emits: rule.emits.map(({ tag }) => tag),
      })),
  ];
  const spread = (): boolean =>
    parts.some((part) => {
      const from = [
        ...part.reads.filter((name) => tainted.has(name)),
        ...Option.toArray(Option.filter(part.handles, (tag) => taintedEvents.has(tag))),
      ][0];
      if (from === undefined) {
        return false;
      }
      const taint: Taint = { _tag: 'Written', by: part.name, from };
      const fresh = [
        ...part.writes.filter((name) => !tainted.has(name)),
        ...part.emits.filter((tag) => !taintedEvents.has(tag)),
      ];
      for (const name of part.writes) {
        if (!tainted.has(name)) tainted.set(name, taint);
      }
      for (const tag of part.emits) {
        if (!taintedEvents.has(tag)) taintedEvents.set(tag, taint);
      }
      return fresh.length > 0;
    });
  while (spread()) {
    // Until nothing more is tainted.
  }
  /** How `name` came to be tainted, back to what its clients do not hold. */
  const chain = (name: string, seen: ReadonlySet<string>): string => {
    const written = tainted.get(name);
    const taint = written ?? taintedEvents.get(name);
    if (taint === undefined || taint._tag === 'Unshared' || seen.has(name)) {
      return `${name}, which its clients do not hold as its host does`;
    }
    const how = written === undefined ? 'emitted' : 'written';
    return `${name}, ${how} by ${taint.by} from ${chain(taint.from, new Set([...seen, name]))}`;
  };
  return game.components
    .filter(({ network, name }) => network === 'predicted' && tainted.has(name))
    .map(({ name }) => chain(name, new Set()));
};

/**
 * A game made of `domains`: their components, actions, events, and commands, their systems in the order the domains come and then the order each lists them, and their rules likewise. A domain required by one of them and missing from the list, an unhandled action, and an unused event do not compile. Two components of one name, which a state keeps in one store, two actions, results, or events of one tag, two commands of one name, and an unpredictable component, a predicted one that follows from what its clients do not hold as its host does, are refused when the game is made.
 */
export const make = <const Domains extends ReadonlyArray<Domain.Any>>(
  game: { readonly stepRate: number; readonly domains: Domains } & Requirements<Domains>,
): Game<
  Domains[number]['components'][number],
  Domains[number]['actions'][number],
  Domains[number]['events'][number],
  Domains[number]['commands'][number]
> => {
  refuseRepeated(
    game.domains.flatMap((domain) => domain.components.map(({ name }) => name)),
    'components named',
  );
  refuseRepeated(
    [
      ...game.domains.flatMap((domain) => [
        ...domain.actions.map(({ tag }) => tag),
        ...domain.events.map(({ tag }) => tag),
      ]),
      ...resultsOf(game.domains.flatMap((domain) => domain.commands)).map(({ tag }) => tag),
    ],
    'actions or events tagged',
  );
  refuseRepeated(
    game.domains.flatMap((domain) => domain.commands.map(({ name }) => name)),
    'commands named',
  );
  const built = made(game);
  const found = unpredictable(built);
  if (found.length > 0) {
    throw new Error(`a game has unpredictable components: ${found.join('; ')}`);
  }
  return built;
};

/** The results `commands` may come to, each once, though two commands may come to the same. */
const resultsOf = <C extends Command.Any>(
  commands: ReadonlyArray<C>,
): ReadonlyArray<C['results'][number]> => [
  ...new Set(commands.flatMap((command) => command.results)),
];

const made = <const Domains extends ReadonlyArray<Domain.Any>>(game: {
  readonly stepRate: number;
  readonly domains: Domains;
}): Game<
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
  results: resultsOf(game.domains.flatMap((domain) => domain.commands)),
  systems: game.domains.flatMap((domain) => domain.systems),
  rules: game.domains.flatMap((domain) => domain.rules),
  localSystems: game.domains.flatMap((domain) => domain.localSystems),
});

/**
 * `game` with only `systems` and `rules`, for a test told about some of what a game does, such as the undead standing still while a blast is tested. They may be any parts over what the game declares; which domain owns what is not checked here, nor that every action is handled.
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
        NoInfer<Actions> | NoInfer<Events> | NoInfer<Commands['results'][number]>,
        NoInfer<Components>,
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

/** An outcome records what one step produced: the next state, the events and commands that arose in it, and its trace. */
export interface Outcome<Commands extends Command.Any = Command.Any> {
  readonly state: State.State;
  /** Every event that arose in the step, in the order it arose; the actions it took are its input, not among them. */
  readonly events: ReadonlyArray<Event.Tagged>;
  /** Every command the rules issued, in the order they issued them; none of them has run. */
  readonly commands: ReadonlyArray<Command.IssuedOf<Commands>>;
  /** What each part did, in the order they ran, if the step was traced; empty if not. */
  readonly trace: ReadonlyArray<Trace>;
}

/** What one part of a game did in a step: the values it set, the entities it spawned and despawned, the events it emitted, and the commands it issued; a rule, with the action or event it ran for. */
export interface Trace {
  readonly part: Part;
  /** The action or event a rule ran for; none for a system. */
  readonly cause: Option.Option<Event.Tagged>;
  /** Each value it set, once, however often it set it. */
  readonly set: ReadonlyArray<{ readonly entity: State.Entity; readonly component: string }>;
  readonly spawned: ReadonlyArray<State.Entity>;
  readonly despawned: ReadonlyArray<State.Entity>;
  readonly emitted: ReadonlyArray<Event.Tagged>;
  readonly issued: ReadonlyArray<Command.Issued>;
}

export interface StepOptions {
  /** Freezes every value of the state the step leaves, so a system or rule that changes one in place throws at once. For development: it walks the whole state. */
  readonly freeze?: boolean;
  /** Tells what each part did in the step, for a log of it. For development: it keeps a note of every change. */
  readonly trace?: boolean;
}

/** A trace being taken of one part, as it runs. */
interface Tracing {
  readonly part: Part;
  readonly cause: Option.Option<Event.Tagged>;
  readonly set: Array<{ readonly entity: State.Entity; readonly component: string }>;
  readonly setKeys: Set<string>;
  readonly spawned: Array<State.Entity>;
  readonly despawned: Array<State.Entity>;
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

/** `state` stepped by `game` with `input` to the state of the next tick, and what arose in the step. */
export const step = <Commands extends Command.Any>(
  game: Game<Component.Any, Action.Any, Event.Any, Commands>,
  state: State.State,
  input: Input.Input = Input.none,
  options: StepOptions = {},
): Outcome<Commands> => {
  // The state a step is given is frozen too, so even what it was spawned with fails at once when changed in place.
  const freezing = options.freeze === true ? game.components : [];
  for (const component of freezing) {
    const store = state.stores.get(component.name);
    if (store !== undefined) {
      component.freeze(store);
    }
  }
  const draft = State.draft(state);
  draft.tick += 1;
  // A demand only reaches an entity spawned to accept it; anything else a client sends is ignored, not added.
  for (const demand of input.demands) {
    if (Option.isSome(State.get(draft, demand.entity, demand.component))) {
      demand.writeInto(draft);
    }
  }
  // Everything the rules handle in the step, in order: the actions first, then what systems and rules emit.
  const line: Array<Event.Tagged> = [...input.actions];
  // What the rules decided should be done outside the game, in the order they decided it.
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
    Rule.Context<Component.Any, Component.Any, Event.Any, Component.Any, true, Commands> = {
    time: { tick: draft.tick, secondsPerStep: 1 / game.stepRate },
    random: () => {
      const [value, counter] = Random.next(draft.random);
      draft.random = counter;
      return value;
    },
    get: <Value>(
      entity: State.Entity,
      component: Component.Component<string, Value, Component.Owner>,
    ) => State.get(draft, entity, component),
    query: State.queryIn(draft),
    set: (entity, component, value) => {
      State.write(draft, entity, component, value);
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
      const entity = State.spawnInto(draft, instances);
      note((trace) => trace.spawned.push(entity));
      return entity;
    },
    despawn: (entity) => {
      State.despawnFrom(draft, entity);
      note((trace) => trace.despawned.push(entity));
    },
  };

  // The actions are handled before anything moves, so the systems see what the rules made of them.
  settle();
  for (const system of game.systems) {
    runAs(system, Option.none(), () => system.run(context));
  }
  settle();

  return {
    state: State.finish(draft, freezing),
    events: line.slice(input.actions.length),
    commands,
    trace: traces,
  };
};

/** The schema of a whole state of `game`: what saves, recordings, and the debugger carry it in. */
export const schema = (game: Game) => State.schema(game.components);

/**
 * `state` after a client's own step at `tick`: every local system run in order, over the state the server sent and what the client keeps for itself. Nothing the server sends changes. What they spawn is given ids of the client's own, and the numbers they draw come of the tick and the state's random counter there, so every client draws the same at the same tick and the state's own counter is left as it was.
 */
export const stepLocal = (
  game: Game,
  state: State.State,
  options: { readonly tick: number },
): State.State => {
  const draft = State.draft(state);
  const drawn = { counter: (state.random ^ Math.imul(options.tick, 0x9e3779b1)) >>> 0 };
  const context: System.Context<Component.Any, Component.Any, Event.Any, Component.Any, true> = {
    time: { tick: options.tick, secondsPerStep: 1 / game.stepRate },
    random: () => {
      const [value, counter] = Random.next(drawn.counter);
      drawn.counter = counter;
      return value;
    },
    get: <Value>(
      entity: State.Entity,
      component: Component.Component<string, Value, Component.Owner>,
    ) => State.get(draft, entity, component),
    query: State.queryIn(draft),
    set: (entity, component, value) => State.write(draft, entity, component, value),
    emit: (event) => {
      throw new Error(`a local system emitted ${event._tag}; events are for the server's rules`);
    },
    spawn: (instances) => State.spawnLocalInto(draft, instances),
    despawn: (entity) => State.despawnFrom(draft, entity),
  };
  for (const system of game.localSystems) {
    system.run(context);
  }
  return State.finish(draft);
};

// CHANGES

/** A part of a game that writes its components, with the domain it belongs to: a system, by its name, or a rule, by the event or action it handles and its name if it has one. A part a test gave a game with `only` belongs to no domain. */
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
  /** The systems and rules that read it, as they declare it. */
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
  /** The tags of the results it may come to. */
  readonly results: ReadonlyArray<string>;
}

/** How a game's components change, read off what its systems and rules declare: by component, by event or action, by command, and what may despawn. */
export interface Changes {
  readonly components: ReadonlyMap<string, ComponentChanges>;
  readonly events: ReadonlyMap<string, EventChanges>;
  readonly commands: ReadonlyMap<string, CommandChanges>;
  readonly despawnedBy: ReadonlyArray<Part>;
}

/**
 * The map of how `game` changes its components. A game of systems has no single `update` to read; its declarations are what is read instead, by people, the debugger, and agents alike. Parts are listed in the order the game runs them.
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
      reads: rule.reads,
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
      [...game.actions, ...game.results, ...game.events].map((event) => [
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
