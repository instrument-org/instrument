import {
  type BrowserTab,
  everyTabIdAtom,
  newTabHrefOf,
  originOf,
  RECENTS_MAX,
  recentsAtom,
  VISITED_MAX,
  visitedPagesAtom,
  type WindowTab,
  type WindowTabs,
  windowTabsAtom,
} from "@/client/atoms/window";
import { FileTypeIcon } from "@/client/components/extend/file-system";
import { PageFavicon } from "@/client/components/favicon";
import { TaskBrowserPanel } from "@/client/components/task/browser-panel";
import { ActiveTabProvider } from "@/client/hooks/use-active-tab";
import { useBrowserTargets } from "@/client/hooks/use-browser-targets";
import { getWebviewElement } from "@/client/lib/browser-pool";
import { forgetIconlessThisSession } from "@/client/lib/favicon-url";
import { flushFileWrites } from "@/client/lib/file-flush";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { getFileType } from "@/client/lib/get-file-type";
import { rpcClient } from "@/client/rpc/client";
import { fileHref } from "@/shared/computer-href";
import { isPageEditAddress } from "@instrument-org/shared";
import {
  type BrowserTargetId,
  decodeBrowserTargetId,
  encodeBrowserTargetId,
  StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { z } from "zod";

import { AskTray } from "./ask-tray";
import { useWindow } from "./context";
import { FileAskButton } from "./file-ask-button";
import { segmentsOf } from "./host-path";
import { PageEditSession, PageEditToggle } from "./page-edit";
import { pageEditTabsAtom, usePageEditToggleOnScreen } from "./page-edit-state";
import { strayWindowGuests } from "./stray-window-guests";
import { visitInTab } from "./tab-history";
import { isHomeTab, selectTab, useWindowTabs } from "./window-tabs";

export interface BrowserPage {
  favicon?: string;
  title: string;
  url: string;
}

/** How long a tab on screen is given to attach its guest before it is taken for one whose page is gone. */
const ORPHAN_GRACE_MS = 1500;

export interface BrowserTabsHandle {
  /** Whether the guest on screen has anywhere of its own to go. */
  canGoBack: boolean;
  canGoForward: boolean;
  /** A step in the guest's own history, which is this tab's and no other's. */
  goBack: () => void;
  goForward: () => void;
  /** Sends the guest on screen to an address, in the tab it is in. */
  navigate: (url: string) => void;
  /**
   * Sends a page tab's guest to an address, whether or not the tab is up,
   * keeping the tab and its history. A tab whose guest has not come back
   * since a launch is opened there.
   */
  navigateTab: (tabId: string, url: string) => void;
  /**
   * Opens a new page tab, at an address when given, and shows it. Given a
   * tab to replace, the page takes that tab's place in the strip: a new tab
   * becoming the page that was typed into it. Given a group, the page lands
   * in that group, behind whatever is up when the group is not the one on
   * screen.
   */
  open: (url?: string, options?: OpenOptions) => StoreId.Session;
  /**
   * Opens a page tab in a chat's group without showing it: the tab joins the
   * group's list and nothing on screen changes, the pane included. What an
   * agent's own work opens, which the user finds in the list when they want
   * to watch. Returns the tab.
   */
  openBehind: (url: string | undefined, group: string) => StoreId.Session;
  /**
   * Opens a page in the group on screen or the group given, or shows the tab
   * already on it when the address is a file's. Given a tab to replace, a
   * page opened takes that tab's place in the strip rather than arriving
   * beside it. Returns the tab the page is in.
   */
  openOrFocus: (url: string, options?: OpenOptions) => string;
  /**
   * Puts a page in a tab's place, whatever the tab showed, keeping where it
   * sits in the strip and whether it was up. Returns the page's tab, which
   * has an id of its own.
   */
  pageInPlaceOf: (tab: WindowTab, url: string) => StoreId.Session;
  /**
   * Reads the page on screen as it is at that moment, or the page in the tab
   * named, for a host drawing a tab of its own; undefined while there is
   * none.
   */
  readPage: (tabId?: string) => Promise<PageContext | undefined>;
  /**
   * Makes a page tab's guest again, at the page it last showed, without
   * showing the tab: after a launch a guest comes back only when its tab is
   * shown, and a task working in the tab needs it before then.
   */
  restore: (tabId: string) => boolean;
}

/**
 * A second place a page is drawn: a draft window's band, which shows the
 * draft's group's tabs itself, or a file tab drawing a page's file beside
 * its tree. The panel for that group's page is portaled into `into`, and
 * shown while `isActive`.
 */
export interface ComposeHost {
  /**
   * Whether the page's own bar is drawn over it, or, for a surface that draws
   * the window's address row over the page, the elements in that row the
   * page's reload and controls go into; a surface with a head of its own and
   * no row says no.
   */
  chrome?: boolean | PageChromeSlots;
  group: string;
  /** Drawn inside an overlay, whose own cover does not park the page; see TaskBrowserPanel. */
  insideOverlay?: boolean;
  into: HTMLElement | null;
  isActive: boolean;
  /** The window layer the guest is shown on, for a host inside a floating surface; the panel's own otherwise. */
  layer?: number;
  /** Where the host stands, so a page is placed again when the host moves without resizing. */
  place: string;
}

/** Where a page's reload and its controls go in an address row drawn over it. */
export interface PageChromeSlots {
  into: HTMLElement | null;
  reloadInto: HTMLElement | null;
}

/** What the page had on it that the words in a message can refer to. */
interface PageContext {
  /** The control the user's cursor is in, described: "the editor, after 'Prototype'". */
  focus?: string;
  selection?: string;
  /** The tab on screen, by the id a task can be handed. */
  tab?: string;
  tabs?: { id: string; title: string; url: string }[];
  text?: string;
  title: string;
  url: string;
}

/**
 * How much of the page goes with a message. The lead is enough to say what a
 * page is about; the page itself is for a task, which has a browser.
 */
const PAGE_TEXT_MAX = 1500;
const SELECTION_MAX = 2000;

const PageWordsSchema = z.object({
  focus: z.string(),
  selection: z.string(),
  text: z.string(),
});

/**
 * Runs in the page: what is selected, its text with the whitespace folded,
 * and where the cursor is. The focused control is described by what any
 * page says about itself (its role or tag, its label or placeholder, and the
 * words around the caret when it holds text), never by knowing the site.
 */
const READ_PAGE_WORDS = `(() => {
  const fold = (words) => String(words ?? "").replace(/\\s+/g, " ").trim();
  const describeFocus = () => {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return "";
    const kind =
      el.getAttribute("role") ||
      (el.isContentEditable ? "editor" : el.tagName.toLowerCase());
    const label = fold(
      el.getAttribute("aria-label") ||
        el.getAttribute("placeholder") ||
        el.getAttribute("title") ||
        el.getAttribute("name") ||
        (el.labels && el.labels[0] && el.labels[0].innerText) ||
        "",
    );
    let around = "";
    const selection = window.getSelection();
    if (el.isContentEditable && selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const block = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
      around = fold(block && block.innerText).slice(0, 160);
    } else if ("value" in el && typeof el.value === "string") {
      around = fold(el.value).slice(0, 160);
    }
    return (
      "the " + kind + (label ? ' "' + label.slice(0, 80) + '"' : "") +
      (around ? ", at the line \u201C" + around + "\u201D" : ", which is empty")
    );
  };
  return {
    focus: describeFocus(),
    selection: String(window.getSelection() ?? ""),
    text: fold(
      (document.querySelector("main, article, [role=main]") ?? document.body)?.innerText,
    ),
  };
})()`;

/** Where a page opens: in a tab's place, or in a named group. */
interface OpenOptions {
  /** The group the page belongs to; the group on screen when left out. */
  group?: string;
  replacing?: WindowTab;
  /** Brings the group on screen at the page, rather than leaving it behind: for what the user asked for by name. */
  show?: boolean;
}

type PageTabsUpdate = (current: {
  activeId: null | string;
  tabs: BrowserTab[];
}) => { activeId: null | string; tabs: BrowserTab[] };

/**
 * The window's pages: each page tab is a browser guest of the window's record,
 * like a task's browser and driven by the same machinery, so a task can be
 * handed one by id and drive it in the user's sight. The tabs themselves are
 * the window's, drawn by the window's strip; this holds their guests, keeps
 * each tab's title, address and icon as its page announces them, and shows
 * the guest of the tab on screen when that tab is a page. The page on screen
 * is the one the chat's own commands drive, and it rides along with
 * every message.
 */
export function BrowserTabs({
  chatOfTask,
  chromeInto,
  compose,
  onPageChange,
  ref,
  reloadInto,
}: {
  /**
   * The chat each task the conversation started was filed from, by its
   * session id, which is the group the task's browsing lands in; a task
   * filed outside any chat is in the map with no chat. A task not in
   * it is one the window has not read yet, since the list is polled while
   * a guest's arrival is live, and its guest waits for the next read rather
   * than landing in no group.
   */
  chatOfTask: ReadonlyMap<TaskId, string | undefined>;
  /** The element in the row above that the page's own bar is drawn into. */
  chromeInto?: HTMLElement | null;
  /** The draft windows' bands, one per draft up: each group's page is drawn in its own. */
  compose?: ComposeHost[];
  /** Told the page on screen whenever it changes, and undefined when none is. */
  onPageChange?: (page: BrowserPage | undefined) => void;
  ref: Ref<BrowserTabsHandle>;
  /** The element beside the row's arrows that the page's reload is drawn into. */
  reloadInto?: HTMLElement | null;
}) {
  const { taskId } = useWindow();
  const { navigateScreen } = useWindowTabs();
  const [{ activeByGroup, activeId, group, tabs: allTabs }, setAllTabs] =
    useAtom(windowTabsAtom);
  const everyTabId = useAtomValue(everyTabIdAtom);
  const tabs = allTabs.filter((tab) => tab.kind === "page");
  const setVisited = useSetAtom(visitedPagesAtom);
  const setRecents = useSetAtom(recentsAtom);
  const attached = useBrowserTargets();

  // Holds every tab's guest for as long as the window is open, the way the
  // task page holds its browser: subscribing is the hold.
  useQuery(
    rpcClient.workspace.browser.live.presence.experimental_liveOptions({
      input: { id: taskId, level: "retained" },
    }),
  );
  useQuery(
    rpcClient.workspace.browser.live.presence.experimental_liveOptions({
      input: { id: taskId, level: "visible" },
    }),
  );

  // A tab closed anywhere takes its guest with it. Each is asked for once:
  // the guest stays attached until the close lands.
  const closingGuests = useRef(new Set<BrowserTargetId>());
  useEffect(() => {
    const stray = strayWindowGuests({
      attached,
      heldIds: everyTabId,
      windowTaskId: taskId,
    });
    for (const target of closingGuests.current) {
      if (!attached.has(target)) {
        closingGuests.current.delete(target);
      }
    }
    for (const target of stray) {
      const decoded = decodeBrowserTargetId(target);
      if (!decoded || closingGuests.current.has(target)) {
        continue;
      }
      closingGuests.current.add(target);
      void rpcClient.workspace.browser.close
        .call({ id: decoded.id, sessionId: decoded.sessionId })
        .catch(() => {
          closingGuests.current.delete(target);
        });
    }
  }, [attached, everyTabId, taskId]);

  const targetOf = (tab: BrowserTab): BrowserTargetId =>
    encodeBrowserTargetId(
      tab.taskId ?? taskId,
      StoreId.SessionSchema.parse(tab.id),
    );
  const active = tabs.find((tab) => tab.id === activeId);

  // The chat's own browser is the tab on screen; a task's tab is the
  // task's to drive.
  const activeTarget = active && !active.taskId ? targetOf(active) : null;
  // Whether the guest on screen has been anywhere, for the arrows in the row
  // above it. Read from the guest rather than counted here: it is the thing
  // that has the history, and a redirect moves it without our being told.
  const [canStep, setCanStep] = useState({ back: false, forward: false });
  const historySteps = useRef(new Set<string>());
  const stepGuest = (direction: "back" | "forward") => {
    const webview = activeTarget && getWebviewElement(activeTarget);
    if (!webview) {
      return;
    }
    if (active) {
      historySteps.current.add(active.id);
      setAllTabs((current) => ({
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.kind === "page" && tab.id === active.id && tab.future?.length
            ? {
                ...tab,
                pageBackSteps: Math.max(
                  0,
                  (tab.pageBackSteps ?? 0) + (direction === "back" ? 1 : -1),
                ),
              }
            : tab,
        ),
      }));
    }
    if (direction === "back") {
      webview.goBack();
    } else {
      webview.goForward();
    }
  };
  // A tab arriving on screen brings its own history with it, so what the
  // arrows say has to be re-read rather than left as the last tab's answer.
  useEffect(() => {
    const webview = activeTarget && getWebviewElement(activeTarget);
    if (!webview) {
      setCanStep({ back: false, forward: false });
      return;
    }
    try {
      setCanStep({
        back: webview.canGoBack(),
        forward: webview.canGoForward(),
      });
    } catch {
      // Not attached yet; the navigation events do this once it is.
    }
  }, [activeTarget]);
  useEffect(() => {
    void rpcClient.workspace.window.setActiveTab.call({
      id: taskId,
      targetId: activeTarget,
    });
  }, [activeTarget, taskId]);

  // The tabs a launch restored, taken once: only these are sent back to the
  // page they held, and a tab opened later is navigated by its own open.
  const bootTabIds = useRef<null | Set<string>>(null);
  bootTabIds.current ??= new Set(allTabs.map((tab) => tab.id));
  // Each restored tab is opened at most once, the first time it comes up.
  const restored = useRef(new Set<string>());
  const activeUrl = active?.url;
  // A tab that comes back after a launch opens where it was: the workspace
  // recreates the guest blank and this sends it to the page it last held,
  // once, the first time the tab is shown. Shown means up in the window or
  // handed back by `openOrFocus`, which is how a page drawn inside another
  // screen (a file tab's page, Quick Look, a popped-out chat) comes up
  // without ever being the window's active tab. Keyed on the tab coming up
  // rather than on its guest being absent, because a local file's guest
  // attaches to about:blank so fast it is already there when this runs.
  const restoreOnce = (
    tab: { id: string; taskId?: TaskId; url?: string },
    { orphaned = false }: { orphaned?: boolean } = {},
  ) => {
    if (
      !tab.url ||
      tab.url === "about:blank" ||
      !(orphaned || bootTabIds.current?.has(tab.id)) ||
      restored.current.has(tab.id)
    ) {
      return;
    }
    restored.current.add(tab.id);
    // A recreated guest has no native history from the preceding launch.
    setAllTabs((current) => ({
      ...current,
      tabs: current.tabs.map((entry) =>
        entry.id === tab.id ? { ...entry, pageBackSteps: 0 } : entry,
      ),
    }));
    void rpcClient.workspace.browser.open.call({
      id: tab.taskId ?? taskId,
      sessionId: StoreId.SessionSchema.parse(tab.id),
      url: tab.url,
    });
  };
  useEffect(() => {
    if (active) {
      restoreOnce(active);
    }
    // Fired once per restored tab, when it first comes up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, activeUrl, taskId]);
  // A tab whose page is gone while the tab stays, such as a task's page after
  // the task's browser closed, comes up with nothing to draw it, and reload
  // and the address field have nothing to act on. Given a moment to attach,
  // one still without a guest is opened again where it was, once.
  const isActiveAttached = active ? attached.has(targetOf(active)) : false;
  useEffect(() => {
    if (!active || isActiveAttached) {
      return;
    }
    const timer = window.setTimeout(() => {
      restoreOnce(active, { orphaned: true });
    }, ORPHAN_GRACE_MS);
    return () => {
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, isActiveAttached, taskId]);

  // The strip as it is at any moment, for the handle below and the listeners,
  // both of which are made once and read it when called.
  const latest = useRef({ active, activeByGroup, allTabs, group, tabs });
  useEffect(() => {
    latest.current = { active, activeByGroup, allTabs, group, tabs };
  });

  // A task browsing in a guest of its own (one filed outside any chat, since
  // a chat's tasks browse in tabs of the chat) is mounted in this window, and
  // the moment one attaches it gets a tab in its chat's list, behind
  // whatever is up: the user finds it there when they want to watch, and
  // nothing moves under them. Only a guest arriving is a tab to add: one the
  // user closed is still attached until the close lands, and must not come
  // straight back.
  const seenTargets = useRef(new Set<BrowserTargetId>());
  useEffect(() => {
    const arrived = [...attached].filter(
      (target) => !seenTargets.current.has(target),
    );
    // A guest whose task the window has not read yet is not seen: it is
    // still arriving, and is placed by the read that names its chat.
    const waiting = new Set<BrowserTargetId>();
    const newcomers = arrived.flatMap((target) => {
      const decoded = decodeBrowserTargetId(target);
      // Checked against every visit the window holds, not only the tabs on the
      // strip: a task browsing behind a screen already has one.
      if (
        !decoded ||
        decoded.id === taskId ||
        everyTabId.has(decoded.sessionId)
      ) {
        return [];
      }
      if (!chatOfTask.has(decoded.id)) {
        waiting.add(target);
        return [];
      }
      return [
        {
          id: decoded.sessionId,
          openedAt: Date.now(),
          taskId: decoded.id,
        } satisfies BrowserTab,
      ];
    });
    seenTargets.current = new Set(
      [...attached].filter((target) => !waiting.has(target)),
    );
    if (newcomers.length === 0) {
      return;
    }
    // In the group of the chat the task was filed from, so a task's
    // browsing stays with its chat; a task filed outside any chat
    // browses among the window's own tabs.
    const arriving = newcomers.map((tab) => ({
      ...tab,
      group: chatOfTask.get(tab.taskId),
      kind: "page" as const,
    }));
    setAllTabs((current) => ({
      ...current,
      tabs: [...current.tabs, ...arriving],
    }));
  }, [attached, everyTabId, setAllTabs, taskId, chatOfTask]);

  // Titles, addresses and icons come off the guests as the pages announce
  // them: the pages navigate by the user's hand and by an agent's, so the
  // strip is told rather than polled. Listeners are put on each guest once it
  // has attached, and again for a tab that arrives later.
  const tabIds = tabs.map((tab) => `${tab.taskId ?? ""}:${tab.id}`).join(",");
  useEffect(() => {
    const patch = (id: string, changes: Partial<BrowserTab>) => {
      setAllTabs(
        withPageTabs((current) => {
          const tab = current.tabs.find((entry) => entry.id === id);
          if (
            !tab ||
            Object.entries(changes).every(
              ([key, value]) => tab[key as keyof BrowserTab] === value,
            )
          ) {
            return current;
          }
          return {
            ...current,
            tabs: current.tabs.map((entry) =>
              entry.id === id ? { ...entry, ...changes } : entry,
            ),
          };
        }),
      );
    };
    const cleanups = tabIds.split(",").map((key) => {
      const [owner, id] = key.split(":");
      if (!id) {
        return;
      }
      const target = encodeBrowserTargetId(
        owner ? (owner as TaskId) : taskId,
        StoreId.SessionSchema.parse(id),
      );
      if (!attached.has(target)) {
        return;
      }
      const webview = getWebviewElement(target);
      if (!webview) {
        return;
      }
      const onNavigate = () => {
        try {
          if (latest.current.active?.id === id) {
            setCanStep({
              back: webview.canGoBack(),
              forward: webview.canGoForward(),
            });
          }
          const url = webview.getURL();
          // A page's file in Edit is loaded at the file's address with the
          // Edit parameter added; the tab is still at the file.
          if (isPageEditAddress(url)) {
            return;
          }
          const isHistoryStep = historySteps.current.delete(id);
          if (
            !isHistoryStep &&
            url !== latest.current.tabs.find((tab) => tab.id === id)?.url
          ) {
            setAllTabs((current) => ({
              ...current,
              tabs: current.tabs.map((tab) =>
                tab.id === id ? { ...tab, future: [], pageBackSteps: 0 } : tab,
              ),
            }));
          }
          if (url && url !== "about:blank") {
            const title = webview.getTitle() || undefined;
            const was = latest.current.tabs.find((tab) => tab.id === id)?.url;
            patch(id, {
              title,
              url,
              // A page on another site lets go of the last one's icon at
              // once, so the tab wears the new site's straight away (from
              // the site-icon cache) rather than the old page's until the
              // new one announces its own.
              ...(originOf(was) === originOf(url) && was?.startsWith("http")
                ? {}
                : { favicon: undefined }),
            });
            const filePath = hostPathOfFileUrl(url);
            if (filePath === undefined) {
              // The new-tab page lists where the browser has been.
              setVisited((current) =>
                [
                  { at: Date.now(), title: title ?? "", url },
                  ...current.filter((page) => page.url !== url),
                ].slice(0, VISITED_MAX),
              );
            } else {
              // A file shown as a page was a file the user opened, and it
              // comes back as one: by the address a file tab opens at, which
              // shows it as a page again.
              const href = fileHref(filePath);
              setRecents((current) =>
                [
                  {
                    at: Date.now(),
                    href,
                    kind: "file" as const,
                    title: segmentsOf(filePath).at(-1) ?? filePath,
                  },
                  ...current.filter((recent) => recent.href !== href),
                ].slice(0, RECENTS_MAX),
              );
            }
          }
        } catch {
          // Not attached yet; the events that follow attachment re-run this.
        }
      };
      // A local page's own `history.pushState` moves its address without
      // loading anything, and every `file://` page shares one origin, so the
      // address it names can be any file on the computer. The tab stays at
      // the file the page loaded: the new address is never kept, shown as
      // the file, or loaded for real, and Edit never opens the file it names.
      const onNavigateInPage = () => {
        try {
          if (hostPathOfFileUrl(webview.getURL()) === undefined) {
            onNavigate();
            return;
          }
          if (latest.current.active?.id === id) {
            setCanStep({
              back: webview.canGoBack(),
              forward: webview.canGoForward(),
            });
          }
        } catch {
          // Not attached yet; the events that follow attachment re-run this.
        }
      };
      const onTitle = (event: Event) => {
        const { title } = event as Event & { title?: string };
        if (title) {
          patch(id, { title });
          const url = latest.current.tabs.find((tab) => tab.id === id)?.url;
          if (url) {
            setVisited((current) =>
              current.map((page) =>
                page.url === url ? { ...page, title } : page,
              ),
            );
          }
        }
      };
      const onFavicon = (event: Event) => {
        const { favicons } = event as Event & { favicons?: string[] };
        const favicon = favicons?.[0];
        patch(id, { favicon });
        if (!favicon) {
          return;
        }
        // Under the page the tab is on now, and nothing else: a tab that
        // wandered off a visited page must not hand it the icon of wherever
        // it went.
        let url: string | undefined;
        try {
          url = webview.getURL();
        } catch {
          url = latest.current.tabs.find((entry) => entry.id === id)?.url;
        }
        if (originOf(url)) {
          setVisited((current) =>
            current.map((page) =>
              page.url === url ? { ...page, favicon } : page,
            ),
          );
          // The site's own icon, kept for it where the favicon proxy has
          // none; only for a page opened here, never one merely named.
          const pageUrl = url;
          if (pageUrl !== undefined) {
            void rpcClient.browser.rememberPageIcon
              .call({ iconUrl: favicon, pageUrl })
              .then(({ stored }) => {
                if (stored) {
                  forgetIconlessThisSession(pageUrl);
                }
              })
              .catch(() => null);
          }
        }
      };
      onNavigate();
      webview.addEventListener("did-navigate", onNavigate);
      webview.addEventListener("did-navigate-in-page", onNavigateInPage);
      webview.addEventListener("page-title-updated", onTitle);
      webview.addEventListener("page-favicon-updated", onFavicon);
      return () => {
        webview.removeEventListener("did-navigate", onNavigate);
        webview.removeEventListener("did-navigate-in-page", onNavigateInPage);
        webview.removeEventListener("page-title-updated", onTitle);
        webview.removeEventListener("page-favicon-updated", onFavicon);
      };
    });
    return () => {
      for (const cleanup of cleanups) {
        cleanup?.();
      }
    };
  }, [attached, setAllTabs, setRecents, setVisited, tabIds, taskId]);

  const activePage: BrowserPage | undefined = active?.url
    ? {
        ...(active.favicon ? { favicon: active.favicon } : {}),
        title: active.title ?? "",
        url: active.url,
      }
    : undefined;
  useEffect(() => {
    onPageChange?.(activePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage?.favicon, activePage?.title, activePage?.url]);

  /**
   * The new-tab page a group has up, when that is what it has up: the tab
   * it last showed, or its first, the way the group comes on screen.
   */
  const newTabUpIn = (key: string): undefined | WindowTab => {
    const own = latest.current.allTabs.filter((tab) => tab.group === key);
    const remembered = latest.current.activeByGroup?.[key];
    const up = own.find((tab) => tab.id === remembered) ?? own[0];
    return up && isHomeTab(up) ? up : undefined;
  };

  const openTab = (
    url?: string,
    { group: into, replacing }: OpenOptions = {},
  ) => {
    const id = StoreId.newSessionId();
    const page = {
      id,
      openedAt: Date.now(),
      ...(url ? { openedUrl: url, url } : {}),
    };
    if (replacing) {
      // In the replaced tab's place and under its strip key, so the strip
      // sees a tab change rather than one leave and another arrive: a new
      // tab becoming the page that was typed into it.
      setAllTabs((current) => {
        const index = current.tabs.findIndex((tab) => tab.id === replacing.id);
        const tab = visitInTab(replacing, {
          ...page,
          kind: "page",
        });
        // On screen, the page is what is up; in a group waiting behind, it
        // is what that group has up when it next comes on screen.
        const waitingIn =
          replacing.group === current.group ? undefined : replacing.group;
        return {
          ...current,
          ...(waitingIn === undefined
            ? { activeId: id }
            : {
                activeByGroup: { ...current.activeByGroup, [waitingIn]: id },
              }),
          tabs:
            index === -1
              ? [...current.tabs, tab]
              : [
                  ...current.tabs.slice(0, index),
                  tab,
                  ...current.tabs.slice(index + 1),
                ],
        };
      });
    } else {
      // In the group on screen, or the group asked for: a page opened while
      // a chat is up is the chat's, and one a chat asked for while
      // another was up is still that chat's, waiting behind.
      setAllTabs((current) => ({
        ...current,
        activeId:
          into === undefined || into === current.group ? id : current.activeId,
        tabs: [
          ...current.tabs,
          {
            ...page,
            group: into ?? current.group,
            kind: "page",
            past: [
              {
                href: newTabHrefOf(into ?? current.group),
                id: `screen-${crypto.randomUUID()}`,
                kind: "screen",
              },
            ],
          },
        ],
      }));
    }
    void rpcClient.workspace.browser.open.call({
      id: taskId,
      sessionId: StoreId.SessionSchema.parse(id),
      ...(url ? { url } : {}),
    });
    return id;
  };

  useImperativeHandle(
    ref,
    () => ({
      canGoBack: canStep.back,
      canGoForward: canStep.forward,
      goBack: () => {
        stepGuest("back");
      },
      goForward: () => {
        stepGuest("forward");
      },
      navigate: (url) => {
        const webview = activeTarget && getWebviewElement(activeTarget);
        if (webview) {
          setAllTabs((current) => ({
            ...current,
            tabs: current.tabs.map((tab) =>
              tab.id === current.activeId
                ? { ...tab, future: [], pageBackSteps: 0 }
                : tab,
            ),
          }));
          void webview.loadURL(url);
        }
      },
      navigateTab: (tabId, url) => {
        const tab = latest.current.allTabs.find(
          (entry): entry is Extract<WindowTab, { kind: "page" }> =>
            entry.kind === "page" && entry.id === tabId,
        );
        if (!tab) {
          return;
        }
        setAllTabs((current) => ({
          ...current,
          tabs: current.tabs.map((entry) =>
            entry.id === tabId ? { ...entry, future: [], url } : entry,
          ),
        }));
        const webview = getWebviewElement(targetOf(tab));
        if (webview) {
          void webview.loadURL(url);
          return;
        }
        void rpcClient.workspace.browser.open.call({
          id: tab.taskId ?? taskId,
          sessionId: StoreId.SessionSchema.parse(tab.id),
          url,
        });
      },
      open: (url, options) => openTab(url, options),
      openBehind: (url, into) => {
        const id = StoreId.newSessionId();
        setAllTabs((current) => ({
          ...current,
          tabs: [
            ...current.tabs,
            {
              group: into,
              id,
              kind: "page",
              openedAt: Date.now(),
              ...(url ? { openedUrl: url, url } : {}),
            },
          ],
        }));
        void rpcClient.workspace.browser.open.call({
          id: taskId,
          sessionId: id,
          ...(url ? { url } : {}),
        });
        return id;
      },
      openOrFocus: (url, options) => {
        const key = options?.group ?? latest.current.group;
        // A file has one tab per place, the way it has one tab in Files; a
        // website gets a tab every time it is asked for, however many are
        // already open at that address. Among the group's own: another
        // chat's tab on the file is that chat's, and a task's tab is the
        // task's, driving where the task drives it.
        const atFile =
          hostPathOfFileUrl(url) === undefined
            ? undefined
            : latest.current.tabs.find(
                (tab) =>
                  tab.group === key && !tab.taskId && sameAddress(tab.url, url),
              );
        if (atFile) {
          restoreOnce(atFile);
          if (options?.show || key === latest.current.group) {
            setAllTabs((current) => selectTab(current, atFile.id));
          }
          return atFile.id;
        }
        // A group waiting behind with its new tab up gets the page in that
        // tab, the way the group on screen does: the tab that was there to
        // be told where to go is told, rather than left beside the page.
        const fresh =
          key === undefined || key === latest.current.group
            ? undefined
            : newTabUpIn(key);
        const id = openTab(
          url,
          fresh ? { ...options, replacing: fresh } : options,
        );
        if (options?.show) {
          setAllTabs((current) => selectTab(current, id));
        }
        return id;
      },
      pageInPlaceOf: (tab, url) => {
        const id = StoreId.newSessionId();
        const page = visitInTab(tab, {
          id,
          kind: "page",
          openedAt: Date.now(),
          openedUrl: url,
          url,
        });
        setAllTabs((current) => ({
          ...current,
          activeByGroup:
            tab.group !== undefined &&
            current.activeByGroup?.[tab.group] === tab.id
              ? { ...current.activeByGroup, [tab.group]: id }
              : current.activeByGroup,
          activeId: current.activeId === tab.id ? id : current.activeId,
          tabs: current.tabs.map((entry) =>
            entry.id === tab.id ? page : entry,
          ),
        }));
        void rpcClient.workspace.browser.open.call({
          id: taskId,
          sessionId: id,
          url,
        });
        return id;
      },
      readPage: async (tabId) => {
        const { active: shown, tabs: all } = latest.current;
        const current =
          tabId === undefined ? shown : all.find((tab) => tab.id === tabId);
        if (!current) {
          return;
        }
        const webview = getWebviewElement(targetOf(current));
        let url: string | undefined;
        let title = current.title ?? "";
        try {
          url = webview?.getURL();
          title = webview?.getTitle() || title;
        } catch {
          // Not attached: what the tab remembers of the page is the answer.
        }
        if (!url || url === "about:blank") {
          url = current.url;
        }
        if (!url) {
          return;
        }
        // The tabs a task can be handed: the group's own, since a note is
        // written for the chat that is up (or the draft being written) and
        // another chat's tab is that chat's; a task's tab is already that
        // task's.
        const groupKey =
          tabId === undefined ? latest.current.group : current.group;
        const own = all.filter((tab) => tab.group === groupKey && !tab.taskId);
        const base: PageContext = {
          ...(current.taskId ? {} : { tab: current.id }),
          tabs: own.map((tab) => ({
            id: tab.id,
            title: tab.title ?? "",
            url: tab.url ?? "",
          })),
          title,
          url,
        };
        if (!webview) {
          return base;
        }
        let raw: unknown;
        try {
          raw = await webview.executeJavaScript(READ_PAGE_WORDS);
        } catch {
          // A page mid-navigation, or one that blocks scripts: its address and
          // title still say what the user was looking at.
          return base;
        }
        const words = PageWordsSchema.safeParse(raw);
        if (!words.success) {
          return base;
        }
        const selection = words.data.selection.trim().slice(0, SELECTION_MAX);
        const text = words.data.text.slice(0, PAGE_TEXT_MAX);
        const { focus } = words.data;
        return {
          ...base,
          ...(focus ? { focus } : {}),
          ...(selection ? { selection } : {}),
          ...(text ? { text } : {}),
        };
      },
      restore: (tabId) => {
        const tab = latest.current.allTabs.find(
          (entry): entry is Extract<WindowTab, { kind: "page" }> =>
            entry.kind === "page" && entry.id === tabId,
        );
        if (!tab) {
          return false;
        }
        void rpcClient.workspace.browser.open.call({
          id: tab.taskId ?? taskId,
          sessionId: StoreId.SessionSchema.parse(tab.id),
          ...(tab.url && tab.url !== "about:blank" ? { url: tab.url } : {}),
        });
        return true;
      },
    }),
    // The handle reads the strip through `latest` at call time; the guest on
    // screen and what its history allows are read here, so the handle is
    // remade, and the row above told, whenever either changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taskId, activeTarget, canStep],
  );

  const taskIdsWithTabs = [
    ...new Set(
      allTabs
        .flatMap((tab) => [tab, ...(tab.past ?? []), ...(tab.future ?? [])])
        .flatMap((visit) =>
          visit.kind === "page" && visit.taskId ? [visit.taskId] : [],
        ),
    ),
  ];

  // A file shown as a page has its text a step away, which the page's menu
  // offers; a site's page has nothing here to show that way.
  const activeFilePath = hostPathOfFileUrl(active?.url);
  // A page's file can be edited in place, from its tab.
  const editTabs = useAtomValue(pageEditTabsAtom);
  const setEditTabs = useSetAtom(pageEditTabsAtom);
  const editableId = active && isEditablePage(active) ? active.id : undefined;
  // Edit lasts while its tab is open on an HTML file: a tab that closes, or
  // goes on to a picture, a PDF or a site, is out of it.
  const editableKey = tabs
    .filter((tab) => isEditablePage(tab))
    .map((tab) => tab.id)
    .join(",");
  useEffect(() => {
    const keep = new Set(editableKey.split(","));
    setEditTabs((current) =>
      Object.keys(current).every((id) => keep.has(id))
        ? current
        : Object.fromEntries(
            Object.entries(current).filter(([id]) => keep.has(id)),
          ),
    );
  }, [editableKey, setEditTabs]);
  usePageEditToggleOnScreen(
    editableId === undefined
      ? null
      : () => {
          setEditTabs((current) => {
            const { [editableId]: was, ...rest } = current;
            return was ? rest : { ...rest, [editableId]: true };
          });
        },
  );

  return (
    <div className="relative h-full min-h-0">
      {taskIdsWithTabs.map((id) => (
        <BrowserHold key={id} taskId={id} />
      ))}
      {tabs.flatMap((tab) => {
        const filePath = hostPathOfFileUrl(tab.url);
        return filePath === undefined
          ? []
          : [
              editTabs[tab.id] && isEditablePage(tab) ? (
                <PageEditSession
                  isShown={tab.id === active?.id}
                  key={tab.id}
                  path={filePath}
                  tabId={tab.id}
                  target={targetOf(tab)}
                />
              ) : (
                <FilePageReload
                  key={tab.id}
                  path={filePath}
                  target={targetOf(tab)}
                />
              ),
            ];
      })}
      {active ? (
        <TaskBrowserPanel
          active={attached.has(targetOf(active))}
          chrome={{ into: chromeInto ?? null, reloadInto: reloadInto ?? null }}
          // Square and flat, like the pane it fills: a page not drawn yet
          // shows the panel, and a card inset in the pane reads as a frame.
          className="h-full rounded-none shadow-none"
          key={active.id}
          {...(editableId === undefined
            ? {}
            : {
                // A page's file asks about itself the way every file tab
                // does, beside the Edit control.
                pageControls: (
                  <>
                    <PageEditToggle tabId={editableId} />
                    {activeFilePath !== undefined && (
                      <FileAskButton
                        name={
                          segmentsOf(activeFilePath).at(-1) ?? activeFilePath
                        }
                        path={activeFilePath}
                      />
                    )}
                  </>
                ),
              })}
          {...(activeFilePath === undefined
            ? {}
            : {
                // The tab itself turns to the file's text, the way it turns
                // back to the page from there, once the page's editor has
                // written what it holds.
                onEditSource: () => {
                  void flushFileWrites(activeFilePath).then(() => {
                    navigateScreen(fileHref(activeFilePath, { source: true }));
                  });
                },
              })}
          sessionId={StoreId.SessionSchema.parse(active.id)}
          taskId={active.taskId ?? taskId}
        />
      ) : null}
      {/* A page's file keeps its asks at its foot while viewed; in Edit the
          page's own dock holds them. */}
      {activeFilePath !== undefined && !(active && editTabs[active.id]) && (
        <AskTray path={activeFilePath} />
      )}
      {compose?.map((host) => {
        // The page the draft window has up, when what it has up is a page:
        // the tab its group remembers, or its first.
        const own = allTabs.filter((tab) => tab.group === host.group);
        const up =
          own.find((tab) => tab.id === activeByGroup?.[host.group]) ?? own[0];
        return up?.kind === "page" ? (
          <ComposePagePanel
            attached={attached.has(targetOf(up))}
            host={host}
            key={host.group}
            onReopen={() => {
              // A recreated guest has no native history from the preceding
              // launch.
              setAllTabs((current) => ({
                ...current,
                tabs: current.tabs.map((tab) =>
                  tab.id === up.id ? { ...tab, pageBackSteps: 0 } : tab,
                ),
              }));
            }}
            tab={up}
            taskId={taskId}
          />
        ) : null;
      })}
    </div>
  );
}

export function TabIcon({
  favicon,
  url,
}: {
  favicon: string | undefined;
  url: string | undefined;
}) {
  // A page of a file on the computer wears the file's type, the way the
  // file does everywhere else; anything else is a page of the web.
  const filePath = hostPathOfFileUrl(url);
  if (filePath !== undefined) {
    return (
      <FileTypeIcon
        className="size-3.5"
        fileName={segmentsOf(filePath).at(-1) ?? filePath}
      />
    );
  }
  return <PageFavicon className="size-3.5" favicon={favicon} url={url} />;
}

/**
 * Holds a task's browser for as long as the window has a tab of it: the task
 * page's leases, taken here instead, since the page for a task the
 * conversation started is never open.
 */
function BrowserHold({ taskId }: { taskId: TaskId }) {
  useQuery(
    rpcClient.workspace.browser.live.presence.experimental_liveOptions({
      input: { id: taskId, level: "retained" },
    }),
  );
  useQuery(
    rpcClient.workspace.browser.live.presence.experimental_liveOptions({
      input: { id: taskId, level: "visible" },
    }),
  );
  return null;
}

/**
 * A draft window's page, drawn into its band with the browser's own bar,
 * since the band has no row above it to carry the address. Under a provider
 * of its own, since the pane around the strip is inactive while a draft
 * window is up. The page comes back after a launch the way the pane's does:
 * the panel opens the guest, and this reopens it at the page the tab
 * remembers.
 */
function ComposePagePanel({
  attached,
  host,
  onReopen,
  tab,
  taskId,
}: {
  attached: boolean;
  host: ComposeHost;
  onReopen: () => void;
  tab: BrowserTab;
  taskId: TaskId;
}) {
  const url = tab.url;
  useEffect(() => {
    if (attached || !url) {
      return;
    }
    onReopen();
    void rpcClient.workspace.browser.open.call({
      id: tab.taskId ?? taskId,
      sessionId: StoreId.SessionSchema.parse(tab.id),
      url,
    });
    // Once per tab coming back, not per render while it attaches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, taskId]);
  if (!host.into) {
    return null;
  }
  return createPortal(
    <ActiveTabProvider isActive={host.isActive}>
      <TaskBrowserPanel
        active={attached}
        chrome={host.chrome ?? true}
        className="h-full rounded-none shadow-none"
        // The draft's words keep the caret; the bar is read, not typed into,
        // when a site arrives from the band.
        focusAddress={false}
        insideOverlay={host.insideOverlay ?? false}
        key={tab.id}
        {...(host.layer === undefined ? {} : { layer: host.layer })}
        relayoutKey={host.place}
        sessionId={StoreId.SessionSchema.parse(tab.id)}
        taskId={tab.taskId ?? taskId}
      />
    </ActiveTabProvider>,
    host.into,
  );
}

/**
 * Keeps a page tab showing a file on this computer at the file as it is: the
 * file is watched for as long as the tab is open, and the guest reloads when
 * it is written, so an edit landing in the file shows the way it would in a
 * viewer of it rather than waiting for the person to reload.
 */
function FilePageReload({
  path,
  target,
}: {
  path: string;
  target: BrowserTargetId;
}) {
  const watched = useQuery(
    rpcClient.files.live.info.experimental_liveOptions({ input: { path } }),
  );
  const modifiedAt = watched.data?.modifiedAt;
  // The version the guest is showing. The first the watch reports is taken as
  // that one, since the guest loaded the file on its own; a missing file is
  // left as it was shown, so a save that replaces the file is one reload.
  const shown = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (modifiedAt === undefined) {
      return;
    }
    if (shown.current !== undefined && shown.current !== modifiedAt) {
      const webview = getWebviewElement(target);
      try {
        webview?.reload();
      } catch {
        // A guest not yet attached and ready refuses a reload, and needs
        // none: its first load, still to come or under way, reads the file
        // as it is. A change reported that early is a cached version from
        // an earlier visit being brought up to date.
      }
    }
    shown.current = modifiedAt;
  }, [modifiedAt, target]);
  return null;
}

/** A page tab of the window's own on an HTML file, which Edit can change in place. */
function isEditablePage(tab: BrowserTab) {
  const filePath = hostPathOfFileUrl(tab.url);
  return (
    !tab.taskId &&
    filePath !== undefined &&
    getFileType({ filename: filePath }) === "html"
  );
}

/** Two addresses are the same tab when they differ only by a trailing slash or a fragment. */
function sameAddress(a: string | undefined, b: string) {
  return a !== undefined && trimAddress(a) === trimAddress(b);
}

function trimAddress(url: string) {
  return url.replace(/#.*$/, "").replace(/\/+$/, "");
}

/**
 * An update to the page tabs, applied to the window's list: the pages are
 * taken out, changed, and put back where they were, with any new one at the
 * end and the screens untouched.
 */
function withPageTabs(update: PageTabsUpdate) {
  return (current: WindowTabs): WindowTabs => {
    const pages = current.tabs.filter((tab) => tab.kind === "page");
    const next = update({ activeId: current.activeId, tabs: pages });
    const byId = new Map(next.tabs.map((tab) => [tab.id, tab]));
    const merged: WindowTab[] = [];
    for (const tab of current.tabs) {
      if (tab.kind !== "page") {
        merged.push(tab);
        continue;
      }
      const updated = byId.get(tab.id);
      if (updated) {
        merged.push({ ...updated, kind: "page" });
      }
    }
    for (const tab of next.tabs) {
      if (!current.tabs.some((entry) => entry.id === tab.id)) {
        merged.push({ ...tab, kind: "page" });
      }
    }
    return { ...current, activeId: next.activeId, tabs: merged };
  };
}
