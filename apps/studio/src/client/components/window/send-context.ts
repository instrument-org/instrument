import { type Draft, draftGroupOf } from "@/shared/drafts";
import { type ScreenView, type WindowTab } from "@/client/atoms/window";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { type RPCOutput } from "@/client/rpc/client";
import { type TabId } from "@/shared/tabs";
import {
  type SessionMessageDataPart,
  type ChatId,
} from "@instrument-org/workspace/client";
import ms from "ms";

import { type AppsBySlug } from "./apps-by-slug";
import { isSiteGroup } from "./app-tabs";
import { type BrowserTabsHandle } from "./browser-tabs";
import { heldChipOf } from "./context-chip";
import {
  chatContextItems,
  type ContextItem,
  draftContextItems,
} from "./context-items";
import { isGroupShown, tabInView } from "./draft-context";
import { computerTabOf, reachablePath } from "./file-tabs";
import { joinHostPath, segmentsOf } from "./host-path";
import { screenLocation, screenPresentation } from "./screen-presentation";
import { type Volume } from "./tab-location";
import { isFreshTab, isHomeTab } from "./tab-model";
import { type TabSurface } from "./tab-surface";
import { chatOfGroup, matchScreen } from "./window-href";
import { type useWindowTabs } from "./window-tabs";

/** The longest a send waits on a page's words: a guest that never answers (mid-navigation, parked, hung) costs the conversation the page's text, not the send. */
const PAGE_READ_MS = ms("5 seconds");

/**
 * The window as the readers see it: its tabs, the screen that is up and what
 * it says it shows, the drafts and what their windows have up, the names an
 * address alone cannot say, and the folders the window reaches, without which
 * nothing is described.
 */
export interface SendContextWindow {
  appsBySlug: AppsBySlug;
  /** The window's own tab that is up, by its id; null before there is one. */
  appTabId: null | TabId;
  /** The window's browser, for a page's words; null until it is mounted. */
  browser: null | Pick<BrowserTabsHandle, "readPage">;
  chatTitles: Map<ChatId, string>;
  /** By draft, the keys of the screen's chips the person dismissed. */
  dismissed: Readonly<Record<string, readonly string[]>>;
  drafts: Draft[];
  /** The router's address, which is the screen's own. */
  href: string;
  /** The computer's volumes, which name a folder chip the way the Finder does. */
  volumes?: Volume[];
  /** Which chats have their pane open, which is whether the tab up in one is in view. */
  paneOpenByGroup: Record<string, boolean>;
  /** What the screen that is up says it shows, or nothing while none has said. */
  screenView: null | ScreenView;
  /** The folders the window reaches, which say how the conversation reaches a file; undefined until the window is open. */
  state: RPCOutput["workspace"]["window"]["ensure"] | undefined;
  /** What each tab's screen says about itself, by the tab's id: what a draft's band shows, and each Files tab's Finder. */
  surfaces: Readonly<Record<string, TabSurface>>;
  windowTabs: Pick<
    ReturnType<typeof useWindowTabs>,
    "active" | "allTabs" | "groupOnScreen" | "selectedTabIn"
  >;
}

/**
 * What goes with a message, read at the moment of sending: the items the
 * composer shows as chips (see `ContextItem`), worked out again from the
 * window as it stands at the press, and nothing else. A draft's and a
 * chat's composer list their items with the same functions the chips are
 * drawn from, so the two cannot disagree.
 */
