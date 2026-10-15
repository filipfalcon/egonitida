import { describe, expect, it } from '@effect/vitest';
import { Option } from 'effect';
import { Story } from 'foldkit';
import { UrlRequest } from 'foldkit/navigation';
import * as Url from 'foldkit/url';
import {
  LoadExternal,
  Message,
  type Model,
  NavigateInternal,
  ScrollToAnchor,
  ScrollToTop,
  initialModelAt,
  update,
} from '#src/main.ts';
import { AppRoute } from '#src/route.ts';
import * as GlanceStage from '#src/glanceStage.ts';
import * as StatePress from '#src/statePress.ts';

/** `path` of the website, as a URL. */
const urlOf = (path: string) => Option.getOrThrow(Url.fromString(`https://egonitida.com${path}`));

/** The page as it opens at the root of the site. */
const initialModel = initialModelAt(urlOf('/'));

describe('the website', () => {
  it('opens at the page its URL leads to, joining the ocean, with nothing shown', () => {
    expect(initialModel).toEqual({
      route: AppRoute.Home(),
      url: urlOf('/'),
      ocean: { _tag: 'Joining' },
      maybeError: Option.none(),
      glance: GlanceStage.initialModel,
      statePress: StatePress.initialModel,
    });
    expect(initialModelAt(urlOf('/nowhere')).route).toEqual(
      AppRoute.NotFound({ path: '/nowhere' }),
    );
  });

  it('goes to a page of its own without loading it again, and loads another site whole', () => {
    Story.story(
      update,
      Story.given(initialModel),
      Story.message(
        Message.ClickedLink({ request: UrlRequest.Internal({ url: urlOf('/nowhere') }) }),
      ),
      Story.Command.expectExact(NavigateInternal({ url: 'https://egonitida.com/nowhere' })),
      Story.Command.resolve(NavigateInternal, Message.CompletedNavigateInternal()),
      Story.message(
        Message.ClickedLink({ request: UrlRequest.External({ href: 'https://github.com' }) }),
      ),
      Story.Command.expectExact(LoadExternal({ href: 'https://github.com' })),
      Story.Command.resolve(LoadExternal, Message.CompletedLoadExternal()),
    );
  });

  it('shows the page a changed URL leads to from its top, or at the heading its hash names', () => {
    Story.story(
      update,
      Story.given(initialModel),
      Story.message(Message.ChangedUrl({ url: urlOf('/nowhere') })),
      Story.model((model) => {
        expect(model.route).toEqual(AppRoute.NotFound({ path: '/nowhere' }));
        expect(model.url).toEqual(urlOf('/nowhere'));
      }),
      Story.Command.expectExact(ScrollToTop),
      Story.Command.resolve(ScrollToTop, Message.CompletedScrollToTop()),
      Story.message(Message.ChangedUrl({ url: urlOf('/#start') })),
      Story.Command.expectExact(ScrollToAnchor({ hash: 'start' })),
      Story.Command.resolve(ScrollToAnchor, Message.CompletedScrollToAnchor()),
    );
  });

  it('shows the ocean once it is joined and its canvas is in the page, and lets go of the canvas when the ocean is left', () => {
    Story.story(
      update,
      Story.given(initialModel),
      Story.message(Message.JoinedOcean()),
      Story.message(Message.MountedCanvas()),
      Story.model((model) => {
        expect(model.ocean).toEqual({ _tag: 'Joined', canvas: 'Mounted' });
      }),
      Story.message(Message.LeftOcean()),
      Story.model((model) => {
        expect(model.ocean).toEqual({ _tag: 'Joining' });
      }),
    );
  });

  it('hands the state press on the page of key terms what happens to it, and runs the steps it asks its game for', () => {
    const toPress = (message: StatePress.Message) => Message.GotStatePressMessage({ message });
    Story.story(
      update,
      Story.given(initialModel),
      Story.message(toPress(StatePress.Message.JoinedGame())),
      Story.Command.expectExact(StatePress.ShowState),
      Story.Command.resolve(StatePress.ShowState, StatePress.Message.ShowedState()),
      Story.message(toPress(StatePress.Message.RequestedStep())),
      Story.Command.expectExact(StatePress.StepGame),
      Story.Command.resolve(StatePress.StepGame, StatePress.Message.SteppedGame()),
      Story.model((model) => {
        expect(model.statePress.session).toEqual({ _tag: 'Joined' });
        expect(model.statePress.asked).toBe(1);
      }),
    );
  });

  it('says why the ocean could not be joined or shown', () => {
    const reasons = [
      Message.FailedJoinOcean({ reason: 'No worker.' }),
      Message.FailedShowOcean({ reason: 'No GPU.' }),
    ].map((failed) => update(initialModel, failed).model.maybeError);

    expect(reasons).toEqual([Option.some('No worker.'), Option.some('No GPU.')]);
  });

  it('shows it again after a reload, whichever comes first of the ocean joined and the stage finding it is not', () => {
    // A Model restored after a reload says the ocean is joined and its canvas in the page, before it is joined again.
    const restored: Model = {
      ...initialModel,
      ocean: { _tag: 'Joined', canvas: 'Mounted' },
      maybeError: Option.some('The ocean is not joined.'),
    };

    Story.story(
      update,
      Story.given(restored),
      Story.message(Message.JoinedOcean()),
      Story.model((model) => {
        expect(model.ocean).toEqual({ _tag: 'Joined', canvas: 'Mounted' });
        // What went wrong while it was not joined is past.
        expect(model.maybeError).toEqual(Option.none());
      }),
    );
    Story.story(
      update,
      Story.given(restored),
      Story.message(Message.LeftOcean()),
      Story.message(Message.JoinedOcean()),
      Story.message(Message.MountedCanvas()),
      Story.model((model) => {
        expect(model.ocean).toEqual({ _tag: 'Joined', canvas: 'Mounted' });
      }),
    );
  });

  it('takes an ocean found joined as joined only while it waits for one, and changes nothing once it has it', () => {
    Story.story(
      update,
      Story.given({ ...initialModel, maybeError: Option.some('Not joined.') }),
      Story.message(Message.FoundOceanJoined()),
      Story.model((model) => {
        expect(model.ocean).toEqual({ _tag: 'Joined', canvas: 'Waiting' });
        expect(model.maybeError).toEqual(Option.none());
      }),
    );
    const shown: Model = {
      ...initialModel,
      ocean: { _tag: 'Joined', canvas: 'Mounted' },
      maybeError: Option.some('No GPU.'),
    };
    Story.story(
      update,
      Story.given(shown),
      Story.message(Message.FoundOceanJoined()),
      Story.model((model) => {
        expect(model).toEqual(shown);
      }),
    );
  });
});
