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
import { tabInView } from "./draft-context";
import { computerTabOf, reachablePath } from "./file-tabs";
import { joinHostPath, segmentsOf } from "./host-path";
import { screenLocation, screenPresentation } from "./screen-presentation";
import { type Volume } from "./tab-location";
import {
  chatOfTab,
  draftOfTab,
  isFreshTab,
  isHomeTab,
  isNewChatTab,
} from "./tab-model";
import { type TabSurface } from "./tab-surface";
import { matchScreen } from "./window-href";
import { type useWindowTabs } from "./window-tabs";

/** The longest a send waits on a page's words: a guest that never answers (mid-navigation, parked, hung) costs the conversation the page's text, not the send. */
const PAGE_READ_MS = ms("5 seconds");

/**
 * The window as the readers see it: its tabs, the screen that is up and what
 * it says it shows, what each tab's screen has up, the names an address
 * alone cannot say, and the folders the window reaches, without which
 * nothing is described.
 */
export interface SendContextWindow {
  appsBySlug: AppsBySlug;
  /** The window's own tab that is up, by its id; null before there is one. */
  appTabId: null | TabId;
  /** The window's browser, for a page's words; null until it is mounted. */
  browser: null | Pick<BrowserTabsHandle, "readPage">;
  chatTitles: Map<ChatId, string>;
  /** The router's address, which is the screen's own. */
  href: string;
  /** The tab beside each new tab its first message leaves out, by the new tab's id (`leftOutBesideAtom`). */
  leftOutBeside?: Readonly<Record<string, string>>;
  /** The computer's volumes, which name a folder chip the way the Finder does. */
  volumes?: Volume[];
  /** What the screen that is up says it shows, or nothing while none has said. */
  screenView: null | ScreenView;
  /** The folders the window reaches, which say how the conversation reaches a file; undefined until the window is open. */
  state: RPCOutput["workspace"]["window"]["ensure"] | undefined;
  /** What each tab's screen says about itself, by the tab's id: what a draft's band shows, and each Files tab's Finder. */
  surfaces: Readonly<Record<string, TabSurface>>;
  windowTabs: Pick<
    ReturnType<typeof useWindowTabs>,
    "active" | "allTabs" | "besideOf" | "groupOnScreen" | "selectedTabIn"
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
  href,
  leftOutBeside = {},
  screenView,
  state,
  surfaces,
  volumes,
  windowTabs,
}: SendContextWindow) {
  const { active } = windowTabs;
  const isActiveShown = active?.group !== undefined;
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
    { isReply }: { isReply: boolean },
  ): Promise<SessionMessageDataPart.ViewContextDataPart | undefined> => {
    if (!state) {
      return;
    }
    // A new tab's face has nothing on it to name or hand over, and a chat's
    // tab is a conversation rather than a thing in the group to work in.
    const own = windowTabs.allTabs.filter(
      (tab) =>
        tab.group === group &&
        !isFreshTab(tab) &&
        !isNewChatTab(tab) &&
        chatOfTab(tab) === undefined,
    );
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
      // A tab of the sending group's own is named with the rest of them
      // below, so only one from elsewhere is named here.
      if (shown) {
        if (!item.owned) {
          named.push(
            ...describeTabs([item.tab]).map(({ id: _id, ...tab }) => tab),
          );
        }
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
    // The chips the person put on the message, which are what the chat is
    // granted. A tab of the sending group's own goes without one: being in
    // the group tells the agent of it, and grants nothing.
    const attached = items
      .filter(
        (item) =>
          !(item.kind === "tab" && item.owned) &&
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
  /**
   * The items a draft carries now (see draftContextItems): its group's tab
   * up, as its composer shows it, and none for a new tab. `tabId` is the tab
   * the draft is written in, where the caller knows it: a draft made a
   * moment ago is not in its tab's address yet.
   */
  const draftItems = (draft: Draft, tabId?: string) => {
    const group = draftGroupOfTab(draft.id, tabId);
    const tab = windowTabs.allTabs.find((each) =>
      tabId === undefined ? draftOfTab(each) === draft.id : each.id === tabId,
    );
    const beside =
      tab === undefined ? undefined : windowTabs.besideOf(tab.id);
    const up =
      tab !== undefined && beside?.id === leftOutBeside[tab.id]
        ? undefined
        : beside;
    return draftContextItems({
      allTabs: windowTabs.allTabs,
      band: up && !isHomeTab(up) ? [up] : [],
      draft,
      finderOf,
      group,
    });
  };
  /** What a draft carries as its chat starts, from the tab it was written in when it was. */
  const draftContext = async (
    draft: Draft,
    tabId: string | undefined,
  ): Promise<SessionMessageDataPart.ViewContextDataPart | undefined> =>
    contextOf(draftGroupOfTab(draft.id, tabId), draftItems(draft, tabId), {
      isReply: false,
    });
  /**
   * What goes with a message in a chat: the tab up on the other side of the
   * chat's tab, while its chip is there, and what the person took for the
   * message from what was offered; and the tabs of the chat's group, by the
   * ids a task can be handed.
   */
  const sendContext = async ({
    chatId,
    isViewOpen,
    tabId,
    taken,
  }: {
    chatId: ChatId;
    /** Whether what stands beside the chat's tab goes with the message. */
    isViewOpen: boolean;
    /** The chat's tab the message is written in. */
    tabId?: string;
    /** What the person took for the message. */
    taken: readonly ContextItem[];
  }): Promise<SessionMessageDataPart.ViewContextDataPart | undefined> => {
    const group =
      windowTabs.allTabs.find((tab) => tab.id === tabId)?.group ?? chatId;
    return contextOf(
      group,
      chatContextItems({
        chatId,
        finderOf,
        group,
        taken,
        up:
          isViewOpen && tabId !== undefined
            ? windowTabs.besideOf(tabId)
            : undefined,
      }),
      { isReply: true },
    );
  };
  /** The group a draft's new chat tab is in, or the key an earlier build kept the draft's tabs under. */
  const draftGroupOfTab = (draftId: string, tabId?: string) =>
    windowTabs.allTabs.find((each) =>
      tabId === undefined ? draftOfTab(each) === draftId : each.id === tabId,
    )?.group ?? draftGroupOf(draftId);
  return { draftContext, draftItems, sendContext };
}