export function contextReaders({
  appsBySlug,
  appTabId,
  browser,
  chatTitles,
  dismissed,
  drafts,
  href,
  paneOpenByGroup,
  screenView,
  state,
  surfaces,
  volumes,
  windowTabs,
}: SendContextWindow) {
  const { active } = windowTabs;
  const isActiveShown = isGroupShown(active?.group, paneOpenByGroup);
  /** What the window has in view: see tabInView. */
  const inView =
    appTabId === null
      ? isActiveShown
        ? active
        : undefined
      : tabInView({
          activeHref: href,
          appTabId,
          groupTab: active,
          isGroupTabShown: isActiveShown,
        });
  const finderOf = (id: string) => surfaces[id]?.finder ?? null;
  /** A group's tabs as the conversation is told them, in the strip's order, each by the id `tab` and "--tab" name it by. */
  const describeTabs = (
    listed: WindowTab[],
  ): NonNullable<SessionMessageDataPart.ViewContextDataPart["tabs"]> =>
    listed.map((tab) => {
      if (tab.kind !== "page") {
        return {
          at: tab.href,
          id: tab.id,
          title: screenPresentation(tab.href, {
            appsBySlug,
            chatTitles,
          }).title,
        };
      }
      const filePath = hostPathOfFileUrl(tab.url);
      return filePath === undefined
        ? {
            at: tab.url ?? "about:blank",
            id: tab.id,
            title: tab.title || tab.url || "New tab",
          }
        : {
            at: filePath,
            id: tab.id,
            title: segmentsOf(filePath).at(-1) ?? filePath,
          };
    });
  /** How the conversation reaches a file on this computer: its name, its path, and the mount it is under when a granted folder covers it. */
  const fileOf = (filePath: string) => {
    const mount = reachablePath(filePath, state?.folders ?? {});
    return {
      ...(mount === undefined ? {} : { mount }),
      name: segmentsOf(filePath).at(-1) ?? filePath,
      path: filePath,
    };
  };
  /**
   * A page's words for the conversation, or nothing when the guest cannot
   * give them in time: the read runs a script in the guest, and a guest that
   * is hung or parked never answers, which must not hold the send.
   */
  const readPage = async (tabId: string) => {
    let timer: number | undefined;
    try {
      return await Promise.race([
        browser?.readPage(tabId),
        new Promise<undefined>((resolve) => {
          timer = window.setTimeout(resolve, PAGE_READ_MS);
        }),
      ]);
    } catch {
      return;
    } finally {
      window.clearTimeout(timer);
    }
  };
  /** What a tab's screen says it shows: its own report, or the window's for the one in view. */
  const viewOf = (tab: WindowTab): null | ScreenView =>
    surfaces[tab.id]?.view ??
    (active?.id === tab.id || inView?.id === tab.id ? screenView : null);
  /**
   * What one tab says about itself: a page by its words, a file by where it
   * is, a folder or an app as its screen reports it, and otherwise as much as
   * its address says. A page's tab id goes for a tab of the sending group's
   * own, which the conversation may hand a task, and for one of the
   * person's own outside every chat, marked theirs, which it may ask them
   * for; a page of another chat's goes without one.
   */
  const tabContext = async (
    tab: WindowTab,
    { owned, own }: { own: WindowTab[]; owned: boolean },
  ): Promise<SessionMessageDataPart.ViewContextDataPart | undefined> => {
    if (tab.kind === "page") {
      const url = tab.url ?? "about:blank";
      const filePath = hostPathOfFileUrl(tab.url);
      if (filePath !== undefined) {
        return { file: fileOf(filePath), screen: "file", url };
      }
      const read = await readPage(tab.id);
      // The sending group's other tabs, by the ids `tab` and "--tab" take.
      const ownTabs = describeTabs(own.filter((other) => other.id !== tab.id))
        .filter((other) => other.id !== undefined)
        .map(({ at, id, title }) => ({ id: id ?? "", title, url: at }));
      const page = read
        ? (() => {
            const { tab: _read, tabs: _readTabs, ...words } = read;
            return {
              ...words,
              ...(owned
                ? { tab: tab.id }
                : tab.group === undefined || isSiteGroup(tab.group)
                  ? { tab: tab.id, theirs: true }
                  : {}),
              tabs: ownTabs,
            };
          })()
        : undefined;
      return { ...(page ? { page } : {}), screen: "browser", url };
    }
    const view = viewOf(tab);
    if (view && view.screen !== "home") {
      return { ...view, url: tab.href };
    }
    const computer = computerTabOf(tab.href);
    if (computer?.file !== undefined) {
      return { file: fileOf(computer.file), screen: "file", url: tab.href };
    }
    if (computer) {
      const path = joinHostPath(computer.root, computer.path);
      const mount = reachablePath(path, state?.folders ?? {});
      return {
        folder: {
          display: path,
          ...(mount === undefined ? {} : { mount }),
          selected: [],
        },
        screen: "computer",
        url: tab.href,
      };
    }
    const screen = matchScreen(tab.href);
    const where = screenLocation(tab.href, { appsBySlug, chatTitles });
    if (screen.kind === "app" && where.kind === "app") {
      const { slug } = screen;
      return {
        app: {
          name: where.name,
          ...(where.site ? { site: where.site } : {}),
          slug,
          standing: "unknown",
        },
        screen: "apps",
        url: tab.href,
      };
    }
    return;
  };
  const names = { appsBySlug, ...(volumes ? { volumes } : {}) };
  /** The chip an item drew, for the transcript to draw over the message. */
  const sentChipOf = (item: ContextItem): SessionMessageDataPart.SentChip => {
    switch (item.kind) {
      case "chat": {
        return {
          id: item.chat,
          kind: "chat",
          title: chatTitles.get(item.chat) ?? "Chat",
        };
      }
      case "chosen": {
        return {
          items: [{ kind: item.item.kind, path: item.item.path }],
          kind: "paths",
        };
      }
      case "tab": {
        return heldChipOf({ items: item.items, tab: item.tab }, names);
      }
    }
  };
  /**
   * The context a group's items carry. What points at this computer goes as
   * picked; the first page or screen is what the window showed and any after
   * it are named among the tabs; another chat is named and nothing more; and
   * the group's own tabs are listed by the ids `tab` and "--tab" take.
   * Nothing goes when there is nothing to say.
   */
  const contextOf = async (
    group: string,
    items: ContextItem[],
  ): Promise<SessionMessageDataPart.ViewContextDataPart | undefined> => {
    if (!state) {
      return;
    }
    // A new tab's face has nothing on it to name or hand over.
    const own = windowTabs.allTabs.filter(
      (tab) => tab.group === group && !isFreshTab(tab) && !isHomeTab(tab),
    );
    const isReply = !group.startsWith("draft:");
    let shown: SessionMessageDataPart.ViewContextDataPart | undefined;
    let chat: SessionMessageDataPart.ViewContextDataPart["chat"];
    const chosen: NonNullable<
      SessionMessageDataPart.ViewContextDataPart["chosen"]
    > = [];
    const named: NonNullable<
      SessionMessageDataPart.ViewContextDataPart["tabs"]
    > = [];
    for (const item of items) {
      if (item.kind === "chosen") {
        chosen.push({ ...fileOf(item.item.path), kind: item.item.kind });
        continue;
      }
      if (item.kind === "chat") {
        // A chat trashed since the draft was opened over it names nothing.
        if (chatTitles.size > 0 && !chatTitles.has(item.chat)) {
          continue;
        }
        chat ??= {
          id: item.chat,
          title: chatTitles.get(item.chat) ?? "a chat",
        };
        continue;
      }
      // What is selected in a Finder goes as picked, beside the folder it
      // is in; a file or folder past the first thing shown goes as picked.
      const picks =
        item.items === undefined ||
        (shown === undefined &&
          (finderOf(item.tab.id)?.selected.length ?? 0) === 0)
          ? []
          : item.items;
      chosen.push(
        ...picks
          .filter((entry) => !chosen.some((held) => held.path === entry.path))
          .map((entry) => ({ ...fileOf(entry.path), kind: entry.kind })),
      );
      if (shown && item.items !== undefined) {
        continue;
      }
      if (shown) {
        named.push(
          ...describeTabs([item.tab]).map(({ id, ...tab }) =>
            item.owned ? { ...tab, id } : tab,
          ),
        );
        continue;
      }
      shown = await tabContext(item.tab, { own, owned: item.owned });
      // The record open in an app's inspector goes only to a chat a draft
      // starts over it, never into a reply to one already going.
      if (isReply && shown?.app) {
        shown = { ...shown, app: { ...shown.app, reading: undefined } };
      }
    }
    if (!shown && !chat && chosen.length === 0 && own.length === 0) {
      return;
    }
    // The chips the composer drew: a chat's own tab goes without one.
    const attached = items
      .filter(
        (item) =>
          !(isReply && item.kind === "tab" && item.owned) &&
          !(
            item.kind === "chat" &&
            chatTitles.size > 0 &&
            !chatTitles.has(item.chat)
          ),
      )
      .map(sentChipOf);
    return {
      ...(shown ??
        (chat
          ? { screen: "chat" as const }
          : isReply
            ? { screen: "conversation" as const }
            : { screen: "home" as const })),
      ...(attached.length > 0 ? { attached } : {}),
      ...(chat ? { chat } : {}),
      ...(chosen.length > 0 ? { chosen } : {}),
      tabs: [...describeTabs(own), ...named],
    };
  };
  /** The items a draft carries now; see draftContextItems. */
  const draftItems = (draft: Draft) => {
    const group = draftGroupOf(draft.id);
    const bandUp = windowTabs.selectedTabIn(group);
    return draftContextItems({
      allTabs: windowTabs.allTabs,
      bandUp,
      dismissed: dismissed[draft.id] ?? [],
      draft,
      finderOf,
      group,
      inView,
    });
  };
  /** What a draft carries as its chat starts. */
  const draftContext = async (
    draftId: string,
  ): Promise<SessionMessageDataPart.ViewContextDataPart | undefined> => {
    const draft = drafts.find((entry) => entry.id === draftId);
    return draft
      ? contextOf(draftGroupOf(draftId), draftItems(draft))
      : undefined;
  };
  /**
   * What goes with a message in a chat: the chat's tab up while its view of
   * it is open, or what the window has in view behind it, each unless left
   * out; and the chat's own tabs, by the ids a task can be handed.
   */
  const sendContext = async ({
    chatId,
    isViewOpen,
    leftOut,
  }: {
    chatId: ChatId;
    /** Whether the chat's view of its tab up is open where the message is written. */
    isViewOpen: boolean;
    leftOut: readonly string[];
  }): Promise<SessionMessageDataPart.ViewContextDataPart | undefined> =>
    contextOf(
      chatId,
      chatContextItems({
        chatId,
        chatOnScreen: chatOfGroup(windowTabs.groupOnScreen),
        finderOf,
        inView: isViewOpen ? undefined : inView,
        leftOut,
        up: isViewOpen ? windowTabs.selectedTabIn(chatId) : undefined,
      }),
    );
  return { draftContext, draftItems, sendContext };
}
