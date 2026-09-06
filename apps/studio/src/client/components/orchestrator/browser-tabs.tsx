import {
  type BrowserTab,
  orchestratorTabsAtom,
} from "@/client/atoms/orchestrator";
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
import { useAtom } from "jotai";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";
import { z } from "zod";

import { useOrchestrator } from "./context";
import { TabStrip } from "./tab-strip";

export interface BrowserPage {
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
            patch(id, { title: webview.getTitle() || undefined, url });
          }
        } catch {
          // Not attached yet; the events that follow attachment re-run this.
        }
      };
      const onTitle = (event: Event) => {
        const { title } = event as Event & { title?: string };
        if (title) {
          patch(id, { title });
        }
      };
      const onFavicon = (event: Event) => {
        const { favicons } = event as Event & { favicons?: string[] };
        patch(id, { favicon: favicons?.[0] });
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
  }, [attached, setTabs, tabIds, taskId]);

  const activePage: BrowserPage | undefined = active?.url
    ? { title: active.title ?? "", url: active.url }
    : undefined;
  useEffect(() => {
    onPageChange?.(activePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage?.title, activePage?.url]);

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

  const closeTab = (id: string) => {
    setTabs((current) => {
      const remaining = current.tabs.filter((tab) => tab.id !== id);
      const index = current.tabs.findIndex((tab) => tab.id === id);
      const next =
        current.activeId === id
          ? (remaining[Math.max(0, index - 1)]?.id ?? null)
          : current.activeId;
      return { activeId: next, tabs: remaining };
    });
  };

  // The handle is made once and reads the strip as it is when called, so
  // nothing holding it is told to re-run each time a title comes in.
  const latest = useRef({ active, tabs });
  useEffect(() => {
    latest.current = { active, tabs };
  });
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
        // The tab opened at that address, wherever the site has taken it
        // since, or failing that one that is there now.
        const existing =
          latest.current.tabs.find((tab) => sameAddress(tab.openedUrl, url)) ??
          latest.current.tabs.find((tab) => sameAddress(tab.url, url));
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
    }),
    // The handle reads the strip through `latest` at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [taskId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
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
          icon: <TabIcon favicon={tab.favicon} />,
          key: tab.id,
          title: tab.title || tab.url || "New tab",
        }))}
      />
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
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <GlobeIcon className="size-8" />
            <p>Open a tab. What you are looking at goes with what you say.</p>
            <button
              className="rounded-md bg-foreground/10 px-3 py-1.5 text-foreground hover:bg-foreground/20"
              onClick={() => {
                openTab();
              }}
              type="button"
            >
              New tab
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Two addresses are the same tab when they differ only by a trailing slash or a fragment. */
function sameAddress(a: string | undefined, b: string) {
  return a !== undefined && trimAddress(a) === trimAddress(b);
}

/** The page's own icon when it has announced one, else the globe. */
function TabIcon({ favicon }: { favicon: string | undefined }) {
  return favicon ? (
    <img
      alt=""
      className="size-3.5 rounded-xs"
      draggable={false}
      src={favicon}
    />
  ) : (
    <GlobeIcon className="size-3.5" />
  );
}

function trimAddress(url: string) {
  return url.replace(/#.*$/, "").replace(/\/+$/, "");
}
