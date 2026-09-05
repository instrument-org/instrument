import {
  clampChatWidth,
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
  BrowserView,
  type BrowserViewHandle,
} from "@/client/components/orchestrator/browser-view";
import {
  OrchestratorContext,
  type OrchestratorWindow,
} from "@/client/components/orchestrator/context";
import { OrchestratorSidebar } from "@/client/components/orchestrator/sidebar";
import { StudioSidebarRail } from "@/client/components/studio-sidebar-rail";
import { TaskChat } from "@/client/components/task/chat";
import { Toaster } from "@/client/components/ui/sonner";
import { Spinner } from "@/client/components/ui/spinner";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { type TaskId } from "@instrument-org/workspace/client";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { skipToken, useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import ms from "ms";
import { type ReactNode, useEffect, useState } from "react";

/** How often the orchestrator's tasks and their status are re-read. */
const REFRESH_MS = ms("2 seconds");

export const Route = createFileRoute("/orchestrator")({
  component: OrchestratorLayout,
  head: () => ({ meta: [{ title: APP_NAME }] }),
});

/**
 * The conversation down the right, dragged wider or narrower by its left
 * edge, and gone when the mark in the corner is off.
 */
function ChatRail({
  children,
  isOpen,
}: {
  children: ReactNode;
  isOpen: boolean;
}) {
  const [width, setWidth] = useAtom(orchestratorChatWidthAtom);
  if (!isOpen) {
    return null;
  }
  return (
    <aside
      className="relative flex shrink-0 flex-col border-l border-border pt-10"
      style={{ width }}
    >
      <div
        aria-label="Resize Instrument"
        aria-orientation="vertical"
        className="absolute inset-y-0 left-0 z-20 w-2 -translate-x-1/2 cursor-col-resize select-none hover:bg-foreground/10"
        onPointerDown={(event) => {
          const startX = event.clientX;
          const startWidth = width;
          const target = event.currentTarget;
          target.setPointerCapture(event.pointerId);
          const move = (moveEvent: PointerEvent) => {
            setWidth(clampChatWidth(startWidth - (moveEvent.clientX - startX)));
          };
          const up = () => {
            target.removeEventListener("pointermove", move);
            target.removeEventListener("pointerup", up);
          };
          target.addEventListener("pointermove", move);
          target.addEventListener("pointerup", up);
        }}
        role="separator"
      />
      {children}
    </aside>
  );
}

/**
 * The window's chrome: no title bar, a strip along the top that drags the
 * window, the sidebar toggle at the left of it past the traffic lights, and
 * the Instrument mark at the right of it.
 */
function Frame({
  children,
  isChatOpen,
  isSidebarOpen,
  isThinking,
  onToggleChat,
  onToggleSidebar,
}: {
  children: ReactNode;
  isChatOpen: boolean;
  isSidebarOpen: boolean;
  isThinking: boolean;
  onToggleChat: () => void;
  onToggleSidebar: () => void;
}) {
  return (
    <div className="relative flex h-screen bg-background">
      <div className="absolute inset-x-0 top-0 z-10 h-10 [-webkit-app-region:drag]" />
      <button
        aria-label={isSidebarOpen ? "Hide sidebar" : "Show sidebar"}
        className="absolute top-2 left-20 z-20 rounded-md p-1 text-muted-foreground [-webkit-app-region:no-drag] hover:bg-foreground/5 hover:text-foreground"
        onClick={onToggleSidebar}
        type="button"
      >
        <SidebarSimpleIcon className="size-4" />
      </button>
      <button
        aria-label={isChatOpen ? "Hide Instrument" : "Show Instrument"}
        className={cn(
          "absolute top-2 right-3 z-20 flex size-6 items-center justify-center rounded-full [-webkit-app-region:no-drag]",
          isChatOpen
            ? "bg-foreground text-background"
            : "bg-foreground/10 text-foreground hover:bg-foreground/20",
        )}
        onClick={onToggleChat}
        type="button"
      >
        {isThinking ? (
          <Spinner className="size-3.5" />
        ) : (
          <InstrumentMark className="size-3.5" />
        )}
      </button>
      {children}
      <Toaster position="top-center" />
    </div>
  );
}

/** The mark: two bars, as the wordmark's icon draws them. */
function InstrumentMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="currentColor"
      viewBox="0 0 16 16"
    >
      <rect height="3" rx="1.5" width="12" x="2" y="4" />
      <rect height="3" rx="1.5" width="8" x="6" y="9" />
    </svg>
  );
}

/**
 * The window: the places in the product down the left, the screen that is up
 * in the middle, the conversation down the right. No title bar: each column
 * starts at the top of the window and leaves room for the traffic lights,
 * and the Instrument mark in the top right corner opens and closes the
 * conversation. The browser is mounted here rather than by its screen, so
 * the page it holds survives the user leaving for a folder and coming back.
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
  const childIds = children.data?.map((child) => child.id) ?? [];
  const status = useQuery(
    rpcClient.workspace.task.agentStatus.byIds.queryOptions({
      input: ids ? { ids: [ids.taskId, ...childIds] } : skipToken,
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

  // The browser hands its handle over once mounted; state rather than a ref,
  // since the send handler below and the screens read it.
  const [browser, setBrowser] = useState<BrowserViewHandle | null>(null);
  const recordBrowserPage = useRecordRecents({
    childTitles: new Map(
      children.data?.map((child) => [child.id, child.title]) ?? [],
    ),
  });

  const running = new Set<TaskId>(
    status.data
      ?.filter((entry) =>
        entry.sessionActors.some((actor) => actor.tags.includes("agent.alive")),
      )
      .map((entry) => entry.taskId) ?? [],
  );
  const isThinking = ids !== undefined && running.has(ids.taskId);

  const screens: null | OrchestratorWindow = ids
    ? {
        browser,
        outputFolder: ids.outputFolder,
        sessionId: ids.sessionId,
        taskId: ids.taskId,
      }
    : null;

  const chrome = {
    isChatOpen,
    isSidebarOpen,
    isThinking,
    onToggleChat: () => {
      setChatOpen((open) => !open);
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
        <div className="flex h-full items-center justify-center">
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
              <BrowserView onPageChange={recordBrowserPage} ref={setBrowser} />
            </div>
          </main>
          <ChatRail isOpen={isChatOpen}>
            <TaskChat
              alwaysSubmittable
              navigateOnSend={false}
              presentation="orchestrator"
              promptDraft={state.data.promptDraft ?? ""}
              selectedModelURI={state.data.selectedModelURI ?? defaultModelURI}
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
                  ...(computerView?.mount ? { mount: computerView.mount } : {}),
                  ...(page ? { page } : {}),
                  selected: computerView?.selected ?? [],
                };
              }}
              task={task.data}
            />
          </ChatRail>
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
      // This Mac itself is a place in the sidebar already.
      return folder ? { href, kind: "folder", title: folder } : undefined;
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
