/** A model's touch points as it was made, as `@nitida/vite-plugin`'s `Touches.plugin` reads them from its file. */
declare module '*?touches' {
  /** Each touch point of the model, by the name of its part: its bone, where it is on it, how round, and which way it faces. */
  const touches: import('@nitida/core').Touch.Touches;
  export default touches;
}
