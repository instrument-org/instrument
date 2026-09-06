import {
  linkedFilesAtom,
  NEW_TAB_HREF,
  type OrchestratorRecent,
  orchestratorRecentsAtom,
  orchestratorSidebarWidthAtom,
  RECENTS_MAX,
  screenViewAtom,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from "@/client/atoms/orchestrator";
import { FileOpenContext } from "@/client/components/file-open-context";
import {
  BrowserTabs,
  type BrowserTabsHandle,
} from "@/client/components/orchestrator/browser-tabs";
import {
  OrchestratorContext,
  type OrchestratorWindow,
} from "@/client/components/orchestrator/context";
import {
  TasksWorkingRow,
  ViewChip,
} from "@/client/components/orchestrator/conversation-chrome";
import { fileHref } from "@/client/components/orchestrator/file-tabs";
import { OrchestratorBookmarks } from "@/client/components/orchestrator/sidebar";
import { WindowTabStrip } from "@/client/components/orchestrator/window-tab-strip";
import {
  PAGE_ROUTE,
  parseHref,
  usePopClosedTab,
  useWindowTabs,
} from "@/client/components/orchestrator/window-tabs";
import {
  type RailBounds,
  StudioSidebarRail,
} from "@/client/components/studio-sidebar-rail";
import { TaskChat } from "@/client/components/task/chat";
import { Toaster } from "@/client/components/ui/sonner";
import { Spinner } from "@/client/components/ui/spinner";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { ActiveTabProvider } from "@/client/hooks/use-active-tab";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { TaskSessionProvider } from "@/client/hooks/use-task-session";
import { pathsNamedInMessage } from "@/client/lib/paths-named-in-message";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { type TaskId } from "@instrument-org/workspace/client";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Outlet,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import ms from "ms";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** How often the tasks' titles are re-read, for the strip. */
const REFRESH_MS = ms("2 seconds");

/** How long a screen has to stay up before Recent counts it. */
const RECENT_DWELL_MS = ms("2 seconds");

/** The sidebar holds the conversation, so its floor is where it stops shrinking, never a collapse. */
const SIDEBAR_BOUNDS: RailBounds = {
  collapse: 0,
  initial: SIDEBAR_WIDTH_DEFAULT,
  max: SIDEBAR_WIDTH_MAX,
  min: SIDEBAR_WIDTH_MIN,
};

export const Route = createFileRoute("/orchestrator")({
  component: OrchestratorLayout,
  head: () => ({ meta: [{ title: APP_NAME }] }),
});

/**
 * The window's chrome: no title bar, so it drags by its top-left corner,
 * which is the sidebar's top, past the traffic lights.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-screen bg-background">
      <div className="absolute top-0 left-0 z-10 h-10 w-60 [-webkit-app-region:drag]" />
      {children}
      <Toaster position="top-center" />
    </div>
  );
}

/**
 * The window: the sidebar down the left, with the user's own things at its
 * top and the conversation under them, and to its right one strip of tabs
 * above whatever is open. A tab is a page (a browser guest of the
 * orchestrator's) or a screen (a folder, a file, a task, the apps, a new tab)
 * addressed by the route it is at, so the router follows the tab on screen
 * and a screen navigating inside itself changes its own tab. The sidebar
 * never closes: the conversation is always in reach.
 */
function OrchestratorLayout() {
  const ensure = useQuery(
    rpcClient.workspace.orchestrator.ensure.queryOptions({
      // The orchestrator, once it exists, is the one this window shows for as
      // long as it is open.
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
  const ids = ensure.data;

  const task = useQuery(
    rpcClient.workspace.task.live.byId.experimental_liveOptions({
      input: ids ? { id: ids.taskId } : skipToken,
    }),
  );
  const state = useQuery(
    rpcClient.workspace.task.state.get.queryOptions({
      input: ids ? { id: ids.taskId } : skipToken,
    }),
  );
  const children = useQuery(
    rpcClient.workspace.orchestrator.children.queryOptions({
      input: ids ? { id: ids.taskId } : skipToken,
      refetchInterval: REFRESH_MS,
    }),
  );
  const messages = useQuery(
    rpcClient.workspace.message.live.list.experimental_liveOptions({
      input: ids ? { id: ids.taskId, sessionId: ids.sessionId } : skipToken,
    }),
  );
  const [defaultModelURI] = useDefaultModelURI();
  const screenView = useAtomValue(screenViewAtom);
  const setLinkedFiles = useSetAtom(linkedFilesAtom);
  // The files the conversation has handed over, newest first, for the sidebar.
  const linkedFiles = messages.data
    ?.toReversed()
    .flatMap((message) =>
      message.role === "assistant" ? [...pathsNamedInMessage(message)] : [],
    );
  const linkedKey = linkedFiles?.join("\n") ?? "";
  useEffect(() => {
    const seen = new Set<string>();
    setLinkedFiles(
      (linkedFiles ?? []).flatMap((path) => {
        if (seen.has(path)) {
          return [];
        }
        seen.add(path);
        return [{ name: path.split("/").at(-1) ?? path, path }];
      }),
    );
    // By content: the list is rebuilt from the messages on every update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedKey, setLinkedFiles]);
  const router = useRouter();
  const location = useRouterState({
    select: (routerState) => routerState.location,
  });

  // The browser hands its handle over once mounted; state rather than a ref,
  // since the send handler below and the screens read it.
  const [browser, setBrowser] = useState<BrowserTabsHandle | null>(null);
  const windowTabs = useWindowTabs();
  const popClosed = usePopClosedTab();
  const { active, activeId, tabs } = windowTabs;
  const isPageOnScreen = active?.kind === "page";

  // The window is never empty: closing the last tab leaves a new one.
  useEffect(() => {
    if (tabs.length === 0) {
      windowTabs.openScreen(NEW_TAB_HREF);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length]);

  // The router follows the tab on screen: a screen's own address, or the
  // page route, which shows nothing of its own, while a page is up.
  useEffect(() => {
    if (!active) {
      return;
    }
    if (active.kind === "page") {
      if (location.pathname !== PAGE_ROUTE) {
        router.history.push(PAGE_ROUTE);
      }
    } else if (location.href !== active.href) {
      router.history.push(active.href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // And the tab on screen follows the router: a screen navigating inside
  // itself moves its tab's address; an address reached while a page was up
  // (a link, a command) is a screen tab of its own.
  useEffect(() => {
    if (location.pathname === PAGE_ROUTE) {
      return;
    }
    if (active?.kind === "screen") {
      windowTabs.setActiveHref(location.href);
    } else {
      windowTabs.openOrFocusScreen(location.href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.href]);

  const isFreshNewTab =
    active?.kind === "screen" &&
    parseHref(active.href).pathname === parseHref(NEW_TAB_HREF).pathname;
  const openPage = (url: string) => {
    const fresh = isFreshNewTab ? active.id : undefined;
    browser?.openOrFocus(url);
    if (fresh) {
      windowTabs.close(fresh);
    }
  };
  const openScreen = (href: string) => {
    if (isFreshNewTab) {
      router.history.push(href);
    } else {
      windowTabs.openOrFocusScreen(href);
    }
  };

  useWindowCommands({
    closeTab: () => {
      windowTabs.closeActive();
    },
    newTab: () => {
      windowTabs.openScreen(NEW_TAB_HREF);
    },
    reopenTab: () => {
      const tab = popClosed();
      if (!tab) {
        return;
      }
      if (tab.kind === "page") {
        browser?.open(tab.url);
      } else {
        windowTabs.openScreen(tab.href);
      }
    },
    selectRelative: windowTabs.selectRelative,
    selectTab: windowTabs.selectIndex,
  });
  useRecordRecents({
    childTitles: new Map(
      children.data?.map((child) => [child.id, child.title]) ?? [],
    ),
  });

  const createMessage = useMutation(
    rpcClient.workspace.message.create.mutationOptions(),
  );
  const modelURI = state.data?.selectedModelURI ?? defaultModelURI;
  const screens: null | OrchestratorWindow = ids
    ? {
        ask: (prompt) => {
          if (!modelURI) {
            return;
          }
          createMessage.mutate({
            id: ids.taskId,
            modelURI,
            prompt,
            sessionId: ids.sessionId,
          });
        },
        browser,
        openPage,
        openScreen,
        sessionId: ids.sessionId,
        taskId: ids.taskId,
      }
    : null;

  if (ensure.error) {
    return (
      <Frame>
        <p className="p-4 pt-12 text-sm text-destructive">
          Could not open the conversation: {ensure.error.message}
        </p>
      </Frame>
    );
  }

  if (!screens || !task.data || !state.data) {
    return (
      <Frame>
        <div className="flex h-full flex-1 items-center justify-center">
          <Spinner className="size-6" />
        </div>
      </Frame>
    );
  }

  return (
    <OrchestratorContext value={screens}>
      {/* A file the conversation offers opens in a tab of its own. */}
      <FileOpenContext
        value={(filePath) => {
          openScreen(fileHref(filePath));
        }}
      >
        <Frame>
          <StudioSidebarRail
            bounds={SIDEBAR_BOUNDS}
            isOpen
            label="Resize the sidebar"
            onCollapse={() => {
              // The conversation lives here; the sidebar has no away to slide to.
            }}
            panelClassName="bg-background"
            widthAtom={orchestratorSidebarWidthAtom}
          >
            <div className="flex min-h-0 w-full flex-1 flex-col pt-10">
              <OrchestratorBookmarks className="max-h-2/5 shrink-0 overflow-y-auto" />
              <div className="mx-3 h-px shrink-0 bg-border" />
              <div className="flex min-h-0 flex-1 flex-col">
                <header className="flex h-9 shrink-0 items-center gap-2 px-3 text-sm font-medium">
                  <InstrumentGlyph className="size-4" />
                  <span>{APP_NAME}</span>
                </header>
                <div className="min-h-0 flex-1">
                  {/* Names the task and session for the links inside, so a page
                      a reply names offers both the window's browser and the
                      user's, the way a link in a task does. */}
                  <TaskSessionProvider
                    sessionId={screens.sessionId}
                    taskId={screens.taskId}
                  >
                    <TaskChat
                      alwaysSubmittable
                      composerLead={<ViewChip />}
                      navigateOnSend={false}
                      presentation="orchestrator"
                      promptDraft={state.data.promptDraft ?? ""}
                      selectedModelURI={
                        state.data.selectedModelURI ?? defaultModelURI
                      }
                      selectedSessionId={screens.sessionId}
                      // What the tab on screen says it shows, plus the page's
                      // words when that tab is a page, read at the moment of
                      // sending; a screen that registered nothing sends nothing.
                      sendContext={async () => {
                        if (!screenView) {
                          return;
                        }
                        const page =
                          screenView.screen === "browser"
                            ? await browser?.readPage()
                            : undefined;
                        return {
                          ...screenView,
                          ...(page ? { page } : {}),
                          url: location.href,
                        };
                      }}
                      task={task.data}
                      transcriptTrailing={<TasksWorkingRow />}
                    />
                  </TaskSessionProvider>
                </div>
              </div>
            </div>
          </StudioSidebarRail>
          <main className="relative flex min-w-0 flex-1 flex-col">
            <WindowTabStrip
              childTitles={
                new Map(
                  children.data?.map((child) => [child.id, child.title]) ?? [],
                )
              }
              onClose={windowTabs.close}
              onNew={() => {
                windowTabs.openScreen(NEW_TAB_HREF);
              }}
              onReorder={windowTabs.reorder}
              onSelect={windowTabs.select}
              selectedId={active?.id}
              tabs={tabs}
            />
            <div className="relative min-h-0 flex-1">
              <Outlet />
              {/* Hidden rather than unmounted while a screen is up, so the pages stay. */}
              <div
                className={cn(
                  "absolute inset-0 bg-background",
                  isPageOnScreen ? undefined : "invisible",
                )}
              >
                {/* The guests are the pool's, drawn over a slot rather than in it, so hiding this box hides nothing of theirs: the panel parks its guest when told the screen is off, the way a task page does when its tab is in the background. */}
                <ActiveTabProvider isActive={isPageOnScreen}>
                  <BrowserTabs ref={setBrowser} />
                </ActiveTabProvider>
              </div>
            </div>
          </main>
        </Frame>
      </FileOpenContext>
    </OrchestratorContext>
  );
}

function recentFor({
  href,
  pathname,
  search,
  taskTitle,
}: {
  href: string;
  pathname: string;
  search: Record<string, unknown>;
  taskTitle: string | undefined;
}): Omit<OrchestratorRecent, "at"> | undefined {
  switch (pathname) {
    case "/orchestrator/computer": {
      const file = typeof search.file === "string" ? search.file : "";
      if (file) {
        return { href, kind: "file", title: file.split("/").at(-1) || "File" };
      }
      const path = typeof search.path === "string" ? search.path : "";
      const folder = path.replace(/\/$/, "").split("/").at(-1);
      // The roots are doors on the new tab page already.
      if (!folder) {
        return undefined;
      }
      return { href, kind: "folder", title: folder };
    }
    default: {
      if (pathname.startsWith("/orchestrator/tasks/")) {
        return { href, kind: "task", title: taskTitle ?? "Task" };
      }
      return undefined;
    }
  }
}

/**
 * Keeps the Recent list: every screen the window lands on goes to the top,
 * one entry per address. Pages keep their own list, by the browser.
 */
function useRecordRecents({
  childTitles,
}: {
  childTitles: Map<TaskId, string>;
}) {
  const location = useRouterState({
    select: (routerState) => routerState.location,
  });
  const setRecents = useSetAtom(orchestratorRecentsAtom);
  const { href, pathname } = location;
  const search = location.search as Record<string, unknown>;
  const taskTitle =
    pathname.startsWith("/orchestrator/tasks/") &&
    childTitles.get(pathname.slice("/orchestrator/tasks/".length) as TaskId);

  useEffect(() => {
    const entry = recentFor({
      href,
      pathname,
      search,
      taskTitle: taskTitle || undefined,
    });
    if (!entry) {
      return;
    }
    // A screen counts once the user has stayed on it a moment: clicking down
    // through folders passes through many that were never the destination.
    const timer = setTimeout(() => {
      setRecents((current) =>
        [
          { ...entry, at: Date.now() },
          ...current.filter((recent) => recent.href !== entry.href),
        ].slice(0, RECENTS_MAX),
      );
    }, RECENT_DWELL_MS);
    return () => {
      clearTimeout(timer);
    };
    // The search object is a new one each render; its address is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href, pathname, taskTitle, setRecents]);
}

/**
 * What the main process asks of the window: back and forward from a trackpad
 * swipe, a thumb button or the History menu, and the tab chords: close,
 * new, reopen, next and previous, one by number.
 * On a Mac the thumb buttons reach the page as mouse events and nothing else,
 * so they are answered here; elsewhere they arrive through the main process.
 */
function useWindowCommands(handlers: {
  closeTab: () => void;
  newTab: () => void;
  reopenTab: () => void;
  selectRelative: (direction: -1 | 1) => void;
  selectTab: (index: number) => void;
}) {
  const router = useRouter();
  // The stream is opened once; what a chord means is read at the moment it
  // fires, off whatever tab is up then.
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 3) {
        router.history.back();
      } else if (event.button === 4) {
        router.history.forward();
      }
    };
    if (isMacOS()) {
      window.addEventListener("mouseup", onMouseUp);
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const commands = await rpcClient.orchestrator.events.command.call(
          undefined,
          { signal: controller.signal },
        );
        for await (const command of commands) {
          if (typeof command === "object") {
            latest.current.selectTab(command.index);
            continue;
          }
          switch (command) {
            case "back": {
              router.history.back();
              break;
            }
            case "closeTab": {
              latest.current.closeTab();
              break;
            }
            case "forward": {
              router.history.forward();
              break;
            }
            case "newTab": {
              latest.current.newTab();
              break;
            }
            case "nextTab": {
              latest.current.selectRelative(1);
              break;
            }
            case "previousTab": {
              latest.current.selectRelative(-1);
              break;
            }
            case "reopenTab": {
              latest.current.reopenTab();
              break;
            }
          }
        }
      } catch {
        // The window is closing, which is the only way the stream ends.
      }
    })();
    return () => {
      controller.abort();
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [router]);
}
