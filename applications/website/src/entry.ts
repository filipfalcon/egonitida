import { Runtime } from 'foldkit';
import { Message, Model, init, update } from '#src/main.ts';
import { view } from '#src/view.ts';
import { managedResources, subscriptions } from '#src/world.ts';

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  subscriptions,
  managedResources,
  container: document.getElementById('root'),
  routing: {
    onUrlRequest: (request) => Message.ClickedLink({ request }),
    onUrlChange: (url) => Message.ChangedUrl({ url }),
  },
  // Inspect, not time travel: the canvas shows the live ocean, whose past the devtools beside its host go back in.
  devTools: { Message, mode: 'Inspect' },
});

Runtime.run(application);
