/** A model's clips as poses, as `@egonitida/vite-plugin`'s `Clips.plugin` reads them from its file. */
declare module '*?clips' {
  /** Each clip of the model, by its name: how long it lasts, and its poses at its keys. */
  const clips: import('@egonitida/core').Clip.Clips;
  export default clips;
}
