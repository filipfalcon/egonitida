import { Action, Component, Domain, Game, Rule, System, State } from '@lightocean/core';
import { Option, Schema } from 'effect';

/**
 * The game the section First Things First teaches with, one like any other, drawn by the engine's own renderer above the section's text. It waits for the viewer to start it, and then tells the engine's first terms, each in the order it needs the one before: at first there is nothing; then the ideas start coming, strands of light drifting in from beyond the edges into a chaos, pressed ever smaller into one point; the point bursts, and a state emerges, a sun at its middle; entities emerge in it, one after another, alike and holding nothing but which of them each is; components then give each what it is, its look and its place, and each takes them; and time starts stepping, the state's host beginning it anew at its first tick, every planet going round a stride a step. Each beat lasts until the viewer goes on to the next, or back a beat, while the game's time runs on within it. It takes only a few steps a second, so each step can be seen. Its views are in `glance.view.ts`.
 */

/** How many steps the game takes a second: few, so each one can be seen. */
const STEP_RATE = 4;

/** The beats of the telling, in order: waiting for the viewer to start it, then each beat it tells. */
export const Moment = Schema.Literals([
  'Waiting',
  'Nothing',
  'Ideas',
  'State',
  'Entities',
  'Components',
  'Step',
]);
export type Moment = typeof Moment.Type;

const BEATS: ReadonlyArray<Moment> = Moment.literals;

/** Whether the telling has come as far as `beat`, at `moment`. */
export const hasCome = (moment: Moment, beat: Moment): boolean =>
  BEATS.indexOf(moment) >= BEATS.indexOf(beat);

/** The most ideas there are at once. */
export const MOST_IDEAS = 40;

/** How many ideas come every step while the ideas beat runs. */
const IDEAS_A_STEP = 3;

/** How many entities emerge, each to become a planet. */
export const PLANETS = 5;

/** How many steps apart the entities emerge. */
const EMERGING_EVERY = 2;

/** How far round the middle a planet `distance` from it goes in a step, in degrees: the nearer, the faster. */
export const strideAt = (distance: number): number => 24 / distance;

// COMPONENTS

/** Where the telling is: its beat, and the tick the beat began at. */
export const Telling = Component.make(
  'Telling',
  Schema.Struct({ beat: Moment, since: Schema.Int }),
  { owner: 'rules', network: 'server' },
);

/** An idea: the tick it came at, and what makes it its own, a share between 0 and 1 its shape and where it drifts in from are drawn from. */
export const Idea = Component.make(
  'Idea',
  Schema.Struct({ since: Schema.Int, seed: Schema.Finite }),
  { owner: 'simulation', network: 'server' },
);

/** The point the ideas were pressed into, bursting into a state: what makes its burst its own, a share between 0 and 1, and the tick the state emerged at. */
export const Bang = Component.make(
  'Bang',
  Schema.Struct({ seed: Schema.Finite, since: Schema.Int }),
  { owner: 'rules', network: 'server' },
);

/** An entity that emerged in the state, and nothing more: which of them it is, counting from 0, and the tick it emerged at. */
export const Body = Component.make(
  'Body',
  Schema.Struct({ index: Schema.Int, since: Schema.Int }),
  { owner: 'simulation', network: 'server' },
);

/** How a planet looks: how large it is, its tint, a share between 0 and 1 its colour is drawn from, and the tick it was given its look at. */
export const Look = Component.make(
  'Look',
  Schema.Struct({ radius: Schema.Finite, tint: Schema.Finite, since: Schema.Int }),
  { owner: 'simulation', network: 'server' },
);

/** Where a planet stands round the middle: how far from it, how far round, in degrees, and how far above or below. It goes a whole step at a time, so it is drawn where a step left it, never between two. */
export const Place = Component.make(
  'Place',
  Schema.Struct({
    distance: Schema.Finite,
    angle: Schema.Finite.annotate({ interpolate: 'previous' }),
    height: Schema.Finite,
  }),
  { owner: 'simulation', network: 'server' },
);

/** The viewer's eye, which the camera looks out of. */
export const Eye = Component.make('Eye', Schema.Struct({}), {
  owner: 'rules',
  network: 'server',
});

// ACTIONS

