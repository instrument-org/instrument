import {
  linkedFilesAtom,
  NEW_TAB_HREF,
  type OrchestratorRecent,
  orchestratorRecentsAtom,
  orchestratorSidebarOpenAtom,
  orchestratorSidebarWidthAtom,
  RECENTS_MAX,
  screenViewAtom,
  selectedChannelAtom,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
} from "@/client/atoms/orchestrator";
import { FileOpenContext } from "@/client/components/file-open-context";
import { FilesLayoutContext } from "@/client/components/files-layout-context";
import {
  BrowserTabs,
  type BrowserTabsHandle,
} from "@/client/components/orchestrator/browser-tabs";
import { ChannelBanner } from "@/client/components/orchestrator/channel-banner";
import {
  ChannelMenu,
  type MenuAt,
} from "@/client/components/orchestrator/channel-menu";
import { ChannelRail } from "@/client/components/orchestrator/channel-rail";
import {
  OrchestratorContext,
  type OrchestratorWindow,
} from "@/client/components/orchestrator/context";
import { ViewChip } from "@/client/components/orchestrator/conversation-chrome";
import { fileHref } from "@/client/components/orchestrator/file-tabs";
import { NewChannelDialog } from "@/client/components/orchestrator/new-channel-dialog";
import { screenPresentation } from "@/client/components/orchestrator/screen-presentation";
import { WindowTabStrip } from "@/client/components/orchestrator/window-tab-strip";
import {
  PAGE_ROUTE,
  parseHref,
  usePopClosedTab,
  useWindowTabs,
} from "@/client/components/orchestrator/window-tabs";
import { PageOpenContext } from "@/client/components/page-open-context";
import {
  type RailBounds,
  StudioSidebarRail,
} from "@/client/components/studio-sidebar-rail";
import { TaskChat } from "@/client/components/task/chat";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/client/components/ui/alert-dialog";
import { Toaster } from "@/client/components/ui/sonner";
import { Spinner } from "@/client/components/ui/spinner";
import { InstrumentGlyph } from "@/client/components/wordmark";
import { ActiveTabProvider } from "@/client/hooks/use-active-tab";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { TaskSessionProvider } from "@/client/hooks/use-task-session";
import { pathsNamedInMessage } from "@/client/lib/paths-named-in-message";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { StoreId, type TaskId } from "@instrument-org/workspace/client";
import { SidebarSimpleIcon } from "@phosphor-icons/react/SidebarSimple";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Outlet,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import ms from "ms";
import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

// The panel that turns Instrument 2.0 off again, in the window it turns off:
// loaded only where developer mode already put it.
const DevPanel = lazy(() =>
  import("@/client/components/dev-panel").then((m) => ({
    default: m.DevPanel,
  })),
);

/** How often the tasks' titles are re-read, for the strip. */
const REFRESH_MS = ms("2 seconds");

/** How long a screen has to stay up before Recent counts it. */
const RECENT_DWELL_MS = ms("2 seconds");

