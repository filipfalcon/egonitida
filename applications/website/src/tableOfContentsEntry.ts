/** A heading of a page, as the page's table of contents lists it: the id it is reached by, its text, and how deep it is. */
export interface TableOfContentsEntry {
  readonly id: string;
  readonly text: string;
  readonly level: 'h2' | 'h3' | 'h4';
}
