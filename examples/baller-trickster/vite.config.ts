import { Bones, Joints, Touches } from '@lightocean/vite-plugin';
import { defineConfig } from 'vite-plus';

/** Her bones, her joints, and the parts of her a ball is touched by, read from her model as the game is built. */
const body = () => [Bones.plugin(), Joints.plugin(), Touches.plugin()];

export default defineConfig({
  plugins: body(),
  // A worker is built on its own, and steps her body too, so it is given them as well.
  worker: { plugins: body },
});
