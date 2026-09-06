import {
  CHAT_WIDTH_DEFAULT,
  CHAT_WIDTH_MAX,
  CHAT_WIDTH_MIN,
  fileTabsAtom,
  linkedFilesAtom,
  orchestratorChatOpenAtom,
  orchestratorChatWidthAtom,
  type OrchestratorRecent,
  orchestratorRecentsAtom,
  orchestratorSidebarOpenAtom,
  RECENTS_MAX,
  screenViewAtom,
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
import {
  TasksWorkingRow,
  ViewChip,
} from "@/client/components/orchestrator/conversation-chrome";
import {
  hostPathOfMount,
  useCloseFileTab,
  useReopenFileTab,
} from "@/client/components/orchestrator/file-tabs";
import { OrchestratorSidebar } from "@/client/components/orchestrator/sidebar";
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
import { pathsNamedInMessage } from "@/client/lib/paths-named-in-message";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { type TaskId } from "@instrument-org/workspace/client";
import { ArrowLeftIcon } from "@phosphor-icons/react/ArrowLeft";
import { ArrowRightIcon } from "@phosphor-icons/react/ArrowRight";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
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
import { type ReactNode, useEffect, useRef, useState } from "react";

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
 * the mark floats in the bottom right corner to bring it back, with a dot on
 * it while there is a reply the user has not seen.
 */
function Frame({
  children,
  hasUnread,
  isChatOpen,
  isSidebarOpen,
  onOpenChat,
  onToggleSidebar,
}: {
  children: ReactNode;
  hasUnread: boolean;
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
          aria-label={
            hasUnread ? "Show Instrument, new reply" : "Show Instrument"
          }
          className="fixed right-4 bottom-4 z-30 size-11 text-brand-600 transition-transform hover:scale-105 dark:text-brand-400"
          onClick={onOpenChat}
          type="button"
        >
          <InstrumentGlyph className="size-11" />
          {hasUnread ? (
            <span className="absolute -top-0.5 -right-0.5 size-3 rounded-full bg-foreground ring-2 ring-background" />
          ) : null}
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
  // The same subscription the conversation holds, read here for the dot on
  // the mark: which reply is newest, against which one the user last had open.
  const messages = useQuery(
    rpcClient.workspace.message.live.list.experimental_liveOptions({
      input: ids ? { id: ids.taskId, sessionId: ids.sessionId } : skipToken,
    }),
  );
  const [defaultModelURI] = useDefaultModelURI();
  const [isSidebarOpen, setSidebarOpen] = useAtom(orchestratorSidebarOpenAtom);
  const [isChatOpen, setChatOpen] = useAtom(orchestratorChatOpenAtom);
  const screenView = useAtomValue(screenViewAtom);
  const setFileTabs = useSetAtom(fileTabsAtom);
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
  const navigate = useNavigate();
  const location = useRouterState({
    select: (routerState) => routerState.location,
  });
  const isBrowserScreen = location.pathname === "/orchestrator/browser";

  // The browser hands its handle over once mounted; state rather than a ref,
  // since the send handler below and the screens read it.
  const [browser, setBrowser] = useState<BrowserTabsHandle | null>(null);
  const closeFileTab = useCloseFileTab();
  const reopenFileTab = useReopenFileTab();
  useWindowCommands({
    closeTab: () => {
      if (isBrowserScreen) {
        browser?.closeActive();
      } else {
        closeFileTab();
      }
    },
    reopenTab: () => {
      if (isBrowserScreen) {
        browser?.reopenClosed();
      } else {
        reopenFileTab();
      }
    },
  });
  const recordBrowserPage = useRecordRecents({
    childTitles: new Map(
      children.data?.map((child) => [child.id, child.title]) ?? [],
    ),
  });

  const latestReplyId = messages.data?.findLast(
    (message) =>
      message.role === "assistant" &&
      message.parts.some(
        (part) => part.type === "text" && part.text.trim() !== "",
      ),
  )?.id;
  // The reply that was newest when the conversation was put away: a newer one
  // since is one the user has not seen.
  const [seenReplyId, setSeenReplyId] = useState<string | undefined>();
  const closeChat = () => {
    setSeenReplyId(latestReplyId);
    setChatOpen(false);
  };
  const hasUnread =
    !isChatOpen && latestReplyId !== undefined && latestReplyId !== seenReplyId;

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
          setChatOpen(true);
          createMessage.mutate({
            id: ids.taskId,
            modelURI,
            prompt,
            sessionId: ids.sessionId,
          });
        },
        browser,
        outputFolder: ids.outputFolder,
        sessionId: ids.sessionId,
        taskId: ids.taskId,
      }
    : null;

  const chrome = {
    hasUnread,
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

  const attachedFolders = state.data.attachedFolders ?? {};

  return (
    <OrchestratorContext value={screens}>
      {/* A file the conversation offers opens in a tab on This Mac, beside whatever folder is up there. */}
      <FileOpenContext
        value={(filePath) => {
          const hostPath = hostPathOfMount(filePath, attachedFolders);
          setFileTabs((current) =>
            current.some((tab) => tab.mount === filePath)
              ? current
              : [
                  ...current,
                  {
                    ...(hostPath ? { hostPath } : {}),
                    mount: filePath,
                    name: filePath.split("/").at(-1) ?? filePath,
                  },
                ],
          );
          void navigate({
            search: (previous: { path?: string; root?: string }) => ({
              file: filePath,
              path: previous.path ?? "",
              root: previous.root ?? "~",
            }),
            to: "/orchestrator/computer",
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
          {/* With the sidebar away, the traffic lights and the window controls sit over the top of the screen, so it starts below them. */}
          <main
            className={cn(
              "relative flex min-w-0 flex-1 flex-col",
              isSidebarOpen ? undefined : "pt-10",
            )}
          >
            <Outlet />
            {/* Hidden rather than unmounted when another screen is up, so the page stays. */}
            <div
              className={cn(
                "absolute inset-x-0 bottom-0 bg-background",
                isSidebarOpen ? "top-0" : "top-10",
                isBrowserScreen ? undefined : "invisible",
              )}
            >
              {/* The guests are the pool's, drawn over a slot rather than in it, so hiding this box hides nothing of theirs: the panel parks its guest when told the screen is off, the way a task page does when its tab is in the background. */}
              <ActiveTabProvider isActive={isBrowserScreen}>
                <BrowserTabs
                  onPageChange={recordBrowserPage}
                  ref={setBrowser}
                />
              </ActiveTabProvider>
            </div>
          </main>
          <StudioSidebarRail
            bounds={CHAT_BOUNDS}
            isOpen={isChatOpen}
            label="Resize Instrument"
            onCollapse={closeChat}
            panelClassName="bg-background"
            side="right"
            widthAtom={orchestratorChatWidthAtom}
          >
            <div className="flex min-h-0 w-full flex-1 flex-col">
              <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3 text-sm font-medium">
                <InstrumentGlyph className="size-4" />
                <span>{APP_NAME}</span>
                <span className="flex-1" />
                <button
                  aria-label="Hide Instrument"
                  className="rounded-md p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  onClick={closeChat}
                  type="button"
                >
                  <SidebarSimpleIcon className="size-4 -scale-x-100" />
                </button>
              </header>
              <div className="min-h-0 flex-1">
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
                  // What the screen that is up says it shows, plus the page's
                  // words when that screen is the browser, read at the moment
                  // of sending; a screen that registered nothing sends nothing.
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
      const file = typeof search.file === "string" ? search.file : "";
      if (file) {
        return { href, kind: "file", title: file.split("/").at(-1) || "File" };
      }
      const path = typeof search.path === "string" ? search.path : "";
      const folder = path.replace(/\/$/, "").split("/").at(-1);
      // The roots are places in the sidebar already.
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
        recent.kind === "browser"
          ? {
              ...recent,
              ...(page.favicon ? { favicon: page.favicon } : {}),
              title: page.title,
            }
          : recent,
      ),
    );
  };
}

/**
 * What the main process asks of the window: back and forward from a trackpad
 * swipe, a thumb button or the History menu, and the close of the tab on
 * screen from Cmd+W, the reopening of the last closed one from Shift+Cmd+T.
 * The thumb buttons also arrive as mouse events here,
 * for a mouse whose buttons the window sees before the main process does.
 */
function useWindowCommands({
  closeTab,
  reopenTab,
}: {
  closeTab: () => void;
  reopenTab: () => void;
}) {
  const router = useRouter();
  // The stream is opened once; what a close or a reopen means is read at the
  // moment of the chord, off whatever screen is up then.
  const latest = useRef({ closeTab, reopenTab });
  useEffect(() => {
    latest.current = { closeTab, reopenTab };
  });
  useEffect(() => {
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 3) {
        router.history.back();
      } else if (event.button === 4) {
        router.history.forward();
      }
    };
    window.addEventListener("mouseup", onMouseUp);
    const controller = new AbortController();
    void (async () => {
      try {
        const commands = await rpcClient.orchestrator.events.command.call(
          undefined,
          { signal: controller.signal },
        );
        for await (const command of commands) {
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
