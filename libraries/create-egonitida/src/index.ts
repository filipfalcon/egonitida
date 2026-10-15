#!/usr/bin/env node
// What `npm create egonitida` prints: EgoNitida and where to find it, as `egonitida` prints them.
import manifest from '../package.json' with { type: 'json' };

console.log(`create-egonitida ${manifest.version}
A real-time 3D engine built on Effect, Three.js, and Foldkit.

  Website    https://egonitida.com
  Source     https://github.com/egonitida/egonitida
  Packages   https://npmjs.com/org/egonitida
  Discord    https://discord.gg/6zsggGTGZf
  X          https://x.com/egonitida
  Instagram  https://instagram.com/egonitida
  Threads    https://threads.com/@egonitida
`);