/** The viewer chose to start the telling. */
export const ChoseStart = Action.make('ChoseStart', {});

/** The viewer chose to go back a beat. */
export const ChoseBack = Action.make('ChoseBack', {});

/** The viewer chose to go on to the next beat. */
export const ChoseNext = Action.make('ChoseNext', {});

// RULES

/** The beat `by` beats on from `beat`, no later than the last, and, once the telling has started, no earlier than its first beat: it never waits again. */
const beatFrom = (beat: Moment, by: number): Moment =>
  BEATS[
    Math.min(BEATS.length - 1, Math.max(beat === 'Waiting' ? 0 : 1, BEATS.indexOf(beat) + by))
  ] ?? beat;

/** What moving the telling needs of a rule: to write the telling, and to make and let go of what it tells of. */
type TellingContext = Rule.Context<typeof Telling, never, typeof Bang | typeof Body, true>;

/** Moves the telling `by` beats: the beat begins now; what the telling tells of comes as its beat begins, or as it is passed, and is gone again before it; a beat moved back to itself begins again, and one moved on past the last stays as it is. */
const move = (context: TellingContext, by: number) => {
  for (const [narrator, { beat }] of context.query(Telling)) {
    const next = beatFrom(beat, by);
    if (next === beat && by > 0) {
      continue;
    }
    const { tick } = context.time;
    context.set(narrator, Telling, { beat: next, since: tick });
    // The ideas are there only while they come; past them, they are the point.
    if (next !== 'Ideas') {
      for (const [idea] of context.query(Idea)) {
        context.despawn(idea);
      }
    }
    const bangs = context.query(Bang);
    if (next === 'State' && bangs.length === 0) {
      context.spawn([Bang.of({ seed: context.random(), since: tick })]);
    }
    if (!hasCome(next, 'State')) {
      for (const [bang] of bangs) {
        context.despawn(bang);
      }
    }
    // An entity keeps the components it was given, so going back to before they were given lets go of the entities too, to emerge again.
    const bodies = context.query(Body);
    if (!hasCome(next, 'Entities') || (by < 0 && next === 'Entities')) {
      for (const [body] of bodies) {
        context.despawn(body);
      }
    }
    // Components are given to every entity there is, however soon the viewer comes to them.
    if (next === 'Components') {
      for (let index = bodies.length; index < PLANETS; index++) {
        context.spawn([Body.of({ index, since: tick })]);
      }
    }
  }
};

const changesTheTelling = {
  writes: [Telling],
  emits: [],
  spawns: [Bang, Body],
  despawns: true,
} as const;

/** The viewer starts the telling, if it is waiting. */
const start = Rule.on(ChoseStart, {
  ...changesTheTelling,
  run: (context) => {
    if (context.query(Telling).some(([, { beat }]) => beat === 'Waiting')) {
      move(context, 1);
    }
  },
});

/** The viewer goes on to the next beat. */
const next = Rule.on(ChoseNext, { ...changesTheTelling, run: (context) => move(context, 1) });

/** The viewer goes back a beat, or, from the first, tells it over again. */
const back = Rule.on(ChoseBack, { ...changesTheTelling, run: (context) => move(context, -1) });

// SYSTEMS

/** The beat the telling is at, as a system reads it. */
const beatIn = (context: { readonly query: State.Query<typeof Telling> }): Moment =>
  context.query(Telling)[0]?.[1].beat ?? 'Waiting';

/** While the ideas beat runs, ideas keep coming, a few every step, up to as many as there may be. */
const imagine = System.make({
  name: 'imagine',
  reads: [Telling, Idea],
  writes: [],
  emits: [],
  spawns: [Idea],
  run: (context) => {
    const { tick } = context.time;
    const room = beatIn(context) === 'Ideas' ? MOST_IDEAS - context.query(Idea).length : 0;
    for (let count = 0; count < Math.min(IDEAS_A_STEP, room); count++) {
      context.spawn([Idea.of({ since: tick, seed: context.random() })]);
    }
  },
});

