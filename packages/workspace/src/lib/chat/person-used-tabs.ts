import ms from "ms";

import { type BrowserTargetId } from "../../types";
import { updateChatState } from "../chat-record";
import { chatDir, resolveChat } from "../record-folders";
import { namedTabOfPage } from "../tab-activity";
import { chatPageTabs } from "./chat-page-tabs";
import { getWorkspaceConfig } from "../workspace-config";

/** How long after a failed write a tab's use is not tried again. */
export const USE_MARK_RETRY_MS = ms("30 seconds");

/**
 * Tabs whose use is on record, or that are in no chat and so never closed
 * for the app: by the id agents name them by, which `openedTabs` keeps them
 * by, as is every set below but `watched`.
 */
const noted = new Set<string>();
/** Tabs used before their entry was there, which `noteOpenedTab` marks as it writes one. */
const pending = new Set<string>();
/** Tabs whose mark is being written. */
const writing = new Set<string>();
/** When each tab whose write failed may be tried again. */
const retryAt = new Map<string, number>();
/** Pages whose guest going clears what is above, each with the tab it draws. */
const watched = new Map<BrowserTargetId, string>();
/** Pages whose tab is being looked up in the window's list. */
const finding = new Set<BrowserTargetId>();

/**
 * Marks a tab an agent opened as used by the person, on its chat's
 * `openedTabs`, so no automatic close takes it, across a relaunch and its
 * page being unloaded: they clicked, tapped, typed or scrolled in its page.
 * `openerOf` reads the chat whose agent opened the tab, as the tab is kept,
 * or undefined for a tab not kept yet or the person's own; it is read only
 * when the tab's use is not on record. One whose entry is not written yet (a
 * popup the person reached first) is marked when `noteOpenedTab` writes it.
 * `page` is the page the person used, which may draw a tab on an HTML file
 * agents name by another id: a page no command or list named yet is looked
 * up in the window's list of its chat's tabs first, once. Cheap to call on
 * every input event.
 */
export function notePersonUsedTab(
  page: BrowserTargetId,
  openerOf: () => string | undefined,
): void {
  const named = namedTabOfPage(page) ?? watched.get(page);
  if (named !== undefined) {
    noteUse(page, named, openerOf);
    return;
  }
  if (finding.has(page)) {
    return;
  }
  const opener = openerOf();
  const chatId = opener === undefined ? undefined : resolveChat(opener);
  if (chatId === undefined) {
    noteUse(page, page, () => opener);
    return;
  }
  finding.add(page);
  chatPageTabs(chatId)
    .catch(() => undefined)
    .then(() => {
      noteUse(page, namedTabOfPage(page) ?? page, () => opener);
    })
    .catch(getWorkspaceConfig().captureException)
    .finally(() => {
      finding.delete(page);
    });
}

/** Marks a tab's use, by the id agents name it by (`id`), as the person used `page`. */
function noteUse(
  page: BrowserTargetId,
  id: string,
  openerOf: () => string | undefined,
): void {
  if (
    noted.has(id) ||
    pending.has(id) ||
    writing.has(id) ||
    (retryAt.get(id) ?? 0) > Date.now()
  ) {
    return;
  }
  if (!watch(page, id)) {
    return;
  }
  const opener = openerOf();
  const chatId = opener === undefined ? undefined : resolveChat(opener);
  if (opener !== undefined && chatId === undefined) {
    noted.add(id);
    return;
  }
  // Before the write, so a `noteOpenedTab` landing meanwhile takes it.
  pending.add(id);
  if (chatId === undefined) {
    return;
  }
  writing.add(id);
  // An entry an earlier build kept by the page's id is the tab's too.
  const isEntry = (tab: { id: string }) => tab.id === id || tab.id === page;
  updateChatState(chatDir(chatId), ({ openedTabs }) => {
    const entry = openedTabs.find(isEntry);
    if (!entry) {
      return undefined;
    }
    pending.delete(id);
    noted.add(id);
    return entry.usedByPerson
      ? undefined
      : {
          openedTabs: openedTabs.map((tab) =>
            isEntry(tab) ? { ...tab, usedByPerson: true as const } : tab,
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
export function takePendingUse(id: string): boolean {
  if (!pending.delete(id)) {
    return false;
  }
  noted.add(id);
  return true;
}

/**
 * Forgets a tab's marks once the guest of the page drawing it goes, so the
 * record on disk answers for it next time. False for a guest already gone.
 */
function watch(page: BrowserTargetId, id: string): boolean {
  const known = watched.has(page);
  watched.set(page, id);
  if (known) {
    return true;
  }
  getWorkspaceConfig().browser.onTargetDestroyed(page, () => {
    const tab = watched.get(page) ?? id;
    noted.delete(tab);
    pending.delete(tab);
    retryAt.delete(tab);
    watched.delete(page);
  });
  return watched.has(page);
}
