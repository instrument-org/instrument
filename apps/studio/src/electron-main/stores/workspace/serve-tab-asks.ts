import { publisher } from "@/electron-main/rpc/publisher";
import { appWindowIdOf } from "@/electron-main/windows/app-window-ids";
import {
  KEPT_STATE_CHANNEL,
  type TabsChanged,
  WINDOW_KEPT_FILE,
} from "@/shared/kept-state";
import { BrowserWindow, ipcMain } from "electron";

import { logger } from "../../lib/electron-logger";
import { keepTabChanges, keptTabsOf } from "./kept-state";
import { changesOfAsk, tabMembersIn, TabsAskSchema } from "./tab-service";

/**
 * Answers each change a window asks of the tabs (`tab-service.ts`): applied
 * to them as they are kept now, each ask after the one before it. Every
 * window hears what changed in the groups, and the window that asked hears
 * its own pages' too, with the ask this answers, changes or none. Apart from
 * the kept state, which the first window reads before the tab model loads.
 */
export function serveTabAsks() {
  ipcMain.on(KEPT_STATE_CHANNEL.tabs, (event, sent: unknown) => {
    const ask = TabsAskSchema.safeParse(sent).data;
    if (ask === undefined) {
      return;
    }
    const windowId = appWindowIdOf(event.sender.id);
    const { groups, own } = keptTabsOf(windowId);
    const members = new Map([
      ...tabMembersIn("groups", groups),
      ...tabMembersIn(WINDOW_KEPT_FILE, own),
    ]);
    let changes: TabsChanged["changes"] = [];
    try {
      changes = changesOfAsk(members, ask);
    } catch (error) {
      logger.error(`Could not apply the tab change ${ask.command.op}`, error);
    }
    keepTabChanges(windowId, changes);
    const shared = changes.filter(([file]) => file !== WINDOW_KEPT_FILE);
    if (shared.length > 0) {
      publisher.publish("window.tab-groups-changed", null);
    }
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) {
        continue;
      }
      if (window.webContents === event.sender) {
        window.webContents.send(KEPT_STATE_CHANNEL.tabsChanged, {
          answers: ask.id,
          changes,
        } satisfies TabsChanged);
      } else if (shared.length > 0) {
        window.webContents.send(KEPT_STATE_CHANNEL.tabsChanged, {
          changes: shared,
        } satisfies TabsChanged);
      }
    }
  });
}
