import * as stylex from '@stylexjs/stylex';

/**
 * StyleX on Foldkit's elements: the styles an element is given, compiled by StyleX, as the class and inline style attributes Foldkit builds. Foldkit keeps one class attribute per element, so all of an element's styles go through one call.
 */

/** What StyleX makes of an element's styles: its class names, and the inline styles of dynamic values. */
export interface Props {
  readonly className?: string | undefined;
  readonly style?: Readonly<Record<string, string | number>> | undefined;
}

/** As much of Foldkit's attribute builders as a style needs. */
export interface Html<ClassAttribute, StyleAttribute> {
  readonly Class: (value: string) => ClassAttribute;
  readonly Style: (value: Record<string, string>) => StyleAttribute;
}

/** `props` as Foldkit's attributes: a class attribute if there are classes, a style attribute if there are inline styles. */
export const fromProps = <ClassAttribute, StyleAttribute>(
  h: Html<ClassAttribute, StyleAttribute>,
  props: Props,
): ReadonlyArray<ClassAttribute | StyleAttribute> => [
  ...(props.className === undefined || props.className === '' ? [] : [h.Class(props.className)]),
  ...(props.style === undefined
    ? []
    : [
        h.Style(
          Object.fromEntries(
            Object.entries(props.style).map(([key, value]) => [key, String(value)]),
          ),
        ),
      ]),
];

/** The styles an element is given, as StyleX's `props` takes them. */
export type Style = stylex.StyleXArray<
  | null
  | undefined
  | boolean
  | stylex.CompiledStyles
  | Readonly<[stylex.CompiledStyles, stylex.InlineStyles]>
>;

/** An element's `styles`, later ones winning, as Foldkit's attributes. */
export const attributes = <ClassAttribute, StyleAttribute>(
  h: Html<ClassAttribute, StyleAttribute>,
  ...styles: ReadonlyArray<Style>
): ReadonlyArray<ClassAttribute | StyleAttribute> => fromProps(h, stylex.props(...styles));
