import { type WindowTab } from "@/client/atoms/window";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { SCREENS } from "@/shared/instrument-screens";
import { chatAddressOf, instrumentUrlOf } from "@instrument-org/shared";
import {
  type ChatId,
  isChatId,
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
import { isFreshTab, isHomeTab } from "./tab-model";
import { matchScreen } from "./window-href";
import { type useWindowTabs } from "./window-tabs";

/**
 * What a chat's tab group is read from, as today's window holds it: the
 * window's tabs, each group's title as the sidebar lists it, and which
 * groups have their chat's card closed.
 */
export interface GroupAwarenessWindow {
  appsBySlug: AppsBySlug;
  chatClosedByGroup: Readonly<Record<string, true>>;
  chatTitles: Map<ChatId, string>;
  /** The window's tab groups as its sidebar lists them. */
  groups: readonly { group: string; title: string }[];
  windowTabs: Pick<
    ReturnType<typeof useWindowTabs>,
    "allTabs" | "selectedTabIn"
  >;
}

/**
 * The layout that goes with a message sent in a group, and what changed in
 * it since this window last sent from there. Read at the press, and kept as
 * what the chat was last told.
 */
export function layoutReader(window: GroupAwarenessWindow) {
  return (group: string): LayoutSent =>
    layoutSent(
      group,
      todaysGroupLayout(window, group),
      elsewhereOf(window, group),
    );
}

/**
 * A group as today's window lays it out: the work's tabs as one side and the
 * chat as the other, or one side while the chat is alone, and the chat after
 * the tabs while its card is closed. The send comes from the chat's
 * composer, so the chat's side has the keyboard. Core's `groupLayoutOf`
 * takes this one's place.
 */
export function todaysGroupLayout(
  window: GroupAwarenessWindow,
  group: string,
): LayoutSnapshot {
  const up = window.windowTabs.selectedTabIn(group);
  // A new tab shows nothing to name, and a chat's first message closes it.
  const tabs = window.windowTabs.allTabs
    .filter((tab) => tab.group === group && !isFreshTab(tab) && !isHomeTab(tab))
    .map((tab) => ({
      ...describedTab(window, tab),
      ...(tab.id === up?.id ? { isUp: true } : {}),
    }));
  const chatTitle =
    (isChatId(group) ? window.chatTitles.get(group) : undefined) ?? "New chat";
  const chat = (isUp: boolean): LayoutTab => ({
    address: isChatId(group) ? chatAddressOf(group) : "instrument://new-chat",
    id: group,
    isThisChat: true,
    ...(isUp ? { isUp: true } : {}),
    kind: "chat",
    title: chatTitle,
  });
  const titled = {
    id: group,
    title:
      window.groups.find((entry) => entry.group === group)?.title ?? chatTitle,
  };
  if (tabs.length === 0) {
    return { focused: 0, group: titled, sides: [{ tabs: [chat(true)] }] };
  }
  if (window.chatClosedByGroup[group] === true) {
    return {
      focused: 0,
      group: titled,
      sides: [{ tabs: [...tabs, chat(false)] }],
    };
  }
  return {
    focused: 1,
    group: titled,
    sides: [{ tabs }, { tabs: [chat(true)] }],
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
 * What each group was last told, by its key, in this window, kept in memory:
 * a relaunch or another window starts over, sending the layout with no
 * changes.
 */
const lastSent = new Map<
  string,
  { elsewhere: Record<string, string>; layout: LayoutSnapshot }
>();

/**
 * The layout with what changed since the group was last sent from, which is
 * nothing for its first message; and the layout kept as the next one's
 * starting point.
 */
function layoutSent(
  group: string,
  layout: LayoutSnapshot,
  elsewhere: Record<string, string>,
): LayoutSent {
  const before = lastSent.get(group);
  lastSent.set(group, { elsewhere, layout });
  if (!before) {
    return { changes: [], layout };
  }
  const where: LayoutElsewhere = { after: elsewhere, before: before.elsewhere };
  return { changes: layoutChanges(before.layout, layout, where), layout };
}

/**
 * A draft's group became its chat's: what the draft was last told goes on
 * as the chat's, so the chat's next message says what changed since its
 * first.
 */
export function carryLayoutSent(from: string, to: string) {
  const kept = lastSent.get(from);
  if (!kept) {
    return;
  }
  lastSent.delete(from);
  lastSent.set(to, {
    ...kept,
    layout: { ...kept.layout, group: { ...kept.layout.group, id: to } },
  });
}
