import {
  type Draft,
  draftGroupOf,
  type FinderShown,
  type ScreenView,
  type WindowTab,
} from "@/client/atoms/window";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { type RPCOutput } from "@/client/rpc/client";
import { type TabId } from "@/shared/tabs";
import { HOME_DIR_LABEL } from "@instrument-org/shared";
import {
  type SessionMessageDataPart,
  type ChatId,
} from "@instrument-org/workspace/client";
import ms from "ms";

import { type AppsBySlug } from "./apps-by-slug";
import { type BrowserTabsHandle } from "./browser-tabs";
import {
  behindTabOf,
  includedItemsOf,
  includedTabOf,
  isGroupShown,
  tabInView,
} from "./draft-context";
import { computerTabOf, mountOfHostPath } from "./file-tabs";
import { joinHostPath, segmentsOf } from "./host-path";
import { screenLocation, screenPresentation } from "./screen-presentation";
import { type useCompose } from "./use-compose";
import { parseHref } from "./window-href";
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
  drafts: Draft[];
  /** What each of the window's own Files tabs has in its Finder, by the tab's id. */
  finders: Readonly<Record<string, FinderShown>>;
  /** The router's address, which is the screen's own. */
  href: string;
  /** Where one of the window's own tabs stands now. */
  hrefOfAppTab: (id: TabId) => string | undefined;
  /** Which chats have their pane open, which is whether the tab up in one is in view. */
  paneOpenByGroup: Record<string, boolean>;
  /** What the screen that is up says it shows, or nothing while none has said. */
  screenView: null | ScreenView;
  /** The folders the window reaches, which say how the conversation reaches a file; undefined until the window is open. */
  state: RPCOutput["workspace"]["window"]["ensure"] | undefined;
  /** What each draft window's band has up, by the draft's group. */
  viewsById: ReturnType<typeof useCompose>["viewsById"];
  windowTabs: Pick<
    ReturnType<typeof useWindowTabs>,
    "active" | "allTabs" | "groupOnScreen" | "selectedTabIn"
  >;
}

/**
 * What goes with a message, read at the moment of sending: the tab on screen
 * and the page's words for a chat's send, and a draft window's band for
 * the chat the draft starts. Both are made over the window as it stands,
 * so what is read is the window at the moment of the ask.
 */
