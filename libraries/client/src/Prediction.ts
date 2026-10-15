import { type Client, type Component, Demand, Game, type Input, State } from '@nitida/core';
import { Effect, Option, Schedule, Schema, type Scope, Stream } from 'effect';
import type * as Drawing from '#src/Drawing.ts';
import * as Interpolate from '#src/Interpolate.ts';

/**
 * A player's own client playing ahead of its host, so what the player does with their controls takes effect at once across a network. The client sends the player's demands once a step, numbered, as the host takes them once a step; the host says which number each state it sends took in. What the player's own entity holds of predicted components is drawn from the newest state the host sent, stepped on with every demand it has not taken in yet. When the host disagrees with what was predicted, what is drawn goes over to it in a few frames, never in a jump. Everything else is drawn as the host sent it.
 *
 * The host disagrees only over what the client could not know: the other players' demands and the actions, which reach the host alone. Never over what the client holds differently, since a game whose predicted components follow from what its clients do not hold as its host does is refused when it is made (`Game.make`).
 */

/** How fast what is drawn of the player goes over to what is predicted: the share of the way left it closes in a second, as a rate. */
const CATCH_UP_PER_SECOND = 30;

/** The most steps' demands kept that the host has not taken in: ten seconds at 60 steps a second. */
const KEPT_DEMANDS = 600;

export interface Prediction {
  /** Takes `values` of demand components as the player's demands from now on, sent once a step until others are given. */
  readonly demand: (values: ReadonlyArray<Component.Instance<Demand.DemandComponent>>) => void;
  /** `frame` with the player's own entity drawn as predicted, `seconds` after the frame before. */
  readonly frame: (frame: Drawing.Frame, seconds: number) => Drawing.Frame;
}

/** The prediction of `client`'s own player in `game`, until the scope closes. */
export const make = (
  client: Client.Client,
  game: Game.Game,
): Effect.Effect<Prediction, never, Scope.Scope> =>
  Effect.gen(function* () {
    const own = client.entity;
    const predicted = game.components.filter(({ network }) => network === 'predicted');
    const predicting = {
      demanded: new Array<Component.Instance<Demand.DemandComponent>>(),
      /** The input of each step sent, by its number, oldest first: the player's demands, and no actions, which the host alone hands to the rules. */
      sent: new Array<{ readonly seq: number; readonly input: Input.Input }>(),
      confirmed: Option.none<State.State>(),
      /** The number of the newest demands a state the host sent took in. */
      acked: 0,
      /** What is drawn of each predicted component of the player now, by its name. */
      shown: new Map<string, unknown>(),
    };

    yield* client.states.pipe(
      Stream.runForEach((state) =>
        Effect.sync(() => {
          predicting.confirmed = Option.some(state);
        }),
      ),
      Effect.forkScoped,
    );
    // Once a step, as the host takes the demands once a step.
    yield* Effect.suspend(() =>
      Effect.map(client.send(predicting.demanded), (seq) => {
        predicting.sent = [
          ...predicting.sent,
          {
            seq,
            input: {
              demands: predicting.demanded.map((instance) => Demand.fromInstance(own, instance)),
              actions: [],
            },
          },
        ].slice(-KEPT_DEMANDS);
      }),
    ).pipe(Effect.repeat(Schedule.spaced(`${1000 / client.stepRate} millis`)), Effect.forkScoped);

    /** The newest state the host sent, stepped on with every demand it has not taken in. Which it took in the host says just after the state, so until it has, the number it said last stands. */
    const ahead = (confirmed: State.State) => {
      predicting.acked = Option.getOrElse(client.ackedAt(confirmed.tick), () => predicting.acked);
      return predicting.sent
        .filter(({ seq }) => seq > predicting.acked)
        .reduce((state, { input }) => Game.step(game, state, input).state, confirmed);
    };

    return {
      demand: (values) => {
        predicting.demanded = [...values];
      },
      frame: (frame, seconds) => {
        const state = Option.map(predicting.confirmed, ahead);
        const share = 1 - Math.exp(-CATCH_UP_PER_SECOND * seconds);
        for (const component of predicted) {
          Option.map(
            Option.flatMap(state, (stepped) => State.get(stepped, own, component)),
            (target) => {
              const before = predicting.shown.get(component.name);
              predicting.shown.set(
                component.name,
                before !== undefined && Schema.is(component.schema)(before)
                  ? Interpolate.between(component.schema, before, target, share)
                  : target,
              );
            },
          );
        }
        const get: Drawing.Frame['get'] = (entity, component) => {
          const shown = predicting.shown.get(component.name);
          return entity === own &&
            component.network === 'predicted' &&
            shown !== undefined &&
            Schema.is(component.schema)(shown)
            ? Option.some(shown)
            : frame.get(entity, component);
        };
        return {
          ...frame,
          get,
          query: State.queryBy((components) => State.entitiesHolding(frame.drawn, components), get),
        };
      },
    };
  });
