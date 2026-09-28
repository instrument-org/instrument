import {
  type Draft,
  draftGroupOf,
  type ScreenView,
  type WindowTab,
} from "@/client/atoms/orchestrator";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { type RPCOutput } from "@/client/rpc/client";
import {
  type SessionMessageDataPart,
  type StoreId,
} from "@instrument-org/workspace/client";
import ms from "ms";

import { type AppsBySlug } from "./apps-by-slug";
import { type BrowserTabsHandle } from "./browser-tabs";
import { behindTabOf, isGroupShown } from "./draft-context";
import { computerTabOf, mountOfHostPath } from "./file-tabs";
import { joinHostPath, segmentsOf } from "./host-path";
import { screenLocation, screenPresentation } from "./screen-presentation";
import { type useCompose } from "./use-compose";
import { parseHref, type useWindowTabs } from "./window-tabs";

/** The longest a send waits on a page's words: a guest that never answers (mid-navigation, parked, hung) costs the conversation the page's text, not the send. */
const PAGE_READ_MS = ms("5 seconds");

/**
 * The window as the readers see it: its tabs, the screen that is up and what
 * it says it shows, the drafts and what their windows have up, the names an
 * address alone cannot say, and the orchestrator's state, without which
 * nothing is described.
 */
export interface SendContextWindow {
  appsBySlug: AppsBySlug;
  /** The window's browser, for a page's words; null until it is mounted. */
  browser: null | Pick<BrowserTabsHandle, "readPage">;
  drafts: Draft[];
  /** The router's address, which is the screen's own. */
  href: string;
  /** Which chats have their pane open, which is whether the tab up in one is in view. */
  paneOpenByGroup: Record<string, boolean>;
  /** What the screen that is up says it shows, or nothing while none has said. */
  screenView: null | ScreenView;
  /** The orchestrator's state, whose folder grants say how the conversation reaches a file. */
  state: RPCOutput["workspace"]["task"]["state"]["get"] | undefined;
  threadTitles: Map<StoreId.Session, string>;
  /** What each draft window's band has up, by the draft's group. */
  viewsById: ReturnType<typeof useCompose>["viewsById"];
  windowTabs: Pick<
    ReturnType<typeof useWindowTabs>,
    "active" | "allTabs" | "tabs" | "tabUpIn"
  >;
}

/**
 * What goes with a message, read at the moment of sending: the tab on screen
 * and the page's words for a thread's send, and a draft window's band for
 * the thread the draft starts. Both are made over the window as it stands,
 * so what is read is the window at the moment of the ask.
 */
