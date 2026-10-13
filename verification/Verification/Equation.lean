/-!
The equation LightOcean rests on, x′ = f(x, u): a state, the input that enters a step from outside it, and the step that turns both into the next state.
-/

/-- A game as the equation x′ = f(x, u): its step turns a state and an input into the next state. -/
structure Game (State Input : Type) where
  step : State → Input → State

/-- The same state and the same input give the same next state. -/
theorem same_state_same_input (game : Game State Input)
    (x₁ x₂ : State) (u₁ u₂ : Input) (same_state : x₁ = x₂) (same_input : u₁ = u₂) :
    game.step x₁ u₁ = game.step x₂ u₂ := by
  subst same_state
  subst same_input
  rfl
