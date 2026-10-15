import { Bones, Build, Devtools, Joints, Strands, Touches } from '@egonitida/vite-plugin';
import { defineConfig } from 'vite-plus';

/** Her bones, her joints, the parts of her a ball is touched by, and her hair as strands, read from her model as the game is built. */
const body = () => [Bones.plugin(), Joints.plugin(), Touches.plugin(), Strands.plugin()];

// In development, the server is also the way to her host for the tools on this machine, such as an MCP server.
export default defineConfig({
  plugins: [Devtools.plugin(), Build.plugin(), ...body()],
  // A worker is built on its own, steps her body too, and is named by the build, so it is given them as well.
  worker: { plugins: () => [Build.plugin(), ...body()] },
});