export function contextReaders({
  appsBySlug,
  appTabId,
  browser,
  chatTitles,
  drafts,
  finders,
  href,
  hrefOfAppTab,
  paneOpenByGroup,
  screenView,
  state,
  viewsById,
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
  const finderFor = (tab: WindowTab) => finders[tab.id] ?? null;
  const includedOf = (draft: Draft) =>
    includedTabOf(draft, windowTabs.allTabs, hrefOfAppTab);
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
            homeLabel: HOME_DIR_LABEL,
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
    const mount = mountOfHostPath(filePath, state?.attachedFolders ?? {});
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
  const readPage = async (tabId?: string) => {
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
  /** What one tab says about itself, for a chat a draft starts: see includedContext. */
  const tabContext = async (
    tab: undefined | WindowTab,
  ): Promise<SessionMessageDataPart.ViewContextDataPart | undefined> => {
    if (!tab || !state) {
      return;
    }
    // The screen's own answer, when the included tab is the one on screen.
    const view =
      active?.id === tab.id || inView?.id === tab.id ? screenView : null;
    if (tab.kind === "page") {
      const url = tab.url ?? "about:blank";
      const filePath = hostPathOfFileUrl(tab.url);
      if (filePath !== undefined) {
        return { file: fileOf(filePath), screen: "file", url };
      }
      const read = await readPage(tab.id);
      if (!read) {
        return { screen: "browser", url };
      }
      const { tab: _own, tabs: _others, ...page } = read;
      return { page, screen: "browser", url };
    }
    if (view && view.screen !== "home") {
      return { ...view, url: tab.href };
    }
    const computer = computerTabOf(tab.href);
    if (computer?.file !== undefined) {
      return { file: fileOf(computer.file), screen: "file", url: tab.href };
    }
    if (computer) {
      const path = joinHostPath(computer.root, computer.path);
      const mount = mountOfHostPath(path, state.attachedFolders ?? {});
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
    const where = screenLocation(tab.href, { appsBySlug, chatTitles });
    if (where.kind === "app") {
      const slug = parseHref(tab.href).pathname.slice("/apps/".length);
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
  /**
   * What the thing a draft was opened over says about itself, for the chat
   * the draft starts: a file by its path, a page by its words read from the
   * place's own guest, a folder or an app as its screen reports it while it
   * is the one on screen, and otherwise as much as its address says. The
   * page's own tabs are left out, since they are the place's to hand over
   * and not the chat's.
   */
  const includedContext = (
    draft: Draft,
  ): Promise<SessionMessageDataPart.ViewContextDataPart | undefined> =>
    tabContext(includedOf(draft));
  /** What a draft's window and the thing it was opened over show, as its chat starts, before what was picked for it. */
  const draftShown = async (
    draftId: string,
  ): Promise<SessionMessageDataPart.ViewContextDataPart | undefined> => {
    const draft = drafts.find((entry) => entry.id === draftId);
    const group = draftGroupOf(draftId);
    const up = windowTabs.selectedTabIn(group);
    const view = viewsById[group];
    if (!state) {
      return;
    }
    const includedTab = draft ? includedOf(draft) : undefined;
    // Without an id: the place's tab is not the chat's to hand over.
    const described = [
      ...describeTabs(windowTabs.allTabs.filter((tab) => tab.group === group)),
      ...(includedTab
        ? describeTabs([includedTab]).map(({ id: _kept, ...tab }) => tab)
        : []),
    ];
    if (!view || !up || view.screen === "home") {
      const included = draft ? await includedContext(draft) : undefined;
      if (included) {
        return { ...included, tabs: described };
      }
      if (!view || !up) {
        return;
      }
      return {
        ...view,
        tabs: described,
        url: up.kind === "page" ? "about:blank" : up.href,
      };
    }
    const filePath =
      view.screen === "browser" && up.kind === "page"
        ? hostPathOfFileUrl(up.url)
        : view.screen === "file"
          ? view.file?.path
          : undefined;
    const page =
      view.screen === "browser" && up.kind === "page" && filePath === undefined
        ? await readPage(up.id)
        : undefined;
    const shown =
      filePath === undefined
        ? view
        : { file: fileOf(filePath), screen: "file" as const };
    return {
      ...shown,
      ...(page ? { page } : {}),
      tabs: described,
      url: up.kind === "page" ? (up.url ?? "about:blank") : up.href,
    };
  };
  /**
   * What a draft's window has up as its chat starts: the band's page, read
   * at that moment, or the folder or file its screen reported, and the
   * draft's tabs for the chat to name, with the thing the draft was opened
   * over described among them. A draft that gathered nothing of its own is
   * told about that thing in place of its band; one with neither has nothing
   * the conversation can be told about. What the draft was opened on by name
   * goes with it whatever the window shows.
   */
  const draftContext = async (
    draftId: string,
  ): Promise<SessionMessageDataPart.ViewContextDataPart | undefined> => {
    const draft = drafts.find((entry) => entry.id === draftId);
    const behind = draft ? behindTabOf(draft, inView) : undefined;
    // With nothing else to say, what is behind the draft is the view itself,
    // a page by its words; beside something else it is named, below.
    const ownShown = await draftShown(draftId);
    const behindShown =
      ownShown === undefined ? await tabContext(behind) : undefined;
    const shown =
      ownShown ??
      (behindShown && behind
        ? { ...behindShown, tabs: describeTabs([behind]) }
        : undefined);
    const picked = (draft?.chosen ?? []).map((item) => ({
      ...fileOf(item.path),
      kind: item.kind,
    }));
    // What the window has up behind the draft, when it is something else and
    // was not left out: a file or folder, or what is selected in its Finder,
    // goes as though it were picked, and a page or an app is named among the
    // tabs, a page by the id a task can be handed. What is selected in the
    // Finder of the thing the draft was opened over goes as picked too, as
    // its chip shows it.
    const named = ownShown === undefined ? undefined : behind;
    const namedItems = named
      ? includedItemsOf(named, finderFor(named), draft?.chosen ?? [])
      : undefined;
    const includedTab = draft ? includedOf(draft) : undefined;
    const includedSelected = includedTab
      ? (finderFor(includedTab)?.selected ?? [])
      : [];
    const chosen = [
      ...picked,
      ...[...includedSelected, ...(namedItems ?? [])]
        .filter((item) => !picked.some((held) => held.path === item.path))
        .map((item) => ({ ...fileOf(item.path), kind: item.kind })),
    ];
    const behindTabs =
      named && namedItems === undefined ? describeTabs([named]) : [];
    if ((chosen.length === 0 && behindTabs.length === 0) || !state) {
      return shown;
    }
    // What was picked goes whatever the window shows, with nothing on screen
    // to say beside it as well.
    const base = shown ?? { screen: "home" as const, tabs: [] };
    return {
      ...base,
      ...(chosen.length > 0 ? { chosen } : {}),
      tabs: [...(base.tabs ?? []), ...behindTabs],
    };
  };
  /**
   * What the window has up for a chat other than the one on screen to be
   * told: the tab up in the chat on screen while its pane is open, or the
   * screen the window's tab is at, as that screen says it. Nothing while the
   * chat asking is the one on screen, which says its own.
   */
  const windowShown = async (
    chatId: ChatId,
  ): Promise<SessionMessageDataPart.ViewContextDataPart | undefined> => {
    if (windowTabs.groupOnScreen === chatId) {
      return;
    }
    if (active && isGroupShown(active.group, paneOpenByGroup)) {
      const shown = await tabContext(active);
      return shown && { ...shown, tabs: describeTabs([active]) };
    }
    if (!screenView || screenView.screen === "home") {
      return;
    }
    // The record open in an app's inspector goes only to a chat a draft
    // starts over it, never into a reply to one already going.
    const app = screenView.app
      ? { ...screenView.app, reading: undefined }
      : undefined;
    return { ...screenView, ...(app ? { app } : {}), tabs: [], url: href };
  };
  /**
   * What goes with a message in a chat, read at the moment of sending: the
   * tab the chat has up while its view of it is open, a page with its words,
   * a file by where it is and how the agent reaches it, a folder or an app
   * as its screen says; with the chat's view put away, what the window has
   * up behind it. Either way the chat's own tabs are named, by the ids a
   * task can be handed.
   */
  const sendContext = async ({
    isViewOpen,
    chatId,
  }: {
    /** Whether the chat's view of its tab up is open where the message is written. */
    isViewOpen: boolean;
    chatId: ChatId;
  }): Promise<SessionMessageDataPart.ViewContextDataPart | undefined> => {
    if (!state) {
      return;
    }
    const own = windowTabs.allTabs.filter((tab) => tab.group === chatId);
    const up = windowTabs.selectedTabIn(chatId);
    const shown =
      isViewOpen && up ? await tabContext(up) : await windowShown(chatId);
    if (!shown && own.length === 0) {
      return;
    }
    return {
      ...(shown ?? { screen: "home" as const, url: href }),
      tabs: [...describeTabs(own), ...(shown?.tabs ?? [])],
    };
  };
  return { draftContext, sendContext };
}
