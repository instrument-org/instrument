import {
  appPlaceAtom,
  type Draft,
  draftGroupOf,
  draftOfGroup,
  draftsAtom,
  draftSnapshotsAtom,
  inboxOpenAtom,
  NEW_TAB_HREF,
  type OrchestratorRecent,
  orchestratorRecentsAtom,
  orchestratorSidebarWidthAtom,
  paneOpenByGroupAtom,
  RECENTS_MAX,
  screenViewAtom,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  threadFiltersAtom,
  THREADS_HREF,
  type WindowTab,
} from "@/client/atoms/orchestrator";
import { openSettings } from "@/client/atoms/settings-modal";
import { FileSystemIconSpriteSheet } from "@/client/components/extend/file-system";
import { FileOpenContext } from "@/client/components/file-open-context";
import { AppRail } from "@/client/components/orchestrator/app-rail";
import { useAppsBySlug } from "@/client/components/orchestrator/apps-by-slug";
import {
  BrowserTabs,
  type BrowserTabsHandle,
} from "@/client/components/orchestrator/browser-tabs";
import { ComposeLayer } from "@/client/components/orchestrator/compose-layer";
import { type DraftSend } from "@/client/components/orchestrator/compose-window";
import {
  type OpenOptions,
  OrchestratorContext,
  type OrchestratorWindow,
} from "@/client/components/orchestrator/context";
import { EmptyPlace } from "@/client/components/orchestrator/empty-place";
import {
  fileHref,
  folderHref,
  mountOfHostPath,
} from "@/client/components/orchestrator/file-tabs";
import { segmentsOf } from "@/client/components/orchestrator/host-path";
import { InboxToggle } from "@/client/components/orchestrator/inbox-toggle";
import { NewTopicDialog } from "@/client/components/orchestrator/new-topic-dialog";
import { PaneToggle } from "@/client/components/orchestrator/pane-toggle";
import { RightPane } from "@/client/components/orchestrator/right-pane";
import {
  screenLocation,
  screenPresentation,
} from "@/client/components/orchestrator/screen-presentation";
import {
  memoryOfHref,
  type TabLocation,
  tasksFaceOfHref,
} from "@/client/components/orchestrator/tab-location";
import { TabLocationRow } from "@/client/components/orchestrator/tab-location-row";
import { ThreadHeader } from "@/client/components/orchestrator/thread-header";
import { ThreadPane } from "@/client/components/orchestrator/thread-pane";
import { ThreadStage } from "@/client/components/orchestrator/thread-stage";
import { ThreadTasksButton } from "@/client/components/orchestrator/thread-tasks-button";
import { ThreadTasksView } from "@/client/components/orchestrator/thread-tasks-view";
import { type TasksFace } from "@/client/components/orchestrator/thread-tasks-view";
import { NO_FILTERS } from "@/client/components/orchestrator/threads";
import { useCompose } from "@/client/components/orchestrator/use-compose";
import { ideasQueryOptions } from "@/client/components/orchestrator/use-ideas";
import { useSetThreadTopics } from "@/client/components/orchestrator/use-set-thread-topics";
import { WindowBar } from "@/client/components/orchestrator/window-bar";
import { WindowTabStrip } from "@/client/components/orchestrator/window-tab-strip";
import {
  isHomeTab,
  PAGE_ROUTE,
  parseHref,
  threadOfHref,
  threadOfHrefPrefix,
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
import { requestBrowserFind } from "@/client/lib/foreground-browser-registry";
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
  type Ref,
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

/** Dragged narrower than this, the inbox column slides shut rather than stopping at its floor. */
const INBOX_COLLAPSE_THRESHOLD = 240;
/** How far past its widest the inbox is dragged before it takes the row and the thread beside it goes. */
const INBOX_COVER_PAST = 80;
/** The least the conversation and its pane keep beside the inbox. */
const MAIN_WIDTH_MIN = 560;

/**
 * The column the inbox stands in: beside the right area, the resizable rail
 * the way the classic window keeps its sidebar, sliding shut when dragged
 * under its floor or put away by the bar's toggle, and giving the whole row
 * to the inbox when dragged past its widest; with nothing on the right, the
 * whole width outright. The pane inside is re-laid between the two, so
 * anything it has to keep lives outside it.
 */
function ChatColumn({
  bounds,
  children,
  isOpen,
  isRightAreaOpen,
  onCollapse,
  onCover,
}: {
  bounds: RailBounds;
  children: ReactNode;
  isOpen: boolean;
  isRightAreaOpen: boolean;
  onCollapse: () => void;
  onCover: () => void;
}) {
  if (!isRightAreaOpen) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    );
  }
  return (
    <StudioSidebarRail
      bounds={bounds}
      isOpen={isOpen}
      label="Resize the inbox"
      onCollapse={onCollapse}
      onCover={onCover}
      panelClassName="bg-background"
      widthAtom={orchestratorSidebarWidthAtom}
    >
      {children}
    </StudioSidebarRail>
  );
}

/**
 * How wide the inbox column may be beside the right area: the row less what
 * the conversation keeps, within the column's own floor and ceiling; a drag
 * past that by a margin covers the row.
 */
