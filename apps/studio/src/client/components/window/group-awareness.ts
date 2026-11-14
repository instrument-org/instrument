import { type WindowTab } from "@/client/atoms/window";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { SCREENS } from "@/shared/instrument-screens";
import { chatAddressOf, instrumentUrlOf } from "@instrument-org/shared";
import {
  type ChatId,
  type LayoutElsewhere,
  type LayoutSent,
  type LayoutSnapshot,
  type LayoutTab,
  layoutChanges,
} from "@instrument-org/workspace/client";

import { type AppsBySlug } from "./apps-by-slug";
import { computerTabOf } from "./file-tabs";
import { joinHostPath, segmentsOf } from "./host-path";
import { screenPresentation } from "./screen-presentation";
import { isFreshTab, isHomeTab, isNewChatTab } from "./tab-model";
import { matchScreen } from "./window-href";
import { type useWindowTabs } from "./window-tabs";

/**
 * What a chat's tab group is read from: the window's tabs and how each group
 * lays them out, and each group's title as the sidebar lists it.
 */
export interface GroupAwarenessWindow {
  appsBySlug: AppsBySlug;
  chatTitles: Map<ChatId, string>;
  /** The window's tab groups as its sidebar lists them. */
  groups: readonly { group: string; title: string }[];
  windowTabs: Pick<ReturnType<typeof useWindowTabs>, "allTabs" | "layoutOf">;
}

/**
 * The layout that goes with a message sent from a tab, the chat's or the
 * new chat's whose draft is sending, and what changed in its group since
 * this window last told `told` (a chat's id, or a draft's group key until
 * its chat starts). Read at the press, and kept as what `told` was last
 * told. None for a tab no group has.
 */
export function layoutReader(window: GroupAwarenessWindow) {
  return (tabId: string, told: string): LayoutSent | undefined => {
    const group = window.windowTabs.allTabs.find(
      (tab) => tab.id === tabId,
    )?.group;
    return group === undefined
      ? undefined
      : layoutSent(
          told,
          groupLayoutFor(window, group, tabId),
          elsewhereOf(window, group),
        );
  };
}

/**
 * A group's layout as the chat in `chatTab` reads it (`groupLayoutOf`): its
 * sides in order, each tab named and the one up marked, the chat's own tab
 * marked as this chat, and the chat's side as the one with the keyboard,
 * since the send comes from its composer. A new chat shows nothing to name,
 * so the group's other new chats are left out, and a side left with no tabs
 * goes with them.
 */
export function groupLayoutFor(
  window: GroupAwarenessWindow,
  group: string,
  chatTab: string,
): LayoutSnapshot {
  const layout = window.windowTabs.layoutOf(group);
  const sides = layout.sides
    .map((side, index) => ({
      index,
      tabs: side.tabs
        .filter(
          (tab) =>
            tab.id === chatTab ||
            !(isFreshTab(tab) || isHomeTab(tab) || isNewChatTab(tab)),
        )
        .map((tab) => ({
          ...describedTab(window, tab),
          ...(tab.id === chatTab ? { isThisChat: true } : {}),
          ...(tab.id === side.up ? { isUp: true } : {}),
        })),
    }))
    .filter((side) => side.tabs.length > 0);
  const chatSide = sides.findIndex((side) =>
    side.tabs.some((tab) => tab.isThisChat === true),
  );
  const focusedSide = sides.findIndex((side) => side.index === layout.focused);
  const focused = chatSide === -1 ? Math.max(focusedSide, 0) : chatSide;
  const title =
    window.groups.find((entry) => entry.group === group)?.title ?? "New chat";
  return {
    focused,
    group: { id: group, title },
    sides: sides.map(({ tabs }) => ({ tabs })),
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
      title: "New chat",
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

/** The window's other groups' tabs, by id, each with its group's title. */
function elsewhereOf(
  { groups, windowTabs }: GroupAwarenessWindow,
  group: string,
): Record<string, string> {
  const titles = new Map(groups.map((entry) => [entry.group, entry.title]));
  const found: Record<string, string> = {};
  for (const tab of windowTabs.allTabs) {
    const title = tab.group === undefined ? undefined : titles.get(tab.group);
    if (tab.group !== group && title !== undefined) {
      found[tab.id] = title;
    }
  }
  return found;
}

/**
 * What each chat was last told, by its id (a draft's group key until its
 * chat starts), in this window, kept in memory: a relaunch or another window
 * starts over, sending the layout with no changes.
 */
const lastSent = new Map<
  string,
  { elsewhere: Record<string, string>; layout: LayoutSnapshot }
>();

/**
 * The layout with what changed since `told` was last sent to, which is
 * nothing for its first message; and the layout kept as the next one's
 * starting point.
 */
function layoutSent(
  told: string,
  layout: LayoutSnapshot,
  elsewhere: Record<string, string>,
): LayoutSent {
  const before = lastSent.get(told);
  lastSent.set(told, { elsewhere, layout });
  if (!before) {
    return { changes: [], layout };
  }
  const where: LayoutElsewhere = { after: elsewhere, before: before.elsewhere };
  return { changes: layoutChanges(before.layout, layout, where), layout };
}

/**
 * A draft's chat started: what the draft was last told goes on as the
 * chat's, so the chat's next message says what changed since its first.
 * The tab it was sent from becomes the chat's in place, in the same group.
 */
export function carryLayoutSent(from: string, to: string) {
  const kept = lastSent.get(from);
  if (!kept) {
    return;
  }
  lastSent.delete(from);
  lastSent.set(to, kept);
}
