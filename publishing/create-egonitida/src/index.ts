#!/usr/bin/env node
// What `npm create egonitida` prints until it can create a project: that it cannot yet, and EgoNitida's official channels.
import manifest from '../package.json' with { type: 'json' };

console.log(`create-egonitida ${manifest.version}
New projects cannot be created until EgoNitida is released.

  Website    https://egonitida.com
  Source     https://github.com/egonitida/egonitida
  Packages   https://www.npmjs.com/org/egonitida
  X          https://x.com/egonitida
  Instagram  https://www.instagram.com/egonitida
  Threads    https://www.threads.net/@egonitida
`);
