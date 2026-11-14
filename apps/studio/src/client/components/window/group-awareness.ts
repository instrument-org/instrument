import { type WindowTab } from "@/client/atoms/window";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { SCREENS } from "@/shared/instrument-screens";
import { chatAddressOf, instrumentUrlOf } from "@instrument-org/shared";
import {
  type ChatId,
  type LayoutRead,
  type LayoutSnapshot,
  type LayoutTab,
} from "@instrument-org/workspace/client";

import { type AppsBySlug } from "./apps-by-slug";
import { computerTabOf } from "./file-tabs";
import { joinHostPath, segmentsOf } from "./host-path";
import { screenPresentation } from "./screen-presentation";
import { matchScreen } from "./window-href";
import { type useWindowTabs } from "./window-tabs";

/** What a chat's tab group is read from: the window's tabs and how each group lays them out. */
export interface GroupAwarenessWindow {
  appsBySlug: AppsBySlug;
  chatTitles: Map<ChatId, string>;
  windowTabs: Pick<ReturnType<typeof useWindowTabs>, "allTabs" | "layoutOf">;
}

/**
 * The group of a chat's tab as the chat reads it, with where every other tab
 * stands (`LayoutRead`): what a message sent from the tab carries, and what
 * the workspace keeps for a wake. None for a tab no group has.
 */
export function layoutReadOf(
  window: GroupAwarenessWindow,
  chatTab: string,
): LayoutRead | undefined {
  const group = window.windowTabs.allTabs.find(
    (tab) => tab.id === chatTab,
  )?.group;
  if (group === undefined) {
    return undefined;
  }
  const elsewhere: Record<string, string> = {};
  for (const tab of window.windowTabs.allTabs) {
    if (tab.group !== undefined && tab.group !== group) {
      elsewhere[tab.id] = tab.group;
    }
  }
  return { elsewhere, layout: groupLayoutFor(window, group, chatTab) };
}

/**
 * A group's layout as the chat in `chatTab` reads it (`groupLayoutOf`): its
 * sides in order, each tab named and the one up marked, the chat's own tab
 * marked as this chat, and the side with the keyboard.
 */
export function groupLayoutFor(
  window: GroupAwarenessWindow,
  group: string,
  chatTab: string,
): LayoutSnapshot {
  const layout = window.windowTabs.layoutOf(group);
  return {
    focused: layout.focused,
    group: { id: group },
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
  { appsBySlug, chatTitles }: GroupAwarenessWindow,
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
  const { title } = screenPresentation(tab.href, {
    appsBySlug,
    chatTitles,
  });
  const computer = computerTabOf(tab.href);
  if (computer?.file !== undefined) {
    return { address: computer.file, id: tab.id, kind: "file", title };
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
  if (screen.kind === "inbox" || screen.kind === "newTab") {
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
