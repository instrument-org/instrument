import {
  chatGroupAtom,
  type Draft,
  draftGroupOf,
  draftsAtom,
  inboxOpenAtom,
  pageSlotsAtom,
  paneOpenByGroupAtom,
  screenViewAtom,
  THREADS_HREF,
} from "@/client/atoms/orchestrator";
import { AppErrorFallback } from "@/client/components/app-error-fallback";
import { FileOpenContext } from "@/client/components/file-open-context";
import { NavControls } from "@/client/components/nav-controls";
import { OnboardingZoomRoot } from "@/client/components/onboarding/zoom-root";
import { PageOpenContext } from "@/client/components/page-open-context";
import { ThemeProvider } from "@/client/components/theme-provider";
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
import { Spinner } from "@/client/components/ui/spinner";
import { TooltipProvider } from "@/client/components/ui/tooltip";
import { WindowBorder } from "@/client/components/window-border";
import {
  ActiveTabProvider,
  TabIdProvider,
} from "@/client/hooks/use-active-tab";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { PortalContainerProvider } from "@/client/hooks/use-portal-container";
import { useTabRouters } from "@/client/hooks/use-tab-routers";
import { resolveComputerFileBase } from "@/client/lib/computer-file-url";
import { ICON_CONTEXT_VALUE } from "@/client/lib/icon-context";
import { sharedQueryClient, type TabRouter } from "@/client/lib/tab-router";
import { getRouterHistory } from "@/client/lib/tab-router-history";
import { getTabRouter } from "@/client/lib/tab-router-registry";
import { setTabPathname } from "@/client/lib/tabs-model";
import { captureComponentError } from "@/client/lib/telemetry";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { fileHref } from "@/shared/computer-href";
import { type Tab } from "@/shared/tabs";
import {
  type SessionMessageDataPart,
  StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { IconContext } from "@phosphor-icons/react/dist/lib/context";
import {
  QueryClientProvider,
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  CatchBoundary,
  RouterContextProvider,
  RouterProvider,
  useRouterState,
} from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import ms from "ms";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AppRail } from "./app-rail";
import { AppTabStrip } from "./app-tab-strip";
import {
  appTabsAtom,
  CHAT_HREF,
  groupOfHref,
  isChatHref,
  placeOfHref,
  useAppTabs,
} from "./app-tabs";
import { useAppsBySlug } from "./apps-by-slug";
import {
  BrowserTabs,
  type BrowserTabsHandle,
  type ComposeHost,
} from "./browser-tabs";
import { ComposeLayer } from "./compose-layer";
import {
  OrchestratorContext,
  type OrchestratorWindow as Screens,
} from "./context";
import { WindowLook } from "./look-panel";
import { NewTopicDialog } from "./new-topic-dialog";
import { contextReaders } from "./send-context";
import {
  type PageSlot,
  type WindowShell as Shell,
  ShellContext,
} from "./shell-context";
import { useStagedAskActions } from "./staged-asks";
import { threadListOptions } from "./thread-list-query";
import { useCompose } from "./use-compose";
import { useDrafts } from "./use-drafts";
import { ideasQueryOptions } from "./use-ideas";
import { useOpeners } from "./use-openers";
import { usePageThumbnailHousekeeping } from "./use-page-thumbnail-housekeeping";
import { useRecordRecents } from "./use-record-recents";
import { useSetThreadTopics } from "./use-set-thread-topics";
import { backfillCandidates } from "./use-topic-backfill";
import { useWindowCommands } from "./use-window-commands";
import { WindowBar, WindowCorner } from "./window-bar";
import { WindowFrame } from "./window-frame";
import { threadOfHref, useWindowTabs } from "./window-tabs";

// Resolve the computer file channel once at boot so file URLs derive locally
// from a host path; not awaited, so it never holds up the first render.
void resolveComputerFileBase();

/** How often the tasks' titles are re-read, for the tabs standing on one. */
const REFRESH_MS = ms("2 seconds");

/** The groups the window's places once kept their tabs under, which nothing shows now. */
const RETIRED_GROUPS = [
  "place:apps",
  "place:discover",
  "place:files",
  "place:home",
];

/**
 * The 2.0 window: its tabs across the bar, each a router of its own kept
 * mounted and live behind the one on screen, and around them what the window
 * keeps once whatever tab is up: the rail, the drafts and popped-out chats
 * along the foot, the window's browser, and its chords.
 */
