#!/usr/bin/env node
// What `npx egonitida` prints: EgoNitida's version and where to find it.
import manifest from '../package.json' with { type: 'json' };

console.log(`EgoNitida ${manifest.version}
A real-time 3D engine built on Effect, Three.js, and Foldkit.

  Website    https://egonitida.com
  Source     https://github.com/egonitida/egonitida
  Packages   https://npmjs.com/org/egonitida
  X          https://x.com/egonitida
  Instagram  https://www.instagram.com/egonitida
  Threads    https://www.threads.net/@egonitida
`);
