import { type BrowserTargetId } from "@instrument-org/workspace/client";

/** What reconciling remembers between runs. */
export interface GuestMemo {
  /** Window guests asked to close, until they detach. Each is asked for once. */
  closing: ReadonlySet<BrowserTargetId>;
}

export const EMPTY_GUEST_MEMO: GuestMemo = {
  closing: new Set(),
};

/**
 * The attached guests set against the tabs the window holds.
 *
 * A guest is one of the window's page tabs, keyed by the tab's id, and
 * closing the tab only takes it off the list. The window holds its browser on
 * screen for as long as it is open, so the lease clock that reaps a browser
 * never runs for these: one that no tab or visit in a tab's history holds any
 * more is the window's to close.
 */
export function reconcileGuests({
  attached,
  heldIds,
  memo,
}: {
  attached: ReadonlySet<BrowserTargetId>;
  /** Every tab id the window holds, visits in a tab's history included. */
  heldIds: ReadonlySet<string>;
  memo: GuestMemo;
}): { close: BrowserTargetId[]; memo: GuestMemo } {
  const closing = new Set(
    [...memo.closing].filter((target) => attached.has(target)),
  );
  const close: BrowserTargetId[] = [];
  for (const target of attached) {
    if (!heldIds.has(target) && !closing.has(target)) {
      closing.add(target);
      close.push(target);
    }
  }
  return { close, memo: { closing } };
}
