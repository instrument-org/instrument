import {
  type BrowserTargetId,
  decodeBrowserTargetId,
  type StoreId,
  type TaskId,
  WINDOW_ID,
} from "@instrument-org/workspace/client";

/** What reconciling remembers between runs. */
export interface GuestMemo {
  /** Window guests asked to close, until they detach. Each is asked for once. */
  closing: ReadonlySet<BrowserTargetId>;
  /**
   * Guests already looked at. Only a guest arriving is a tab to add: one the
   * user closed is still attached until the close lands, and must not come
   * straight back.
   */
  seen: ReadonlySet<BrowserTargetId>;
}

export const EMPTY_GUEST_MEMO: GuestMemo = {
  closing: new Set(),
  seen: new Set(),
};

/**
 * The attached guests set against the tabs the window holds.
 *
 * A window guest is one of the window's own page tabs, keyed by the tab's id,
 * and closing the tab only takes it off the list. The window holds its
 * browser on screen for as long as it is open, so the lease clock that reaps a
 * task's browser never runs for these: one that no tab or visit in a tab's
 * history holds any more is the window's to close.
 *
 * A task browsing in a guest of its own (one filed outside any chat, since a
 * chat's tasks browse in tabs of the chat) is mounted in the window too, and
 * the moment one attaches it gets a tab in the group of the chat it was filed
 * from. A task's guest is never the window's to close: it arrives before its
 * tab does, and is released by the hold its tab takes on the task.
 */
export function reconcileGuests({
  attached,
  chatOfTask,
  heldIds,
  memo,
}: {
  attached: ReadonlySet<BrowserTargetId>;
  /**
   * The chat each browsing task was filed from, undefined for one filed
   * outside any chat. A task missing from it has not been read yet, and its
   * guest waits for that read rather than landing in no group.
   */
  chatOfTask: ReadonlyMap<TaskId, string | undefined>;
  /** Every tab id the window holds, visits in a tab's history included. */
  heldIds: ReadonlySet<string>;
  memo: GuestMemo;
}): {
  add: { group: string | undefined; id: StoreId.Session; taskId: TaskId }[];
  close: BrowserTargetId[];
  memo: GuestMemo;
} {
  const closing = new Set(
    [...memo.closing].filter((target) => attached.has(target)),
  );
  const close: BrowserTargetId[] = [];
  const add: {
    group: string | undefined;
    id: StoreId.Session;
    taskId: TaskId;
  }[] = [];
  const waiting = new Set<BrowserTargetId>();
  for (const target of attached) {
    const decoded = decodeBrowserTargetId(target);
    if (!decoded) {
      continue;
    }
    if (decoded.id === WINDOW_ID) {
      if (!heldIds.has(decoded.sessionId) && !closing.has(target)) {
        closing.add(target);
        close.push(target);
      }
      continue;
    }
    // Checked against every visit the window holds, not only the tabs on the
    // strip: a task browsing behind a screen already has one.
    if (memo.seen.has(target) || heldIds.has(decoded.sessionId)) {
      continue;
    }
    if (!chatOfTask.has(decoded.id)) {
      waiting.add(target);
      continue;
    }
    add.push({
      group: chatOfTask.get(decoded.id),
      id: decoded.sessionId,
      taskId: decoded.id,
    });
  }
  return {
    add,
    close,
    memo: {
      closing,
      seen: new Set([...attached].filter((target) => !waiting.has(target))),
    },
  };
}
