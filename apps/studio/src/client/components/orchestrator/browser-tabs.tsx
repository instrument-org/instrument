import {
  type BrowserTab,
  orchestratorTabsAtom,
} from "@/client/atoms/orchestrator";
import { TaskBrowserPanel } from "@/client/components/task/browser-panel";
import { useBrowserTargets } from "@/client/hooks/use-browser-targets";
import { WINDOW_BROWSER_HOST } from "@/client/lib/browser-host";
import { getWebviewElement } from "@/client/lib/browser-pool";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  type BrowserTargetId,
  encodeBrowserTargetId,
  StoreId,
} from "@instrument-org/workspace/client";
import { GlobeIcon } from "@phosphor-icons/react/Globe";
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery } from "@tanstack/react-query";
import { useAtom } from "jotai";
import ms from "ms";
import { type Ref, useEffect, useImperativeHandle, useState } from "react";
import { z } from "zod";

import { useOrchestrator } from "./context";

export interface BrowserPage {
  title: string;
  url: string;
}

export interface BrowserTabsHandle {
  /** Opens an address in a new tab and shows it. */
  open: (url: string) => void;
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

/** How often the tabs' titles are re-read off their guests. */
const TITLE_REFRESH_MS = ms("1.5 seconds");

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
 * with every message.
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
  const [pages, setPages] = useState<Record<string, BrowserPage>>({});

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

  // Titles and addresses come off the guests themselves, which navigate by
  // the user's hand and by an agent's, so the strip is read rather than told.
  useEffect(() => {
    const read = () => {
      const next: Record<string, BrowserPage> = {};
      for (const tab of tabs) {
        const webview = getWebviewElement(targetOf(tab));
        const url = webview?.getURL();
        if (url && url !== "about:blank") {
          next[tab.id] = { title: webview?.getTitle() ?? "", url };
        }
      }
      setPages((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
      // The address rides with the tab, so a tab that comes back after a
      // launch opens where it was.
      setTabs((current) => {
        const updated = current.tabs.map((tab) => {
          const page = next[tab.id];
          return page && page.url !== tab.url ? { ...tab, url: page.url } : tab;
        });
        return updated.some((tab, index) => tab !== current.tabs[index])
          ? { ...current, tabs: updated }
          : current;
      });
    };
    read();
    const timer = setInterval(read, TITLE_REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, taskId]);

  const activePage = active ? pages[active.id] : undefined;
  useEffect(() => {
    onPageChange?.(activePage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePage?.title, activePage?.url]);

  const openTab = (url?: string) => {
    const id = StoreId.newSessionId();
    setTabs((current) => ({
      activeId: id,
      tabs: [...current.tabs, { id, openedAt: Date.now() }],
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

  useImperativeHandle(
    ref,
    () => ({
      open: (url: string) => {
        openTab(url);
      },
      readPage: async () => {
        const current = active;
        if (!current) {
          return;
        }
        const webview = getWebviewElement(targetOf(current));
        const url = webview?.getURL();
        if (!webview || !url || url === "about:blank") {
          return;
        }
        const base: PageContext = {
          tab: current.id,
          tabs: tabs.map((tab) => ({
            id: tab.id,
            title: pages[tab.id]?.title ?? "",
            url: pages[tab.id]?.url ?? "",
          })),
          title: webview.getTitle(),
          url,
        };
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
    // The handle reads the tabs through the closure as they are at the call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active?.id, tabs, pages, taskId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-stretch gap-1 overflow-x-auto border-b border-border px-2 pt-1">
        {tabs.map((tab) => {
          const page = pages[tab.id];
          const isActive = tab.id === active?.id;
          return (
            <div
              className={cn(
                "group flex max-w-56 min-w-32 shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-2 text-xs",
                isActive
                  ? "border-border bg-background"
                  : "border-transparent text-muted-foreground hover:bg-foreground/5",
              )}
              key={tab.id}
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                onClick={() => {
                  setTabs((current) => ({ ...current, activeId: tab.id }));
                }}
                type="button"
              >
                <GlobeIcon className="size-3.5 shrink-0" />
                <span className="truncate">
                  {page?.title || page?.url || "New tab"}
                </span>
              </button>
              <button
                aria-label="Close tab"
                className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-foreground/10"
                onClick={() => {
                  closeTab(tab.id);
                }}
                type="button"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          );
        })}
        <button
          aria-label="New tab"
          className="my-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          onClick={() => {
            openTab();
          }}
          type="button"
        >
          <PlusIcon className="size-4" />
        </button>
      </div>
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
