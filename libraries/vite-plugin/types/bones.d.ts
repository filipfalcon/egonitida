/** A model's bones as it was made, as `@egonitida/vite-plugin`'s `Bones.plugin` reads them from its file. */
declare module '*?bones' {
  /** Each bone of the model, by its name: the bone above it, if any, and where it stands. */
  const bones: import('@egonitida/core').Shape.Bones;
  export default bones;
}
