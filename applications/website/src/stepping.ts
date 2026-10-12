import { type Client, type Host } from '@lightocean/core';
import { Rewind } from '@lightocean/devtools';
import { Effect, Match, Schema, type Scope, Stream } from 'effect';

/**
 * A game stepped by hand: its host holds time from the start, or a page holds it, shows a page the state it holds when the page asks, and takes one step each time the page asks for one, by controls the page sends. Going back to an earlier state is the engine's own: the debugger beside the host keeps its past, and a page goes back through its rewind's controls. Holding time is the host's to allow, so this serves only a host that lets its clients hold it, as a local server for one player does.
 */

/** What a page asks of a game stepped by hand: to be shown the state as it stands, as a host sends its state only after each step it takes; or one step on. */
export const Control = Schema.Union([
  Schema.TaggedStruct('Show', {}),
  Schema.TaggedStruct('Step', {}),
]);
export type Control = typeof Control.Type;

/** Carries out the controls `host`'s pages send, until the scope closes, whoever holds its time. */
export const carryOut = (host: Host.Host): Effect.Effect<void, never, Scope.Scope> =>
  host.controls.pipe(
    Stream.filterMap(({ payload }) => Schema.decodeUnknownResult(Control)(payload)),
    Stream.runForEach((control) =>
      Match.value(control).pipe(
        Match.tag('Show', () => Effect.flatMap(host.state, host.show)),
        Match.tag('Step', () => host.step(1)),
        Match.exhaustive,
      ),
    ),
    Effect.forkScoped,
    Effect.asVoid,
  );

/** Holds `host`'s time, and carries out the controls its pages send, until the scope closes. */
export const serve = (host: Host.Host): Effect.Effect<void, never, Scope.Scope> =>
  Effect.andThen(host.hold, carryOut(host));

const send = (client: Client.Client, control: Control) =>
  client.control(Schema.encodeSync(Control)(control));

/** Asks the host `client` is joined to for the state as it stands. */
export const show = (client: Client.Client): Effect.Effect<void> => send(client, { _tag: 'Show' });

/** Asks the host `client` is joined to for one step. */
export const step = (client: Client.Client): Effect.Effect<void> => send(client, { _tag: 'Step' });

/** Asks the host `client` is joined to to go back to the state it was at, at `tick`, and step on from there, through the rewind of the debugger beside it: what came after is gone. Its time stays held, by the host itself. */
export const goBack = (client: Client.Client, tick: number): Effect.Effect<void> => {
  const rewind = Rewind.controls(client);
  return Effect.andThen(rewind.seek(tick), rewind.playFromHere);
};
