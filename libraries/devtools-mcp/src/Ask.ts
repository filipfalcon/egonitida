import { type Inspect, Page, Relay } from '@egonitida/devtools';
import { Data, Duration, Effect, Option, Schema } from 'effect';
import WebSocket from 'ws';

/**
 * A tool's side of a relay: one request at a time, each over a connection of its own, made when it is asked and closed once it is answered, so a tool may start before the development server, and reaches one started again on its next request.
 */

/** Why a request came to nothing: a relay or host that could not be reached, or a host that refused it. */
export class Failed extends Data.TaggedError('Failed')<{ readonly reason: string }> {}

/** How long a request may wait for its answer. */
const PATIENCE = Duration.seconds(10);

const fromJson = Schema.decodeUnknownOption(Schema.fromJsonString(Relay.FromRelay));

/** Sends `message` to the relay `record` tells of, and comes to its answer. */
const send = (record: Relay.Record, message: typeof Relay.ToRelay.Encoded) =>
  Effect.callback<Relay.FromRelay, Failed>((resume) => {
    const url = new URL(record.url);
    url.searchParams.set('token', record.token);
    const socket = new WebSocket(url);
    socket.on('open', () => socket.send(JSON.stringify(message)));
    socket.on('message', (data) => {
      const text = Array.isArray(data) || data instanceof ArrayBuffer ? '' : data.toString('utf8');
      Option.map(fromJson(text), (answer) => {
        if (answer.id === message.id) {
          resume(Effect.succeed(answer));
          socket.close();
        }
      });
    });
    socket.on('error', (error) =>
      resume(Effect.fail(new Failed({ reason: `the relay at ${record.url}: ${error.message}` }))),
    );
    return Effect.sync(() => socket.terminate());
  }).pipe(
    Effect.timeoutOrElse({
      duration: PATIENCE,
      orElse: () =>
        Effect.fail(new Failed({ reason: 'the game did not answer in time: is its page open?' })),
    }),
  );

/** Every host of every relay, the newest last. */
export const hosts = (relays: ReadonlyArray<Relay.Record>) =>
  Effect.map(
    Effect.forEach(relays, (record) =>
      Effect.map(send(record, { _tag: 'Hosts', id: 1 }), (answer) =>
        answer._tag === 'Hosts' ? answer.hosts.map((host) => ({ ...host, record })) : [],
      ),
    ),
    (each) => each.flat(),
  );

/** The relay to ask: the one whose hosts include `host`, or the newest. */
const relayFor = (relays: ReadonlyArray<Relay.Record>, host: Option.Option<string>) =>
  Option.match(host, {
    onNone: () =>
      Effect.fromOption(Option.fromNullishOr(relays.at(-1))).pipe(
        Effect.mapError(
          () =>
            new Failed({
              reason:
                'no development server with the EgoNitida devtools plugin is running in this workspace',
            }),
        ),
      ),
    onSome: (named) =>
      Effect.flatMap(hosts(relays), (running) =>
        Option.match(Option.fromNullishOr(running.find(({ host }) => host === named)), {
          onNone: () =>
            Effect.fail(
              new Failed({
                reason: `no host is called ${named}: ${running.map(({ host }) => host).join(', ') || 'none'} running`,
              }),
            ),
          onSome: ({ record }) => Effect.succeed(record),
        }),
      ),
  });

/** Asks `request` of the host named `host`, or the newest, through the relays: its answer, or why it came to nothing. */
export const request = (
  relays: ReadonlyArray<Relay.Record>,
  asked: typeof Inspect.Request.Encoded,
  host?: string,
): Effect.Effect<unknown, Failed> =>
  Effect.gen(function* () {
    const named = Option.fromNullishOr(host);
    const record = yield* relayFor(relays, named);
    const answer = yield* send(record, {
      _tag: 'Ask',
      id: 1,
      ...Option.match(named, { onNone: () => ({}), onSome: (only) => ({ host: only }) }),
      request: asked,
    });
    switch (answer._tag) {
      case 'Answered':
        return answer.answer;
      case 'Unanswered':
        return yield* new Failed({ reason: answer.reason });
      case 'Hosts':
        return yield* new Failed({ reason: 'the relay answered something it was not asked' });
    }
  });

/** A shot of what the newest page drawing the host named `host`, or the newest, shows now, at most `width` pixels across if given; or why there is none. */
export const capture = (
  relays: ReadonlyArray<Relay.Record>,
  options: { readonly host?: string | undefined; readonly width?: number | undefined },
): Effect.Effect<Page.Shot, Failed> =>
  Effect.gen(function* () {
    const named = Option.fromNullishOr(options.host);
    const record = yield* relayFor(relays, named);
    const answer = yield* send(record, {
      _tag: 'Capture',
      id: 1,
      ...Option.match(named, { onNone: () => ({}), onSome: (only) => ({ host: only }) }),
      ...(options.width === undefined ? {} : { width: options.width }),
    });
    switch (answer._tag) {
      case 'Answered':
        return yield* Schema.decodeUnknownEffect(Page.Shot)(answer.answer).pipe(
          Effect.mapError(() => new Failed({ reason: 'the page answered with no shot' })),
        );
      case 'Unanswered':
        return yield* new Failed({ reason: answer.reason });
      case 'Hosts':
        return yield* new Failed({ reason: 'the relay answered something it was not asked' });
    }
  });
