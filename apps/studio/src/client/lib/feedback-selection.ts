/**
 * Which of a feedback report's items go, kept as the ones left out, since
 * everything starts checked. A part's own box stands over its items: checked
 * while all of them go, a dash while only some do, empty while none do.
 */
export type PartState = "indeterminate" | boolean;

export function partState(
  itemIds: readonly string[],
  leftOut: ReadonlySet<string>,
): PartState {
  const going = itemIds.filter((id) => !leftOut.has(id)).length;
  if (going === itemIds.length) {
    return true;
  }
  return going === 0 ? false : "indeterminate";
}

/**
 * Pressing a part's box: a part that is all in goes all out, and one that is
 * partly or all out comes all back in, the way a mail client's select-all
 * box behaves.
 */
export function togglePart(
  itemIds: readonly string[],
  leftOut: ReadonlySet<string>,
): Set<string> {
  const next = new Set(leftOut);
  const allIn = partState(itemIds, leftOut) === true;
  for (const id of itemIds) {
    if (allIn) {
      next.add(id);
    } else {
      next.delete(id);
    }
  }
  return next;
}

export function toggleItem(
  id: string,
  leftOut: ReadonlySet<string>,
): Set<string> {
  const next = new Set(leftOut);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

/** What the items still going add up to. */
export function bytesGoing(
  items: readonly { bytes: number; id: string }[],
  leftOut: ReadonlySet<string>,
): number {
  return items.reduce(
    (sum, item) => (leftOut.has(item.id) ? sum : sum + item.bytes),
    0,
  );
}

/** A size as the dialog shows it: whole kilobytes, never zero, then megabytes past a thousand. */
export function formatSize(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1000) {
    return `${Math.max(1, Math.round(kb))} KB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
}
