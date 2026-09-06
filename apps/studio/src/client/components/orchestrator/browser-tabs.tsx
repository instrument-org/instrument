import {
  type BrowserTab,
  originOf,
  siteFaviconsAtom,
  VISITED_MAX,
  visitedPagesAtom,
  type WindowTab,
  windowTabsAtom,
} from "@/client/atoms/orchestrator";
import { Favicon } from "@/client/components/favicon";
import { TaskBrowserPanel } from "@/client/components/task/browser-panel";
import { useBrowserTargets } from "@/client/hooks/use-browser-targets";
import { WINDOW_BROWSER_HOST } from "@/client/lib/browser-host";
import { getWebviewElement } from "@/client/lib/browser-pool";
import { rpcClient } from "@/client/rpc/client";
import {
  type BrowserTargetId,
  decodeBrowserTargetId,
  encodeBrowserTargetId,
  StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useSetAtom } from "jotai";
import {
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { z } from "zod";

import { useOrchestrator } from "./context";

export interface BrowserPage {
  favicon?: string;
  title: string;
  url: string;
}

export interface BrowserTabsHandle {
  /** Opens a new page tab, at an address when given, and shows it. */
  open: (url?: string) => void;
  /** Shows the page tab already at that address, or opens one there. */
  openOrFocus: (url: string) => void;
  /** Reads the page on screen as it is at that moment; undefined while none is. */
  readPage: () => Promise<PageContext | undefined>;
}

/** What the page had on it that the words in a message can refer to. */
export interface PageContext {
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
      (around ? ", at the line \u201c" + around + "\u201d" : ", which is empty")
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

type PageTabsUpdate = (current: {
  activeId: null | string;
  tabs: BrowserTab[];
}) => { activeId: null | string; tabs: BrowserTab[] };

/**
 * The window's pages: each page tab is a browser guest of the orchestrator's,
 * like a task's browser and driven by the same machinery, so a task can be
 * handed one by id and drive it in the user's sight. The tabs themselves are
 * the window's, drawn by the window's strip; this holds their guests, keeps
 * each tab's title, address and icon as its page announces them, and shows
 * the guest of the tab on screen when that tab is a page. The page on screen
 * is the one the orchestrator's own commands drive, and it rides along with
 * every message.
 */
export function BrowserTabs({
  onPageChange,
  ref,
}: {
  /** Told the page on screen whenever it changes, and undefined when none is. */
  onPageChange?: (page: BrowserPage | undefined) => void;
  ref: Ref<BrowserTabsHandle>;
}) {
  const { taskId } = useOrchestrator();
  const [{ activeId, tabs: allTabs }, setAllTabs] = useAtom(windowTabsAtom);
  const tabs = allTabs.filter((tab) => tab.kind === "page");
  // A patch to a page tab lands in the window's list, where the tab lives.
  const setTabs = (update: PageTabsUpdate) => {
    setAllTabs(withPageTabs(update));
  };
  const setSiteFavicons = useSetAtom(siteFaviconsAtom);
  const setVisited = useSetAtom(visitedPagesAtom);
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

  const targetOf = (tab: BrowserTab): BrowserTargetId =>
    encodeBrowserTargetId(
      tab.taskId ?? taskId,
      StoreId.SessionSchema.parse(tab.id),
    );
  const active = tabs.find((tab) => tab.id === activeId);

  // The orchestrator's own browser is the tab on screen; a task's tab is the
  // task's to drive.
  const activeTarget = active && !active.taskId ? targetOf(active) : null;
  useEffect(() => {
    void rpcClient.workspace.orchestrator.setActiveTab.call({
      id: taskId,
      targetId: activeTarget,
    });
  }, [activeTarget, taskId]);

  // A tab that comes back after a launch opens where it was: the panel opens
  // the guest itself, but at the page the workspace last recorded, which a
  // page the user browsed to by hand may not be.
  const activeAttached = activeTarget !== null && attached.has(activeTarget);
  const activeUrl = active?.url;
  useEffect(() => {
    if (!active || activeAttached || !activeUrl) {
      return;
    }
    void rpcClient.workspace.browser.open.call({
      host: WINDOW_BROWSER_HOST,
      id: active.taskId ?? taskId,
      sessionId: StoreId.SessionSchema.parse(active.id),
      url: activeUrl,
    });
    // Once per tab coming back, not per render while it attaches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, taskId]);

  // The strip as it is at any moment, for the handle below and the listeners,
  // both of which are made once and read it when called.
  const latest = useRef({ active, tabs });
  useEffect(() => {
    latest.current = { active, tabs };
  });

  // A task the conversation started browses here too: its guest is mounted
  // in this window, and the moment one attaches it gets a tab, behind the one
  // on screen, so the user can watch it work. Only a guest arriving is a tab
  // to add: one the user closed is still attached until the close lands, and
  // must not come straight back.
  const seenTargets = useRef(new Set<BrowserTargetId>());
  useEffect(() => {
    const arrived = [...attached].filter(
      (target) => !seenTargets.current.has(target),
    );
    seenTargets.current = new Set(attached);
    const newcomers = arrived.flatMap((target) => {
      const decoded = decodeBrowserTargetId(target);
      if (
        !decoded ||
        decoded.id === taskId ||
        latest.current.tabs.some((tab) => tab.id === decoded.sessionId)
      ) {
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
    if (newcomers.length === 0) {
      return;
    }
    setAllTabs(
      withPageTabs((current) => ({
        ...current,
        tabs: [...current.tabs, ...newcomers],
      })),
    );
  }, [attached, setAllTabs, taskId]);

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
          const url = webview.getURL();
          if (url && url !== "about:blank") {
            const title = webview.getTitle() || undefined;
            patch(id, { title, url });
            // The new-tab page lists where the browser has been.
            setVisited((current) =>
              [
                { at: Date.now(), title: title ?? "", url },
                ...current.filter((page) => page.url !== url),
              ].slice(0, VISITED_MAX),
            );
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
        // Under the site the page is on now, and nothing else: a tab that
        // wandered off a pinned site must not hand the pin the icon of
        // wherever it went.
        let url: string | undefined;
        try {
          url = webview.getURL();
        } catch {
          url = latest.current.tabs.find((entry) => entry.id === id)?.url;
        }
        const origin = originOf(url);
        if (origin) {
          setSiteFavicons((current) => ({ ...current, [origin]: favicon }));
          setVisited((current) =>
            current.map((page) =>
              page.url === url ? { ...page, favicon } : page,
            ),
          );
        }
      };
      onNavigate();
      webview.addEventListener("did-navigate", onNavigate);
      webview.addEventListener("did-navigate-in-page", onNavigate);
      webview.addEventListener("page-title-updated", onTitle);
      webview.addEventListener("page-favicon-updated", onFavicon);
      return () => {
        webview.removeEventListener("did-navigate", onNavigate);
        webview.removeEventListener("did-navigate-in-page", onNavigate);
        webview.removeEventListener("page-title-updated", onTitle);
        webview.removeEventListener("page-favicon-updated", onFavicon);
      };
    });
    return () => {
      for (const cleanup of cleanups) {
        cleanup?.();
      }
    };
  }, [attached, setAllTabs, setSiteFavicons, setVisited, tabIds, taskId]);

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

  const openTab = (url?: string) => {
    const id = StoreId.newSessionId();
    setTabs((current) => ({
      activeId: id,
      tabs: [
        ...current.tabs,
        { id, openedAt: Date.now(), ...(url ? { openedUrl: url, url } : {}) },
      ],
    }));
    void rpcClient.workspace.browser.open.call({
      host: WINDOW_BROWSER_HOST,
      id: taskId,
      sessionId: StoreId.SessionSchema.parse(id),
      ...(url ? { url } : {}),
    });
  };

  useImperativeHandle(
    ref,
    () => ({
      open: (url) => {
        openTab(url);
      },
      openOrFocus: (url) => {
        // A tab still on that site, by where it is now: a tab that was opened
        // there and has since wandered off is not the site.
        const origin = originOf(url);
        const existing =
          latest.current.tabs.find((tab) => sameAddress(tab.url, url)) ??
          latest.current.tabs.find(
            (tab) => origin !== undefined && originOf(tab.url) === origin,
          );
        if (existing) {
          setTabs((current) => ({ ...current, activeId: existing.id }));
        } else {
          openTab(url);
        }
      },
      readPage: async () => {
        const { active: current, tabs: all } = latest.current;
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
        // The window's own tabs are the ones a task can be handed; a task's
        // tab is already that task's.
        const own = all.filter((tab) => !tab.taskId);
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
    }),
    // The handle reads the strip through `latest` at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taskId],
  );

  const taskIdsWithTabs = [
    ...new Set(tabs.flatMap((tab) => (tab.taskId ? [tab.taskId] : []))),
  ];

  return (
    <div className="relative h-full min-h-0">
      {taskIdsWithTabs.map((id) => (
        <BrowserHold key={id} taskId={id} />
      ))}
      {active ? (
        <TaskBrowserPanel
          active={attached.has(targetOf(active))}
          className="h-full"
          key={active.id}
          sessionId={StoreId.SessionSchema.parse(active.id)}
          taskId={active.taskId ?? taskId}
        />
      ) : null}
    </div>
  );
}

/**
 * The page's own icon when it has announced one and it loads; else the site's,
 * looked up by address, since a page that announced none or a stale one is
 * still on a site with one; else the globe.
 */
export function TabIcon({
  favicon,
  url,
}: {
  favicon: string | undefined;
  url: string | undefined;
}) {
  const [failed, setFailed] = useState<string | undefined>();
  if (favicon && failed !== favicon) {
    return (
      <img
        alt=""
        className="size-3.5 rounded-xs"
        draggable={false}
        onError={() => {
          setFailed(favicon);
        }}
        src={favicon}
      />
    );
  }
  if (url && /^https?:/.test(url)) {
    return <Favicon className="size-3.5 rounded-xs" url={url} />;
  }
  return <GlobeIcon className="size-3.5" />;
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
  return (current: {
    activeId: null | string;
    tabs: WindowTab[];
  }): { activeId: null | string; tabs: WindowTab[] } => {
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
    return { activeId: next.activeId, tabs: merged };
  };
}
