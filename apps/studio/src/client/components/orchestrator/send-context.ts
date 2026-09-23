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
import { computerTabOf, mountOfHostPath } from "./file-tabs";
import { joinHostPath, segmentsOf } from "./host-path";
import { screenLocation, screenPresentation } from "./screen-presentation";
import { type TasksFace } from "./thread-tasks-view";
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
  /** The orchestrator's tasks, for the face's account of them. */
  children: RPCOutput["workspace"]["orchestrator"]["children"] | undefined;
  drafts: Draft[];
  /** The router's address, which is the screen's own. */
  href: string;
  /** What the screen that is up says it shows, or nothing while none has said. */
  screenView: null | ScreenView;
  /** The orchestrator's state, whose folder grants say how the conversation reaches a file. */
  state: RPCOutput["workspace"]["task"]["state"]["get"] | undefined;
  /** The face over the tab, while one is up; nothing otherwise. */
  tasksFace: TasksFace | undefined;
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
  children,
  drafts,
  href,
  screenView,
  state,
  tasksFace,
  threadTitles,
  viewsById,
  windowTabs,
}: SendContextWindow) {
  const { active, tabs } = windowTabs;
  /** A group's tabs as the conversation is told them, in the strip's order: what `open` and `--tab` can name. */
  const describeTabs = (
    listed: WindowTab[],
  ): NonNullable<SessionMessageDataPart.ViewContextDataPart["tabs"]> =>
    listed.map((tab) => {
      if (tab.kind !== "page") {
        return {
          at: tab.href,
          title: screenPresentation(tab.href, { appsBySlug, threadTitles })
            .title,
        };
      }
      // A file page has no id to hand a task: a task is pointed at sites,
      // never at a file on this computer.
      const filePath = hostPathOfFileUrl(tab.url);
      return filePath === undefined
        ? {
            at: tab.url ?? "about:blank",
            id: tab.id,
            title: tab.title || tab.url || "New tab",
          }
        : {
            at: filePath,
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
  /**
   * What the thing a draft was opened over says about itself, for the thread
   * the draft starts: a file by its path, a page by its words read from the
   * place's own guest, a folder or an app as its screen reports it while it
   * is the one on screen, and otherwise as much as its address says. The
   * page's own tabs are left out, since they are the place's to hand over
   * and not the thread's.
   */
  const includedContext = async (
    draft: Draft,
  ): Promise<SessionMessageDataPart.ViewContextDataPart | undefined> => {
    const tab = includedTabOf(draft, windowTabs.allTabs);
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
   * What a draft's window has up as its thread starts: the band's page, read
   * at that moment, or the folder or file its screen reported, and the
   * draft's tabs for the thread to name, with the thing the draft was opened
   * over described among them. A draft that gathered nothing of its own is
   * told about that thing in place of its band; one with neither has nothing
   * the conversation can be told about.
   */
  const draftContext = async (
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
   * What the face has on it, in the terms a screen reports: one task and
   * where it stands, or the thread's tasks each with theirs.
   */
  const tasksFaceView = (
    face: TasksFace,
  ): SessionMessageDataPart.ViewContextDataPart | undefined => {
    const own = (children ?? []).filter(
      (child) => child.threadId === face.thread,
    );
    const describe = (child: (typeof own)[number]) => ({
      id: child.id,
      status:
        child.standing.kind === "running"
          ? ("working" as const)
          : ("done" as const),
      ...(child.standing.kind === "running"
        ? { step: child.standing.line }
        : {}),
      title: child.title,
    });
    if (face.task === undefined) {
      return { screen: "tasks", tasks: own.map(describe) };
    }
    const task = own.find((child) => child.id === face.task);
    return task ? { screen: "task", task: describe(task) } : undefined;
  };
  /**
   * What the tab on screen says it shows, plus the page's words when that
   * tab is a page, read at the moment of sending; a screen that registered
   * nothing sends nothing, and so does a group with no tab under its head.
   */
  const sendContext = async (): Promise<
    SessionMessageDataPart.ViewContextDataPart | undefined
  > => {
    // The face over the tab is what the user is looking at while it is up,
    // and it is the window's rather than any screen's to describe.
    const faceView = tasksFace ? tasksFaceView(tasksFace) : undefined;
    if (faceView && state) {
      return { ...faceView, tabs: [], url: href };
    }
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
