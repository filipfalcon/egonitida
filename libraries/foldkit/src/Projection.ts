import type { World as Worlds } from '@lightocean/core';
import { Effect, Schema, Stream } from 'effect';
import type { ManagedResource } from 'foldkit';
import type * as World from '#src/World.ts';

/**
 * What an application shows of a world, kept in its Foldkit Model: a value the application reads off the world and its player, described by a schema, told once as it is and again only when it changes, never at every step. The world stays the world's, and the Model holds no more of it than the DOM shows, so `view` stays a function of the Model and Foldkit's DevTools show what changed in what is shown.
 */

/** What an application reads off a world for its player, and the schema that describes it and tells when it has changed. */
export interface Projection<A> {
  readonly schema: Schema.Schema<A>;
  readonly project: (world: Worlds.World, player: Worlds.Entity) => A;
}

/** What `projection` reads off the world `joined` plays: as it is now, then each time it changes, in order. */
export const changes = <A>(joined: World.Joined, projection: Projection<A>): Stream.Stream<A> =>
  Stream.concat(Stream.fromEffect(joined.client.world), joined.client.worlds).pipe(
    Stream.map((world) => projection.project(world, joined.client.entity)),
    Stream.changesWith(Schema.toEquivalence(projection.schema)),
  );

/**
 * A projection as a Foldkit Subscription's Stream: what `projection` reads off the world `resource` holds, each value said in a Message of the application's, for as long as the Stream runs; nothing while no world is joined.
 */
export const stream = <A, Message, Service>(
  options: Projection<A> & {
    readonly resource: ManagedResource.ManagedResource<World.Joined, Service>;
    readonly onProjected: (value: A) => Message;
  },
): Stream.Stream<Message, never, Service> =>
  Stream.unwrap(
    options.resource.get.pipe(
      Effect.map((joined) => changes(joined, options).pipe(Stream.map(options.onProjected))),
      Effect.orElseSucceed(() => Stream.empty),
    ),
  );