/** While entities emerge, one emerges every few steps, holding only which of them it is, until all have. */
const emerge = System.make({
  name: 'emerge',
  reads: [Telling, Body],
  writes: [],
  emits: [],
  spawns: [Body],
  run: (context) => {
    const { tick } = context.time;
    for (const [, { beat, since }] of context.query(Telling)) {
      const index = context.query(Body).length;
      if (beat === 'Entities' && (tick - since) % EMERGING_EVERY === 0 && index < PLANETS) {
        context.spawn([Body.of({ index, since: tick })]);
      }
    }
  },
});

/** Once components are given, every entity with none yet is given its look and its place, as large, of a tint, and as far out as the game's randomness has it, each further out than the one before. */
const give = System.make({
  name: 'give',
  reads: [Telling, Body, Look],
  writes: [Look, Place],
  emits: [],
  run: (context) => {
    const { tick } = context.time;
    const isGiving = hasCome(beatIn(context), 'Components');
    for (const [entity, { index }] of context.query(Body)) {
      if (isGiving && Option.isNone(context.get(entity, Look))) {
        context.set(entity, Look, {
          radius: 0.16 + context.random() * 0.3,
          tint: context.random(),
          since: tick,
        });
        context.set(entity, Place, {
          distance: 1.3 + index * 0.62 + context.random() * 0.2,
          angle: context.random() * 360,
          height: (context.random() - 0.5) * 0.8,
        });
      }
    }
  },
});

/** Once time starts stepping, every planet goes on round the middle, a stride every step, the nearer the faster. */
const orbit = System.make({
  name: 'orbit',
  reads: [Telling],
  writes: [Place],
  emits: [],
  run: (context) => {
    const isTicking = beatIn(context) === 'Step';
    for (const [planet, place] of context.query(Place)) {
      if (isTicking) {
        context.set(planet, Place, {
          ...place,
          angle: (place.angle + strideAt(place.distance)) % 360,
        });
      }
    }
  },
});

// DOMAIN

export const domain = Domain.make({
  name: 'Glance',
  requires: [],
  components: [Telling, Idea, Bang, Body, Look, Place, Eye],
  actions: [ChoseStart, ChoseBack, ChoseNext],
  events: [],
  systems: [imagine, emerge, give, orbit],
  rules: [start, next, back],
});

/** The first game: its one domain, a few steps a second. */
export const game = Game.make({ stepRate: STEP_RATE, domains: [domain] });

/** How a page joins the first game: as the viewer's eye, whose choices move the telling. */
export const setup = {
  game,
  join: (state: State.State) => State.spawn(state, [Eye.of({})]),
  leave: State.despawn,
};

/** The state at tick 0: the telling waiting for the viewer, and nothing else. */
export const [state] = State.spawn(State.empty({ seed: 1 }), [
  Telling.of({ beat: 'Waiting', since: 0 }),
]);

/** Where the telling of `state` is. */
export const momentOf = (state: State.State): Moment =>
  Option.getOrElse(
    Option.map(Option.fromNullishOr(State.query(state, Telling)[0]), ([, { beat }]) => beat),
    (): Moment => 'Waiting',
  );

/** Whether time has started stepping in `state`, and the state is yet to begin from there: the step beat, reached by a telling that did not begin there. */
export const isAboutToBegin = (state: State.State): boolean =>
  State.query(state, Telling).some(([, { beat, since }]) => beat === 'Step' && since > 0);

/**
 * The state `state` begins as, once time starts stepping in it: everything it holds, as it was, at its first tick, every tick it remembers counted from there, so what came before is before tick 0. Its host goes on from it in place of the state before, so the game's time starts there.
 */
export const begun = (state: State.State): State.State => {
  const { tick } = state;
  const draft = State.draft(state);
  for (const [entity, telling] of State.query(state, Telling)) {
    State.write(draft, entity, Telling, { ...telling, since: telling.since - tick });
  }
  for (const [entity, bang] of State.query(state, Bang)) {
    State.write(draft, entity, Bang, { ...bang, since: bang.since - tick });
  }
  for (const [entity, body] of State.query(state, Body)) {
    State.write(draft, entity, Body, { ...body, since: body.since - tick });
  }
  for (const [entity, look] of State.query(state, Look)) {
    State.write(draft, entity, Look, { ...look, since: look.since - tick });
  }
  return { ...State.finish(draft), tick: 0 };
};
