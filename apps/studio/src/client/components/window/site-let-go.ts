/**
 * What a window does with the sites' pages its tabs have stopped standing on. The
 * windows share every site's tabs, so one this window never had a tab on is
 * another's to let go. One it did leaves unless a tab of another window, open or
 * closed, stands on it now, or a tab of its went to another window with it.
 */

/** The sites this window held that no tab open here stands on now. */
export function sitesNoLongerHere(
  groups: readonly string[],
  open: ReadonlySet<string>,
  heldHere: ReadonlySet<string>,
) {
  return groups.filter((group) => !open.has(group) && heldHere.has(group));
}

/** Of those, the ones whose pages go. */
export function sitesLeaving(
  noLongerHere: readonly string[],
  inOtherWindows: ReadonlySet<string>,
  hasMovedAway: (group: string) => boolean,
) {
  return noLongerHere.filter(
    (group) => !inOtherWindows.has(group) && !hasMovedAway(group),
  );
}

/**
 * The records kept aside for tabs a window can still reopen, which bring their
 * pages back at their addresses: kept while a closed tab can bring one back or an
 * open one is on its way to, and taken for any site a closed tab here stands on and
 * no open one does, whoever else stands on it now, since they can let it go first.
 */
export function sitesPutAway<T>(
  current: Readonly<Record<string, T[]>>,
  {
    noLongerHere,
    open,
    recordOf,
    reopenable,
  }: {
    noLongerHere: readonly string[];
    open: ReadonlySet<string>;
    recordOf: (group: string) => T[];
    reopenable: ReadonlySet<string>;
  },
) {
  const next: Record<string, T[]> = {};
  for (const [group, stashed] of Object.entries(current)) {
    if (reopenable.has(group) || open.has(group)) {
      next[group] = stashed;
    }
  }
  for (const group of noLongerHere) {
    if (reopenable.has(group)) {
      next[group] = recordOf(group);
    }
  }
  return next;
}
