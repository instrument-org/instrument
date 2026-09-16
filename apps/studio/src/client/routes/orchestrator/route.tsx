import {
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
import { openSettings } from "@/client/atoms/settings-modal";
import { FileOpenContext } from "@/client/components/file-open-context";
import { ActivityPopover } from "@/client/components/orchestrator/activity-popover";
import { useAppsBySlug } from "@/client/components/orchestrator/apps-by-slug";
import {
  BrowserTabs,
  type BrowserTabsHandle,
} from "@/client/components/orchestrator/browser-tabs";
import {
  OrchestratorContext,
  type OrchestratorWindow,
} from "@/client/components/orchestrator/context";
import {
  fileHref,
  folderHref,
  mountOfHostPath,
} from "@/client/components/orchestrator/file-tabs";
import { segmentsOf } from "@/client/components/orchestrator/host-path";
import {
  screenLocation,
  screenPresentation,
  THREADS_HREF,
} from "@/client/components/orchestrator/screen-presentation";
import { type TabLocation } from "@/client/components/orchestrator/tab-location";
import { TabLocationRow } from "@/client/components/orchestrator/tab-location-row";
import { ThreadPane } from "@/client/components/orchestrator/thread-pane";
import { ideasQueryOptions } from "@/client/components/orchestrator/use-ideas";
import { WindowBar } from "@/client/components/orchestrator/window-bar";
import { WindowTabStrip } from "@/client/components/orchestrator/window-tab-strip";
import {
  PAGE_ROUTE,
  parseHref,
  usePopClosedTab,
  useWindowTabs,
} from "@/client/components/orchestrator/window-tabs";
import { PageOpenContext } from "@/client/components/page-open-context";
import { StudioModals } from "@/client/components/studio-modals/studio-modals";
import {
  type RailBounds,
  StudioSidebarRail,
} from "@/client/components/studio-sidebar-rail";
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
import { UpdateStatusIndicator } from "@/client/components/update-status-indicator";
import { UpdatedToast } from "@/client/components/updated-toast";
import { ActiveTabProvider } from "@/client/hooks/use-active-tab";
import { ChromeInsetProvider } from "@/client/hooks/use-chrome-inset";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { useDeveloperMode } from "@/client/hooks/use-developer-mode";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { cn, isMacOS } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { APP_NAME } from "@instrument-org/shared";
import {
  isFolderPath,
  StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createFileRoute,
  Outlet,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useAtomValue, useSetAtom } from "jotai";
import ms from "ms";
import {
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

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

/** The chat pane never collapses: a drag past its floor stops at the floor. */
const SIDEBAR_BOUNDS: RailBounds = {
  collapse: Number.NEGATIVE_INFINITY,
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
 * which is the chat pane's top, past the traffic lights.
 */
function Frame({ bar, children }: { bar?: ReactNode; children: ReactNode }) {
  return (
    // The band across the top is the window's, so every menu, popover and
    // tooltip is held below it: on macOS the traffic lights are drawn over that
    // strip of web contents and what lands under them cannot be clicked at all.
    <ChromeInsetProvider top={TOOLBAR_HEIGHT}>
      {/* `h-full` rather than the viewport: this is drawn inside `ZoomRoot`,
        which is already the real window scaled to the zoom the UI is laid out
        at, so a viewport height would apply that zoom a second time. */}
      <div className="relative flex h-full flex-col bg-background">
        {/* The bar is the window's own row and reserves the band the traffic
          lights are drawn in, so no column below has to leave a gap for them. */}
        {bar ?? (
          <div
            className="shrink-0 border-b border-border [-webkit-app-region:drag]"
            style={{ height: `${TOOLBAR_HEIGHT}px` }}
          />
        )}
        <div className="flex min-h-0 flex-1">{children}</div>
        <StudioModals />
        <Toaster position="bottom-right" />
        {/* No action beside it: the release notes are a screen this window has
          not got, and the version it is now on is the part worth saying. */}
        <UpdatedToast />
      </div>
    </ChromeInsetProvider>
  );
}

/**
 * The window: the chat pane down the left, with its filters, its threads, and
 * its composer, and to its right one strip of tabs above whatever is open. A
 * tab is a page (a browser guest of the orchestrator's) or a screen (a thread,
 * a folder, a file, a task, the apps, a new tab) addressed by the route it is
 * at, so the router follows the tab on screen and a screen navigating inside
 * itself changes its own tab. The pane never closes: the chat is always in
 * reach.
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
  // The threads' titles, for the tabs standing on one; the pane reads the
  // same live list, so this is one subscription shared through the cache.
  const threads = useQuery(
    rpcClient.workspace.orchestrator.threads.live.list.experimental_liveOptions(
      { input: ids ? { id: ids.taskId } : skipToken },
    ),
  );
  const threadTitles = new Map<StoreId.Session, string>(
    threads.data?.map((thread) => [thread.id, thread.title]) ?? [],
  );
  const [defaultModelURI] = useDefaultModelURI();
  const screenView = useAtomValue(screenViewAtom);
  const isDeveloperMode = useDeveloperMode();
  const conversationRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const location = useRouterState({
    select: (routerState) => routerState.location,
  });

  // The browser hands its handle over once mounted; state rather than a ref,
  // since the send handler below and the screens read it.
  const [browser, setBrowser] = useState<BrowserTabsHandle | null>(null);
  const windowTabs = useWindowTabs();
  // The element in the row a page's own bar is drawn into, once the row has
  // made one; null while a screen is up and the row is the field itself.
  const [chromeSlot, setChromeSlot] = useState<HTMLElement | null>(null);
  const popClosed = usePopClosedTab();
  const { active, activeId, tabs } = windowTabs;
  const isPageOnScreen = active?.kind === "page";

  // The window is never empty: with no tab, it starts where a new tab starts.
  // The one opener while the list is empty; the effects below wait for it.
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

  // Route navigation stays in this tab, including when leaving a website.
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
      windowTabs.navigateScreen(location.href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.href]);

  const isFreshNewTab =
    active?.kind === "screen" &&
    parseHref(active.href).pathname === parseHref(NEW_TAB_HREF).pathname;
  // A task's tab is the task's: the guest in it is the one the task is
  // driving, and taking its place in the strip would leave the task browsing
  // where nobody can see it. Everything else gives its place up in place.
  const isTaskTab = active?.kind === "page" && Boolean(active.taskId);
  const openPage = (url: string, { newTab = false } = {}) => {
    if (!newTab && active?.kind === "page" && !active.taskId) {
      browser?.navigate(url);
      return active.id;
    }
    return browser?.open(
      url,
      active && !isTaskTab && (!newTab || isFreshNewTab)
        ? { replacing: active }
        : undefined,
    );
  };
  const openScreen = (href: string, { newTab = false } = {}) => {
    if (newTab && !isFreshNewTab) {
      windowTabs.openOrFocusScreen(href);
    } else {
      windowTabs.navigateScreen(href);
      router.history.push(href);
    }
  };
  /**
   * Opens a path a reply named: a file in its viewer, a folder as the folder
   * view standing in it.
   *
   * A reply names a path the way the conversation reaches it, and both tabs
   * are addressed by where the thing sits on the computer, so the translation
   * happens here, against the conversation's own layout. A path under nothing
   * the conversation has is one this window cannot stand in, and saying so
   * beats a tab rooted nowhere.
   */
  const openNamedPath = (path: string, options?: { newTab?: boolean }) => {
    if (!ids) {
      return;
    }
    const isFolder = isFolderPath(path);
    const filePath = isFolder ? path.slice(0, -1) : path;
    void (async () => {
      const [error, hostPaths] = await safe(
        rpcClient.workspace.task.files.hostPaths.call({
          filePaths: [filePath],
          taskId: ids.taskId,
        }),
      );
      const hostPath = hostPaths?.[filePath];
      if (error || !hostPath) {
        toast(`Nothing at “${path}”`, {
          description: isFolder
            ? "Not a folder Instrument can reach."
            : "Not a file Instrument can reach.",
        });
        return;
      }
      openScreen(isFolder ? folderHref(hostPath) : fileHref(hostPath), options);
    })();
  };

  // Walk the current screen or guest first, then cross into the preceding or
  // following visit in this tab. Guests stay alive while a screen is up.
  const canGoBack =
    Boolean(active?.past?.length) ||
    (isPageOnScreen ? true : windowTabs.canStepBack);
  const canGoForward = isPageOnScreen
    ? Boolean(active.future?.length) || (browser?.canGoForward ?? false)
    : Boolean(active?.future?.length) || windowTabs.canStepForward;
  const goBack = () => {
    if (!active) {
      return;
    }
    if (active.kind === "page") {
      if (browser?.canGoBack) {
        browser.goBack();
      } else {
        windowTabs.stepVisit(-1);
      }
      return;
    }
    const href = windowTabs.step(-1);
    if (href !== undefined) {
      router.history.push(href);
    } else if (windowTabs.stepVisit(-1)) {
      return;
    } else if (active.isOpened) {
      // Nothing behind it, and something else opened it: back is the way out
      // of a tab that exists to show one thing.
      windowTabs.close(active.id);
    }
  };
  const goForward = () => {
    if (active?.kind === "page") {
      if (active.future?.length && !active.pageBackSteps) {
        windowTabs.stepVisit(1);
      } else {
        browser?.goForward();
      }
      return;
    }
    const href = windowTabs.step(1);
    if (href === undefined) {
      windowTabs.stepVisit(1);
    } else {
      router.history.push(href);
    }
  };

  // What the conversation asks to open, as it asks: a page as a tab, a path
  // of the user's as the tab that shows it. The openers are read at the moment
  // of each ask, since they close over the tabs as they are then.
  const appsBySlug = useAppsBySlug();
  // The address says what kind of place this is and, for a file, where it is
  // on the computer; the folder screen itself says where it stands, since it
  // is the one that expanded the root.
  const tabLocation: TabLocation = (() => {
    const activeFilePath =
      active?.kind === "page" ? hostPathOfFileUrl(active.url) : undefined;
    const fromTab: TabLocation =
      active?.kind === "page"
        ? activeFilePath === undefined
          ? { kind: "page", url: active.url ?? "" }
          : // A file shown as a page is still the file: the place it is at,
            // with the folders above it, rather than its address.
            {
              asPage: true,
              kind: "file",
              name: segmentsOf(activeFilePath).at(-1) ?? activeFilePath,
              path: activeFilePath,
            }
        : active?.kind === "screen"
          ? screenLocation(active.href, {
              appsBySlug,
              childTitles,
              threadTitles,
            })
          : { kind: "newTab" };
    if (fromTab.kind === "folder" && screenView?.folder) {
      return { ...fromTab, path: screenView.folder.display };
    }
    return fromTab;
  })();

  const openers = useRef({ openNamedPath, openPage, openScreen });
  useEffect(() => {
    openers.current = { openNamedPath, openPage, openScreen };
  });
  // A screen a link from outside asked for while this window was opening:
  // the command stream below could not carry it to a renderer not yet
  // listening, so it is asked for once the window can show it.
  const isReady = ids !== undefined;
  useEffect(() => {
    if (!isReady) {
      return;
    }
    void (async () => {
      const [, href] = await safe(
        rpcClient.orchestrator.takePendingScreen.call(),
      );
      if (href) {
        openers.current.openScreen(href, { newTab: true });
      }
    })();
  }, [isReady]);
  // What a new tab shows, asked for as the window comes up rather than as the
  // tab mounts, so the page lays out from the cache instead of growing a
  // section at a time as each answer lands. The tab's own queries keep them
  // fresh from there.
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
      rpcClient.workspace.computer.recents.queryOptions({ input }),
    );
    void queryClient.prefetchQuery(
      rpcClient.workspace.computer.places.queryOptions(),
    );
    void queryClient.prefetchQuery(ideasQueryOptions());
  }, [ids, queryClient]);
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
            const tabId = openers.current.openPage(target.url, {
              newTab: true,
            });
            // The tab's id goes back to the command that asked, so the
            // conversation can hand the tab to a task without waiting for
            // the next message's note to name it.
            if (tabId) {
              void rpcClient.workspace.orchestrator.opened.call({
                id: ids.taskId,
                requestId: target.requestId,
                tabId,
              });
            }
          } else {
            openers.current.openNamedPath(target.mount, { newTab: true });
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

  // The one field the window has, which is the tab's own: asked for by chord,
  // it takes the caret with the place already in it, selected, so the words
  // typed next replace it.
  const locationRef = useRef<HTMLDivElement>(null);
  const focusOmnibar = () => {
    const field = locationRef.current?.querySelector("input");
    field?.focus();
    field?.select();
  };

  useWindowCommands({
    back: goBack,
    closeTab: () => {
      if (active) {
        requestClose(active.id);
      }
    },
    forward: goForward,
    newTab: () => {
      windowTabs.openScreen(NEW_TAB_HREF);
    },
    openScreen: (href) => {
      openScreen(href, { newTab: true });
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
    search: focusOmnibar,
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
        // No session: a line sent at the top level opens a thread of its own.
        ask: (prompt) => {
          if (!modelURI) {
            return;
          }
          createMessage.mutate({ id: ids.taskId, modelURI, prompt });
        },
        browser,
        // The composer is the pane's, so a screen that wants the caret in it
        // reaches through the box the chat is drawn in.
        focusComposer: () => {
          conversationRef.current
            ?.querySelector<HTMLElement>('[contenteditable="true"], textarea')
            ?.focus();
        },
        openPage,
        openScreen,
        taskId: ids.taskId,
      }
    : null;

  /**
   * What the tab on screen says it shows, plus the page's words when that
   * tab is a page, read at the moment of sending; a screen that registered
   * nothing sends nothing.
   */
  const sendContext = async () => {
    if (!screenView || !state.data) {
      return;
    }
    // A file shown as a page is the file to the conversation: where it is,
    // and how the agent reaches it when a granted folder covers it, rather
    // than an address only this window can open.
    const activeFilePath =
      screenView.screen === "browser" && active?.kind === "page"
        ? hostPathOfFileUrl(active.url)
        : undefined;
    const page =
      screenView.screen === "browser" && activeFilePath === undefined
        ? await browser?.readPage()
        : undefined;
    const activeMount =
      activeFilePath === undefined
        ? undefined
        : mountOfHostPath(activeFilePath, state.data.attachedFolders ?? {});
    const shown =
      activeFilePath === undefined
        ? screenView
        : {
            file: {
              ...(activeMount === undefined ? {} : { mount: activeMount }),
              name: segmentsOf(activeFilePath).at(-1) ?? activeFilePath,
              path: activeFilePath,
            },
            screen: "file" as const,
          };
    return {
      ...shown,
      ...(page ? { page } : {}),
      tabs: tabs.map((tab) => {
        if (tab.kind !== "page") {
          return {
            at: tab.href,
            title: screenPresentation(tab.href, {
              appsBySlug,
              childTitles,
              threadTitles,
            }).title,
          };
        }
        // A file page has no id to hand a task: a task is pointed at sites,
        // never at a file on this computer.
        const filePath = hostPathOfFileUrl(tab.url);
        return filePath === undefined
          ? {
              at: tab.url ?? "about:blank",
              id: tab.id,
              title: tab.title || tab.url || "New tab",
            }
          : {
              at: filePath,
              title: segmentsOf(filePath).at(-1) ?? filePath,
            };
      }),
      url: location.href,
    };
  };

  if (ensure.error) {
    return (
      <Frame>
        <p className="p-4 pt-12 text-sm text-destructive">
          Could not open the conversation: {ensure.error.message}
        </p>
      </Frame>
    );
  }

  if (!screens || !state.data) {
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
      {/* Main-pane links navigate in place; the conversation overrides these openers. */}
      <FileOpenContext
        value={(filePath, options) => {
          openNamedPath(filePath, options);
        }}
      >
        <PageOpenContext value={openPage}>
          <Frame
            bar={
              <WindowBar
                tabs={
                  <WindowTabStrip
                    childTitles={childTitles}
                    onClose={requestClose}
                    onNew={() => {
                      windowTabs.openScreen(NEW_TAB_HREF);
                    }}
                    onReorder={windowTabs.reorder}
                    onSelect={windowTabs.select}
                    selectedId={active?.id}
                    tabs={tabs}
                    threadTitles={threadTitles}
                  />
                }
                trailing={
                  <>
                    {/* The record across every thread, behind a clock at the
                      strip's end: a place to flip between locations from
                      without leaving the tab that is up. */}
                    <ActivityPopover />
                    {isDeveloperMode && (
                      <Suspense fallback={null}>
                        <DevPanel />
                      </Suspense>
                    )}
                    {/* A build waiting to be installed is the window's news,
                      not a thread's, so it sits in the same corner the
                      classic window keeps it in. */}
                    <UpdateStatusIndicator />
                  </>
                }
              />
            }
          >
            <StudioSidebarRail
              bounds={SIDEBAR_BOUNDS}
              isOpen
              label="Resize the chat"
              onCollapse={() => {
                // The pane never collapses; its floor is where a drag stops.
              }}
              panelClassName="bg-background"
              widthAtom={orchestratorSidebarWidthAtom}
            >
              {/* `select-text`: the pane's shell is chrome and turns selection off; the chat is text. */}
              <div
                className="flex min-h-0 w-full flex-1 flex-col select-text [&_.prose]:text-[13px] [&_.prose]:leading-5 [&_.text-sm]:text-[13px]"
                ref={conversationRef}
              >
                {/* Names the openers for the links inside, so a page a row
                  names offers both the window's browser and the user's, and
                  a thread opens as a tab beside whatever is up. */}
                <OrchestratorContext
                  value={{
                    ...screens,
                    openPage: (url) => openPage(url, { newTab: true }),
                    openScreen: (href) => {
                      openScreen(href, { newTab: true });
                    },
                    opensNewTab: true,
                  }}
                >
                  <FileOpenContext
                    value={(path) => {
                      openNamedPath(path, { newTab: true });
                    }}
                  >
                    <PageOpenContext
                      value={(url) => openPage(url, { newTab: true })}
                    >
                      <ThreadPane
                        modelURI={modelURI}
                        onOpenThread={(thread) => {
                          openScreen(`${THREADS_HREF}/${thread.id}`);
                        }}
                        promptDraft={state.data.promptDraft ?? ""}
                        sendContext={sendContext}
                        taskId={screens.taskId}
                      />
                    </PageOpenContext>
                  </FileOpenContext>
                </OrchestratorContext>
              </div>
            </StudioSidebarRail>
            <main className="relative flex min-w-0 flex-1 flex-col">
              {/* Under the strip and across the pane: what this tab is
                showing, and the way back out of it. */}
              <TabLocationRow
                canGoBack={canGoBack}
                canGoForward={canGoForward}
                ref={locationRef}
                // On a page the field sends the tab's own guest somewhere,
                // and the page's controls (reload, the way out, the menu) are
                // drawn into the row's tail by the panel that has the page. A
                // file shown as a page is one too.
                {...(tabLocation.kind === "page" ||
                (tabLocation.kind === "file" && tabLocation.asPage)
                  ? {
                      onSite: (url: string) => openPage(url),
                      trailing: (
                        <div
                          className="flex shrink-0 items-center gap-0.5"
                          ref={setChromeSlot}
                        />
                      ),
                    }
                  : {})}
                location={tabLocation}
                onBack={goBack}
                onForward={goForward}
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
                    <BrowserTabs chromeInto={chromeSlot} ref={setBrowser} />
                  </ActiveTabProvider>
                </div>
              </div>
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
 * swipe, a thumb button or the History menu, the tab chords (close, new,
 * reopen, next and previous, one by number), the caret into the field, and a
 * screen a link from outside the app named.
 * On a Mac the thumb buttons reach the page as mouse events, so they are
 * answered here; elsewhere they arrive through the main process. Chromium
 * walks the renderer's own history on the same mouseup unless the page
 * consumes it, and that history is not the tab's: left alone, back moved the
 * tab one step and the renderer one step, and the second undid the first.
 */
function useWindowCommands(handlers: {
  /** The tab's own history, which is the only history a thumb or a menu reaches. */
  back: () => void;
  closeTab: () => void;
  forward: () => void;
  newTab: () => void;
  /** A screen by its route, in a tab of its own, since what asked is not in any tab. */
  openScreen: (href: string) => void;
  reopenTab: () => void;
  /** The caret into the window's field, wherever it was. */
  search: () => void;
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
    const isThumb = (event: MouseEvent) =>
      event.button === 3 || event.button === 4;
    // Consumed at every stage, on the way down, so neither Chromium's own
    // navigation nor a click handler under the pointer sees the press.
    const swallow = (event: MouseEvent) => {
      if (isThumb(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const onMouseUp = (event: MouseEvent) => {
      if (!isThumb(event)) {
        return;
      }
      swallow(event);
      if (event.button === 3) {
        latest.current.back();
      } else {
        latest.current.forward();
      }
    };
    // The chord for the field, taken before anything on the page reads it: the
    // native menu is only offered the keys web content left alone, and the
    // composer's editor takes this one for itself. The menu item stays for the
    // case this cannot see, a focused page guest, whose keys never reach here.
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "l"
      ) {
        event.preventDefault();
        latest.current.search();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    if (isMacOS()) {
      window.addEventListener("mousedown", swallow, { capture: true });
      window.addEventListener("mouseup", onMouseUp, { capture: true });
      window.addEventListener("auxclick", swallow, { capture: true });
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
            if (command.type === "selectTab") {
              latest.current.selectTab(command.index);
            } else {
              latest.current.openScreen(command.href);
            }
            continue;
          }
          switch (command) {
            case "back": {
              latest.current.back();
              break;
            }
            case "closeTab": {
              latest.current.closeTab();
              break;
            }
            case "forward": {
              latest.current.forward();
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
            case "openSettings": {
              openSettings({ tab: "General" });
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
            case "search": {
              latest.current.search();
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
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("mousedown", swallow, { capture: true });
      window.removeEventListener("mouseup", onMouseUp, { capture: true });
      window.removeEventListener("auxclick", swallow, { capture: true });
    };
  }, [router]);
}
