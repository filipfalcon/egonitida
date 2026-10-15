/** A model's hair as strands, as `@egonitida/vite-plugin`'s `Strands.plugin` reads it from its file. */
declare module '*?strands' {
  /** The model's hair: the guides it swings as, the strands it draws, counted, and how they are shaded. */
  const hair: import('@egonitida/core').Strands.Hair;
  export default hair;
}
