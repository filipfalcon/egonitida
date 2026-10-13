import Verification.Equation

/-!
Replay: what a host records of its steps is enough to step its state again, from the state it began at.
-/

/-- A recording: the state it began at, and the input of every step since, in order. -/
structure Recording (State Input : Type) where
  start : State
  inputs : List Input

/-- What a recording replays to: every input stepped in order from the state it began at. -/
def Recording.replay (game : Game State Input) (recording : Recording State Input) : State :=
  recording.inputs.foldl game.step recording.start

/-- A host as it runs: the state it holds, and the recording it keeps of how it came to it. -/
structure Host (State Input : Type) where
  state : State
  recording : Recording State Input

/-- A host that has just begun from `start`, with nothing recorded yet. -/
def Host.begin (start : State) : Host State Input :=
  { state := start, recording := { start, inputs := [] } }

/-- A host takes one step: its state steps with the input, and the input joins its recording. -/
def Host.take (game : Game State Input) (host : Host State Input) (input : Input) :
    Host State Input :=
  { state := game.step host.state input,
    recording := { host.recording with inputs := host.recording.inputs ++ [input] } }

/-- A host whose recording replays to the state it holds still does after one more step. -/
theorem take_keeps_replay (game : Game State Input) (host : Host State Input) (input : Input)
    (replays : host.recording.replay game = host.state) :
    (host.take game input).recording.replay game = (host.take game input).state := by
  simp only [Host.take, Recording.replay, List.foldl_append, List.foldl_cons, List.foldl_nil]
  rw [← replays]
  rfl

/-- A host whose recording replays to the state it holds still does after any number of steps. -/
theorem steps_keep_replay (game : Game State Input) (inputs : List Input) :
    ∀ host : Host State Input, host.recording.replay game = host.state →
      (inputs.foldl (Host.take game) host).recording.replay game =
        (inputs.foldl (Host.take game) host).state := by
  induction inputs with
  | nil => intro host replays; exact replays
  | cons input rest after =>
    intro host replays
    exact after (host.take game input) (take_keeps_replay game host input replays)

/-- However many steps a host takes, from whatever input, its recording replays to the very state it holds. -/
theorem replay_is_live (game : Game State Input) (start : State) (inputs : List Input) :
    (inputs.foldl (Host.take game) (Host.begin start)).recording.replay game =
      (inputs.foldl (Host.take game) (Host.begin start)).state :=
  steps_keep_replay game inputs (Host.begin start) rfl
