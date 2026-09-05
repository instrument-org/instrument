import {
  CHAT_WIDTH_DEFAULT,
  CHAT_WIDTH_MAX,
  CHAT_WIDTH_MIN,
  computerViewAtom,
  orchestratorChatOpenAtom,
  orchestratorChatWidthAtom,
  type OrchestratorRecent,
  orchestratorRecentsAtom,
  orchestratorSidebarOpenAtom,
  RECENTS_MAX,
} from "@/client/atoms/orchestrator";
import { FileOpenContext } from "@/client/components/file-open-context";
import {
  type BrowserPage,
  BrowserTabs,
  type BrowserTabsHandle,
} from "@/client/components/orchestrator/browser-tabs";
import {
  OrchestratorContext,
  type OrchestratorWindow,
} from "@/client/components/orchestrator/context";
import { OrchestratorSidebar } from "@/client/components/orchestrator/sidebar";
import {
  type RailBounds,
  StudioSidebarRail,
} from "@/client/components/studio-sidebar-rail";
import { TaskChat } from "@/client/components/task/chat";
import { Toaster } from "@/client/components/ui/sonner";
import { Spinner } from "@/client/components/ui/spinner";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { type TaskId } from "@instrument-org/workspace/client";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { skipToken, useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Outlet,
  useCanGoBack,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import ms from "ms";
import { type ReactNode, useEffect, useState } from "react";

/** How often the orchestrator's tasks and their status are re-read. */
const REFRESH_MS = ms("2 seconds");

/** How long a screen has to stay up before Recent counts it. */
const RECENT_DWELL_MS = ms("2 seconds");

const CHAT_BOUNDS: RailBounds = {
  collapse: 240,
  initial: CHAT_WIDTH_DEFAULT,
  max: CHAT_WIDTH_MAX,
  min: CHAT_WIDTH_MIN,
};

export const Route = createFileRoute("/orchestrator")({
  component: OrchestratorLayout,
  head: () => ({ meta: [{ title: APP_NAME }] }),
});

/**
 * What is going on behind the conversation, just above the composer: the
 * tasks at work, named by what each is doing this moment rather than by task,
 * so a reply that handed the work off does not read as the end of it.
 */
function ActivityStrip({
  running,
}: {
  running: { step?: string; taskId: string; title: string }[];
}) {
  if (running.length === 0) {
    return null;
  }
  const latest = running.find((entry) => entry.step) ?? running[0];
  const doing = latest?.step ?? latest?.title;
  return (
    <div className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
      <Spinner className="size-3 shrink-0" />
      <span className="truncate">
        {running.length > 1 ? `${running.length} things in progress · ` : ""}
        {doing}
      </span>
    </div>
  );
}

function ChromeButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="rounded-md p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * The window's chrome. It drags by its top-left corner only, so the rest of
 * the top edge is the screens' to use; past the traffic lights sit the
 * sidebar toggle and back and forward; and when the conversation is away,
 * the mark floats in the bottom right corner to bring it back.
 */
function Frame({
  children,
  isBusy,
  isChatOpen,
  isSidebarOpen,
  onOpenChat,
  onToggleSidebar,
}: {
  children: ReactNode;
  isBusy: boolean;
  isChatOpen: boolean;
  isSidebarOpen: boolean;
  onOpenChat: () => void;
  onToggleSidebar: () => void;
}) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  return (
    <div className="relative flex h-screen bg-background">
      <div className="absolute top-0 left-0 z-10 h-10 w-60 [-webkit-app-region:drag]" />
      <div className="absolute top-2 left-20 z-20 flex items-center gap-0.5 [-webkit-app-region:no-drag]">
        <ChromeButton
          label={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
          onClick={onToggleSidebar}
        >
          <SidebarSimpleIcon className="size-4" />
        </ChromeButton>
        <ChromeButton
          disabled={!canGoBack}
          label="Back"
          onClick={() => {
            router.history.back();
          }}
        >
          <ArrowLeftIcon className="size-4" />
        </ChromeButton>
        <ChromeButton
          label="Forward"
          onClick={() => {
            router.history.forward();
          }}
        >
          <ArrowRightIcon className="size-4" />
        </ChromeButton>
      </div>
      {children}
      {isChatOpen ? null : (
        <button
          aria-label="Show Instrument"
          className="fixed right-4 bottom-4 z-30 flex size-11 items-center justify-center rounded-full bg-foreground text-background shadow-lg hover:scale-105"
          onClick={onOpenChat}
          type="button"
        >
          {isBusy ? (
            <Spinner className="size-5" />
          ) : (
            <InstrumentGlyph className="size-5" />
          )}
        </button>
      )}
      <Toaster position="top-center" />
    </div>
  );
}

/**
 * The window: the places in the product down the left, the screen that is up
 * in the middle, the conversation down the right. No title bar: the window
 * drags by its top-left corner, past the traffic lights sit the sidebar
 * toggle and back and forward, and the conversation is a rail like the
 * sidebar, with the Instrument mark floating in the corner when it is away.
 * The browser is mounted here rather than by its screen, so the page it
 * holds survives the user leaving for a folder and coming back.
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
  const status = useQuery(
    rpcClient.workspace.task.agentStatus.byIds.queryOptions({
      input: ids ? { ids: [ids.taskId] } : skipToken,
      refetchInterval: REFRESH_MS,
    }),
  );
  const activity = useQuery(
    rpcClient.workspace.orchestrator.activity.queryOptions({
      input: ids ? { id: ids.taskId } : skipToken,
      refetchInterval: REFRESH_MS,
    }),
  );
  const [defaultModelURI] = useDefaultModelURI();
  const [isSidebarOpen, setSidebarOpen] = useAtom(orchestratorSidebarOpenAtom);
  const [isChatOpen, setChatOpen] = useAtom(orchestratorChatOpenAtom);
  const computerView = useAtomValue(computerViewAtom);
  const navigate = useNavigate();
  const location = useRouterState({
    select: (routerState) => routerState.location,
  });
  const isBrowserScreen = location.pathname === "/orchestrator/browser";
  useHistoryShortcuts();

  // The browser hands its handle over once mounted; state rather than a ref,
  // since the send handler below and the screens read it.
  const [browser, setBrowser] = useState<BrowserTabsHandle | null>(null);
  const recordBrowserPage = useRecordRecents({
    childTitles: new Map(
      children.data?.map((child) => [child.id, child.title]) ?? [],
    ),
  });

  const isThinking =
    status.data?.some((entry) =>
      entry.sessionActors.some((actor) => actor.tags.includes("agent.alive")),
    ) ?? false;
  const running = activity.data?.running ?? [];
  const isBusy = isThinking || running.length > 0;

  const screens: null | OrchestratorWindow = ids
    ? {
        browser,
        outputFolder: ids.outputFolder,
        sessionId: ids.sessionId,
        taskId: ids.taskId,
      }
    : null;

  const chrome = {
    isBusy,
    isChatOpen,
    isSidebarOpen,
    onOpenChat: () => {
      setChatOpen(true);
    },
    onToggleSidebar: () => {
      setSidebarOpen((open) => !open);
    },
  };

  if (ensure.error) {
    return (
      <Frame {...chrome}>
        <p className="p-4 pt-12 text-sm text-destructive">
          Could not open the conversation: {ensure.error.message}
        </p>
      </Frame>
    );
  }

  if (!screens || !task.data || !state.data) {
    return (
      <Frame {...chrome}>
        <div className="flex h-full flex-1 items-center justify-center">
          <Spinner className="size-6" />
        </div>
      </Frame>
    );
  }

  return (
    <OrchestratorContext value={screens}>
      <FileOpenContext
        value={(filePath) => {
          void navigate({
            search: { path: filePath },
            to: "/orchestrator/file",
          });
        }}
      >
        <Frame {...chrome}>
          <StudioSidebarRail
            isOpen={isSidebarOpen}
            onCollapse={() => {
              setSidebarOpen(false);
            }}
          >
            <div className="flex min-h-0 w-full flex-1 flex-col pt-10">
              <OrchestratorSidebar className="min-h-0 w-full flex-1" />
            </div>
          </StudioSidebarRail>
          <main className="relative flex min-w-0 flex-1 flex-col">
            <Outlet />
            {/* Hidden rather than unmounted when another screen is up, so the page stays. */}
            <div
              className={cn(
                "absolute inset-0 bg-background pt-10",
                isBrowserScreen ? undefined : "invisible",
              )}
            >
              <BrowserTabs onPageChange={recordBrowserPage} ref={setBrowser} />
            </div>
          </main>
          <StudioSidebarRail
            bounds={CHAT_BOUNDS}
            isOpen={isChatOpen}
            label="Resize Instrument"
            onCollapse={() => {
              setChatOpen(false);
            }}
            panelClassName="bg-background"
            side="right"
            widthAtom={orchestratorChatWidthAtom}
          >
            <div className="flex min-h-0 w-full flex-1 flex-col">
              <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-sm font-medium">
                <InstrumentGlyph className="size-4" />
                <span>{APP_NAME}</span>
                {isBusy ? (
                  <Spinner className="size-3 text-muted-foreground" />
                ) : null}
                <span className="flex-1" />
                <button
                  aria-label="Hide Instrument"
                  className="rounded-md p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  onClick={() => {
                    setChatOpen(false);
                  }}
                  type="button"
                >
                  <SidebarSimpleIcon className="size-4 -scale-x-100" />
                </button>
              </header>
              <div className="min-h-0 flex-1">
                <TaskChat
                  alwaysSubmittable
                  composerLead={<ActivityStrip running={running} />}
                  navigateOnSend={false}
                  presentation="orchestrator"
                  promptDraft={state.data.promptDraft ?? ""}
                  selectedModelURI={
                    state.data.selectedModelURI ?? defaultModelURI
                  }
                  selectedSessionId={screens.sessionId}
                  sendContext={async () => {
                    const page = isBrowserScreen
                      ? await browser?.readPage()
                      : undefined;
                    if (!computerView && !page) {
                      return;
                    }
                    return {
                      folder: computerView?.folder ?? "~",
                      ...(computerView?.mount
                        ? { mount: computerView.mount }
                        : {}),
                      ...(page ? { page } : {}),
                      selected: computerView?.selected ?? [],
                    };
                  }}
                  task={task.data}
                />
              </div>
            </div>
          </StudioSidebarRail>
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
    case "/orchestrator/browser": {
      // One browser, one entry, whatever address it was sent.
      return {
        href: "/orchestrator/browser",
        kind: "browser",
        title: "Browser",
      };
    }
    case "/orchestrator/computer": {
      const path = typeof search.path === "string" ? search.path : "";
      const folder = path.replace(/\/$/, "").split("/").at(-1);
      // The roots are places in the sidebar already.
      if (!folder) {
        return undefined;
      }
      return { href, kind: "folder", title: folder };
    }
    case "/orchestrator/file": {
      const path = typeof search.path === "string" ? search.path : "";
      return { href, kind: "file", title: path.split("/").at(-1) || "File" };
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
 * Back and forward as a browser has them: Cmd+[ and Cmd+], and the thumb
 * buttons on a mouse. The webview swallows its own, so these reach only the
 * window's own screens.
 */
function useHistoryShortcuts() {
  const router = useRouter();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.altKey || event.ctrlKey) {
        return;
      }
      if (event.key === "[") {
        event.preventDefault();
        router.history.back();
      } else if (event.key === "]") {
        event.preventDefault();
        router.history.forward();
      }
    };
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 3) {
        router.history.back();
      } else if (event.button === 4) {
        router.history.forward();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [router]);
}

/**
 * Keeps the Recent list: every screen the window lands on goes to the top,
 * one entry per address. The browser's entry is named for the page it shows,
 * which arrives after the screen does, so this also hands back the function
 * that renames it.
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

  const record = (entry: Omit<OrchestratorRecent, "at">) => {
    setRecents((current) => {
      const previous = current.find((recent) => recent.href === entry.href);
      const title =
        // The browser keeps the name of the page it shows across visits.
        entry.kind === "browser" && previous ? previous.title : entry.title;
      return [
        { ...entry, at: Date.now(), title },
        ...current.filter((recent) => recent.href !== entry.href),
      ].slice(0, RECENTS_MAX);
    });
  };

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
      record(entry);
    }, RECENT_DWELL_MS);
    return () => {
      clearTimeout(timer);
    };
    // The search object is a new one each render; its address is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href, pathname, taskTitle, setRecents]);

  return (page: BrowserPage | undefined) => {
    if (!page?.title) {
      return;
    }
    setRecents((current) =>
      current.map((recent) =>
        recent.kind === "browser" ? { ...recent, title: page.title } : recent,
      ),
    );
  };
}
