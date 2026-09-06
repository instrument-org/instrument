import {
  type BrowserTab,
  orchestratorTabsAtom,
  originOf,
  siteFaviconsAtom,
  VISITED_MAX,
  type VisitedPage,
  visitedPagesAtom,
} from "@/client/atoms/orchestrator";
import { Favicon } from "@/client/components/favicon";
import { TaskBrowserPanel } from "@/client/components/task/browser-panel";
import { useBrowserTargets } from "@/client/hooks/use-browser-targets";
import { WINDOW_BROWSER_HOST } from "@/client/lib/browser-host";
import { getWebviewElement } from "@/client/lib/browser-pool";
import { rpcClient } from "@/client/rpc/client";
import {
  type BrowserTargetId,
  encodeBrowserTargetId,
  StoreId,
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
import { TabStrip } from "./tab-strip";

export interface BrowserPage {
  favicon?: string;
  title: string;
  url: string;
}

export interface BrowserTabsHandle {
  /** Closes the tab on screen, if any. */
  closeActive: () => void;
  /** Opens a new tab, at an address when given, and shows it. */
  open: (url?: string) => void;
  /** Shows the tab already at that address, or opens one there. */
  openOrFocus: (url: string) => void;
  /** Reads the tab on screen as it is at that moment; undefined while none is. */
  readPage: () => Promise<PageContext | undefined>;
  /** Brings back the tab closed last, at the page it was on. */
  reopenClosed: () => void;
  /** Shows the next or previous tab, wrapping. */
  selectRelative: (direction: -1 | 1) => void;
  /** Shows the tab at that place, counting from one; nine is the last, as in a browser. */
  selectTab: (index: number) => void;
}

/** What the page had on it that the words in a message can refer to. */
export interface PageContext {
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

const PageWordsSchema = z.object({ selection: z.string(), text: z.string() });

/** Runs in the page: what is selected, and its text with the whitespace folded. */
const READ_PAGE_WORDS = `({
  selection: String(window.getSelection() ?? ""),
  text: (
    (document.querySelector("main, article, [role=main]") ?? document.body)
      ?.innerText ?? ""
  )
    .replace(/\\s+/g, " ")
    .trim(),
})`;

/**
 * The window's browser: tabs along the top, each a browser guest of the
 * orchestrator's, like a task's browser and driven by the same machinery, so
 * a task can be handed one by id and drive it in the user's sight. The tab on
 * screen is the one the orchestrator's own commands drive, and it rides along
 * with every message. Each tab keeps its title, address and icon as the page
 * announces them, so a tab that has not been shown since the app opened still
 * says what it is.
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
  const [{ activeId, tabs }, setTabs] = useAtom(orchestratorTabsAtom);
  const setSiteFavicons = useSetAtom(siteFaviconsAtom);
  const [visited, setVisited] = useAtom(visitedPagesAtom);
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
    encodeBrowserTargetId(taskId, StoreId.SessionSchema.parse(tab.id));
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  // The orchestrator's own browser is the tab on screen.
  const activeTarget = active ? targetOf(active) : null;
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
      id: taskId,
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

  // Titles, addresses and icons come off the guests as the pages announce
  // them: the pages navigate by the user's hand and by an agent's, so the
  // strip is told rather than polled. Listeners are put on each guest once it
  // has attached, and again for a tab that arrives later.
  const tabIds = tabs.map((tab) => tab.id).join(",");
  useEffect(() => {
    const patch = (id: string, changes: Partial<BrowserTab>) => {
      setTabs((current) => {
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
      });
    };
    const cleanups = tabIds.split(",").map((id) => {
      if (!id) {
        return;
      }
      const target = encodeBrowserTargetId(
        taskId,
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
  }, [attached, setSiteFavicons, setTabs, setVisited, tabIds, taskId]);

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

  // Tabs closed this launch, newest last, so Shift+Cmd+T has somewhere to
  // reach. Not kept across launches: a guest gone with the app is gone.
  const closed = useRef<BrowserTab[]>([]);
  const closeTab = (id: string) => {
    setTabs((current) => {
      const closing = current.tabs.find((tab) => tab.id === id);
      if (closing?.url) {
        closed.current.push(closing);
      }
      const remaining = current.tabs.filter((tab) => tab.id !== id);
      const index = current.tabs.findIndex((tab) => tab.id === id);
      const next =
        current.activeId === id
          ? (remaining[Math.max(0, index - 1)]?.id ?? null)
          : current.activeId;
      return { activeId: next, tabs: remaining };
    });
  };
  const reopenClosed = () => {
    const tab = closed.current.pop();
    if (tab?.url) {
      openTab(tab.url);
    }
  };

  useImperativeHandle(
    ref,
    () => ({
      closeActive: () => {
        const current = latest.current.active;
        if (current) {
          closeTab(current.id);
        }
      },
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
        const base: PageContext = {
          tab: current.id,
          tabs: all.map((tab) => ({
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
        return {
          ...base,
          ...(selection ? { selection } : {}),
          ...(text ? { text } : {}),
        };
      },
      reopenClosed,
      selectRelative: (direction) => {
        const { active: current, tabs: all } = latest.current;
        const at = all.findIndex((tab) => tab.id === current?.id);
        const next = all[(at + direction + all.length) % all.length];
        if (next) {
          setTabs((state) => ({ ...state, activeId: next.id }));
        }
      },
      selectTab: (index) => {
        const all = latest.current.tabs;
        const tab = index >= 9 ? all.at(-1) : all[index - 1];
        if (tab) {
          setTabs((current) => ({ ...current, activeId: tab.id }));
        }
      },
    }),
    // The handle reads the strip through `latest` at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taskId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {tabs.length === 0 ? null : (
        <TabStrip
          className="border-b border-border"
          onClose={closeTab}
          onNew={() => {
            openTab();
          }}
          onReorder={(keys) => {
            setTabs((current) => ({
              ...current,
              tabs: keys.flatMap((key) => {
                const tab = current.tabs.find((entry) => entry.id === key);
                return tab ? [tab] : [];
              }),
            }));
          }}
          onSelect={(id) => {
            setTabs((current) => ({ ...current, activeId: id }));
          }}
          selectedKey={active?.id}
          tabs={tabs.map((tab) => ({
            icon: <TabIcon favicon={tab.favicon} url={tab.url} />,
            key: tab.id,
            title: tab.title || tab.url || "New tab",
          }))}
        />
      )}
      <div className="relative min-h-0 flex-1">
        {active ? (
          <TaskBrowserPanel
            active={attached.has(targetOf(active))}
            className="h-full"
            key={active.id}
            sessionId={StoreId.SessionSchema.parse(active.id)}
            taskId={taskId}
          />
        ) : (
          <NewTabPage
            onNew={() => {
              openTab();
            }}
            onOpen={(url) => {
              openTab(url);
            }}
            visited={visited}
          />
        )}
      </div>
    </div>
  );
}

/**
 * What the browser shows with no tab open: an empty tab, the way a browser
 * opens, with where it has been under it. Closing the last tab lands here:
 * the browser is still the screen the user was on.
 */
function NewTabPage({
  onNew,
  onOpen,
  visited,
}: {
  onNew: () => void;
  onOpen: (url: string) => void;
  visited: VisitedPage[];
}) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto px-8 py-10">
      <GlobeIcon className="size-8 text-muted-foreground" />
      <button
        className="mt-4 rounded-md bg-foreground/10 px-3 py-1.5 text-sm text-foreground hover:bg-foreground/20"
        onClick={onNew}
        type="button"
      >
        New tab
      </button>
      {visited.length > 0 ? (
        <ul className="mt-8 grid w-full max-w-xl gap-0.5">
          {visited.slice(0, 8).map((page) => (
            <li key={page.url}>
              <button
                className="flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                onClick={() => {
                  onOpen(page.url);
                }}
                title={page.url}
                type="button"
              >
                <TabIcon favicon={page.favicon} url={page.url} />
                <span className="truncate">{page.title || page.url}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Two addresses are the same tab when they differ only by a trailing slash or a fragment. */
function sameAddress(a: string | undefined, b: string) {
  return a !== undefined && trimAddress(a) === trimAddress(b);
}

/**
 * The page's own icon when it has announced one and it loads; else the site's,
 * looked up by address, since a page that announced none or a stale one is
 * still on a site with one; else the globe.
 */
function TabIcon({
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

function trimAddress(url: string) {
  return url.replace(/#.*$/, "").replace(/\/+$/, "");
}
