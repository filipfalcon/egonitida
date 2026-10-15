import Verification.Equation
import Verification.Replay
import Verification.Segments
import Verification.Composition
import Verification.Prediction

/-!
The theorems Nitida's principles rest on, each stated here again in full, and checked to rest on no axiom beyond Lean's own. A theorem removed, weakened, or proven with `sorry` fails the build here, even where its own file still builds.
-/

/-- The same state and the same input give the same next state. -/
example : ∀ {State Input : Type} (game : Game State Input) (x₁ x₂ : State) (u₁ u₂ : Input),
    x₁ = x₂ → u₁ = u₂ → game.step x₁ u₁ = game.step x₂ u₂ :=
  @same_state_same_input

/-- However many steps a host takes, its recording replays to the very state it holds. -/
example : ∀ {State Input : Type} (game : Game State Input) (start : State) (inputs : List Input),
    (inputs.foldl (Host.take game) (Host.begin start)).recording.replay game =
      (inputs.foldl (Host.take game) (Host.begin start)).state :=
  @replay_is_live

/-- Through steps and reloads alike, each segment replays with its own version: the current one to the state the host holds, and every one before to the state the one after it began at. -/
example : ∀ {Version State Input : Type} (games : Version → Game State Input) (version : Version)
    (start : State) (happenings : List (Happening Version Input)),
    (happenings.foldl (SegmentedHost.happen games) (SegmentedHost.begin version start)).Replays
      games :=
  @segments_replay

/-- However the hosts step and whenever their messages arrive, each host's recording replays with its own game alone. -/
example : ∀ {HostId : Type} [DecidableEq HostId] {State Input : Type}
    (nodes : HostId → Node HostId State Input) (starts : HostId → State)
    (events : List (Event HostId Input)) (host : HostId),
    let network := events.foldl (Network.happen nodes) (Network.begin starts)
    (network.hosts host).recording.replay (nodes host).game = (network.hosts host).state :=
  @hosts_replay_alone

/-- If the check finds every predicted component clean, a client predicts every one exactly as the host steps it. -/
example : ∀ {Component Value Input : Type} (role : Component → Role)
    (systems : List (System Component Value Input)) (clean : Component → Prop),
    Clean role systems clean →
    (∀ component, role component = .predicted → clean component) →
    ∀ (input : Input) (host client : Component → Value),
    (∀ component, (role component).Shared → client component = host component) →
    ∀ component, role component = .predicted →
      stepWith systems input client component = stepWith systems input host component :=
  @prediction_matches_host

/-- info: 'same_state_same_input' does not depend on any axioms -/
#guard_msgs in #print axioms same_state_same_input

/-- info: 'replay_is_live' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms replay_is_live

/-- info: 'segments_replay' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms segments_replay

/-- info: 'hosts_replay_alone' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms hosts_replay_alone

/-- info: 'prediction_matches_host' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in #print axioms prediction_matches_host
