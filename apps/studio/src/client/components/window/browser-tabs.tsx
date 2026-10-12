import {
  type BrowserTab,
  originOf,
  type WindowTab,
} from "@/client/atoms/window";
import { FileTypeIcon } from "@/client/components/extend/file-system";
import { PageFavicon } from "@/client/components/favicon";
import { BrowserPanel } from "@/client/components/window/browser-panel";
import { ActiveTabProvider } from "@/client/hooks/use-active-tab";
import { useBrowserTargets } from "@/client/hooks/use-browser-targets";
import { getGuest, takeGuestTraversal } from "@/client/lib/browser-pool";
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
  type ChatId,
  WINDOW_ID,
} from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { createPortal } from "react-dom";
import { z } from "zod";

import { AskTray } from "./ask-tray";
import { FileAskButton } from "./file-ask-button";
import { segmentsOf } from "./host-path";
import { PageEditSession, PageEditToggle } from "./page-edit";
import { pageEditTabsAtom, usePageEditToggleOnScreen } from "./page-edit-state";
import { EMPTY_GUEST_MEMO, reconcileGuests } from "./reconcile-guests";
import { visitInTab } from "./tab-history";
import {
  addPages,
  isHomeTab,
  openPage as openPageIn,
  type PageTab,
  pageNavigated,
  patchPage,
  replaceTab,
  selectTab,
  selectedTabIn,
} from "./tab-model";
import {
  everyTabIdAtom,
  newScreenId,
  useWindowTabs,
  useWindowTabsChange,
} from "./window-tabs";

export interface BrowserPage {
  favicon?: string;
  title: string;
  url: string;
}

export interface BrowserTabsHandle {
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
   * The whole text of the page in a page tab, as the person sees it, or
   * undefined when the tab has no live page to read.
   */
  readPageText: (tabId: string) => Promise<string | undefined>;
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
  /** Drawn inside an overlay, whose own cover does not park the page; see BrowserPanel. */
  insideOverlay?: boolean;
  into: HTMLElement | null;
  isActive: boolean;
  /** The window layer the guest is shown on, for a host inside a floating surface; the panel's own otherwise. */
  layer?: number;
  /** Where the host stands, so a page is placed again when the host moves without resizing. */
  place: string;
  /** The tab drawn, for a host showing one of its group's tabs that is not the one the group has up: a floating chat's peek. */
  tabId?: string;
}

/** Where a page's reload and its controls go in an address row drawn over it. */
export interface PageChromeSlots {
  /** Inside the address field, at its end: the page's zoom while it is not 100%. */
  fieldInto: HTMLElement | null;
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
  title: string;
  url: string;
}

/** How much of what is selected goes with a message. */
const SELECTION_MAX = 2000;

/** The most of a page `tab read` hands back, which bounds what crosses to the sandbox. */
const PAGE_TEXT_MAX = 200_000;

const PageWordsSchema = z.object({
  focus: z.string(),
  selection: z.string(),
});

/** Runs in the page: its text as rendered, lines kept. */
const READ_PAGE_TEXT = `String(document.body?.innerText ?? "")`;

/**
 * Runs in the page: what is selected and where the cursor is. The focused
 * control is described by what any page says about itself (its role or tag,
 * its label or placeholder, and the words around the caret when it holds
 * text), never by knowing the site.
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

/**
 * The window's pages: each page tab is a browser guest of the window's own,
 * like a task's browser and driven by the same machinery, so a task can be
 * handed one by id and drive it in the user's sight. The tabs themselves are
 * the window's, drawn by the window's strip; this holds their guests, keeps
 * each tab's title, address and icon as its page announces them, and shows
 * the guest of the tab on screen when that tab is a page. The page on screen
 * is the one the chat's own commands drive, and it rides along with
 * every message.
 */
