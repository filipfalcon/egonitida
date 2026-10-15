/** A model's bones as it was made, as `@nitida/vite-plugin`'s `Bones.plugin` reads them from its file. */
declare module '*?bones' {
  /** Each bone of the model, by its name: the bone above it, if any, and where it stands. */
  const bones: import('@nitida/core').Shape.Bones;
  export default bones;
}