/** Dragged under the collapse point, the sidebar shrinks to a rail; it is never gone. */
const SIDEBAR_BOUNDS: RailBounds = {
  collapse: 220,
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
  // The channels of the one conversation, and which of them is on screen. A
  // channel is a session, so everything below that took a session id takes the
  // selected channel's instead.
  const channels = useQuery(
    rpcClient.workspace.orchestrator.channels.list.queryOptions({
      input: ids ? { id: ids.taskId } : skipToken,
      refetchInterval: REFRESH_MS,
    }),
  );
  const [selectedChannel, setSelectedChannel] = useAtom(selectedChannelAtom);
  const channelList = channels.data ?? [];
  const channelId =
    channelList.find((channel) => channel.id === selectedChannel)?.id ??
    channelList[0]?.id;
  const sessionId = channelId
    ? StoreId.SessionSchema.parse(channelId)
    : ids?.sessionId;
  // The tabs are kept per channel and keyed by this, so a selection that is
  // still null while the list loads would file the first tabs opened under
  // nothing. Written the moment the list settles rather than left implied.
  useEffect(() => {
    // Only when nothing is chosen. A channel just made is selected by its own
    // mutation before the list has been re-read, and writing the fallback back
    // over it here would drop the user on the first channel instead.
    if (!selectedChannel && channelId) {
      setSelectedChannel(channelId);
    }
  }, [channelId, selectedChannel, setSelectedChannel]);
  const createChannel = useMutation(
    rpcClient.workspace.orchestrator.channels.create.mutationOptions({
      onSuccess: async (channel) => {
        // Re-read first: the rail has to know the channel exists before the
        // window is switched to it.
        await channels.refetch();
        setSelectedChannel(channel.id);
      },
    }),
  );
  const markSeen = useMutation(
    rpcClient.workspace.orchestrator.channels.seen.mutationOptions(),
  );
  const afterChannelChange = { onSuccess: () => void channels.refetch() };
  const updateChannel = useMutation(
    rpcClient.workspace.orchestrator.channels.update.mutationOptions(
      afterChannelChange,
    ),
  );
  const archiveChannel = useMutation(
    rpcClient.workspace.orchestrator.channels.archive.mutationOptions(
      afterChannelChange,
    ),
  );
  // Which channels have a task running, for the ring on their marks and for
  // the line under the banner of the one on screen.
  const activity = useQuery(
    rpcClient.workspace.orchestrator.activity.queryOptions({
      input: ids ? { id: ids.taskId } : skipToken,
      refetchInterval: REFRESH_MS,
    }),
  );
  const running = activity.data?.running ?? [];
  const workingChannels = new Set(
    running.flatMap((task) => (task.channel ? [task.channel] : [])),
  );
  const [isNewChannelOpen, setNewChannelOpen] = useState(false);
  // Which channel a menu was asked for and where, so the rail's right click
  // and the banner's caret open the same one.
  const [menu, setMenu] = useState<{ at: MenuAt; id: string }>();
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
  const childTitles = new Map<TaskId, string>(
    children.data?.map((child) => [child.id, child.title]) ?? [],
  );
  const messages = useQuery(
    rpcClient.workspace.message.live.list.experimental_liveOptions({
      input: ids && sessionId ? { id: ids.taskId, sessionId } : skipToken,
    }),
  );
  // What the user has seen in the channel they are looking at, so its count
  // clears while they read rather than only when they leave.
  const newestMessageId = messages.data?.at(-1)?.id;
  useEffect(() => {
    if (!ids || !sessionId) {
      return;
    }
    markSeen.mutate({ id: ids.taskId, sessionId });
    // The mutation is stable; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [ids?.taskId, sessionId, newestMessageId]);
  const [defaultModelURI] = useDefaultModelURI();
  const screenView = useAtomValue(screenViewAtom);
  const [isSidebarOpen, setSidebarOpen] = useAtom(orchestratorSidebarOpenAtom);
  const isDeveloperMode = useDeveloperMode();
  const setLinkedFiles = useSetAtom(linkedFilesAtom);
  const conversationRef = useRef<HTMLDivElement>(null);
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

  // The window is never empty: with no tab, the screen the router is at
  // becomes one, or a new tab when the router is at the page route. The one
  // opener while the list is empty; the effects below wait for it.
  useEffect(() => {
    if (tabs.length === 0) {
      // A channel with nothing open starts where a new tab starts, rather than
      // inheriting whatever the channel before it was showing.
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
    if (tabs.length === 0) {
      return;
    }
    if (location.pathname === PAGE_ROUTE) {
      // History walked back to the page route while a screen is up (a page
      // was on screen at that point in the history); the screen stays, and
      // the address goes back to it.
      if (active?.kind === "screen") {
        router.history.replace(active.href);
      }
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

  // What the conversation asks to open, as it asks: a page as a tab, a file
  // of the user's as a file tab. The openers are read at the moment of each
  // ask, since they close over the tabs as they are then.
  const openers = useRef({ openPage, openScreen });
  useEffect(() => {
    openers.current = { openPage, openScreen };
  });
  useEffect(() => {
    if (!ids) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const asks = await rpcClient.workspace.orchestrator.events.open.call(
          { id: ids.taskId },
          { signal: controller.signal },
        );
        for await (const target of asks) {
          if (target.kind === "page") {
            openers.current.openPage(target.url);
          } else {
            openers.current.openScreen(fileHref(target.mount));
          }
        }
      } catch {
        // The window closing ends the stream.
      }
    })();
    return () => {
      controller.abort();
    };
  }, [ids]);

  // Closing a task's browser tab closes the browser, and the task loses its
  // page; while the task is in it, the user is asked first.
  const [closingBrowser, setClosingBrowser] = useState<{
    id: string;
    taskId: TaskId;
    title: string;
  }>();
  const closeTaskBrowser = (id: string, taskId: TaskId) => {
    void rpcClient.workspace.browser.close.call({
      id: taskId,
      sessionId: StoreId.SessionSchema.parse(id),
    });
    windowTabs.close(id);
  };
  const requestClose = (id: string) => {
    const tab = tabs.find((entry) => entry.id === id);
    if (tab?.kind !== "page" || !tab.taskId) {
      windowTabs.close(id);
      return;
    }
    const { taskId } = tab;
    void rpcClient.workspace.orchestrator.childStatus
      .call({ id: taskId })
      .then((status) => {
        if (status.isWorking) {
          setClosingBrowser({ id, taskId, title: status.title });
        } else {
          closeTaskBrowser(id, taskId);
        }
      })
      .catch(() => {
        closeTaskBrowser(id, taskId);
      });
  };

  useWindowCommands({
    closeTab: () => {
      if (active) {
        requestClose(active.id);
      }
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
  useRecordRecents({ childTitles });

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
            sessionId: sessionId ?? ids.sessionId,
          });
        },
        browser,
        // The composer is the sidebar's, so a screen that wants the caret in
        // it reaches through the box the conversation is drawn in.
        focusComposer: () => {
          conversationRef.current
            ?.querySelector<HTMLElement>('[contenteditable="true"], textarea')
            ?.focus();
        },
        openPage,
        openScreen,
        sessionId: sessionId ?? ids.sessionId,
        taskId: ids.taskId,
      }
    : null;

  // Opening a channel is the user saying they want to talk in it, so the caret
  // goes to its composer. A layout effect, which runs after the newly mounted
  // screen has taken focus for itself, so the channel's own composer wins over
  // a new tab page's search box.
  useLayoutEffect(() => {
    if (!sessionId) {
      return;
    }
    conversationRef.current
      ?.querySelector<HTMLElement>('[contenteditable="true"], textarea')
      ?.focus();
  }, [sessionId]);

  if (ensure.error) {
    return (
      <Frame>
        <p className="p-4 pt-12 text-sm text-destructive">
          Could not open the conversation: {ensure.error.message}
        </p>
      </Frame>
    );
  }

  // The channels as the rail draws them, and the one it has open. A channel
  // on screen has nothing unread by definition, since the user is reading it.
  const railChannels = channelList.map((channel) => ({
    ...(channel.color ? { color: channel.color } : {}),
    ...(channel.emoji ? { emoji: channel.emoji } : {}),
    id: channel.id,
    name: channel.name,
    needsYou: channel.id === sessionId ? false : channel.needsYou,
    unread: channel.id === sessionId ? 0 : channel.unread,
    working: workingChannels.has(channel.id),
  }));
  const openChannel = railChannels.find((channel) => channel.id === sessionId);
  const isHomeChannel = channelList[0]?.id === sessionId;
  const menuChannel = railChannels.find((channel) => channel.id === menu?.id);
  // Only this channel's work, since the line belongs to the channel rather
  // than to the window.
  const channelTasks = running
    .filter((entry) => entry.channel === sessionId)
    .map((entry) => ({
      step: entry.step ?? "Working",
      taskId: entry.taskId,
      title: entry.title,
    }));

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
        <PageOpenContext value={openPage}>
          <Frame>
            {/* The window's own rail, outside the sidebar: a channel owns the
              conversation, the tabs and the pages in them, so what switches
              them sits against the traffic lights rather than inside the panel
              it switches. */}
            <ChannelRail
              channels={railChannels}
              onMenu={(id, at) => {
                setMenu({ at, id });
              }}
              onNew={() => {
                setNewChannelOpen(true);
              }}
              onSelect={setSelectedChannel}
              {...(sessionId ? { selectedId: sessionId } : {})}
            />
            {isSidebarOpen ? null : (
              <Rail
                onOpen={() => {
                  setSidebarOpen(true);
                }}
              />
            )}
            <StudioSidebarRail
              bounds={SIDEBAR_BOUNDS}
              isOpen={isSidebarOpen}
              label="Resize the sidebar"
              onCollapse={() => {
                setSidebarOpen(false);
              }}
              panelClassName="bg-background"
              widthAtom={orchestratorSidebarWidthAtom}
            >
              <div className="relative flex min-h-0 w-full flex-1 flex-col">
                {/* Beside the traffic lights, where the rail's twin sits. */}
                <button
                  aria-label="Hide sidebar"
                  className="absolute top-2 right-2 z-10 rounded-md p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                  onClick={() => {
                    setSidebarOpen(false);
                  }}
                  type="button"
                >
                  <SidebarSimpleIcon className="size-4" />
                </button>
                <div className="flex min-h-0 flex-1 flex-col pt-10">
                  {openChannel && (
                    <ChannelBanner
                      canEdit={!isHomeChannel}
                      channel={openChannel}
                      onMenu={(at) => {
                        setMenu({ at, id: openChannel.id });
                      }}
                      onRename={(name) => {
                        updateChannel.mutate({
                          id: screens.taskId,
                          name,
                          sessionId: StoreId.SessionSchema.parse(
                            openChannel.id,
                          ),
                        });
                      }}
                      tasks={channelTasks}
                    />
                  )}
                  {/* `select-text`: the sidebar shell is chrome and turns selection off; the conversation is text. */}
                  <div
                    className="min-h-0 flex-1 select-text [&_.prose]:text-[13px] [&_.prose]:leading-5 [&_.text-sm]:text-[13px]"
                    ref={conversationRef}
                  >
                    {/* Names the task and session for the links inside, so a page
                      a reply names offers both the window's browser and the
                      user's, the way a link in a task does. */}
                    <TaskSessionProvider
                      sessionId={screens.sessionId}
                      taskId={screens.taskId}
                    >
                      <FilesLayoutContext value="list">
                        <TaskChat
                          alwaysSubmittable
                          composerLead={<ViewChip />}
                          {...(openChannel
                            ? {
                                composerPlaceholder: `Message ${openChannel.name}`,
                              }
                            : {})}
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
                              tabs: tabs.map((tab) =>
                                tab.kind === "page"
                                  ? {
                                      at: tab.url ?? "about:blank",
                                      id: tab.id,
                                      title: tab.title || tab.url || "New tab",
                                    }
                                  : {
                                      at: tab.href,
                                      title: screenPresentation(tab.href, {
                                        appsBySlug: new Map(),
                                        childTitles,
                                      }).title,
                                    },
                              ),
                              url: location.href,
                            };
                          }}
                          task={task.data}
                        />
                      </FilesLayoutContext>
                    </TaskSessionProvider>
                  </div>
                </div>
              </div>
            </StudioSidebarRail>
            <main className="relative flex min-w-0 flex-1 flex-col">
              <WindowTabStrip
                childTitles={
                  new Map(
                    children.data?.map((child) => [child.id, child.title]) ??
                      [],
                  )
                }
                onClose={requestClose}
                onNew={() => {
                  windowTabs.openScreen(NEW_TAB_HREF);
                }}
                onReorder={windowTabs.reorder}
                {...(sessionId ? { groupKey: sessionId } : {})}
                onSelect={windowTabs.select}
                selectedId={active?.id}
                tabs={tabs}
                trailing={
                  isDeveloperMode ? (
                    <Suspense fallback={null}>
                      <DevPanel />
                    </Suspense>
                  ) : null
                }
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
              {menuChannel && (
                <ChannelMenu
                  at={menu?.at}
                  canEdit={channelList[0]?.id !== menuChannel.id}
                  channel={menuChannel}
                  onChange={(edits) => {
                    updateChannel.mutate({
                      ...edits,
                      id: screens.taskId,
                      sessionId: StoreId.SessionSchema.parse(menuChannel.id),
                    });
                  }}
                  onClose={() => {
                    setMenu(undefined);
                  }}
                  {...(channelList[0]?.id === menuChannel.id
                    ? {}
                    : {
                        onArchive: () => {
                          if (menuChannel.id === sessionId) {
                            setSelectedChannel(
                              channelList.find(
                                (channel) => channel.id !== menuChannel.id,
                              )?.id ?? null,
                            );
                          }
                          archiveChannel.mutate({
                            id: screens.taskId,
                            sessionId: StoreId.SessionSchema.parse(
                              menuChannel.id,
                            ),
                          });
                          setMenu(undefined);
                        },
                      })}
                />
              )}
              <NewChannelDialog
                onCreate={(channel) => {
                  createChannel.mutate({ ...channel, id: screens.taskId });
                }}
                onOpenChange={setNewChannelOpen}
                open={isNewChannelOpen}
              />
              <AlertDialog
                onOpenChange={(open) => {
                  if (!open) {
                    setClosingBrowser(undefined);
                  }
                }}
                open={closingBrowser !== undefined}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {closingBrowser
                        ? `“${closingBrowser.title}” is using this page`
                        : ""}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      The task is still working in this browser. Closing it
                      takes the page away mid-work; the task is told, and
                      carries on without it.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep it open</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        if (closingBrowser) {
                          closeTaskBrowser(
                            closingBrowser.id,
                            closingBrowser.taskId,
                          );
                        }
                        setClosingBrowser(undefined);
                      }}
                    >
                      Close anyway
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </main>
          </Frame>
        </PageOpenContext>
      </FileOpenContext>
    </OrchestratorContext>
  );
}

/**
 * The sidebar shrunk to a rail: wide enough for the traffic lights to sit
 * clear of the tabs, with the mark at its foot to bring the conversation
 * back. Never gone.
 */
function Rail({ onOpen }: { onOpen: () => void }) {
  return (
    <aside className="relative flex w-20 shrink-0 flex-col items-center border-r border-border bg-background pt-10 pb-3">
      <button
        aria-label="Show sidebar"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        onClick={onOpen}
        type="button"
      >
        <SidebarSimpleIcon className="size-4" />
      </button>
      <span className="flex-1" />
      <button
        aria-label="Show Instrument"
        className="rounded-md p-1.5 text-brand-600 hover:bg-foreground/5 dark:text-brand-400"
        onClick={onOpen}
        type="button"
      >
        <InstrumentGlyph className="size-6" />
      </button>
    </aside>
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
