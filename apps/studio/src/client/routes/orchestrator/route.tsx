import {
  type Draft,
  draftFilesAtom,
  draftGroupOf,
  draftOfGroup,
  draftsAtom,
  NEW_TAB_HREF,
  openDraftAtom,
  type OrchestratorRecent,
  orchestratorRecentsAtom,
  orchestratorSidebarWidthAtom,
  RECENTS_MAX,
  rightAreaOpenAtom,
  screenViewAtom,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  THREADS_HREF,
} from "@/client/atoms/orchestrator";
import { openSettings } from "@/client/atoms/settings-modal";
import { FileSystemIconSpriteSheet } from "@/client/components/extend/file-system";
import { FileOpenContext } from "@/client/components/file-open-context";
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
  DraftBar,
  DraftHead,
} from "@/client/components/orchestrator/draft-head";
import {
  fileHref,
  folderHref,
  mountOfHostPath,
} from "@/client/components/orchestrator/file-tabs";
import { segmentsOf } from "@/client/components/orchestrator/host-path";
import { RightAreaToggle } from "@/client/components/orchestrator/right-area-toggle";
import {
  screenLocation,
  screenPresentation,
} from "@/client/components/orchestrator/screen-presentation";
import { type TabLocation } from "@/client/components/orchestrator/tab-location";
import { TabLocationRow } from "@/client/components/orchestrator/tab-location-row";
import { TasksBadge } from "@/client/components/orchestrator/tasks-badge";
import { ThreadHeader } from "@/client/components/orchestrator/thread-header";
import { ThreadPane } from "@/client/components/orchestrator/thread-pane";
import { ThreadStage } from "@/client/components/orchestrator/thread-stage";
import { ideasQueryOptions } from "@/client/components/orchestrator/use-ideas";
import { WindowBar } from "@/client/components/orchestrator/window-bar";
import { WindowTabStrip } from "@/client/components/orchestrator/window-tab-strip";
import {
  isAnchor,
  PAGE_ROUTE,
  parseHref,
  threadOfHref,
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
  type SessionMessageDataPart,
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
import { useAtom, useAtomValue, useSetAtom } from "jotai";
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
import { ulid } from "ulid";

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

/** What an opener is told: a tab of its own, and the group the thing belongs to when not the one on screen. */
interface OpenOptions {
  group?: string;
  newTab?: boolean;
}

/** The chat pane never collapses: a drag past its floor stops at the floor. */
const SIDEBAR_BOUNDS: RailBounds = {
  collapse: Number.NEGATIVE_INFINITY,
  initial: SIDEBAR_WIDTH_DEFAULT,
  max: SIDEBAR_WIDTH_MAX,
  min: SIDEBAR_WIDTH_MIN,
};

/**
 * The column the chat pane stands in: the resizable rail beside the right
 * area, or, with the right area closed, the whole width. The pane inside is
 * re-laid between the two, so anything it has to keep lives outside it.
 */
function ChatColumn({
  children,
  isHidden,
  isRightAreaOpen,
}: {
  children: ReactNode;
  /** Put away entirely, for a draft spread across the window. */
  isHidden: boolean;
  isRightAreaOpen: boolean;
}) {
  if (isHidden) {
    return <div className="hidden">{children}</div>;
  }
  if (!isRightAreaOpen) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    );
  }
  return (
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
      {children}
    </StudioSidebarRail>
  );
}

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
        {/* The file browser's own type icons, drawn by reference, so a file
          named anywhere in the window (a thread's marks, a row in Activity)
          wears the same colored mark it has in the computer view. */}
        <FileSystemIconSpriteSheet />
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
  // The thread each task was filed from, which is the group its browsing
  // lands in.
  const childThreads = new Map<TaskId, string | undefined>(
    children.data?.map((child) => [child.id, child.threadId]) ?? [],
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
  const [drafts, setDrafts] = useAtom(draftsAtom);
  const [draftFiles, setDraftFiles] = useAtom(draftFilesAtom);
  // Read at the moment of starting, since the context is gathered first, and
  // the reader of the screen is made further down.
  const draftFilesRef = useRef(draftFiles);
  draftFilesRef.current = draftFiles;
  const sendContextRef = useRef<
    () => Promise<SessionMessageDataPart.ViewContextDataPart | undefined>
  >(() => Promise.resolve(undefined));
  const [openDraft, setOpenDraft] = useAtom(openDraftAtom);
  const [isRightAreaOpen, setRightAreaOpen] = useAtom(rightAreaOpenAtom);
  const isDeveloperMode = useDeveloperMode();
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
  // Nothing is on screen with no group up: the right area belongs to a
  // thread or a draft, never to the window on its own.
  const showsRightArea = isRightAreaOpen && windowTabs.group !== undefined;
  const draftUp = draftOfGroup(windowTabs.group);
  const isExpanded =
    openDraft?.placement === "expanded" && draftUp !== undefined;
  const isPageOnScreen = active?.kind === "page";

  // The router follows the tab on screen: a screen's own address, or the
  // page route, which shows nothing of its own, while a page is up. Checked
  // against the history's own address rather than the rendered one: two
  // pushes in one tick reach the render one at a time, and a push made
  // against the earlier of them would be a step backward.
  useEffect(() => {
    if (!active) {
      return;
    }
    const latest = router.history.location;
    if (active.kind === "page") {
      if (latest.pathname !== PAGE_ROUTE) {
        router.history.push(PAGE_ROUTE);
      }
    } else if (latest.href !== active.href) {
      router.history.push(active.href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Route navigation stays in this tab, including when leaving a website.
  useEffect(() => {
    if (tabs.length === 0) {
      return;
    }
    // An address the history has already moved past is not one to follow:
    // the tabs were set for where the history is now, and following the
    // stale one would move them back, and the effect above forward, without
    // end.
    if (router.history.location.href !== location.href) {
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
  /**
   * Opens a page: in the tab on screen when it is a page of the window's
   * own, in a tab of its own when asked for one, and into a named group when
   * the open belongs to a thread other than the one up, where it waits
   * behind. A group's anchor is never replaced: a page opened from it opens
   * beside it.
   */
  const openPage = (
    url: string,
    { group: into, newTab = false }: OpenOptions = {},
  ) => {
    if (into !== undefined && into !== windowTabs.group) {
      browser?.openOrFocus(url, { group: into });
      return;
    }
    setRightAreaOpen(true);
    if (!newTab && active?.kind === "page" && !active.taskId) {
      browser?.navigate(url);
      return active.id;
    }
    // A tab of its own is asked for once per place: a page already open in
    // this group at that address comes forward rather than opening again.
    if (newTab && !isFreshNewTab) {
      browser?.openOrFocus(url);
      return;
    }
    return browser?.open(
      url,
      active &&
        !isTaskTab &&
        !isAnchor(active) &&
        (!newTab || isFreshNewTab)
        ? { replacing: active }
        : undefined,
    );
  };
  const openScreen = (
    href: string,
    { group: into, newTab = false }: OpenOptions = {},
  ) => {
    const thread = threadOfHref(href);
    if (thread) {
      // The thread's group comes up at the tab it last had up, and the
      // address follows that tab; pushing the thread's own address here
      // would send the group back to the thread itself.
      setRightAreaOpen(true);
      windowTabs.showThread(thread);
      return;
    }
    if (into !== undefined && into !== windowTabs.group) {
      windowTabs.openOrFocusScreen(href, { group: into, isOpened: true });
      return;
    }
    if (windowTabs.group === undefined) {
      // Nothing is on screen to open it in: a screen belongs to a thread or
      // a draft, never to the window on its own.
      return;
    }
    setRightAreaOpen(true);
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
  const openNamedPath = (path: string, options?: OpenOptions) => {
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
          // Into the thread that asked, which may not be the one on screen.
          const group = target.sessionId;
          if (target.kind === "page") {
            const tabId = openers.current.openPage(target.url, {
              ...(group ? { group } : {}),
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
            openers.current.openNamedPath(target.mount, {
              ...(group ? { group } : {}),
              newTab: true,
            });
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
  const topicsQuery = useQuery(
    rpcClient.workspace.orchestrator.topics.list.queryOptions({
      input: ids ? { id: ids.taskId } : skipToken,
    }),
  );
  const topics = topicsQuery.data ?? [];
  const [isStarting, setStarting] = useState(false);

  /** Brings a draft's group on screen with its head over it. */
  const showDraft = (id: string, placement: "docked" | "expanded") => {
    setOpenDraft({ id, placement });
    setRightAreaOpen(true);
    windowTabs.showDraft(id);
  };
  /** Makes a draft, filed under a topic when the pane stands in one, and brings it up. */
  const startDraft = (topicId: string | undefined) => {
    const now = Date.now();
    const draft: Draft = {
      createdAt: now,
      id: ulid(),
      ...(topicId ? { topicId } : {}),
      updatedAt: now,
      words: "",
    };
    setDrafts((current) => [...current, draft]);
    showDraft(draft.id, "docked");
  };
  /** Hands the screen back to the group the draft took it from, or to nothing. */
  const leaveDraft = () => {
    const previous = windowTabs.previousGroup;
    const thread = previous
      ? StoreId.SessionSchema.safeParse(previous)
      : undefined;
    if (thread?.success) {
      windowTabs.showThread(thread.data);
    } else {
      windowTabs.leaveGroup();
    }
  };
  /** Puts the draft away to a bar, keeping everything it has. */
  const putDraftAway = (id: string, placement: "bar") => {
    setOpenDraft({ id, placement });
    leaveDraft();
  };
  /** Throws a draft away: its record, its files, and its tabs. */
  const deleteDraft = (id: string) => {
    setDrafts((current) => current.filter((draft) => draft.id !== id));
    setDraftFiles(({ [id]: _dropped, ...rest }) => rest);
    if (openDraft?.id === id) {
      setOpenDraft(null);
      if (draftUp === id) {
        leaveDraft();
      }
    }
    windowTabs.dropGroup(draftGroupOf(id));
  };
  /**
   * Closes the draft: one with words or something gathered is kept in
   * Drafts, the way mail keeps a draft, and an empty one is thrown away.
   */
  const closeDraft = (id: string) => {
    const draft = drafts.find((entry) => entry.id === id);
    const hasTabs = windowTabs.allTabs.some(
      (tab) => tab.group === draftGroupOf(id) && !isAnchor(tab),
    );
    if (draft && (draft.words.trim() !== "" || hasTabs)) {
      setOpenDraft(null);
      leaveDraft();
      toast("Saved to Drafts");
    } else {
      deleteDraft(id);
    }
  };
  /**
   * Starts the thread the draft is for: its words, its files, and its topic
   * as the first message, with what its tabs show as the context; then what
   * the draft gathered becomes the thread's tabs as they are, and the
   * thread comes on screen.
   */
  const startThread = (id: string) => {
    const draft = drafts.find((entry) => entry.id === id);
    if (!draft || !ids) {
      return;
    }
    if (!modelURI) {
      toast.error("Choose a model before starting a thread");
      return;
    }
    setStarting(true);
    void sendContextRef.current().then((viewing) => {
      createMessage.mutate(
        {
          files: (draftFilesRef.current[id] ?? []).map((file) => ({
            content: file.content,
            filename: file.name,
          })),
          id: ids.taskId,
          modelURI,
          prompt: draft.words,
          ...(draft.topicId ? { topics: [draft.topicId] } : {}),
          viewing,
        },
        {
          onError: (error) => {
            toast.error("Failed to start the thread", {
              description: error.message,
            });
          },
          onSettled: () => {
            setStarting(false);
          },
          onSuccess: ({ sessionId }) => {
            setDrafts((current) => current.filter((entry) => entry.id !== id));
            setDraftFiles(({ [id]: _sent, ...rest }) => rest);
            setOpenDraft(null);
            windowTabs.adoptGroup(draftGroupOf(id), sessionId);
          },
        },
      );
    });
  };
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
        // The composer is the draft at the corner, which takes the caret as
        // it opens.
        focusComposer: () => {
          startDraft(undefined);
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
  const sendContext = async (): Promise<
    SessionMessageDataPart.ViewContextDataPart | undefined
  > => {
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

  sendContextRef.current = sendContext;

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
                // Nothing in the bar's middle for now: the tabs are each
                // thread's and sit over the thread; the region is kept for
                // tabs of the window's own, should they come back.
                tabs={null}
                trailing={
                  <>
                    {/* How many tasks are at work, and the list of them: a
                      task pressed opens its thread and then the task as a
                      tab of the thread's, since the tabs are each thread's. */}
                    <TasksBadge
                      onOpen={(task) => {
                        // A task filed outside any thread opens among the
                        // group up, if there is one.
                        if (task.threadId) {
                          openScreen(`${THREADS_HREF}/${task.threadId}`);
                        }
                        openScreen(`/orchestrator/tasks/${task.id}`, {
                          newTab: true,
                        });
                      }}
                      tasks={children.data ?? []}
                    />
                    {/* The way out of the right area as a whole, at the
                      bar's end: not perfectly the bar's business, but the
                      one place a control over the whole area can sit. */}
                    <RightAreaToggle />
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
            <ChatColumn
              isHidden={isExpanded}
              isRightAreaOpen={showsRightArea}
            >
              {/* `select-text`: the pane's shell is chrome and turns selection off; the chat is text. */}
              <div className="flex min-h-0 w-full flex-1 flex-col select-text [&_.prose]:text-[13px] [&_.prose]:leading-5 [&_.text-sm]:text-[13px]">
                {/* Names the openers for what the rows hold, so a file, an
                  app, or a page a thread made opens in the tab on screen the
                  way the thread itself does; a middle or modified click is
                  what asks for a tab of its own. */}
                <OrchestratorContext
                  value={{
                    ...screens,
                    openPage: (url) => openPage(url),
                    openScreen: (href) => {
                      openScreen(href);
                    },
                    opensNewTab: false,
                  }}
                >
                  <FileOpenContext
                    value={(path) => {
                      openNamedPath(path);
                    }}
                  >
                    <PageOpenContext value={(url) => openPage(url)}>
                      <ThreadPane
                        drafts={drafts}
                        onDeleteDraft={deleteDraft}
                        onNew={startDraft}
                        onOpenDraft={(id: string) => {
                          showDraft(id, "docked");
                        }}
                        onOpenThread={(thread) => {
                          openScreen(`${THREADS_HREF}/${thread.id}`);
                        }}
                        openThreadId={
                          isRightAreaOpen ? windowTabs.group : undefined
                        }
                        taskId={screens.taskId}
                      />
                    </PageOpenContext>
                  </FileOpenContext>
                </OrchestratorContext>
              </div>
            </ChatColumn>
            {/* Hidden rather than unmounted while the area is closed, so
              every tab keeps what it has for when something opens again. */}
            <main
              className={cn(
                "relative flex min-w-0 flex-1 flex-col",
                showsRightArea ? undefined : "hidden",
              )}
            >
              {/* A draft up: its words are the head of the right area, over
                its tabs, and what a tab shows sits under both. */}
              {openDraft && draftUp === openDraft.id && (
                <DraftHead
                  draft={drafts.find((draft) => draft.id === openDraft.id)}
                  isExpanded={openDraft.placement === "expanded"}
                  isStarting={isStarting}
                  onChange={(update) => {
                    setDrafts((current) =>
                      current.map((draft) =>
                        draft.id === openDraft.id
                          ? { ...update(draft), updatedAt: Date.now() }
                          : draft,
                      ),
                    );
                  }}
                  onClose={() => {
                    closeDraft(openDraft.id);
                  }}
                  onExpand={(expanded) => {
                    setOpenDraft({
                      id: openDraft.id,
                      placement: expanded ? "expanded" : "docked",
                    });
                  }}
                  onMinimize={() => {
                    putDraftAway(openDraft.id, "bar");
                  }}
                  onStart={() => {
                    startThread(openDraft.id);
                  }}
                  topics={topics}
                />
              )}
              {/* The tabs of the thread on screen, the thread itself first
                and held there, or the window's own when no thread is up.
                Switching threads swaps the whole row. */}
              <div className="flex h-9 shrink-0 items-center border-b border-border bg-muted/40 px-2">
                <WindowTabStrip
                  childTitles={childTitles}
                  groupKey={windowTabs.group ?? "window"}
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
              </div>
              {/* Under the tabs and across the pane: what this tab is
                showing, and the way back out of it; a thread's own tab has
                nowhere to type or step to, so it wears its head instead. */}
              {active && isAnchor(active) && tabLocation.kind === "thread" ? (
                <ThreadHeader
                  thread={threads.data?.find(
                    (thread) => thread.id === windowTabs.group,
                  )}
                  topics={topics}
                />
              ) : (
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
              )}
              <div className="relative min-h-0 flex-1">
                <Outlet />
                {/* The threads, kept mounted behind the one whose tab is up,
                  so switching back is the transcript as it was. */}
                <ThreadStage
                  sessionId={
                    active?.kind === "screen" && isAnchor(active)
                      ? threadOfHref(active.href)
                      : undefined
                  }
                />
                {/* Hidden rather than unmounted while a screen is up, so the pages stay. */}
                <div
                  className={cn(
                    "absolute inset-0 bg-background",
                    isPageOnScreen && showsRightArea ? undefined : "invisible",
                  )}
                >
                  {/* The guests are the pool's, drawn over a slot rather than in it, so hiding this box hides nothing of theirs: the panel parks its guest when told the screen is off, the way a task page does when its tab is in the background. */}
                  <ActiveTabProvider
                    isActive={isPageOnScreen && showsRightArea}
                  >
                    <BrowserTabs
                      chromeInto={chromeSlot}
                      groupOfTask={(id) => childThreads.get(id)}
                      ref={setBrowser}
                    />
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
            {/* A draft put away to a bar along the bottom edge, still there
              to take up again. */}
            {openDraft?.placement === "bar" && (
              <DraftBar
                draft={drafts.find((draft) => draft.id === openDraft.id)}
                onClose={() => {
                  closeDraft(openDraft.id);
                }}
                onOpen={() => {
                  showDraft(openDraft.id, "docked");
                }}
              />
            )}
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
