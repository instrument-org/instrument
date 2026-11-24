import { type ChatId } from "@instrument-org/workspace/client";
import { useStore } from "jotai";

import { appTabsAtom } from "./app-tabs";
import { closedGroupOfChat } from "./closed-groups";
import { useShell } from "./shell-context";
import { useWindowTabs } from "./window-tabs";

/**
 * Brings up the tab group a chat is in, so a chat picked from a list comes
 * with what sat beside it: the open group with a tab on it, that tab up, in
 * this window or the one that has it; or else the group this window closed
 * with it, back as it closed. `from` is the group the pick was made in,
 * which gives way when it holds nothing else (`WindowShell.showGroup`): the
 * group on screen unless the caller names another, so a pick from the
 * command menu or the bookmarks bar over an empty new tab leaves no empty
 * group behind.
 * Answers false for a chat in neither, with nothing done, for the caller to
 * open it as it would.
 */
export function useShowChatGroup(): (
  chat: ChatId,
  options?: { from?: string },
) => boolean {
  const shell = useShell();
  const store = useStore();
  const windowTabs = useWindowTabs();
  return (chat, options) => {
    const from = options?.from ?? windowTabs.active?.group;
    const leaving = from === undefined ? {} : { from };
    const tab = windowTabs.chatTab(chat);
    if (tab?.group !== undefined) {
      windowTabs.select(tab.id);
      shell.showGroup(tab.group, leaving);
      return true;
    }
    const closed = closedGroupOfChat(
      store.get(appTabsAtom).recentlyClosed,
      chat,
    );
    if (closed === undefined) {
      return false;
    }
    shell.reopenClosed(closed.id, leaving);
    return true;
  };
}
