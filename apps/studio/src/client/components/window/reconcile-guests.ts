import {
  type BrowserTargetId,
  parseBrowserTargetId,
} from "@instrument-org/workspace/client";

/** What reconciling remembers between runs. */
export interface GuestMemo {
  /** Window guests asked to close, until they detach. Each is asked for once. */
  closing: ReadonlySet<BrowserTargetId>;
  /** Attached guests a tab has held, so one whose tab went is told from one that never had a tab. */
  held: ReadonlySet<BrowserTargetId>;
  /**
   * Guests a tab has held before they attached: a tab opened and closed while
   * its guest was still being made leaves one attaching with no tab, which is
   * the window's to close and not an agent's page.
   */
  pending: ReadonlySet<BrowserTargetId>;
}

export const EMPTY_GUEST_MEMO: GuestMemo = {
  closing: new Set(),
  held: new Set(),
  pending: new Set(),
};

/**
 * The attached guests set against the tabs the window holds.
 *
 * A guest is one of the window's page tabs, keyed by the tab's id, and
 * closing the tab only takes it off the list. The browser's clocks discard a
 * guest whose tab stays; one whose tab, and every visit in a tab's history,
 * is gone is the window's to close. A guest no tab has held yet is an
 * agent's page that has not gone anywhere, which gets its tab as it does,
 * and is the agent's to close, so it is left alone.
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
  const held = new Set(
    [...attached].filter(
      (target) =>
        heldIds.has(target) ||
        memo.held.has(target) ||
        memo.pending.has(target),
    ),
  );
  const pending = new Set(
    [
      ...memo.pending,
      ...[...heldIds].flatMap((id) => parseBrowserTargetId(id) ?? []),
    ].filter((target) => !attached.has(target)),
  );
  const close: BrowserTargetId[] = [];
  for (const target of held) {
    if (!heldIds.has(target) && !closing.has(target)) {
      closing.add(target);
      close.push(target);
    }
  }
  return { close, memo: { closing, held, pending } };
}
