import Verification.Replay

/-!
Segments: a game whose code changes as it runs, by a reload or a new build, is a switched system, xₖ₊₁ = f_{v(k)}(xₖ, uₖ), with one game for each version. A host records it as segments, one for each version it ran: each begins at the state the host went on from, and replays with its own version alone.
-/

/-- A segment of a recording: the version of the game it ran, and what it recorded under it. -/
structure Segment (Version State Input : Type) where
  version : Version
  recording : Recording State Input

/-- What a segment replays to, with the game of its own version. -/
def Segment.replay (games : Version → Game State Input) (segment : Segment Version State Input) :
    State :=
  segment.recording.replay (games segment.version)

/-- Whether `earlier`, newest first, are the segments before `segment`, each replaying to the state the one after it began at. -/
def Follows (games : Version → Game State Input) :
    Segment Version State Input → List (Segment Version State Input) → Prop
  | _, [] => True
  | segment, before :: rest => before.replay games = segment.recording.start ∧ Follows games before rest

/-- What happens to a host whose code may change: a step taken with an input, or a reload to another version. -/
inductive Happening (Version Input : Type) where
  | took (input : Input)
  | reloaded (version : Version)

/-- A host whose code may change as it runs: the state it holds, the segment it is recording now, and the segments before it, newest first. -/
structure SegmentedHost (Version State Input : Type) where
  state : State
  current : Segment Version State Input
  earlier : List (Segment Version State Input)

/-- A host that has just begun from `start` with the game of `version`, with nothing recorded yet. -/
def SegmentedHost.begin (version : Version) (start : State) : SegmentedHost Version State Input :=
  { state := start, current := { version, recording := { start, inputs := [] } }, earlier := [] }

/-- What one happening makes of a host: a step with the game of the version it runs, its input joining the current segment; or a reload, which closes the current segment and begins another at the state the host goes on from. -/
def SegmentedHost.happen (games : Version → Game State Input) (host : SegmentedHost Version State Input) :
    Happening Version Input → SegmentedHost Version State Input
  | .took input =>
    { host with
      state := (games host.current.version).step host.state input,
      current := { host.current with
        recording := { host.current.recording with
          inputs := host.current.recording.inputs ++ [input] } } }
  | .reloaded version =>
    { host with
      current := { version, recording := { start := host.state, inputs := [] } },
      earlier := host.current :: host.earlier }

/-- Whether the segments before a segment follow on depends only on the state that segment began at. -/
theorem follows_of_start (games : Version → Game State Input)
    (segment other : Segment Version State Input) (earlier : List (Segment Version State Input))
    (same_start : other.recording.start = segment.recording.start)
    (follows : Follows games segment earlier) : Follows games other earlier := by
  cases earlier with
  | nil => trivial
  | cons before rest =>
    obtain ⟨replays, follows_rest⟩ := follows
    exact ⟨replays.trans same_start.symm, follows_rest⟩

/-- What holds of a host as it runs: its current segment replays to the state it holds, and every segment before follows on. -/
def SegmentedHost.Replays (games : Version → Game State Input)
    (host : SegmentedHost Version State Input) : Prop :=
  host.current.replay games = host.state ∧ Follows games host.current host.earlier

/-- A host of whom that holds still is after whatever happens to it next, a step or a reload. -/
theorem SegmentedHost.happen_keeps_replays (games : Version → Game State Input)
    (host : SegmentedHost Version State Input) (happening : Happening Version Input)
    (replays : host.Replays games) : (host.happen games happening).Replays games := by
  obtain ⟨current_replays, follows⟩ := replays
  cases happening with
  | took input =>
    refine ⟨?_, follows_of_start games host.current _ host.earlier rfl follows⟩
    simp only [SegmentedHost.happen, Segment.replay, Recording.replay, List.foldl_append,
      List.foldl_cons, List.foldl_nil]
    rw [← current_replays]
    rfl
  | reloaded version =>
    exact ⟨rfl, current_replays, follows⟩

/-- A host of whom that holds still is after any happenings at all. -/
theorem SegmentedHost.happenings_keep_replays (games : Version → Game State Input)
    (happenings : List (Happening Version Input)) :
    ∀ host : SegmentedHost Version State Input, host.Replays games →
      (happenings.foldl (SegmentedHost.happen games) host).Replays games := by
  induction happenings with
  | nil => intro host replays; exact replays
  | cons happening rest after =>
    intro host replays
    exact after _ (SegmentedHost.happen_keeps_replays games host happening replays)

/-- However a host runs, through steps and reloads alike: its current segment replays with its own version to the very state the host holds, and every segment before replays with its own version to the state the one after it began at. -/
theorem segments_replay (games : Version → Game State Input) (version : Version) (start : State)
    (happenings : List (Happening Version Input)) :
    (happenings.foldl (SegmentedHost.happen games) (SegmentedHost.begin version start)).Replays
      games :=
  SegmentedHost.happenings_keep_replays games happenings _ ⟨rfl, trivial⟩
