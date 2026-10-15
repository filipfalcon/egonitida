import type { State } from '@nitida/core';
import { Effect, Schema, Stream } from 'effect';
import type { ManagedResource } from 'foldkit';
import type * as Session from '#src/Session.ts';

/**
 * What an application shows of a game, kept in its Foldkit Model: a value the application reads off the game's state and its player, described by a schema, told once as it is and again only when it changes, never at every step. The state stays the game's, and the Model holds no more of it than the DOM shows, so `view` stays a function of the Model and Foldkit's DevTools show what changed in what is shown.
 */

/** What an application reads off a state for its player, and the schema that describes it and tells when it has changed. */
export interface Projection<A> {
  readonly schema: Schema.Schema<A>;
  readonly project: (state: State.State, player: State.Entity) => A;
}

/** What `projection` reads off the state of the game `joined` plays: as it is now, then each time it is replaced, in order. */
export const changes = <A>(joined: Session.Joined, projection: Projection<A>): Stream.Stream<A> =>
  Stream.concat(Stream.fromEffect(joined.client.state), joined.client.states).pipe(
    Stream.map((state) => projection.project(state, joined.client.entity)),
    Stream.changesWith(Schema.toEquivalence(projection.schema)),
  );

/**
 * A projection as a Foldkit Subscription's Stream: what `projection` reads off the state of the session `resource` holds, each value said in a Message of the application's, for as long as the Stream runs. If the session is not joined, though the Model says it is, as a Model restored after a reload does, `onNotJoined` says so instead, which puts the Model right so the projection runs again once the session is joined.
 */
export const stream = <A, Message, Service>(
  options: Projection<A> & {
    readonly resource: ManagedResource.ManagedResource<Session.Joined, Service>;
    readonly onProjected: (value: A) => Message;
    readonly onNotJoined: () => Message;
  },
): Stream.Stream<Message, never, Service> =>
  Stream.unwrap(
    options.resource.get.pipe(
      Effect.map((joined) => changes(joined, options).pipe(Stream.map(options.onProjected))),
      Effect.orElseSucceed(() => Stream.make(options.onNotJoined())),
    ),
  );
