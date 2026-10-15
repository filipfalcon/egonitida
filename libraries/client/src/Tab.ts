/**
 * The tab a page is in, as development tools know it: an id that stays the same for as long as the tab, across every reload of its page, so what is kept for the tab, such as its state, comes back with the page.
 */

/** Where a tab keeps what outlives its page: the tab's session storage, in a browser. */
export interface Storage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

/** The id the tab keeps for `prefix`, made the first time; one of its own each time where nothing can be kept, as in a private window. */
export const id = (prefix: string, storage: Storage = sessionStorage): string => {
  const made = `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  try {
    const kept = storage.getItem(`egonitida:tab:${prefix}`);
    if (kept !== null) {
      return kept;
    }
    storage.setItem(`egonitida:tab:${prefix}`, made);
    return made;
  } catch {
    return made;
  }
};
