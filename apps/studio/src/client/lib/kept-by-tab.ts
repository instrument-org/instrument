/**
 * What a group's tabs keep of their screens once they are no longer drawn. A
 * screen stays drawn behind the tab up only so long (`kept-screens.ts`), and
 * a chat not at all, so one drawn afresh as its tab comes back up would
 * start over in whatever it held in its own state alone. Each
 * kind of thing kept is a store of its own, by tab id (`keptByTab`), and every
 * store lets go of a tab once the tab is closed (`forgetTab`).
 *
 * Kept a leaf: nothing here knows what is kept.
 */
const forgetters = new Set<(id: string) => void>();

/** A store of one kind of thing kept, by tab id, let go of with the tab. */
export function keptByTab<T>(): Map<string, T> {
  const store = new Map<string, T>();
  forgetters.add((id) => {
    store.delete(id);
  });
  return store;
}

/** Everything a closed tab kept, in every store. */
export function forgetTab(id: string) {
  for (const forget of forgetters) {
    forget(id);
  }
}
