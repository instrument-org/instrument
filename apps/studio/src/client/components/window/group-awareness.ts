import { type WindowTab } from "@/client/atoms/window";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { SCREENS } from "@/shared/instrument-screens";
import { chatAddressOf, instrumentUrlOf } from "@instrument-org/shared";
import {
  type LayoutRead,
  type LayoutSnapshot,
  type LayoutTab,
} from "@instrument-org/workspace/client";

import { computerTabOf } from "./file-tabs";
import { agentPageOfTab } from "./hosted-page";
import { joinHostPath, segmentsOf } from "./host-path";
import { type ScreenNames } from "./screen-presentation";
import { tabTitle } from "./tab-title";
import { matchScreen } from "./window-href";
import { type useWindowTabs } from "./window-tabs";

/** What a chat's tab group is read from: the window's tabs and how each group lays them out. */
export interface GroupAwarenessWindow {
  names: ScreenNames;
  windowTabs: Pick<
    ReturnType<typeof useWindowTabs>,
    "allTabs" | "groupOnScreen" | "layoutOf"
  >;
}

/**
 * The group of a chat's tab as the chat reads it (`groupReadOf`): what a
 * message sent from the tab carries. None for a tab no group has.
 */
export function layoutReadOf(
  window: GroupAwarenessWindow,
  chatTab: string,
): LayoutRead | undefined {
  const group = window.windowTabs.allTabs.find(
    (tab) => tab.id === chatTab,
  )?.group;
  return group === undefined ? undefined : groupReadOf(window, group, chatTab);
}

/**
 * A group as a chat reads it (`LayoutRead`), the chat's tab in it marked:
 * its layout, and the tabs that moved between it and another group, each
 * by the other group (`movedFrom`). What a message sent from the chat's tab
 * carries, and what the window answers a wake and `window list`.
 */
export function groupReadOf(
  window: GroupAwarenessWindow,
  group: string,
  chatTab: string | undefined,
): LayoutRead {
  const movedIn: Record<string, string> = {};
  const movedOut: Record<string, string> = {};
  for (const tab of window.windowTabs.allTabs) {
    if (tab.group === group && tab.movedFrom !== undefined) {
      movedIn[tab.id] = tab.movedFrom;
    } else if (tab.group !== undefined && tab.movedFrom === group) {
      movedOut[tab.id] = tab.group;
    }
  }
  return {
    layout: groupLayoutFor(window, group, chatTab),
    movedIn,
    movedOut,
  };
}

/**
 * A group's layout as the chat in `chatTab` reads it (`groupLayoutOf`): its
 * sides in order, each tab named and the one up marked, the chat's own tab
 * marked as this chat, and the side with the keyboard.
 */
export function groupLayoutFor(
  window: GroupAwarenessWindow,
  group: string,
  chatTab: string | undefined,
): LayoutSnapshot {
  const layout = window.windowTabs.layoutOf(group);
  return {
    focused: layout.focused,
    group: { id: group },
    ...(window.windowTabs.groupOnScreen === group ? {} : { isShown: false }),
    sides: layout.sides.map((side) => ({
      tabs: side.tabs.map((tab) => ({
        ...describedTab(window, tab),
        ...(tab.openedBy === undefined ? {} : { byAgent: true }),
        ...(tab.id === chatTab ? { isThisChat: true } : {}),
        ...(tab.id === side.up ? { isUp: true } : {}),
      })),
    })),
  };
}

/** One tab as the agent reads it: what it is, what it is called, and where. */
function describedTab(
  { names, windowTabs }: GroupAwarenessWindow,
  tab: WindowTab,
): LayoutTab {
  if (tab.kind === "page") {
    const filePath = hostPathOfFileUrl(tab.url);
    return filePath === undefined
      ? {
          address: tab.url ?? "about:blank",
          id: tab.id,
          kind: "website",
          title: tab.title || tab.url || "New tab",
        }
      : {
          address: filePath,
          id: tab.id,
          kind: "file",
          title: segmentsOf(filePath).at(-1) ?? filePath,
        };
  }
  const title = tabTitle(tab, names);
  const computer = computerTabOf(tab.href);
  if (computer?.file !== undefined) {
    // A tab on a page's file goes by its page's id, the one agent-browser
    // drives, once it has a page.
    const page = agentPageOfTab(windowTabs.allTabs, tab);
    return {
      address: computer.file,
      id: page !== undefined && "id" in page ? page.id : tab.id,
      kind: "file",
      title,
    };
  }
  if (computer) {
    return {
      address: joinHostPath(computer.root, computer.path),
      id: tab.id,
      kind: "folder",
      title,
    };
  }
  const screen = matchScreen(tab.href);
  if (screen.kind === "inbox") {
    return {
      address: "instrument://new-chat",
      id: tab.id,
      kind: "newChat",
      title: "New Tab",
    };
  }
  if (screen.kind === "chat") {
    return {
      address: chatAddressOf(screen.chat),
      id: tab.id,
      kind: "chat",
      title,
    };
  }
  return {
    address: builtInAddress(tab.href),
    id: tab.id,
    kind: "builtIn",
    title,
  };
}

/** A page of the app's own by its `instrument://` address where it has one. */
function builtInAddress(href: string): string {
  const named = Object.entries(SCREENS).find(
    ([, screen]) => "href" in screen && screen.href === href,
  )?.[0];
  return (
    instrumentUrlOf(href) ??
    (named === undefined ? href : `instrument://screen/${named}`)
  );
}
