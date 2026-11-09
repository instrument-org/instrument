import ms from "ms";

import { type BrowserTargetId } from "../../types";
import { updateChatState } from "../chat-record";
import { chatDir, resolveChat } from "../record-folders";
import { getWorkspaceConfig } from "../workspace-config";

/** How long after a failed write a tab's use is not tried again. */
export const USE_MARK_RETRY_MS = ms("30 seconds");

/** Tabs whose use is on record, or that are in no chat and so never closed for the app. */
const noted = new Set<BrowserTargetId>();
/** Tabs used before their entry was there, which `noteOpenedTab` marks as it writes one. */
const pending = new Set<BrowserTargetId>();
/** Tabs whose mark is being written. */
const writing = new Set<BrowserTargetId>();
/** When each tab whose write failed may be tried again. */
const retryAt = new Map<BrowserTargetId, number>();
/** Tabs whose guest going clears what is above. */
const watched = new Set<BrowserTargetId>();

/**
 * Marks a tab an agent opened as used by the person, on its chat's
 * `openedTabs`, so no automatic close takes it, across a relaunch and its
 * page being unloaded: they clicked, tapped, typed or scrolled in its page.
 * `groupOf` reads the window group the tab is kept in, a chat's id for a
 * chat's tab, or undefined for a tab not kept yet; it is read only when the
 * tab's use is not on record. A tab in a group that is no chat's is the
 * person's own and left alone. One whose entry is not written yet (a popup
 * the person reached first) is marked when `noteOpenedTab` writes it.
 * Cheap to call on every input event.
 */
export function notePersonUsedTab(
  id: BrowserTargetId,
  groupOf: () => string | undefined,
): void {
  if (
    noted.has(id) ||
    pending.has(id) ||
    writing.has(id) ||
    (retryAt.get(id) ?? 0) > Date.now()
  ) {
    return;
  }
  if (!watch(id)) {
    return;
  }
  const group = groupOf();
  const chatId = group === undefined ? undefined : resolveChat(group);
  if (group !== undefined && chatId === undefined) {
    noted.add(id);
    return;
  }
  // Before the write, so a `noteOpenedTab` landing meanwhile takes it.
  pending.add(id);
  if (chatId === undefined) {
    return;
  }
  writing.add(id);
  updateChatState(chatDir(chatId), ({ openedTabs }) => {
    const entry = openedTabs.find((tab) => tab.id === id);
    if (!entry) {
      return undefined;
    }
    pending.delete(id);
    noted.add(id);
    return entry.usedByPerson
      ? undefined
      : {
          openedTabs: openedTabs.map((tab) =>
            tab.id === id ? { ...tab, usedByPerson: true as const } : tab,
          ),
        };
  })
    .catch((error: unknown) => {
      pending.delete(id);
      noted.delete(id);
      retryAt.set(id, Date.now() + USE_MARK_RETRY_MS);
      getWorkspaceConfig().captureException(error);
    })
    .finally(() => {
      writing.delete(id);
    });
}

/** Whether the person used a tab before its entry was written, taking that word: `noteOpenedTab` marks it. */
export function takePendingUse(id: BrowserTargetId): boolean {
  if (!pending.delete(id)) {
    return false;
  }
  noted.add(id);
  return true;
}

/**
 * Forgets a tab's marks once its guest goes, so the record on disk answers
 * for it next time. False for a guest already gone.
 */
function watch(id: BrowserTargetId): boolean {
  if (watched.has(id)) {
    return true;
  }
  watched.add(id);
  getWorkspaceConfig().browser.onTargetDestroyed(id, () => {
    noted.delete(id);
    pending.delete(id);
    retryAt.delete(id);
    watched.delete(id);
  });
  return watched.has(id);
}