function inboxBounds(rowWidth: number): RailBounds {
  const max = Math.min(
    SIDEBAR_WIDTH_MAX,
    Math.max(SIDEBAR_WIDTH_MIN, rowWidth - MAIN_WIDTH_MIN),
  );
  return {
    collapse: INBOX_COLLAPSE_THRESHOLD,
    cover: max + INBOX_COVER_PAST,
    initial: SIDEBAR_WIDTH_DEFAULT,
    max,
    min: SIDEBAR_WIDTH_MIN,
  };
}

export const Route = createFileRoute("/orchestrator")({
  component: OrchestratorLayout,
  head: () => ({ meta: [{ title: APP_NAME }] }),
});

/**
 * The window's chrome: no title bar, so it drags by its top-left corner,
 * which is the chat pane's top, past the traffic lights.
 */
function Frame({
  bar,
  children,
  overlay,
  rail,
  rowRef,
}: {
  bar?: ReactNode;
  children: ReactNode;
  /** Laid over the row, for the draft windows that float over it. */
  overlay?: ReactNode;
  /** The rail down the window's left edge, outside the row the columns share. */
  rail?: ReactNode;
  /** The row the columns share, for whoever sizes them against it. */
  rowRef?: Ref<HTMLDivElement>;
}) {
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
          named anywhere in the window (a thread's marks, say) wears the same
          colored mark it has in the computer view. */}
        <FileSystemIconSpriteSheet />
        {/* The bar is the window's own row and reserves the band the traffic
          lights are drawn in, so no column below has to leave a gap for them. */}
        {bar ?? (
          <div
            className="shrink-0 border-b border-border [-webkit-app-region:drag]"
            style={{ height: `${TOOLBAR_HEIGHT}px` }}
          />
        )}
        <div className="flex min-h-0 flex-1">
          {rail}
          {/* Measured on its own, past the rail, so a column sized against
            the row is sized against the width the columns actually share.
            The overlay shares its width and its edges, so a draft window
            stands against the row's own corner. */}
          <div
            className="relative flex min-h-0 min-w-0 flex-1 flex-col"
            ref={rowRef}
          >
            <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
            {overlay}
          </div>
        </div>
        <StudioModals />
        <Toaster position="bottom-right" />
        {/* No action beside it: the release notes are a screen this window has
          not got, and the version it is now on is the part worth saying. */}
        <UpdatedToast />
      </div>
    </ChromeInsetProvider>
  );
}

