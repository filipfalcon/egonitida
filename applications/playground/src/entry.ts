import { Runtime } from 'foldkit';
import { Message, Model, init, update } from '#src/main.ts';
import { view } from '#src/view.ts';
import { subscriptions } from '#src/viewport.ts';

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  subscriptions,
  container: document.getElementById('root'),
  // Inspect, not time travel: the viewport draws the live Model through a Subscription, so a historical DOM would sit beside a live 3D view.
  devTools: { Message, mode: 'Inspect' },
});

Runtime.run(application);
