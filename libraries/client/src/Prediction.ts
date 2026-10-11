import { type Client, type Component, Game, Input, World } from '@lightocean/core';
import { Effect, Option, Schedule, Schema, type Scope, Stream } from 'effect';
import type * as Drawing from '#src/Drawing.ts';
import * as Interpolate from '#src/Interpolate.ts';

/**
 * A player's own client playing ahead of its host, so the player's input answers at once across a network. The client sends the input the player holds once a step, numbered, as the host takes one a step; the host says which number each world it sends took in. What the player's own entity holds of predicted components is drawn from the newest world the host sent, stepped on with every input it has not taken in yet. When the host disagrees with what was predicted, what is drawn goes over to it in a few frames, never in a jump. Everything else is drawn as the host sent it.
 */

/** How fast what is drawn of the player goes over to what is predicted: the share of the way left it closes in a second, as a rate. */
const CATCH_UP_PER_SECOND = 30;

/** The most inputs kept that the host has not taken in: ten seconds at 60 steps a second. */
const KEPT_INPUTS = 600;

export interface Prediction {
  /** Holds `values` of input components as the player's input from now on, sent once a step until another is held. */
  readonly hold: (values: ReadonlyArray<Component.Instance<Input.InputComponent>>) => void;
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
    const state = {
      held: new Array<Component.Instance<Input.InputComponent>>(),
      /** The inputs sent, by their numbers, oldest first. */
      sent: new Array<{ readonly seq: number; readonly inputs: ReadonlyArray<Input.Input> }>(),
      confirmed: Option.none<World.World>(),
      /** The number of the newest input a world the host sent took in. */
      acked: 0,
      /** What is drawn of each predicted component of the player now, by its name. */
      shown: new Map<string, unknown>(),
    };

    yield* client.worlds.pipe(
      Stream.runForEach((world) =>
        Effect.sync(() => {
          state.confirmed = Option.some(world);
        }),
      ),
      Effect.forkScoped,
    );
    // Once a step, as the host takes one input a step.
    yield* Effect.suspend(() =>
      Effect.map(client.send(state.held), (seq) => {
        state.sent = [
          ...state.sent,
          { seq, inputs: state.held.map((instance) => Input.fromInstance(own, instance)) },
        ].slice(-KEPT_INPUTS);
      }),
    ).pipe(Effect.repeat(Schedule.spaced(`${1000 / client.stepRate} millis`)), Effect.forkScoped);

    /** The newest world the host sent, stepped on with every input it has not taken in. Which it took in the host says just after the world, so until it has, the number it said last stands. */
    const ahead = (confirmed: World.World) => {
      state.acked = Option.getOrElse(client.ackedAt(confirmed.tick), () => state.acked);
      return state.sent
        .filter(({ seq }) => seq > state.acked)
        .reduce((world, { inputs }) => Game.step(game, world, inputs).world, confirmed);
    };

    return {
      hold: (values) => {
        state.held = [...values];
      },
      frame: (frame, seconds) => {
        const world = Option.map(state.confirmed, ahead);
        const share = 1 - Math.exp(-CATCH_UP_PER_SECOND * seconds);
        for (const component of predicted) {
          Option.map(
            Option.flatMap(world, (stepped) => World.get(stepped, own, component)),
            (target) => {
              const before = state.shown.get(component.name);
              state.shown.set(
                component.name,
                before !== undefined && Schema.is(component.schema)(before)
                  ? Interpolate.between(component.schema, before, target, share)
                  : target,
              );
            },
          );
        }
        const get: Drawing.Frame['get'] = (entity, component) => {
          const shown = state.shown.get(component.name);
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
          query: World.queryBy((components) => World.holding(frame.drawn, components), get),
        };
      },
    };
  });