/** Whether a draft has anything written in it, which is what keeps it past its window. */
function hasWords(draft: Draft): boolean {
  return draft.words.trim() !== "";
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
  const [defaultModelURI, setDefaultModelURI, saveDefaultModelURI] =
    useDefaultModelURI();
  const screenView = useAtomValue(screenViewAtom);
  const [drafts, setDrafts] = useAtom(draftsAtom);
  const setDraftSnapshots = useSetAtom(draftSnapshotsAtom);
  const [threadFilters, setThreadFilters] = useAtom(threadFiltersAtom);
  // The place the rail has the window standing in. Only the chat is built:
  // its columns stay mounted behind the other places, hidden, so a thread
  // and its tabs are as they were on the way back.
  const [place, setPlace] = useAtom(appPlaceAtom);
  const isChat = place === "chat";
  // Read at the moment of starting, since the context is gathered first, and
  // the reader of the screen is made further down.
  const sendContextRef = useRef<
    () => Promise<SessionMessageDataPart.ViewContextDataPart | undefined>
  >(() => Promise.resolve(undefined));
  const [isInboxOpen, setInboxOpen] = useAtom(inboxOpenAtom);
  const [sidebarWidth, setSidebarWidth] = useAtom(orchestratorSidebarWidthAtom);
  // The row the columns share, measured in layout px, so the inbox's widest
  // leaves the conversation its least whatever the window is.
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
  const bounds = inboxBounds(rowWidth);
  const [paneOpenByGroup, setPaneOpenByGroup] = useAtom(paneOpenByGroupAtom);
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
  const { active, tabs } = windowTabs;
  // Nothing is on screen with no group up: the right area belongs to a
  // thread or a draft, never to the window on its own.
  const showsRightArea = windowTabs.group !== undefined;
  // An inbox left at the row's whole width, or a window grown narrower,
  // gives the conversation its least back as soon as something is beside it.
  useEffect(() => {
    if (showsRightArea && rowWidth > 0 && sidebarWidth > bounds.max) {
      setSidebarWidth(bounds.max);
    }
  }, [showsRightArea, rowWidth, sidebarWidth, bounds.max, setSidebarWidth]);
  // The drafts being written, in windows along the row's foot.
  const compose = useCompose(rowWidth);
  // A draft is written over the screen, never on it: a draft's group left
  // on screen by an earlier launch is put away, and a draft with no words
  // is not kept past its window, so one left over from a launch goes too.
  // Once, over what was restored.
  useEffect(() => {
    if (draftOfGroup(windowTabs.group) !== undefined) {
      windowTabs.leaveGroup();
    }
    for (const draft of drafts) {
      if (!hasWords(draft)) {
        windowTabs.dropGroup(draftGroupOf(draft.id));
      }
    }
    setDrafts((current) => current.filter(hasWords));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The thread whose group is on screen, beside its tabs.
  const threadUp = (() => {
    const parsed = StoreId.SessionSchema.safeParse(windowTabs.group);
    return parsed.success ? parsed.data : undefined;
  })();
  const isPageOnScreen = active?.kind === "page";
  // The thread's tasks as the pane's face, over whatever tab it has up: a
  // fixed view rather than a tab, so it is never among the tabs to close or
  // keep track of, holding the thread's list or one task's page. Put away by
  // picking a tab or opening anything, which both change the tab under it,
  // and by pressing its control again.
  const [tasksFace, setTasksFace] = useState<TasksFace>();
  const isTasksViewUp =
    tasksFace !== undefined && tasksFace.thread === threadUp;
  const activeTabId = active?.id;
  useEffect(() => {
    // Opened over the tab the thread had up then; a change under it is the
    // user, or a task's browser arriving, asking for the tab.
    setTasksFace((current) =>
      current === undefined || current.overTab === activeTabId
        ? current
        : undefined,
    );
  }, [activeTabId]);
  // The pane beside the conversation: open unless this group put it away,
  // and shown only while there are tabs to show in it or its tasks are its
  // face. Closing the last tab closes the pane; the toggle brings it back
  // with a new tab in it.
  const isPaneWanted =
    windowTabs.group === undefined ||
    (paneOpenByGroup[windowTabs.group] ?? true);
  const showsPane = (tabs.length > 0 || isTasksViewUp) && isPaneWanted;
  // Whether the page in the pane is what is on screen: the chat up, the tab
  // a page, the pane open, and nothing over it. Off, the guest is parked. A
  // draft window counts as over it: a guest paints over everything in the
  // window, so one under a draft would paint over the draft.
  const isPageShown =
    isChat &&
    isPageOnScreen &&
    showsRightArea &&
    showsPane &&
    !isTasksViewUp &&
    !compose.covers;
  const setPaneOpen = (group: string, isOpen: boolean) => {
    setPaneOpenByGroup((current) => ({ ...current, [group]: isOpen }));
  };
  /** Brings the pane up for the group on screen, for something opened into it. */
  const revealPane = () => {
    if (windowTabs.group !== undefined) {
      setPaneOpen(windowTabs.group, true);
    }
  };
  const togglePane = () => {
    const group = windowTabs.group;
    if (group === undefined) {
      return;
    }
    if (showsPane) {
      setPaneOpen(group, false);
      return;
    }
    setPaneOpen(group, true);
    if (tabs.length === 0) {
      windowTabs.openScreen(NEW_TAB_HREF);
    }
  };
  const paneToggle = <PaneToggle isOpen={showsPane} onToggle={togglePane} />;

  /**
   * Brings the face up over a thread: its list, or one of its tasks, with
   * the thread on screen and its pane open. A task is shown in the thread it
   * was filed from; one filed from none goes over the thread on screen.
   */
  const showTasksFace = (task?: TaskId, group?: string) => {
    const filedFrom = task === undefined ? undefined : childThreads.get(task);
    const parsed = StoreId.SessionSchema.safeParse(
      filedFrom ?? group ?? windowTabs.group,
    );
    if (!parsed.success) {
      return;
    }
    const thread = parsed.data;
    windowTabs.showThread(thread);
    setPaneOpen(thread, true);
    setTasksFace((current) => ({
      // What was left behind stays forward of the list, so back and then
      // forward lands where it was.
      forward:
        task === undefined && current?.thread === thread
          ? current.task
          : undefined,
      overTab: windowTabs.tabUpIn(thread)?.id,
      task,
      thread,
    }));
  };

  // A task the thread on screen has just started brings the thread's tasks
  // up as the pane's face, so someone watching the conversation sees what it
  // is working through and can open any of them. The face already up stays
  // as it is, on the list or on a task; a task's browser arriving still takes
  // the pane, as it does. Nothing on the first read, which lists what was
  // there before the window, and nothing for a task another thread started.
  const knownChildren = useRef<Set<TaskId>>(null);
  useEffect(() => {
    const listed = children.data;
    if (!listed) {
      return;
    }
    const known = knownChildren.current;
    knownChildren.current = new Set(listed.map((child) => child.id));
    if (!known || threadUp === undefined || isTasksViewUp) {
      return;
    }
    const arrived = listed.some(
      (child) => !known.has(child.id) && child.threadId === threadUp,
    );
    if (arrived) {
      showTasksFace(undefined, threadUp);
    }
    // On each read of the tasks; the rest is read as it is then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children.data]);

  // A tab at the tasks' address from before the tasks became the pane's
  // face has no screen behind it: closed as the window opens, and opened
  // again as the face if it is asked for back.
  useEffect(() => {
    for (const tab of windowTabs.allTabs) {
      if (tab.kind === "screen" && tasksFaceOfHref(tab.href)) {
        windowTabs.close(tab.id);
      }
    }
    // Once, over the tabs as they were restored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The router follows the tab on screen: a screen's own address, or the
  // page route, which shows nothing of its own, while a page is up or no tab
  // is. Checked against the history's own address rather than the rendered
  // one: two pushes in one tick reach the render one at a time, and a push
  // made against the earlier of them would be a step backward.
  useEffect(() => {
    const latest = router.history.location;
    if (!active || active.kind === "page") {
      if (latest.pathname !== PAGE_ROUTE) {
        router.history.push(PAGE_ROUTE);
      }
    } else if (latest.href !== active.href) {
      router.history.push(active.href);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  // Route navigation stays in this tab, including when leaving a website.
  useEffect(() => {
    if (windowTabs.group === undefined) {
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
    if (!active) {
      // Nothing under the head to move: a screen the router was sent to
      // opens as the group's first tab.
      windowTabs.openScreen(location.href);
    } else if (active.kind === "screen") {
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
   * behind. Opened into the group on screen, it brings the pane up.
   */
  const openPage = (
    url: string,
    { group: into, newTab = false, show = false }: OpenOptions = {},
  ) => {
    if (into !== undefined && into !== windowTabs.group) {
      const id = browser?.openOrFocus(url, { group: into, show });
      if (show) {
        setPaneOpen(into, true);
      }
      return id;
    }
    if (windowTabs.group === undefined) {
      // Nothing is on screen to open it in: a page belongs to a thread or a
      // draft, never to the window on its own.
      return;
    }
    revealPane();
    if (!newTab && active?.kind === "page" && !active.taskId) {
      browser?.navigate(url);
      return active.id;
    }
    // A tab of its own is asked for once per place: a page already open in
    // this group at that address comes forward rather than opening again.
    if (newTab && !isFreshNewTab) {
      return browser?.openOrFocus(url);
    }
    return browser?.open(
      url,
      active && !isTaskTab && (!newTab || isFreshNewTab)
        ? { replacing: active }
        : undefined,
    );
  };
  const openScreen = (
    href: string,
    { group: into, newTab = false, show = false }: OpenOptions = {},
  ) => {
    // A whole id, or the start of one the way a reply's link carries it,
    // among the threads the window has: a whole id that names none of them
    // is a link to a thread since deleted, not a thread with nothing in it.
    // Until the list has been read, a whole id is taken on its own.
    const thread = threads.data
      ? threadOfHrefPrefix(href, threadTitles.keys())
      : threadOfHref(href);
    if (thread) {
      // The thread's group comes up at the tab it last had up, and the
      // address follows that tab; pushing the thread's own address here
      // would send the tab on screen there.
      windowTabs.showThread(thread);
      return;
    }
    if (parseHref(href).pathname.startsWith(`${THREADS_HREF}/`)) {
      // A thread's address that names none of the threads here: a screen
      // at it would be a thread with nothing in it.
      toast("No thread at that address", {
        description:
          "It may have been deleted, or the link is not for this chat.",
      });
      return;
    }
    // A task, or the tasks, are the face of their thread's pane rather than
    // a screen of their own: every way of asking for one lands there.
    const face = tasksFaceOfHref(href);
    if (face) {
      showTasksFace(face.task, into);
      return;
    }
    // A memory is shown where all of them are, in Settings, brought to the
    // one named; a screen of its own would be one memory with nothing to do
    // to it.
    const memory = memoryOfHref(href);
    if (memory) {
      openSettings({ memory, tab: "Memory" });
      return;
    }
    if (into !== undefined && into !== windowTabs.group) {
      windowTabs.openOrFocusScreen(href, {
        group: into,
        isOpened: true,
        show,
      });
      if (show) {
        setPaneOpen(into, true);
      }
      return;
    }
    if (windowTabs.group === undefined) {
      // Nothing is on screen to open it in: a screen belongs to a thread or
      // a draft, never to the window on its own.
      return;
    }
    revealPane();
    if (!active) {
      // Nothing in the pane to open it in place of.
      windowTabs.openScreen(href);
    } else if (newTab && !isFreshNewTab) {
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
  // The face over the tab is walked first of all: a task back to the list,
  // the list back to the tab under it, and forward from the list to the
  // task that was left.
  const canGoBack =
    isTasksViewUp ||
    Boolean(active?.past?.length) ||
    (isPageOnScreen ? true : windowTabs.canStepBack);
  const canGoForward = isTasksViewUp
    ? tasksFace.task === undefined && tasksFace.forward !== undefined
    : isPageOnScreen
      ? Boolean(active.future?.length) || (browser?.canGoForward ?? false)
      : Boolean(active?.future?.length) || windowTabs.canStepForward;
  const goBack = () => {
    if (isTasksViewUp) {
      setTasksFace(
        tasksFace.task === undefined
          ? undefined
          : { ...tasksFace, forward: tasksFace.task, task: undefined },
      );
      return;
    }
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
    if (isTasksViewUp) {
      if (tasksFace.forward !== undefined) {
        setTasksFace({
          ...tasksFace,
          forward: undefined,
          task: tasksFace.forward,
        });
      }
      return;
    }
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
          ? screenLocation(active.href, { appsBySlug, threadTitles })
          : { kind: "newTab" };
    if (isTasksViewUp) {
      return tasksFace.task === undefined
        ? { kind: "tasks" }
        : {
            kind: "task",
            title: childTitles.get(tasksFace.task) ?? "Task",
          };
    }
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

  useRecordRecents();

  const createMessage = useMutation(
    rpcClient.workspace.message.create.mutationOptions(),
  );
  // The default first, since it is what the draft's picker edits: every send
  // stores its model on the orchestrator's own state, so once any thread has
  // been started that field is always set, and a pick that only ever reached
  // the fallback would change nothing on screen. The stored model stands in
  // for a window whose default was never saved.
  const modelURI = defaultModelURI ?? state.data?.selectedModelURI;
  const topicsQuery = useQuery(
    rpcClient.workspace.orchestrator.topics.list.queryOptions({
      input: ids ? { id: ids.taskId } : skipToken,
    }),
  );
  const topics = topicsQuery.data ?? [];
  const createTopic = useMutation(
    rpcClient.workspace.orchestrator.topics.create.mutationOptions({
      onSuccess: () => void topicsQuery.refetch(),
    }),
  );
  const setThreadTopics = useSetThreadTopics(ids?.taskId);
  const [isNewTopicOpen, setNewTopicOpen] = useState(false);
  // The draft whose first message is on its way, by id.
  const [startingId, setStartingId] = useState<string>();

  /** Brings a draft up in a window along the foot, to go on writing it. */
  const showDraft = (id: string) => {
    compose.open(id);
  };
  /**
   * Makes a draft, filed under a topic when the pane stands in one and with
   * words already in it when a button handed some over, and brings it up in
   * a window of its own with the new-tab page as its first tab: the place to
   * find a site, a folder, a file, or an app to gather. Every ask is a new
   * draft, beside the ones already open.
   */
  const startDraft = (topicId: string | undefined, words = "") => {
    const now = Date.now();
    const draft: Draft = {
      createdAt: now,
      id: ulid(),
      ...(topicId ? { topicId } : {}),
      updatedAt: now,
      words,
    };
    setDrafts((current) => [...current, draft]);
    windowTabs.openScreen(NEW_TAB_HREF, {
      activate: true,
      group: draftGroupOf(draft.id),
    });
    showDraft(draft.id);
  };
  /**
   * New, from the rail or its chord, or a button handing over a line: a
   * draft filed under the topic the inbox stands in while it stands in one,
   * with the window put on the chat, which is where a draft is written.
   */
  const newDraft = (words?: string) => {
    setPlace("chat");
    startDraft(
      isChat && threadFilters.topics.length === 1
        ? topics.find((topic) => topic.id === threadFilters.topics[0])?.id
        : undefined,
      typeof words === "string" ? words : "",
    );
  };
  /**
   * Puts the group on screen away: the inbox takes the width, and comes
   * back if it was hidden, since nothing else would be left on screen.
   */
  const leaveGroup = () => {
    windowTabs.leaveGroup();
    setInboxOpen(true);
  };
  // What a draft's composer held is kept only as long as the draft: a
  // composer unmounting keeps its snapshot as it goes, so a draft sent or
  // thrown away is pruned here, after that.
  const draftIds = drafts.map((draft) => draft.id).join("\n");
  useEffect(() => {
    const keep = new Set(draftIds.split("\n"));
    setDraftSnapshots((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([id]) => keep.has(id)),
      ),
    );
  }, [draftIds, setDraftSnapshots]);
  /** Throws a draft away: its window, its record, what its composer held, and its tabs. */
  const deleteDraft = (id: string) => {
    compose.remove(id);
    setDrafts((current) => current.filter((draft) => draft.id !== id));
    windowTabs.dropGroup(draftGroupOf(id));
  };
  /**
   * Closes a draft's window: one with words is kept in Drafts the way mail
   * keeps a draft, and one with nothing written is thrown away, whatever it
   * gathered, so a draft opened and closed again leaves nothing behind. The
   * words come from the window, since the record follows the box a beat
   * behind.
   */
  const closeDraft = (id: string, words: string) => {
    if (words.trim() === "") {
      deleteDraft(id);
    } else {
      compose.remove(id);
    }
  };
  // The inbox's rows as the pane lists them, for stepping through them by
  // chord; the pane says what it shows, since it holds the filters.
  const listedThreads = useRef<StoreId.Session[]>([]);
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
    newThread: newDraft,
    // Put away only while something is on screen to have the window; with
    // nothing beside it the column is the window, and stays.
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
        openScreen(tab.href, { newTab: true });
      }
    },
    search: focusOmnibar,
    selectRelative: windowTabs.selectRelative,
    selectTab: windowTabs.selectIndex,
    toggleInbox: () => {
      setInboxOpen((isOpen) => !isOpen || !showsRightArea);
    },
    // The next or previous row of the inbox from the thread on screen; from
    // no thread, the list's first or last.
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
  });
  /** A group's tabs as the conversation is told them, in the strip's order: what `open` and `--tab` can name. */
  const describeTabs = (
    listed: WindowTab[],
  ): NonNullable<SessionMessageDataPart.ViewContextDataPart["tabs"]> =>
    listed.map((tab) => {
      if (tab.kind !== "page") {
        return {
          at: tab.href,
          title: screenPresentation(tab.href, { appsBySlug, threadTitles })
            .title,
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
    });
  /**
   * What a draft's window has up as its thread starts: the band's page, read
   * at that moment, or the folder or file its screen reported, and the
   * draft's tabs for the thread to name. Nothing while the band shows
   * nothing the conversation can be told about.
   */
  const draftContext = async (
    draftId: string,
  ): Promise<SessionMessageDataPart.ViewContextDataPart | undefined> => {
    const group = draftGroupOf(draftId);
    const up = windowTabs.tabUpIn(group);
    const view = compose.viewsById[draftId];
    if (!view || !state.data || !up) {
      return;
    }
    const filePath =
      view.screen === "browser" && up.kind === "page"
        ? hostPathOfFileUrl(up.url)
        : view.screen === "file"
          ? view.file?.path
          : undefined;
    const page =
      view.screen === "browser" && up.kind === "page" && filePath === undefined
        ? await browser?.readPage(up.id)
        : undefined;
    const mount =
      filePath === undefined
        ? undefined
        : mountOfHostPath(filePath, state.data.attachedFolders ?? {});
    const shown =
      filePath === undefined
        ? view
        : {
            file: {
              ...(mount === undefined ? {} : { mount }),
              name: segmentsOf(filePath).at(-1) ?? filePath,
              path: filePath,
            },
            screen: "file" as const,
          };
    return {
      ...shown,
      ...(page ? { page } : {}),
      tabs: describeTabs(
        windowTabs.allTabs.filter((tab) => tab.group === group),
      ),
      url: up.kind === "page" ? (up.url ?? "about:blank") : up.href,
    };
  };
  /**
   * Starts the thread the draft is for: what its composer sends (the words,
   * the files, the folders, the model) and its topic as the first message,
   * with what its band shows as the context; then what the draft gathered
   * becomes the thread's tabs exactly as they are, and the thread comes on
   * screen beside the inbox.
   */
  const startThread = (id: string, send: DraftSend) => {
    const draft = drafts.find((entry) => entry.id === id);
    if (!draft || !ids) {
      return;
    }
    setStartingId(id);
    // The model chosen for the thread is the one the next draft opens with.
    saveDefaultModelURI(send.modelURI);
    void draftContext(id).then((viewing) => {
      createMessage.mutate(
        {
          files: send.files,
          folders: send.folders,
          id: ids.taskId,
          modelURI: send.modelURI,
          output: send.output,
          prompt: send.prompt,
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
            setStartingId((current) => (current === id ? undefined : current));
          },
          onSuccess: ({ sessionId }) => {
            compose.remove(id);
            setDrafts((current) => current.filter((entry) => entry.id !== id));
            // What the draft gathered becomes the thread's tabs, the pages
            // and folders as they stand; the new-tab pages among them were
            // the band's own face and are not carried over, and a draft that
            // gathered nothing hands over nothing, so the thread opens with
            // no pane.
            const group = draftGroupOf(id);
            const own = windowTabs.allTabs.filter((tab) => tab.group === group);
            const homes = own.filter((tab) => isHomeTab(tab));
            if (homes.length === own.length) {
              windowTabs.dropGroup(group);
              windowTabs.showThread(sessionId);
            } else {
              for (const home of homes) {
                windowTabs.close(home.id);
              }
              windowTabs.adoptGroup(group, sessionId);
            }
            // A list narrowed to a topic or a place is a list the new thread
            // is very likely not in, so the narrowing goes.
            setThreadFilters(NO_FILTERS);
          },
        },
      );
    });
  };
  const screens: null | OrchestratorWindow = ids
    ? {
        // No session: a line a button hands over at the top level opens a
        // draft with the line in it rather than a thread, so the person reads
        // what is about to be asked, adds to it, and sends it themselves.
        ask: (prompt) => {
          newDraft(prompt);
        },
        browser,
        // The composer is a draft in a window of its own, which takes the
        // caret as it opens.
        focusComposer: () => {
          newDraft();
        },
        openPage,
        openPath: openNamedPath,
        openScreen,
        taskId: ids.taskId,
      }
    : null;

  /**
   * What the face has on it, in the terms a screen reports: one task and
   * where it stands, or the thread's tasks each with theirs.
   */
  const tasksFaceView = (
    face: TasksFace,
  ): SessionMessageDataPart.ViewContextDataPart | undefined => {
    const own = (children.data ?? []).filter(
      (child) => child.threadId === face.thread,
    );
    const describe = (child: (typeof own)[number]) => ({
      id: child.id,
      status:
        child.standing.kind === "running"
          ? ("working" as const)
          : ("done" as const),
      ...(child.standing.kind === "running"
        ? { step: child.standing.line }
        : {}),
      title: child.title,
    });
    if (face.task === undefined) {
      return { screen: "tasks", tasks: own.map(describe) };
    }
    const task = own.find((child) => child.id === face.task);
    return task ? { screen: "task", task: describe(task) } : undefined;
  };

  /**
   * What the tab on screen says it shows, plus the page's words when that
   * tab is a page, read at the moment of sending; a screen that registered
   * nothing sends nothing, and so does a group with no tab under its head.
   */
  const sendContext = async (): Promise<
    SessionMessageDataPart.ViewContextDataPart | undefined
  > => {
    // The face over the tab is what the user is looking at while it is up,
    // and it is the window's rather than any screen's to describe.
    const faceView = isTasksViewUp ? tasksFaceView(tasksFace) : undefined;
    if (faceView && state.data) {
      return { ...faceView, tabs: [], url: location.href };
    }
    if (!screenView || !state.data || !active) {
      return;
    }
    // A file shown as a page is the file to the conversation: where it is,
    // and how the agent reaches it when a granted folder covers it, rather
    // than an address only this window can open.
    const activeFilePath =
      screenView.screen === "browser" && active.kind === "page"
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
      tabs: describeTabs(tabs),
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
                leading={
                  // The one control the bar keeps at its left: the inbox
                  // column, put away or brought back, so a thread and its
                  // tabs can have the window. Only while something is on
                  // screen to have it, and only on the chat, which is
                  // where the inbox is.
                  isChat ? <InboxToggle isCollapsible={showsRightArea} /> : null
                }
                // Nothing in the bar's middle: the tabs are each thread's
                // and sit beside the thread.
                tabs={null}
                trailing={
                  <>
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
            overlay={
              <ComposeLayer
                browser={browser}
                compose={compose}
                drafts={drafts}
                isStarting={startingId}
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
                onModelChange={setDefaultModelURI}
                onStart={startThread}
                openOutside={(href) => {
                  openScreen(href, { newTab: true });
                }}
                topics={topics}
              />
            }
            rail={
              <AppRail
                onChoose={setPlace}
                onNew={() => {
                  newDraft();
                }}
                place={place}
              />
            }
            rowRef={setRowElement}
          >
            {/* The places not yet built: the area right of the rail, with
              the chat's columns hidden behind them rather than unmounted. */}
            {place === "home" && <EmptyPlace title="Home" />}
            {place === "apps" && <EmptyPlace title="Apps" />}
            {place === "files" && <EmptyPlace title="Files" />}
            <div
              className={cn(
                "flex min-h-0 min-w-0 flex-1",
                isChat ? undefined : "hidden",
              )}
            >
              <ChatColumn
                bounds={bounds}
                isOpen={isInboxOpen}
                isRightAreaOpen={showsRightArea}
                onCollapse={() => {
                  setInboxOpen(false);
                }}
                onCover={leaveGroup}
              >
                {/* `select-text`: the pane's shell is chrome and turns selection off; the chat is text. */}
                <div className="flex min-h-0 w-full flex-1 flex-col select-text [&_.prose]:text-[13px] [&_.prose]:leading-5 [&_.text-sm]:text-[13px]">
                  {/* Names the openers for what the rows hold: a plain click
                  opens in the tab on screen the way the thread itself does,
                  and a middle or modified click asks for a tab of its own;
                  the rows say which thread a hold belongs to. */}
                  <OrchestratorContext
                    value={{
                      ...screens,
                      openPage: (url, options) => openPage(url, options),
                      openScreen: (href, options) => {
                        openScreen(href, options);
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
                          // Only a draft with words is a draft to come back
                          // to; one being written with none yet is its
                          // window's alone.
                          drafts={drafts.filter(hasWords)}
                          onDeleteDraft={deleteDraft}
                          onListed={(listed) => {
                            listedThreads.current = listed;
                          }}
                          onOpenDraft={showDraft}
                          onOpenThread={(thread) => {
                            openScreen(`${THREADS_HREF}/${thread.id}`);
                          }}
                          openThreadId={windowTabs.group}
                          taskId={screens.taskId}
                        />
                      </PageOpenContext>
                    </FileOpenContext>
                  </OrchestratorContext>
                </div>
              </ChatColumn>
              {/* Hidden rather than unmounted while nothing is on screen, so
              every tab keeps what it has for when something opens again. */}
              <main
                className={cn(
                  "relative flex min-w-0 flex-1 flex-col",
                  showsRightArea ? undefined : "hidden",
                )}
              >
                {/* The conversation, and the pane of the group's tabs beside
                it, the way a task's page keeps its pane: put away and
                brought back by the toggle over the conversation, sized by
                the edge between them, and the pane's state each group's
                own. */}
                <RightPane
                  conversation={
                    <div className="relative flex h-full min-h-0 flex-col">
                      {/* The threads, kept mounted behind the one on screen so
                      switching back is the transcript as it was. */}
                      <div className="absolute inset-0 flex flex-col">
                        <ThreadHeader
                          onNewTopic={() => {
                            setNewTopicOpen(true);
                          }}
                          onSetTopics={(next) => {
                            if (threadUp) {
                              setThreadTopics(threadUp, next);
                            }
                          }}
                          thread={threads.data?.find(
                            (thread) => thread.id === threadUp,
                          )}
                          topics={topics}
                          trailing={showsPane ? null : paneToggle}
                        />
                        <div className="relative min-h-0 flex-1">
                          <ThreadStage
                            sendContext={() => sendContextRef.current()}
                            sessionId={threadUp}
                          />
                        </div>
                      </div>
                    </div>
                  }
                  isOpen={showsPane}
                  onCollapse={() => {
                    if (windowTabs.group !== undefined) {
                      setPaneOpen(windowTabs.group, false);
                    }
                  }}
                  paneKey={windowTabs.group ?? "window"}
                >
                  <div className="flex h-full flex-col p-2">
                    {/* One card, with the strip as its first row: the tabs of
                    the thread or the draft on screen, and at the row's end
                    the toggle that puts the pane away. */}
                    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl bg-card shadow-sm">
                      <div className="flex h-10 shrink-0 items-center border-b border-border pr-1 pl-1">
                        <WindowTabStrip
                          childTitles={childTitles}
                          groupKey={windowTabs.group ?? "window"}
                          onClose={requestClose}
                          onNew={() => {
                            windowTabs.openScreen(NEW_TAB_HREF);
                          }}
                          onReorder={windowTabs.reorder}
                          onSelect={(id) => {
                            setTasksFace(undefined);
                            windowTabs.select(id);
                          }}
                          selectedId={isTasksViewUp ? undefined : active?.id}
                          tabs={tabs}
                          threadTitles={threadTitles}
                          trailing={
                            <>
                              {paneToggle}
                              {/* The thread's own task list, one press from
                              wherever the pane is; a draft has no tasks
                              yet. */}
                              {threadUp !== undefined && (
                                <ThreadTasksButton
                                  isOpen={isTasksViewUp}
                                  onOpen={() => {
                                    // A place to go, never a switch: pressed
                                    // with the list already up, nothing moves;
                                    // with a task up, it goes back to the
                                    // list. A tab picked is what puts the
                                    // face away.
                                    if (
                                      isTasksViewUp &&
                                      tasksFace.task === undefined
                                    ) {
                                      return;
                                    }
                                    showTasksFace(undefined, threadUp);
                                  }}
                                />
                              )}
                            </>
                          }
                        />
                      </div>
                      <TabLocationRow
                        canGoBack={canGoBack}
                        canGoForward={canGoForward}
                        ref={locationRef}
                        // On a page the field sends the tab's own guest
                        // somewhere, and the page's controls (reload, the way
                        // out, the menu) are drawn into the row's tail by the
                        // panel that has the page. A file shown as a page is
                        // one too.
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
                            isPageShown ? undefined : "invisible",
                          )}
                        >
                          {/* The guests are the pool's, drawn over a slot rather than in it, so hiding this box hides nothing of theirs: the panel parks its guest when told the screen is off, the way a task page does when its tab is in the background. */}
                          <ActiveTabProvider isActive={isPageShown}>
                            <BrowserTabs
                              chromeInto={chromeSlot}
                              compose={compose.hosts}
                              ref={setBrowser}
                              threadOfTask={childThreads}
                            />
                          </ActiveTabProvider>
                          {/* The page's guest is parked under a draft
                            window, so the pane says so where the page was. */}
                          {compose.covers && isPageOnScreen && (
                            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-background text-xs text-muted-foreground">
                              Hidden while you write
                            </div>
                          )}
                        </div>
                        {/* The thread's tasks as the pane's face, over the tab
                        up: the list, or the task pressed in it. */}
                        {isTasksViewUp && (
                          <div className="absolute inset-0 bg-background">
                            <ThreadTasksView
                              onOpen={(id) => {
                                showTasksFace(id, tasksFace.thread);
                              }}
                              sessionId={tasksFace.thread}
                              taskId={tasksFace.task}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </RightPane>
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
                {/* Asked for from the thread's own head, so the topic it
                makes is filed on the thread as it lands. */}
                <NewTopicDialog
                  onCreate={(topic) => {
                    const filedOn = threads.data?.find(
                      (thread) => thread.id === threadUp,
                    );
                    createTopic.mutate(
                      { ...topic, id: screens.taskId },
                      {
                        onSuccess: (created) => {
                          if (filedOn) {
                            setThreadTopics(filedOn.id, [
                              ...filedOn.topics,
                              created.id,
                            ]);
                          }
                        },
                      },
                    );
                  }}
                  onOpenChange={setNewTopicOpen}
                  open={isNewTopicOpen}
                  taken={topics.flatMap((topic) =>
                    topic.emoji ? [topic.emoji] : [],
                  )}
                />
              </main>
            </div>
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
}: {
  href: string;
  pathname: string;
  search: Record<string, unknown>;
}): Omit<OrchestratorRecent, "at"> | undefined {
  if (pathname !== "/orchestrator/computer") {
    return undefined;
  }
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

/**
 * Keeps the Recent list: every file and folder the window lands on goes to
 * the top, one entry per address. Pages keep their own list, by the browser.
 */
function useRecordRecents() {
  const location = useRouterState({
    select: (routerState) => routerState.location,
  });
  const setRecents = useSetAtom(orchestratorRecentsAtom);
  const { href, pathname } = location;
  const search = location.search as Record<string, unknown>;

  useEffect(() => {
    const entry = recentFor({ href, pathname, search });
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
  }, [href, pathname, setRecents]);
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
  /** A draft of a new thread, at the corner. */
  newThread: () => void;
  /** A screen by its route, in a tab of its own, since what asked is not in any tab. */
  openScreen: (href: string) => void;
  reopenTab: () => void;
  /** The caret into the window's field, wherever it was. */
  search: () => void;
  selectRelative: (direction: -1 | 1) => void;
  selectTab: (index: number) => void;
  /** The next or previous thread of the inbox, as listed. */
  selectThread: (direction: -1 | 1) => void;
  /** The inbox column put away or brought back. */
  toggleInbox: () => void;
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
            case "findInPage": {
              // The page on screen registers itself as the foreground
              // browser; with none up there is nothing to search.
              requestBrowserFind();
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
            case "newThread": {
              latest.current.newThread();
              break;
            }
            case "nextTab": {
              latest.current.selectRelative(1);
              break;
            }
            case "nextThread": {
              latest.current.selectThread(1);
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
            case "previousThread": {
              latest.current.selectThread(-1);
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
            case "toggleInbox": {
              latest.current.toggleInbox();
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