export function contextReaders({
  appsBySlug,
  browser,
  drafts,
  href,
  paneOpenByGroup,
  screenView,
  state,
  threadTitles,
  viewsById,
  windowTabs,
}: SendContextWindow) {
  const { active, tabs } = windowTabs;
  /** A group's tabs as the conversation is told them, in the strip's order, each by the id `tab` and "--tab" name it by. */
  const describeTabs = (
    listed: WindowTab[],
  ): NonNullable<SessionMessageDataPart.ViewContextDataPart["tabs"]> =>
    listed.map((tab) => {
      if (tab.kind !== "page") {
        return {
          at: tab.href,
          id: tab.id,
          title: screenPresentation(tab.href, { appsBySlug, threadTitles })
            .title,
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
  /** What one tab says about itself, for a thread a draft starts: see includedContext. */
  const tabContext = async (
    tab: undefined | WindowTab,
  ): Promise<SessionMessageDataPart.ViewContextDataPart | undefined> => {
    if (!tab || !state) {
      return;
    }
    // The screen's own answer, when the included tab is the one on screen.
    const view = active?.id === tab.id ? screenView : null;
    if (tab.kind === "page") {
      const url = tab.url ?? "about:blank";
      const filePath = hostPathOfFileUrl(tab.url);
      if (filePath !== undefined) {
        return { file: fileOf(filePath), screen: "file", url };
      }
      const read = await readPage(tab.id);
      const { tab: _own, tabs: _others, ...page } = read ?? { title: "", url };
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
    const where = screenLocation(tab.href, { appsBySlug, threadTitles });
    if (where.kind === "app") {
      const slug = parseHref(tab.href).pathname.slice(
        "/orchestrator/apps/".length,
      );
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
   * What the thing a draft was opened over says about itself, for the thread
   * the draft starts: a file by its path, a page by its words read from the
   * place's own guest, a folder or an app as its screen reports it while it
   * is the one on screen, and otherwise as much as its address says. The
   * page's own tabs are left out, since they are the place's to hand over
   * and not the thread's.
   */
  const includedContext = (
    draft: Draft,
  ): Promise<SessionMessageDataPart.ViewContextDataPart | undefined> =>
    tabContext(includedTabOf(draft, windowTabs.allTabs));
  /** What a draft's window and the thing it was opened over show, as its thread starts, before what was picked for it. */
  const draftShown = async (
    draftId: string,
  ): Promise<SessionMessageDataPart.ViewContextDataPart | undefined> => {
    const draft = drafts.find((entry) => entry.id === draftId);
    const group = draftGroupOf(draftId);
    const up = windowTabs.tabUpIn(group);
    const view = viewsById[group];
    if (!state) {
      return;
    }
    const includedTab = draft
      ? includedTabOf(draft, windowTabs.allTabs)
      : undefined;
    // Without an id: the place's tab is not the thread's to hand over.
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
   * What a draft's window has up as its thread starts: the band's page, read
   * at that moment, or the folder or file its screen reported, and the
   * draft's tabs for the thread to name, with the thing the draft was opened
   * over described among them. A draft that gathered nothing of its own is
   * told about that thing in place of its band; one with neither has nothing
   * the conversation can be told about. What the draft was opened on by name
   * goes with it whatever the window shows.
   */
  const draftContext = async (
    draftId: string,
  ): Promise<SessionMessageDataPart.ViewContextDataPart | undefined> => {
    const draft = drafts.find((entry) => entry.id === draftId);
    const behind = draft
      ? behindTabOf(draft, active, isGroupShown(active?.group, paneOpenByGroup))
      : undefined;
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
    // was not left out: a file or folder goes as though it were picked, and
    // a page or an app is named among the tabs, a page by the id a task can
    // be handed.
    const named = ownShown === undefined ? undefined : behind;
    const behindPath = named ? hostPathOf(named) : undefined;
    const chosen = [
      ...picked,
      ...(behindPath && !picked.some((item) => item.path === behindPath.path)
        ? [{ ...fileOf(behindPath.path), kind: behindPath.kind }]
        : []),
    ];
    const behindTabs =
      named && behindPath === undefined ? describeTabs([named]) : [];
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
   * What the tab on screen says it shows, plus the page's words when that
   * tab is a page, read at the moment of sending; a screen that registered
   * nothing sends nothing, and so does a group with no tab under its head.
   */
  const sendContext = async (): Promise<
    SessionMessageDataPart.ViewContextDataPart | undefined
  > => {
    if (!screenView || !state || !active) {
      return;
    }
    // A file shown as a page is the file to the conversation: where it is,
    // and how the agent reaches it when a granted folder covers it, rather
    // than an address only this window can open.
    const activeFilePath =
      screenView.screen === "browser" && active.kind === "page"
        ? hostPathOfFileUrl(active.url)
        : undefined;
    const page =
      screenView.screen === "browser" && activeFilePath === undefined
        ? await readPage()
        : undefined;
    const activeMount =
      activeFilePath === undefined
        ? undefined
        : mountOfHostPath(activeFilePath, state.attachedFolders ?? {});
    // The record open in an app's inspector goes only to a thread a draft
    // starts over it, never into a reply to one already going.
    const app = screenView.app
      ? { ...screenView.app, reading: undefined }
      : undefined;
    const shown =
      activeFilePath === undefined
        ? { ...screenView, ...(app ? { app } : {}) }
        : {
            file: {
              ...(activeMount === undefined ? {} : { mount: activeMount }),
              name: segmentsOf(activeFilePath).at(-1) ?? activeFilePath,
              path: activeFilePath,
            },
            screen: "file" as const,
          };
    return {
      ...shown,
      ...(page ? { page } : {}),
      tabs: describeTabs(tabs),
      url: href,
    };
  };
  return { draftContext, sendContext };
}

/** Where a tab stands on this computer: a file shown as a page, a file tab's file, or a folder tab's folder; nothing for a web page or an app. */
function hostPathOf(
  tab: WindowTab,
): undefined | { kind: "file" | "folder"; path: string } {
  if (tab.kind === "page") {
    const path = hostPathOfFileUrl(tab.url);
    return path === undefined ? undefined : { kind: "file", path };
  }
  const computer = computerTabOf(tab.href);
  if (!computer) {
    return;
  }
  return computer.file === undefined
    ? { kind: "folder", path: joinHostPath(computer.root, computer.path) }
    : { kind: "file", path: computer.file };
}

/** The tab a draft was opened over, while it is still among the window's. */
function includedTabOf(
  draft: Draft,
  allTabs: WindowTab[],
): undefined | WindowTab {
  const { included } = draft;
  if (!included) {
    return;
  }
  return allTabs.find(
    (tab) => tab.id === included.tabId && tab.group === included.group,
  );
}
