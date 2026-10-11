import type { Inline } from '@foldkit/markdown';
import { Array, Match, Option, Predicate, String, flow, pipe } from 'effect';
import type { Html } from 'foldkit/html';

/** The plain text of a heading's or a link's inline content, its formatting dropped: what a heading's id, and its line in a table of contents, are made of. */
export const inlineToText = (content: ReadonlyArray<Inline>): string =>
  pipe(
    content,
    Array.map((inline) =>
      Match.value(inline).pipe(
        Match.withReturnType<string>(),
        Match.tagsExhaustive({
          Text: ({ value }) => value,
          InlineCode: ({ value }) => value,
          HardBreak: () => ' ',
          Emphasis: ({ content }) => inlineToText(content),
          Strong: ({ content }) => inlineToText(content),
          Strikethrough: ({ content }) => inlineToText(content),
          Link: ({ content }) => inlineToText(content),
          Image: ({ alt }) => alt,
        }),
      ),
    ),
    Array.join(''),
  );

/** The id a heading's `text` is reached by: lower case, apostrophes dropped so a contraction stays one word, every other run of what is not a letter or a digit one dash, and none at either end. `"How’s It Done"` is `"hows-it-done"`. */
export const slugify: (text: string) => string = flow(
  String.replaceAll(/['’]/g, ''),
  String.toLowerCase,
  String.replaceAll(/[^a-z0-9]+/g, '-'),
  String.replaceAll(/^-+|-+$/g, ''),
);

const ID_WRITTEN = /^(.*?)\s*\{#([A-Za-z0-9-]+)\}$/;
const ID_WRITTEN_AT_END = /\s*\{#[A-Za-z0-9-]+\}$/;

/** A heading's text, and the id written after it as `{#id}`, if one is. Only plain text ending the heading counts, as only that is taken off the heading drawn. */
export const parseHeadingId = (
  content: ReadonlyArray<Inline>,
): { readonly maybeId: Option.Option<string>; readonly text: string } => {
  const text = inlineToText(content);
  const endsInText = Option.exists(Array.last(content), ({ _tag }) => _tag === 'Text');
  return Option.match(endsInText ? String.match(ID_WRITTEN)(text) : Option.none(), {
    onNone: () => ({ maybeId: Option.none(), text }),
    onSome: ([, before = text, id]) => ({ maybeId: Option.fromNullishOr(id), text: before }),
  });
};

/** A heading's drawn content without the `{#id}` written after it, its formatting kept. */
export const stripHeadingIdMarker = (
  content: ReadonlyArray<Html | string>,
): ReadonlyArray<Html | string> =>
  Array.matchRight(content, {
    onEmpty: () => content,
    onNonEmpty: (before, last) => {
      if (!Predicate.isString(last)) {
        return content;
      }
      const stripped = String.replace(ID_WRITTEN_AT_END, '')(last);
      return String.isEmpty(stripped) ? before : Array.append(before, stripped);
    },
  });
