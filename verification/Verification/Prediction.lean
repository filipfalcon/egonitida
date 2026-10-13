/-!
Prediction: a client steps its player ahead of the host, over the state it holds, which lacks the components the host keeps for itself and holds components the host never has. If whatever writes a predicted component depends, through every read along the way, only on components host and client hold alike, the client's step gives every predicted component exactly as the host's does, from the same input.
-/

/-- Where a component's values live: decided by the host and sent to every client; guessed by the client and confirmed by the host; kept by a client alone; or kept by the host alone. -/
inductive Role where
  | server
  | predicted
  | «local»
  | «private»

/-- Whether host and client hold a component of this role alike: what the host sends every client. -/
def Role.Shared : Role → Prop
  | .server => True
  | .predicted => True
  | .«local» => False
  | .«private» => False

/-- A system as the step runs it: the components it reads and writes, as it declares them, and what it does, which changes nothing it does not write, and writes only what follows from what it reads. -/
structure System (Component Value Input : Type) where
  reads : Component → Prop
  writes : Component → Prop
  run : Input → (Component → Value) → (Component → Value)
  leaves : ∀ input state component, ¬ writes component → run input state component = state component
  follows_reads : ∀ input first second,
    (∀ component, reads component → first component = second component) →
      ∀ component, writes component → run input first component = run input second component

/-- A step as its systems make it: each runs in order, on what the ones before it wrote. -/
def stepWith (systems : List (System Component Value Input)) (input : Input)
    (state : Component → Value) : Component → Value :=
  systems.foldl (fun state system => system.run input state) state

/-- What the check of a game finds clean: components host and client hold alike, such that whatever writes one reads only clean components. -/
structure Clean (role : Component → Role) (systems : List (System Component Value Input))
    (clean : Component → Prop) : Prop where
  shared : ∀ component, clean component → (role component).Shared
  closed : ∀ system ∈ systems, ∀ component, system.writes component → clean component →
    ∀ read, system.reads read → clean read

/-- Host and client that hold every clean component alike still do after one more system runs, if whatever that system writes clean, it reads only clean. -/
theorem system_keeps_clean_alike (system : System Component Value Input)
    (clean : Component → Prop)
    (closed : ∀ component, system.writes component → clean component →
      ∀ read, system.reads read → clean read)
    (input : Input) (host client : Component → Value)
    (alike : ∀ component, clean component → client component = host component) :
    ∀ component, clean component →
      system.run input client component = system.run input host component := by
  intro component is_clean
  by_cases written : system.writes component
  · exact system.follows_reads input client host
      (fun read reads => alike read (closed component written is_clean read reads))
      component written
  · rw [system.leaves input client component written, system.leaves input host component written]
    exact alike component is_clean

/-- Host and client that hold every clean component alike still do after any systems run in order, if whatever each writes clean, it reads only clean. -/
theorem systems_keep_clean_alike (clean : Component → Prop) (input : Input)
    (systems : List (System Component Value Input)) :
    (∀ system ∈ systems, ∀ component, system.writes component → clean component →
      ∀ read, system.reads read → clean read) →
    ∀ host client : Component → Value,
      (∀ component, clean component → client component = host component) →
      ∀ component, clean component →
        stepWith systems input client component = stepWith systems input host component := by
  induction systems with
  | nil => intro _ host client alike; exact alike
  | cons system rest after =>
    intro closed host client alike
    exact after (fun other member => closed other (List.mem_cons_of_mem system member))
      (system.run input host) (system.run input client)
      (system_keeps_clean_alike system clean (closed system List.mem_cons_self) input host client
        alike)

/-- If the check finds every predicted component clean, a client's step over the state it holds gives every predicted component exactly as the host's step over its own, from the same input. -/
theorem prediction_matches_host (role : Component → Role)
    (systems : List (System Component Value Input)) (clean : Component → Prop)
    (checked : Clean role systems clean)
    (predicted_clean : ∀ component, role component = .predicted → clean component)
    (input : Input) (host client : Component → Value)
    (holds_alike : ∀ component, (role component).Shared → client component = host component) :
    ∀ component, role component = .predicted →
      stepWith systems input client component = stepWith systems input host component :=
  fun component predicted =>
    systems_keep_clean_alike clean input systems checked.closed host client
      (fun other is_clean => holds_alike other (checked.shared other is_clean))
      component (predicted_clean component predicted)
