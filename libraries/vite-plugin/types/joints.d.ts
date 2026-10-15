/** A model's joints as it was made, as `@lightocean/vite-plugin`'s `Joints.plugin` reads them from its file. */
declare module '*?joints' {
  /** Each joint of the model, by the name of its bone: how it turns, how far, and the flesh about it. */
  const joints: import('@lightocean/core').Joint.Joints;
  export default joints;
}
