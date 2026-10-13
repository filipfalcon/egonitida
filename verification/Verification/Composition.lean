import Verification.Replay

/-!
Composition: a game may run on many hosts, each holding a state and a tick of its own. No host reaches into another's state: a step may send other hosts messages, its output, and each message arrives later as input of the host it was sent to. Whatever order the hosts step in, and whenever their messages arrive, each host's recording replays on its own.
-/

/-- A host's part in a game that spans many: the game it steps, and what a step sends other hosts, as messages that arrive there as input. -/
structure Node (HostId State Input : Type) where
  game : Game State Input
  sends : State → Input → List (HostId × Input)

/-- Every host of a game that spans many, and the messages on their way between them. -/
structure Network (HostId State Input : Type) where
  hosts : HostId → Host State Input
  inFlight : List (HostId × Input)

/-- What may happen next across the hosts: input from outside them all, such as a player's, reaching one; or one of the messages on their way arriving. Which happens, and when, the network decides. -/
inductive Event (HostId Input : Type) where
  | arrived (host : HostId) (input : Input)
  | delivered (index : Nat)

variable [DecidableEq HostId]

/-- One host takes a step with an input: only it steps and records, and what the step sends joins the messages on their way. -/
def Network.stepHost (nodes : HostId → Node HostId State Input)
    (network : Network HostId State Input) (host : HostId) (input : Input) :
    Network HostId State Input :=
  { hosts := fun other =>
      if other = host then (network.hosts host).take (nodes host).game input
      else network.hosts other,
    inFlight := network.inFlight ++ (nodes host).sends (network.hosts host).state input }

/-- What one event makes of the hosts: input from outside steps the host it reaches; a message on its way leaves the network and steps the host it was sent to. -/
def Network.happen (nodes : HostId → Node HostId State Input)
    (network : Network HostId State Input) : Event HostId Input → Network HostId State Input
  | .arrived host input => network.stepHost nodes host input
  | .delivered index =>
    match network.inFlight[index]? with
    | none => network
    | some (host, input) =>
      ({ network with inFlight := network.inFlight.eraseIdx index }).stepHost nodes host input

/-- Hosts that have just begun, each from its own state, with nothing recorded and nothing on its way. -/
def Network.begin (starts : HostId → State) : Network HostId State Input :=
  { hosts := fun host => Host.begin (starts host), inFlight := [] }

/-- What holds of the hosts as they run: every host's recording replays, with its own game alone, to the state it holds. -/
def Network.Replays (nodes : HostId → Node HostId State Input)
    (network : Network HostId State Input) : Prop :=
  ∀ host, (network.hosts host).recording.replay (nodes host).game = (network.hosts host).state

/-- That still holds after one host takes a step: the host that steps keeps it as a host does, and every other host is left as it was. -/
theorem Network.stepHost_keeps_replays (nodes : HostId → Node HostId State Input)
    (network : Network HostId State Input) (stepping : HostId) (input : Input)
    (replays : network.Replays nodes) : (network.stepHost nodes stepping input).Replays nodes := by
  intro host
  simp only [Network.stepHost]
  split
  · next same => subst same; exact take_keeps_replay _ _ _ (replays host)
  · exact replays host

/-- That still holds after whatever happens next across the hosts. -/
theorem Network.happen_keeps_replays (nodes : HostId → Node HostId State Input)
    (network : Network HostId State Input) (event : Event HostId Input)
    (replays : network.Replays nodes) : (network.happen nodes event).Replays nodes := by
  cases event with
  | arrived stepping input => exact Network.stepHost_keeps_replays nodes network stepping input replays
  | delivered index =>
    simp only [Network.happen]
    split
    · exact replays
    · exact Network.stepHost_keeps_replays nodes _ _ _ replays

/-- That still holds after any events at all. -/
theorem Network.events_keep_replays (nodes : HostId → Node HostId State Input)
    (events : List (Event HostId Input)) :
    ∀ network : Network HostId State Input, network.Replays nodes →
      (events.foldl (Network.happen nodes) network).Replays nodes := by
  induction events with
  | nil => intro network replays; exact replays
  | cons event rest after =>
    intro network replays
    exact after _ (Network.happen_keeps_replays nodes network event replays)

/-- However the hosts step, in whatever order, and whenever their messages arrive: each host's recording replays, with its own game alone, to the very state it holds. -/
theorem hosts_replay_alone (nodes : HostId → Node HostId State Input) (starts : HostId → State)
    (events : List (Event HostId Input)) (host : HostId) :
    let network := events.foldl (Network.happen nodes) (Network.begin starts)
    (network.hosts host).recording.replay (nodes host).game = (network.hosts host).state :=
  Network.events_keep_replays nodes events (Network.begin starts) (fun _ => rfl) host