export function OrchestratorWindow() {
  const model = useAtomValue(appTabsAtom);
  const routers = useTabRouters(model.tabs);
  const activeRouter = getTabRouter(model.selectedId);
  return (
    <QueryClientProvider client={sharedQueryClient}>
      <ThemeProvider>
        {/* The window's one TooltipProvider for its own chrome; each tab's
          root route keeps its own for what the tab draws. */}
        {/* eslint-disable-next-line no-restricted-syntax */}
        <TooltipProvider>
          <CatchBoundary
            errorComponent={AppErrorFallback}
            getResetKey={() => "window"}
            onCatch={captureComponentError}
          >
            <IconContext.Provider value={ICON_CONTEXT_VALUE}>
              <OnboardingZoomRoot>
                {activeRouter ? (
                  <RouterContextProvider router={activeRouter}>
                    <WindowShell routers={routers} tabs={model.tabs} />
                  </RouterContextProvider>
                ) : null}
              </OnboardingZoomRoot>
              <WindowBorder />
            </IconContext.Provider>
          </CatchBoundary>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

/**
 * One of the window's tabs: kept mounted and live behind the one on screen,
 * hidden rather than taken down, so a tab come back to is as it was. Its
 * router's every step is written back to the tab, with the whole history,
 * so the tab comes back after a launch where it stood.
 */
function AppTabView({
  isActive,
  router,
  tab,
}: {
  isActive: boolean;
  router: TabRouter;
  tab: Tab;
}) {
  const setModel = useSetAtom(appTabsAtom);
  useEffect(() => {
    const unsubscribe = router.subscribe("onResolved", () => {
      setModel((model) =>
        setTabPathname(model, {
          history: getRouterHistory(router),
          id: tab.id,
          pathname: router.state.location.href,
        }),
      );
    });
    return () => {
      unsubscribe();
    };
  }, [router, setModel, tab.id]);
  return (
    <div
      className={cn(
        "absolute inset-0 flex",
        // Transparent as well as invisible, so a layer the compositor
        // promoted in a tab behind cannot stay painted over the one up.
        isActive ? "visible" : "invisible opacity-0",
      )}
      {...(isActive ? { "data-app-tab-active": "" } : {})}
    >
      <PortalContainerProvider>
        {/* The width a screen gets, for `@container/app-content` variants;
          inside the portal provider, never above its target. */}
        <div className="@container/app-content flex min-h-0 min-w-0 flex-1">
          <TabIdProvider id={tab.id}>
            <ActiveTabProvider isActive={isActive}>
              <RouterProvider router={router} />
            </ActiveTabProvider>
          </TabIdProvider>
        </div>
      </PortalContainerProvider>
    </div>
  );
}

/** The caret into the field of the tab up's address row, with what is in it selected. */
function focusField() {
  const field = document.querySelector<HTMLInputElement>(
    "[data-app-tab-active] [data-tab-location] input",
  );
  field?.focus();
  field?.select();
}

/** Whether a draft has anything written in it, which is what keeps it past its window. */
function hasWords(draft: Draft): boolean {
  return draft.words.trim() !== "";
}

function WindowShell({
  routers,
  tabs,
}: {
  routers: ReadonlyMap<string, TabRouter>;
  tabs: Tab[];
}) {
  const appTabs = useAppTabs();
  // Where the tab up stands, read off its own router, which the context above
  // is: the rail lights its place and the group on screen follows it.
  const activeHref = useRouterState({
    select: (routerState) => routerState.location.href,
  });
  const ensure = useQuery(
    rpcClient.workspace.orchestrator.ensure.queryOptions({
      // The orchestrator, once it exists, is the one this window shows for as
      // long as it is open.
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
  const ids = ensure.data;
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
  // The thread each task was filed from, which is the group its browsing
  // lands in.
  const childThreads = new Map<TaskId, string | undefined>(
    children.data?.map((child) => [child.id, child.threadId]) ?? [],
  );
  const threads = useQuery(threadListOptions());
  const threadTitles = new Map<StoreId.Session, string>(
    threads.data?.map((thread) => [thread.id, thread.title]) ?? [],
  );
  const [defaultModelURI, setDefaultModelURI, saveDefaultModelURI] =
    useDefaultModelURI();
  const screenView = useAtomValue(screenViewAtom);
  const [drafts, setDrafts] = useAtom(draftsAtom);
  const setChatGroup = useSetAtom(chatGroupAtom);
  const setInboxOpen = useSetAtom(inboxOpenAtom);
  const sendContextRef = useRef<
    () => Promise<SessionMessageDataPart.ViewContextDataPart | undefined>
  >(() => Promise.resolve(undefined));
  // The card the tabs are drawn in, measured in layout px, which the inbox
  // and the floating windows size themselves against.
  const [rowElement, setRowElement] = useState<HTMLDivElement | null>(null);
  const [rowWidth, setRowWidth] = useState(0);
  useEffect(() => {
    if (!rowElement) {
      return;
    }
    setRowWidth(rowElement.offsetWidth);
    const observer = new ResizeObserver(() => {
      setRowWidth(rowElement.offsetWidth);
    });
    observer.observe(rowElement);
    return () => {
      observer.disconnect();
    };
  }, [rowElement]);
  const [paneOpenByGroup, setPaneOpenByGroup] = useAtom(paneOpenByGroupAtom);
  const [browser, setBrowser] = useState<BrowserTabsHandle | null>(null);
  const windowTabs = useWindowTabs();
  const place = placeOfHref(activeHref);
  const isChat = isChatHref(activeHref);

  // The group on screen is the tab up's: its chat's tabs, a site's page, or
  // nothing for a screen that is its route. The window's browser, the
  // openers and what goes with a message all read it from there.
  const groupOnScreen = groupOfHref(activeHref);
  useEffect(() => {
    if (windowTabs.group === groupOnScreen) {
      return;
    }
    if (groupOnScreen === undefined) {
      windowTabs.leaveGroup();
    } else {
      windowTabs.showGroup(groupOnScreen);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupOnScreen, windowTabs.group]);
  // The chat a tab last had open is where Chat in the rail takes a tab.
  useEffect(() => {
    if (!isChat) {
      return;
    }
    setChatGroup(threadOfHref(activeHref) ?? null);
  }, [activeHref, isChat, setChatGroup]);

  const compose = useCompose(rowWidth, (group) =>
    windowTabs.allTabs.some((tab) => tab.group === group),
  );
  // A draft is written over the screen, never on it, and a draft with no
  // words is not kept past its window, so one left over from a launch goes,
  // unless its window came back with it. A window whose draft is gone goes.
  // Once, over what was restored.
  useEffect(() => {
    const floating = new Set(
      compose.entries.flatMap((entry) =>
        entry.kind === "draft" ? [entry.draftId] : [],
      ),
    );
    const isKept = (draft: Draft) => hasWords(draft) || floating.has(draft.id);
    for (const draft of drafts) {
      if (!isKept(draft)) {
        windowTabs.dropGroup(draftGroupOf(draft.id));
      }
    }
    setDrafts((current) => current.filter(isKept));
    for (const entry of compose.entries) {
      if (
        entry.kind === "draft" &&
        !drafts.some((draft) => draft.id === entry.draftId)
      ) {
        compose.remove(draftGroupOf(entry.draftId));
      }
    }
    for (const group of RETIRED_GROUPS) {
      windowTabs.dropGroup(group);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPaneOpen = (group: string, isOpen: boolean) => {
    setPaneOpenByGroup((current) => ({ ...current, [group]: isOpen }));
  };
  /** Brings the pane up for the group on screen, for something opened into it. */
  const revealPane = () => {
    if (windowTabs.group !== undefined) {
      setPaneOpen(windowTabs.group, true);
    }
  };
  // The pages screens draw into slots of their own (a page's file beside a
  // file tab's tree), shown while the screen that made the slot is up.
  const pageSlots = useAtomValue(pageSlotsAtom);
  const slotHosts: ComposeHost[] = Object.entries(pageSlots).flatMap(
    ([group, { insideOverlay, into, layer }]) =>
      into
        ? [
            {
              chrome: false,
              group,
              into,
              isActive: true,
              ...(layer === undefined ? {} : { layer }),
              ...(insideOverlay ? { insideOverlay } : {}),
              place: `${group}:${rowWidth}`,
            },
          ]
        : [],
  );

  // Where the tab up wants the window's page drawn. The browser's own face
  // lives in one element for the window's whole life, handed from tab to tab,
  // so a page and its edit session never remount as tabs are switched.
  const [pageSlot, setPageSlot] = useState<null | PageSlot>(null);
  const [stage] = useState(() => {
    const element = document.createElement("div");
    element.className = "relative h-full min-h-0";
    return element;
  });
  const holderRef = useRef<HTMLDivElement>(null);
  const pageHost = pageSlot?.host ?? null;
  useLayoutEffect(() => {
    const host = pageHost ?? holderRef.current;
    if (host && stage.parentElement !== host) {
      host.append(stage);
    }
  }, [pageHost, stage]);

  /**
   * Takes a thread out of the corner: the window goes and the thread comes
   * up in the tab on screen, whole, its pane as it was.
   */
  const landThread = (sessionId: StoreId.Session) => {
    compose.remove(sessionId);
    appTabs.navigate(`${THREADS_HREF}/${sessionId}`);
  };
  /** The same, with one of the thread's tabs put in front of its pane. */
  const landOnTab = (sessionId: StoreId.Session, tabId: string) => {
    landThread(sessionId);
    windowTabs.selectIn(sessionId, tabId);
    setPaneOpen(sessionId, true);
  };

  const { openNamedPath, openPage, openScreen } = useOpeners({
    appTabs,
    browser,
    ids,
    revealPane,
    setPaneOpen,
    threadOfTask: (id) => childThreads.get(id),
    threads: threads.data,
    threadTitles,
    windowTabs,
  });

  const appsBySlug = useAppsBySlug();
  // What a new tab shows, asked for as the window comes up rather than as the
  // tab mounts, so the page lays out from the cache instead of growing a
  // section at a time as each answer lands.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!ids) {
      return;
    }
    const input = { id: ids.taskId };
    void queryClient.prefetchQuery(
      rpcClient.workspace.orchestrator.children.queryOptions({ input }),
    );
    void queryClient.prefetchQuery(
      rpcClient.workspace.computer.recents.queryOptions(),
    );
    void queryClient.prefetchQuery(
      rpcClient.workspace.computer.places.queryOptions(),
    );
    void queryClient.prefetchQuery(ideasQueryOptions());
  }, [ids, queryClient]);

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
    // Any group's: a popped-out chat's rail closes its tabs here too.
    const tab = windowTabs.allTabs.find((entry) => entry.id === id);
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

  useRecordRecents();
  usePageThumbnailHousekeeping();

  // The default first, since it is what the draft's picker edits: every send
  // stores its model on the orchestrator's own state, so once any thread has
  // been started that field is always set. The stored model stands in for a
  // window whose default was never saved.
  const modelURI = defaultModelURI ?? state.data?.selectedModelURI;
  const topicsQuery = useQuery(
    rpcClient.workspace.orchestrator.topics.list.queryOptions(),
  );
  const topics = topicsQuery.data ?? [];
  const createTopic = useMutation(
    rpcClient.workspace.orchestrator.topics.create.mutationOptions({
      onSuccess: () => void topicsQuery.refetch(),
    }),
  );
  const setThreadTopics = useSetThreadTopics();
  // The new-topic dialog, asked for from a chat's head or a draft's, with
  // what was typed in the picker: the topic it makes files that chat or
  // that draft.
  const [newTopic, setNewTopic] = useState<{
    draftId?: string;
    name?: string;
  }>();
  const threadUp = threadOfHref(activeHref);

  // What goes with a message, read at the moment of sending.
  const { draftContext, sendContext } = contextReaders({
    appsBySlug,
    browser,
    drafts,
    href: activeHref,
    paneOpenByGroup,
    screenView,
    state: state.data,
    threadTitles,
    viewsById: compose.viewsById,
    windowTabs,
  });
  sendContextRef.current = sendContext;
  const {
    arrivedId,
    closeDraft,
    deleteDraft,
    newDraft,
    sentWords,
    showDraft,
    startingIds,
    startThread,
  } = useDrafts({
    attachedFolders: state.data?.attachedFolders ?? {},
    compose,
    draftContext,
    ids,
    isChat,
    saveDefaultModelURI,
    topics,
    windowTabs,
  });
  // The inbox's rows as the tab up lists them, for stepping through them by
  // chord.
  const listedThreads = useRef<StoreId.Session[]>([]);
  useWindowCommands(
    {
      back: () => {
        appTabs.activeRouter?.history.back();
      },
      closeTab: () => {
        if (appTabs.model.selectedId) {
          appTabs.close(appTabs.model.selectedId);
        }
      },
      forward: () => {
        appTabs.activeRouter?.history.forward();
      },
      newTab: appTabs.openNewTab,
      newThread: newDraft,
      // A file from outside the app is the person's own, in a tab of its own.
      openFile: (hostPath) => {
        appTabs.open(fileHref(hostPath));
      },
      openScreen: (href) => {
        appTabs.open(href);
      },
      reopenTab: appTabs.reopen,
      search: focusField,
      selectRelative: appTabs.selectRelative,
      selectTab: appTabs.selectIndex,
      toggleInbox: () => {
        // The inbox is the chat's; elsewhere the chord has nothing to move.
        if (isChat) {
          setInboxOpen((isOpen) => !isOpen || threadUp === undefined);
        }
      },
      // The next or previous row of the inbox from the chat up; from no
      // chat, the list's first or last.
      selectThread: (direction) => {
        const listed = listedThreads.current;
        const at = threadUp === undefined ? -1 : listed.indexOf(threadUp);
        const next =
          at === -1
            ? direction === 1
              ? listed[0]
              : listed.at(-1)
            : listed[at + direction];
        if (next !== undefined) {
          openScreen(`${THREADS_HREF}/${next}`);
        }
      },
    },
    { isReady: ids !== undefined },
  );
  const { moveTo: moveAsks } = useStagedAskActions();
  const screens: null | Screens = ids
    ? {
        // No session: a line a button hands over at the top level opens a
        // draft with the line in it rather than a thread, so the person reads
        // what is about to be asked, adds to it, and sends it themselves.
        ask: (prompt) => {
          newDraft(prompt);
        },
        askAbout: (items) => {
          newDraft(undefined, items);
        },
        browser,
        focusComposer: () => {
          newDraft();
        },
        // With no chat beside the file, a new draft takes what was marked,
        // opened over the file now that the marking is done.
        moveAsksToDraft: (askIds) => {
          moveAsks(askIds, { draftId: newDraft(), kind: "draft" });
        },
        openPage,
        openPath: openNamedPath,
        openScreen,
        taskId: ids.taskId,
      }
    : null;

  if (ensure.error) {
    return (
      <WindowFrame>
        <p className="p-4 pt-12 text-sm text-destructive">
          Could not open the conversation: {ensure.error.message}
        </p>
      </WindowFrame>
    );
  }

  if (!screens || !state.data || !ids) {
    return (
      <WindowFrame>
        <div className="flex h-full flex-1 items-center justify-center">
          <Spinner className="size-6" />
        </div>
      </WindowFrame>
    );
  }

  const shell: Shell = {
    appTabs,
    arrivedId,
    childTitles,
    compose,
    deleteDraft,
    // Only a draft with words is a draft to come back to; one being written
    // with none yet is its window's alone, and one being sent is already its
    // thread.
    drafts: drafts.filter(
      (draft) => hasWords(draft) && !startingIds.has(draft.id),
    ),
    ids,
    onListed: (listed) => {
      listedThreads.current = listed;
    },
    onNewTopic: (name) => {
      setNewTopic(name ? { name } : {});
    },
    reportPageSlot: setPageSlot,
    requestClose,
    rowWidth,
    sendContext: () => sendContextRef.current(),
    setPaneOpen,
    setThreadTopics,
    showDraft,
    threads: threads.data,
    threadTitles,
    topics,
  };

  return (
    <OrchestratorContext value={screens}>
      <FileOpenContext
        value={(filePath, options) => {
          openNamedPath(filePath, options);
        }}
      >
        <PageOpenContext value={openPage}>
          <WindowFrame
            bar={
              <WindowBar
                leading={<NavControls />}
                tabs={
                  <AppTabStrip
                    childTitles={childTitles}
                    onClose={appTabs.close}
                    onNew={appTabs.openNewTab}
                    onReorder={appTabs.reorder}
                    onSelect={appTabs.select}
                    selectedId={appTabs.model.selectedId}
                    tabs={tabs}
                    threadTitles={threadTitles}
                  />
                }
                trailing={<WindowCorner />}
              />
            }
            overlay={
              <ComposeLayer
                browser={browser}
                compose={compose}
                drafts={drafts}
                modelURI={modelURI}
                onChangeDraft={(id, update) => {
                  setDrafts((current) =>
                    current.map((entry) =>
                      entry.id === id
                        ? { ...update(entry), updatedAt: Date.now() }
                        : entry,
                    ),
                  );
                }}
                onCloseDraft={closeDraft}
                onCloseTab={requestClose}
                onCloseThread={(sessionId) => {
                  compose.remove(sessionId);
                }}
                onExpandThread={(sessionId) => {
                  // A page shows in one place: the grown window draws the
                  // chat's, so the tab up lets the chat go.
                  if (windowTabs.group === sessionId) {
                    appTabs.navigate(CHAT_HREF);
                  }
                }}
                onModelChange={setDefaultModelURI}
                onNewTopic={(draftId, name) => {
                  setNewTopic({ draftId, ...(name ? { name } : {}) });
                }}
                onOpenThread={landThread}
                onPressThreadTab={landOnTab}
                onStart={startThread}
                openOutside={(href) => {
                  appTabs.open(href);
                }}
                sendContext={() => sendContextRef.current()}
                sentWords={sentWords}
                threads={threads.data ?? []}
                topics={topics}
              />
            }
            rail={
              <AppRail
                onChoose={(next, { newTab }) => {
                  // Chat asked for is the inbox asked for too, even where the
                  // row is narrow enough that it stepped aside.
                  if (next === "chat") {
                    setInboxOpen(true);
                  }
                  if (next === place && !newTab) {
                    return;
                  }
                  appTabs.goToPlace(next, { newTab });
                }}
                onNew={() => {
                  newDraft();
                }}
                place={place}
              />
            }
            rowRef={setRowElement}
          >
            <ShellContext value={shell}>
              <div className="relative min-h-0 min-w-0 flex-1">
                {tabs.map((tab) => {
                  const router = routers.get(tab.id);
                  return router ? (
                    <AppTabView
                      isActive={tab.id === appTabs.model.selectedId}
                      key={tab.id}
                      router={router}
                      tab={tab}
                    />
                  ) : null;
                })}
              </div>
            </ShellContext>
            {/* Where the window's page waits while the tab up has none to
              show; hidden, so a guest left over it is parked. */}
            <div hidden ref={holderRef} />
            {createPortal(
              <ActiveTabProvider isActive={pageSlot?.isShown ?? false}>
                <BrowserTabs
                  chromeInto={pageSlot?.chrome?.into ?? null}
                  compose={[...compose.hosts, ...slotHosts]}
                  ref={setBrowser}
                  reloadInto={pageSlot?.chrome?.reloadInto ?? null}
                  threadOfTask={childThreads}
                />
              </ActiveTabProvider>,
              stage,
            )}
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
                    The task is still working in this browser. Closing it takes
                    the page away mid-work; the task is told, and carries on
                    without it.
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
            {/* Asked for from a chat's head or a draft's, so the topic it
              makes is filed on that chat or draft as it lands. */}
            <NewTopicDialog
              candidates={backfillCandidates(
                (threads.data ?? []).filter((thread) => thread.id !== threadUp),
              )}
              {...(newTopic?.name ? { name: newTopic.name } : {})}
              onCreate={(topic, alsoFile) => {
                const forDraft = newTopic?.draftId;
                const filedOn =
                  forDraft === undefined
                    ? threads.data?.find((thread) => thread.id === threadUp)
                    : undefined;
                createTopic.mutate(topic, {
                  onSuccess: (created) => {
                    for (const id of alsoFile) {
                      setThreadTopics(id, [created.id]);
                    }
                    if (forDraft !== undefined) {
                      setDrafts((current) =>
                        current.map((draft) =>
                          draft.id === forDraft
                            ? {
                                ...draft,
                                topicId: created.id,
                                topicSource: "chosen",
                                updatedAt: Date.now(),
                              }
                            : draft,
                        ),
                      );
                    }
                    if (filedOn) {
                      setThreadTopics(filedOn.id, [
                        ...filedOn.topics,
                        created.id,
                      ]);
                    }
                  },
                });
              }}
              onOpenChange={(open) => {
                if (!open) {
                  setNewTopic(undefined);
                }
              }}
              open={newTopic !== undefined}
              taken={topics.flatMap((topic) =>
                topic.emoji ? [topic.emoji] : [],
              )}
            />
          </WindowFrame>
          {/* What a tab's Expand asks to see large, over the window. */}
          <WindowLook />
        </PageOpenContext>
      </FileOpenContext>
    </OrchestratorContext>
  );
}
