import { Option } from 'effect';
import { Subscription } from 'foldkit';
import { Message, type Model } from '#src/main.ts';
import * as Session from '#src/session.ts';
import * as GlanceStage from '#src/glanceStage.ts';
import * as StatePress from '#src/statePress.ts';

/** Everything the website listens to: the ocean on the home page, and the stage of First Things First and the state press while the page of key terms shows them. */
export const subscriptions = Subscription.aggregate(
  Session.subscriptions,
  Subscription.lift(GlanceStage.subscriptions)<Model, Message>({
    read: (model) => Option.some(model.glance),
    toParentMessage: (message) => Message.GotGlanceMessage({ message }),
    when: {
      glanceStage: ({ route }) => route._tag === 'KeyTerms',
      glanceMoment: ({ route }) => route._tag === 'KeyTerms',
    },
  }),
  Subscription.lift(StatePress.subscriptions)<Model, Message>({
    read: (model) => Option.some(model.statePress),
    toParentMessage: (message) => Message.GotStatePressMessage({ message }),
    when: {
      states: ({ route }) => route._tag === 'KeyTerms',
      frames: ({ route }) => route._tag === 'KeyTerms',
      motion: ({ route }) => route._tag === 'KeyTerms',
    },
  }),
);
