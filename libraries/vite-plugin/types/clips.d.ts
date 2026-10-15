/** A model's clips as poses, as `@nitida/vite-plugin`'s `Clips.plugin` reads them from its file. */
declare module '*?clips' {
  /** Each clip of the model, by its name: how long it lasts, and its poses at its keys. */
  const clips: import('@nitida/core').Clip.Clips;
  export default clips;
}
