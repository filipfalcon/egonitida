import { Devices, Drawing, KeyboardAndMouse, View, Viewport } from '@lightocean/client';
import { Client } from '@lightocean/core';
import { Prediction } from '@lightocean/client/experimental';
import { SocketTransport } from '@lightocean/core/experimental';
import { Room } from '@lightocean/server/experimental';
import * as stylex from '@stylexjs/stylex';
import { Effect, Option, Schema } from 'effect';
import * as Socket from 'effect/socket/Socket';
import * as Three from 'three/webgpu';
import * as Steering from '#src/steering.ts';
import * as Walkers from '#src/walkers.ts';
import * as WalkersView from '#src/walkers.view.ts';
// Relative, as StyleX finds variables by the path of the module that defines them.
import { colours } from './tokens.stylex.ts';

// The page: opens the room the address names, `?room=lobby` unless it names another, over a WebSocket to the Worker the Alchemy stack says is at VITE_ROOMS_URL; draws its walkers at every frame the display shows, and steers this player's walker by the keys, predicting it so it responds at once.

const styles = stylex.create({
  canvas: { display: 'block', width: '100%', height: '100%', backgroundColor: colours.ground },
});

/** The room the page's address names, or the lobby. */
const roomId = Option.getOrElse(
  Option.flatMap(
    Option.fromNullishOr(new URLSearchParams(location.search).get('room')),
    Schema.decodeOption(Room.Id),
  ),
  () => Schema.decodeSync(Room.Id)('lobby'),
);

/** Where the room is reached: the Worker's address, as a WebSocket's, followed by the room's path. */
const roomUrl = Effect.suspend(() => {
  const configured: unknown = import.meta.env['VITE_ROOMS_URL'];
  if (typeof configured !== 'string' || configured === '') {
    return Effect.die('The page was not told where rooms are: serve it with `npm run dev`.');
  }
  const url = new URL(Room.pathOf(roomId), configured);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return Effect.succeed(url.href);
});

const main = Effect.gen(function* () {
  document.title = `A shared room: ${roomId}`;
  const canvas = document.createElement('canvas');
  canvas.className = stylex.props(styles.canvas).className ?? '';
  document.body.append(canvas);

  const connection = yield* SocketTransport.connect(yield* roomUrl);
  const client = yield* Client.connect(connection, { game: Walkers.game });
  const drawing = yield* Drawing.make(client, { keepSeconds: 1 });
  const viewport = yield* Viewport.make(canvas);
  const views = yield* View.make(WalkersView.views);
  const prediction = yield* Prediction.make(client, Walkers.game);

  const sun = new Three.DirectionalLight(0xffffff, 2);
  sun.position.set(4, 10, 6);
  const floor = new Three.GridHelper(
    Walkers.HALF_SIZE * 2,
    Walkers.HALF_SIZE * 2,
    0x3a3f47,
    0x2a2e35,
  );
  viewport.scene.add(views.root, floor, new Three.AmbientLight(0xffffff, 0.5), sun);
  viewport.camera.position.set(0, 12, 9);
  viewport.camera.lookAt(0, 0, 0);

  const keyboardAndMouse = yield* KeyboardAndMouse.make(window);
  const steered = { last: Steering.start };
  yield* viewport.loop((seconds) =>
    Option.match(drawing.frame(seconds), {
      onNone: () => Effect.void,
      onSome: (frame) =>
        Effect.suspend(() => {
          steered.last = Steering.steer(
            { ...Devices.idle, ...keyboardAndMouse.read() },
            steered.last,
          );
          prediction.hold([Walkers.Steering.of(steered.last.steering)]);
          return views.frame(prediction.frame(frame, seconds));
        }),
    }),
  );
  return yield* Effect.never;
}).pipe(Effect.provide(Socket.layerWebSocketConstructorGlobal), Effect.scoped);

Effect.runFork(main);