export function BrowserTabs({
  chromeInto,
  compose,
  fieldInto,
  onPageChange,
  ref,
  reloadInto,
}: {
  /** The element in the row above that the page's own bar is drawn into. */
  chromeInto?: HTMLElement | null;
  /** The draft windows' bands, one per draft up: each group's page is drawn in its own. */
  compose?: ComposeHost[];
  /** The element inside the row's address field that the page's state is drawn into. */
  fieldInto?: HTMLElement | null;
  /** Told the page on screen whenever it changes, and undefined when none is. */
  onPageChange?: (page: BrowserPage | undefined) => void;
  ref: Ref<BrowserTabsHandle>;
  /** The element beside the row's arrows that the page's reload is drawn into. */
  reloadInto?: HTMLElement | null;
}) {
  const windowTabs = useWindowTabs();
  const { activeByGroup, allTabs, groupOnScreen, navigateScreen } = windowTabs;
  const change = useWindowTabsChange();
  const everyTabId = useAtomValue(everyTabIdAtom);
  const tabs = allTabs.filter((tab): tab is PageTab => tab.kind === "page");
  const attached = useBrowserTargets();
  // Holds every tab's guest for as long as the window is open, the way the
  // task page holds its browser: subscribing is the hold.
  useQuery(
    rpcClient.workspace.browser.live.presence.experimental_liveOptions({
      input: { id: WINDOW_ID, level: "retained" },
    }),
  );
  useQuery(
    rpcClient.workspace.browser.live.presence.experimental_liveOptions({
      input: { id: WINDOW_ID, level: "visible" },
    }),
  );

  const targetOf = (tab: BrowserTab): BrowserTargetId =>
    encodeBrowserTargetId(WINDOW_ID, StoreId.SessionSchema.parse(tab.id));
  // The page the group on screen has up, when what it has up is a page.
  const up = windowTabs.active;
  const active = up?.kind === "page" ? up : undefined;
  const activeTarget = active ? targetOf(active) : null;

  // The strip as it is at any moment, for the handle below and the listeners,
  // both of which are made once and read it when called.
  const latest = useRef({
    active,
    activeByGroup,
    allTabs,
    group: groupOnScreen,
    tabs,
  });
  useEffect(() => {
    latest.current = {
      active,
      activeByGroup,
      allTabs,
      group: groupOnScreen,
      tabs,
    };
  });

  // A tab closed anywhere takes its guest with it.
  const guestMemo = useRef(EMPTY_GUEST_MEMO);
  useEffect(() => {
    const { close, memo } = reconcileGuests({
      attached,
      heldIds: everyTabId,
      memo: guestMemo.current,
    });
    guestMemo.current = memo;
    for (const target of close) {
      const decoded = decodeBrowserTargetId(target);
      if (!decoded) {
        continue;
      }
      // The guest stays attached until the close lands; one that fails is
      // asked for again on the next run.
      void rpcClient.workspace.browser.close
        .call({ id: decoded.id, sessionId: decoded.sessionId })
        .catch(() => {
          const closing = new Set(guestMemo.current.closing);
          closing.delete(target);
          guestMemo.current = { ...guestMemo.current, closing };
        });
    }
  }, [attached, everyTabId]);

  // Titles, addresses and icons come off the guests as the pages announce
  // them: the pages navigate by the user's hand and by an agent's, so the
  // strip is told rather than polled. Listeners are put on each guest once it
  // has attached, and again for a tab that arrives later.
  const tabIds = tabs.map((tab) => tab.id).join(",");
  useEffect(() => {
    const patch = (
      id: string,
      changes: Partial<Pick<BrowserTab, "favicon" | "title" | "url">>,
    ) => {
      change((current) => patchPage(current, id, changes));
    };
    const cleanups = tabIds.split(",").map((id) => {
      if (!id) {
        return;
      }
      const target = encodeBrowserTargetId(
        WINDOW_ID,
        StoreId.SessionSchema.parse(id),
      );
      if (!attached.has(target)) {
        return;
      }
      const guest = getGuest(target);
      if (!guest) {
        return;
      }
      const onNavigate = () => {
        const url = guest.url();
        // A guest gone since it was read has no page to report.
        if (url === "") {
          return;
        }
        // A page's file in Edit is loaded at the file's address with the
        // Edit parameter added; the tab is still at the file.
        if (isPageEditAddress(url)) {
          return;
        }
        const isHistoryStep = takeGuestTraversal(target);
        if (
          !isHistoryStep &&
          url !== latest.current.tabs.find((tab) => tab.id === id)?.url
        ) {
          change((current) => pageNavigated(current, id));
        }
        if (url && url !== "about:blank") {
          const title = guest.title() || undefined;
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
        }
      };
      // A local page's own `history.pushState` moves its address without
      // loading anything, and every `file://` page shares one origin, so the
      // address it names can be any file on the computer. The tab stays at
      // the file the page loaded: the new address is never kept, shown as
      // the file, or loaded for real, and Edit never opens the file it names.
      const onNavigateInPage = () => {
        if (hostPathOfFileUrl(guest.url()) === undefined) {
          onNavigate();
        }
      };
      const onTitle = ({ title }: { title: string }) => {
        if (title) {
          patch(id, { title });
        }
      };
      const onFavicon = ({ favicons }: { favicons: string[] }) => {
        const favicon = favicons[0];
        patch(id, { favicon });
        if (!favicon) {
          return;
        }
        // Under the page the tab is on now, and nothing else: a tab that
        // wandered off a visited page must not hand it the icon of wherever
        // it went.
        const url =
          guest.url() ||
          latest.current.tabs.find((entry) => entry.id === id)?.url;
        if (originOf(url)) {
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
      const stops = [
        guest.on("did-navigate", onNavigate),
        guest.on("did-navigate-in-page", onNavigateInPage),
        guest.on("page-title-updated", onTitle),
        guest.on("page-favicon-updated", onFavicon),
      ];
      return () => {
        for (const stop of stops) {
          stop();
        }
      };
    });
    return () => {
      for (const cleanup of cleanups) {
        cleanup?.();
      }
    };
  }, [attached, change, tabIds]);

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

  const openTab = (
    url?: string,
    { group: into, replacing, show = false }: OpenOptions = {},
  ) => {
    const id = StoreId.newSessionId();
    const page = {
      id,
      openedAt: Date.now(),
      ...(url ? { openedUrl: url, url } : {}),
    };
    // In the group on screen, or the group asked for: a page opened while a
    // chat is up is the chat's, and one a chat asked for while another was
    // up is still that chat's, waiting behind. In a tab's place, the page is
    // what that tab's group has up.
    change((current, onScreen) =>
      openPageIn(current, {
        group: into ?? onScreen,
        homeId: newScreenId(),
        page,
        ...(replacing ? { replacing } : {}),
        select: show || into === undefined || into === onScreen,
      }),
    );
    void rpcClient.workspace.browser.open.call({
      id: WINDOW_ID,
      sessionId: StoreId.SessionSchema.parse(id),
      ...(url ? { url } : {}),
    });
    return id;
  };

  useImperativeHandle(
    ref,
    () => ({
      navigate: (url) => {
        const guest = activeTarget && getGuest(activeTarget);
        if (guest) {
          change((current, onScreen) => {
            const shown = selectedTabIn(current, onScreen);
            return shown ? pageNavigated(current, shown.id) : current;
          });
          void guest.load(url);
        }
      },
      navigateTab: (tabId, url) => {
        const tab = latest.current.tabs.find((entry) => entry.id === tabId);
        if (!tab) {
          return;
        }
        change((current) => pageNavigated(current, tabId, url));
        const guest = getGuest(targetOf(tab));
        if (guest) {
          void guest.load(url);
          return;
        }
        void rpcClient.workspace.browser.open.call({
          id: WINDOW_ID,
          sessionId: StoreId.SessionSchema.parse(tab.id),
          url,
        });
      },
      open: (url, options) => openTab(url, options),
      openBehind: (url, into) => {
        const id = StoreId.newSessionId();
        change((current) =>
          addPages(current, [
            {
              group: into,
              id,
              openedAt: Date.now(),
              ...(url ? { openedUrl: url, url } : {}),
            },
          ]),
        );
        void rpcClient.workspace.browser.open.call({
          id: WINDOW_ID,
          sessionId: id,
          ...(url ? { url } : {}),
        });
        return id;
      },
      openOrFocus: (url, options) => {
        const key = options?.group ?? latest.current.group;
        // An address already open in the group comes forward rather than
        // opening twice: a file has one tab per place, the way it has one tab
        // in Files, and a link to a page a task left open is that page.
        // Only the exact address counts, so a second page on a site still
        // gets a tab of its own. Only the group's own: another chat's tab
        // is that chat's.
        const atAddress = latest.current.tabs.find(
          (tab) => tab.group === key && sameAddress(tab.url, url),
        );
        if (atAddress) {
          if (options?.show || key === latest.current.group) {
            change((current) => selectTab(current, atAddress.id));
          }
          return atAddress.id;
        }
        // A group waiting behind with its new tab up gets the page in that
        // tab, the way the group on screen does: the tab that was there to
        // be told where to go is told, rather than left beside the page.
        const waitingUp =
          key === undefined || key === latest.current.group
            ? undefined
            : selectedTabIn(
                {
                  activeByGroup: latest.current.activeByGroup,
                  tabs: latest.current.allTabs,
                },
                key,
              );
        const fresh = waitingUp && isHomeTab(waitingUp) ? waitingUp : undefined;
        return openTab(url, fresh ? { ...options, replacing: fresh } : options);
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
        change((current) => replaceTab(current, tab.id, page));
        void rpcClient.workspace.browser.open.call({
          id: WINDOW_ID,
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
        // A guest not ready yet: what the tab remembers of the page is the answer.
        const guest = getGuest(targetOf(current));
        let url = guest?.url();
        const title = guest?.title() || (current.title ?? "");
        if (!url || url === "about:blank") {
          url = current.url;
        }
        if (!url) {
          return;
        }
        // The tabs a task can be handed: the group's own, since a note is
        // written for the chat that is up (or the draft being written) and
        // another chat's tab is that chat's.
        const groupKey =
          tabId === undefined ? latest.current.group : current.group;
        const own = all.filter((tab) => tab.group === groupKey);
        const base: PageContext = {
          tab: current.id,
          tabs: own.map((tab) => ({
            id: tab.id,
            title: tab.title ?? "",
            url: tab.url ?? "",
          })),
          title,
          url,
        };
        if (!guest) {
          return base;
        }
        let raw: unknown;
        try {
          raw = await guest.run(READ_PAGE_WORDS);
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
        const { focus } = words.data;
        return {
          ...base,
          ...(focus ? { focus } : {}),
          ...(selection ? { selection } : {}),
        };
      },
      readPageText: async (tabId) => {
        const tab = latest.current.tabs.find((entry) => entry.id === tabId);
        const guest = tab ? getGuest(targetOf(tab)) : undefined;
        if (!guest) {
          return;
        }
        try {
          const raw: unknown = await guest.run(READ_PAGE_TEXT);
          return typeof raw === "string"
            ? raw.slice(0, PAGE_TEXT_MAX)
            : undefined;
        } catch {
          return;
        }
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
          id: WINDOW_ID,
          sessionId: StoreId.SessionSchema.parse(tab.id),
          ...(tab.url && tab.url !== "about:blank"
            ? { restoreUrl: tab.url }
            : {}),
        });
        return true;
      },
    }),
    // The handle reads the strip through `latest` at call time; the guest on
    // screen is read here, so the handle is remade whenever it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeTarget],
  );

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
        <BrowserPanel
          active={attached.has(targetOf(active))}
          chrome={{
            fieldInto: fieldInto ?? null,
            into: chromeInto ?? null,
            reloadInto: reloadInto ?? null,
          }}
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
          restoreUrl={active.url}
          sessionId={StoreId.SessionSchema.parse(active.id)}
          chatId={WINDOW_ID}
        />
      ) : null}
      {/* A page's file keeps its asks at its foot while viewed; in Edit the
          page's own dock holds them. */}
      {activeFilePath !== undefined && !(active && editTabs[active.id]) && (
        <AskTray path={activeFilePath} />
      )}
      {compose?.map((host) => {
        // The page the window has up, when what it has up is a page: the
        // tab the host names, or else the one its group remembers, or its
        // first.
        const hostUp =
          host.tabId === undefined
            ? windowTabs.selectedTabIn(host.group)
            : allTabs.find((tab) => tab.id === host.tabId);
        return hostUp?.kind === "page" ? (
          <ComposePagePanel
            attached={attached.has(targetOf(hostUp))}
            host={host}
            key={host.group}
            tab={hostUp}
            chatId={WINDOW_ID}
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
  tab,
  chatId,
}: {
  attached: boolean;
  host: ComposeHost;
  tab: BrowserTab;
  chatId: ChatId;
}) {
  if (!host.into) {
    return null;
  }
  return createPortal(
    <ActiveTabProvider isActive={host.isActive}>
      <BrowserPanel
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
        restoreUrl={tab.url}
        sessionId={StoreId.SessionSchema.parse(tab.id)}
        chatId={chatId}
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
      // A guest not yet ready needs no reload: its first load, still to
      // come or under way, reads the file as it is. A change reported that
      // early is a cached version from an earlier visit being brought up to
      // date.
      getGuest(target)?.reload();
    }
    shown.current = modifiedAt;
  }, [modifiedAt, target]);
  return null;
}

/** A page tab of the window's own on an HTML file, which Edit can change in place. */
function isEditablePage(tab: BrowserTab) {
  const filePath = hostPathOfFileUrl(tab.url);
  return (
    filePath !== undefined && getFileType({ filename: filePath }) === "html"
  );
}

/** Two addresses are the same tab when they differ only by a trailing slash or a fragment. */
function sameAddress(a: string | undefined, b: string) {
  return a !== undefined && trimAddress(a) === trimAddress(b);
}

function trimAddress(url: string) {
  return url.replace(/#.*$/, "").replace(/\/+$/, "");
}
