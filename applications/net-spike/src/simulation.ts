/**
 * The world the spike's server steps: players moving on a plane. It is pure and deterministic, the way the engine's core will be, so the server, a client predicting, and a replay all reach the same state from the same inputs.
 */

export const STEP_RATE = 30;
export const STEP_SECONDS = 1 / STEP_RATE;
/** Metres per second at a full move. */
export const SPEED = 4;

export type Vector2 = readonly [x: number, z: number];

export interface Player {
  readonly id: string;
  readonly position: Vector2;
  /** The sequence number of the newest input applied, which the client compares its own against. */
  readonly lastSeq: number;
}

export interface State {
  readonly tick: number;
  readonly players: ReadonlyArray<Player>;
}

export interface Input {
  readonly playerId: string;
  readonly seq: number;
  /** A direction no longer than one. */
  readonly move: Vector2;
}

export const empty: State = { tick: 0, players: [] };

export const join = (state: State, id: string): State =>
  state.players.some((player) => player.id === id)
    ? state
    : { ...state, players: [...state.players, { id, position: [0, 0], lastSeq: 0 }] };

export const leave = (state: State, id: string): State => ({
  ...state,
  players: state.players.filter((player) => player.id !== id),
});

const limited = (move: Vector2): Vector2 => {
  const length = Math.hypot(move[0], move[1]);
  return length > 1 ? [move[0] / length, move[1] / length] : move;
};

/** The newest input of a player that is newer than what it already had applied. */
const newestFor = (player: Player, inputs: ReadonlyArray<Input>): Input | undefined =>
  inputs.reduce<Input | undefined>(
    (newest, input) =>
      input.playerId === player.id &&
      input.seq > player.lastSeq &&
      (newest === undefined || input.seq > newest.seq)
        ? input
        : newest,
    undefined,
  );

const move = (player: Player, input: Input | undefined): Player => {
  if (input === undefined) {
    return player;
  }
  const [x, z] = limited(input.move);
  return {
    ...player,
    position: [
      player.position[0] + x * SPEED * STEP_SECONDS,
      player.position[1] + z * SPEED * STEP_SECONDS,
    ],
    lastSeq: input.seq,
  };
};

/** One fixed step: every player moves by its newest input, if it sent a new one. */
export const step = (state: State, inputs: ReadonlyArray<Input>): State => ({
  tick: state.tick + 1,
  players: state.players.map((player) => move(player, newestFor(player, inputs))),
});
