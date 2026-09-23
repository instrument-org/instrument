import {
  type AppPlace,
  appPlaceAtom,
  chatGroupAtom,
  type Draft,
  draftGroupOf,
  draftOfGroup,
  draftsAtom,
  inboxOpenAtom,
  NEW_TAB_HREF,
  newTabHrefOf,
  newThreadOnArrivalAtom,
  orchestratorSidebarWidthAtom,
  pageSlotsAtom,
  paneOpenByGroupAtom,
  placeGroupOf,
  placeOfGroup,
  screenViewAtom,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  THREADS_HREF,
} from "@/client/atoms/orchestrator";
import { FileOpenContext } from "@/client/components/file-open-context";
import { AppRail } from "@/client/components/orchestrator/app-rail";
import { useAppsBySlug } from "@/client/components/orchestrator/apps-by-slug";
import {
  BrowserTabs,
  type BrowserTabsHandle,
  type ComposeHost,
} from "@/client/components/orchestrator/browser-tabs";
import { ComposeLayer } from "@/client/components/orchestrator/compose-layer";
import {
  OrchestratorContext,
  type OrchestratorWindow,
} from "@/client/components/orchestrator/context";
import { computerTabOf } from "@/client/components/orchestrator/file-tabs";
import { HomePlace } from "@/client/components/orchestrator/home-place";
import {
  folderOf,
  segmentsOf,
} from "@/client/components/orchestrator/host-path";
import { InboxToggle } from "@/client/components/orchestrator/inbox-toggle";
import { NewTopicDialog } from "@/client/components/orchestrator/new-topic-dialog";
import { PaneToggle } from "@/client/components/orchestrator/pane-toggle";
import { PoppedOut } from "@/client/components/orchestrator/popped-out";
import { RightPane } from "@/client/components/orchestrator/right-pane";
import { screenLocation } from "@/client/components/orchestrator/screen-presentation";
import { contextReaders } from "@/client/components/orchestrator/send-context";
import {
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
import { useCompose } from "@/client/components/orchestrator/use-compose";
import { useDrafts } from "@/client/components/orchestrator/use-drafts";
import { useHistorySteps } from "@/client/components/orchestrator/use-history-steps";
import { ideasQueryOptions } from "@/client/components/orchestrator/use-ideas";
import { useOpeners } from "@/client/components/orchestrator/use-openers";
import { useRecordRecents } from "@/client/components/orchestrator/use-record-recents";
import { useRouterSync } from "@/client/components/orchestrator/use-router-sync";
import { useSetThreadTopics } from "@/client/components/orchestrator/use-set-thread-topics";
import { useWindowCommands } from "@/client/components/orchestrator/use-window-commands";
import {
  WindowBar,
  WindowCorner,
} from "@/client/components/orchestrator/window-bar";
import { WindowFrame } from "@/client/components/orchestrator/window-frame";
import { WindowTabStrip } from "@/client/components/orchestrator/window-tab-strip";
import {
  usePopClosedTab,
  useWindowTabs,
} from "@/client/components/orchestrator/window-tabs";
import { PageOpenContext } from "@/client/components/page-open-context";
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
import { Spinner } from "@/client/components/ui/spinner";
import { ActiveTabProvider } from "@/client/hooks/use-active-tab";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { fileHref } from "@/shared/computer-href";
import { APP_NAME } from "@instrument-org/shared";
import {
  type SessionMessageDataPart,
  StoreId,
  type TaskId,
} from "@instrument-org/workspace/client";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  createFileRoute,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { useAtom, useAtomValue } from "jotai";
import ms from "ms";
import { type ReactNode, useEffect, useRef, useState } from "react";

/** How often the tasks' titles are re-read, for the strip. */
const REFRESH_MS = ms("2 seconds");

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
  // The place the rail has the window standing in. The chat is the inbox
  // beside a thread and its tabs; every other place is a row of tabs of its
  // own filling the area, drawn by the same pane with the inbox and the
  // conversation put away, so a place's pages are guests like a thread's.
  const [place, setPlace] = useAtom(appPlaceAtom);
  const isChat = place === "chat";
  // Home is a landing page over whatever group is up rather than a group of
  // its own: the main area is put away under it, and nothing on screen
  // changes when it is chosen or left.
  const isHome = place === "home";
  // The group the chat had up, kept while the window stands elsewhere so
  // coming back lands on the same thread.
  const [chatGroup, setChatGroup] = useAtom(chatGroupAtom);
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
  // thread, a draft or a place, never to the window on its own.
  const showsRightArea = windowTabs.group !== undefined;
  // The chat's group follows what the chat has up, and only while the window
  // stands in the chat: a place's group is the place's own.
  useEffect(() => {
    if (isChat && placeOfGroup(windowTabs.group) === undefined) {
      setChatGroup(windowTabs.group ?? null);
    }
  }, [isChat, windowTabs.group, setChatGroup]);
  /**
   * Brings the chat back at the group it had up: its thread, if the thread
   * is still among the window's, or the inbox alone.
   */
  const showChat = () => {
    const thread = StoreId.SessionSchema.safeParse(chatGroup);
    if (thread.success && (!threads.data || threadTitles.has(thread.data))) {
      windowTabs.showGroup(thread.data);
    } else {
      windowTabs.leaveGroup();
    }
  };
  /**
   * Stands the window in a place: the chat comes back where it was, and
   * any other place comes up on its own tabs.
   */
  const choosePlace = (next: AppPlace) => {
    if (next === place) {
      return;
    }
    setPlace(next);
    if (next === "chat") {
      showChat();
    } else if (next !== "home") {
      windowTabs.showPlace(next);
    }
  };
  /**
   * Opens a file from Home in Files, as its own tab beside the Finder with
   * the folder it sits in as its tree: the tab already at it if there is
   * one, else a new one, and the window lands there.
   */
  const openFileInFiles = (hostPath: string) => {
    const group = placeGroupOf("files");
    windowTabs.showPlace("files");
    const existing = windowTabs.allTabs.find(
      (tab) =>
        tab.group === group &&
        tab.kind === "screen" &&
        computerTabOf(tab.href)?.file === hostPath,
    );
    if (existing) {
      windowTabs.select(existing.id);
    } else {
      windowTabs.openScreen(fileHref(hostPath, { tree: folderOf(hostPath) }), {
        group,
        isOpened: true,
      });
    }
    setPlace("files");
  };
  /** Puts the window on the chat, for a thread coming on screen from wherever it stands. */
  const toChat = () => {
    setPlace("chat");
  };
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
    // Home was once a row of tabs; what an earlier launch kept under it has
    // nowhere to show.
    windowTabs.dropGroup("place:home");
    // Site favicons were once kept here, data: URIs and all, and nothing
    // reads them now; left in place they hold the origin's storage quota
    // that every orchestrator.* atom writes into.
    try {
      localStorage.removeItem("orchestrator.site-favicons.v2");
    } catch {
      // Storage refused: nothing was freed, and nothing else depends on it.
    }
    // The tabs come back as they were, and so does the place, and the two
    // have to agree: a place stands on its own group, with at least its own
    // new tab in it, and the chat never shows a place's. Home stands over
    // whatever group came back.
    if (isChat) {
      if (placeOfGroup(windowTabs.group) !== undefined) {
        showChat();
      }
    } else if (place !== "home") {
      windowTabs.showPlace(place);
    }
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
  // with a new tab in it. A place is nothing but its pane, which fills the
  // area and never closes.
  const isPaneWanted =
    windowTabs.group === undefined ||
    (paneOpenByGroup[windowTabs.group] ?? true);
  const showsPane =
    !isChat || ((tabs.length > 0 || isTasksViewUp) && isPaneWanted);
  // Whether the page in the pane is what is on screen: the tab a page, the
  // pane open, and no screen over it. Off, the guest is parked. A window in
  // the corner does not park it: the guest stands on the window's lowest
  // layer, so a draft, a small view, and every menu draw over the page, and
  // the page stays in view around them.
  const isPageShown =
    isPageOnScreen && showsRightArea && !isHome && showsPane && !isTasksViewUp;
  const setPaneOpen = (group: string, isOpen: boolean) => {
    setPaneOpenByGroup((current) => ({ ...current, [group]: isOpen }));
  };
  // The pages screens draw into slots of their own (a page's file beside a
  // file tab's tree), shown on the same terms as the pane's page: parked
  // under the tasks' face, like it.
  const pageSlots = useAtomValue(pageSlotsAtom);
  const slotHosts: ComposeHost[] = Object.entries(pageSlots).flatMap(
    ([group, into]) =>
      into
        ? [
            {
              chrome: false,
              group,
              into,
              isActive: showsRightArea && !isHome && !isTasksViewUp,
              place: `${group}:${rowWidth}`,
            },
          ]
        : [],
  );
  /** Brings the pane up for the group on screen, for something opened into it. */
  const revealPane = () => {
    if (windowTabs.group !== undefined) {
      setPaneOpen(windowTabs.group, true);
    }
  };
  const togglePane = () => {
    const group = windowTabs.group;
    if (group === undefined || !isChat) {
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
  /** Opens the new tab of whatever the pane holds: a place's own kind, or the page that reaches everything. */
  const openNewTab = () => {
    windowTabs.openScreen(newTabHrefOf(windowTabs.group));
  };

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
    toChat();
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

  // The threads in their small views, floating over the row.
  const floating = compose.entries.flatMap((entry) =>
    entry.kind === "thread" ? [entry.sessionId] : [],
  );
  /**
   * Takes a thread out of the corner: the window goes and the thread lands
   * in Chat, whole, its row in the list and its pane as it was.
   */
  const landThread = (sessionId: StoreId.Session) => {
    compose.remove(sessionId);
    windowTabs.showThread(sessionId);
    toChat();
  };
  /** The same, with one of the thread's tabs put in front of its pane. */
  const landOnTab = (sessionId: StoreId.Session, tabId: string) => {
    landThread(sessionId);
    windowTabs.selectIn(sessionId, tabId);
    setPaneOpen(sessionId, true);
    setTasksFace(undefined);
  };

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

  useRouterSync(windowTabs);

  // A file opened from the Finder has its tree and its crumbs in the tab
  // itself, and wears no row over it: the head is the file's, and the close
  // at its right is the way back to the Finder.
  const isTreeFileTab =
    active?.kind === "screen" && computerTabOf(active.href)?.tree !== undefined;
  const { openNamedPath, openPage, openScreen } = useOpeners({
    browser,
    ids,
    revealPane,
    setPaneOpen,
    showTasksFace,
    threads: threads.data,
    threadTitles,
    toApps: () => {
      setPlace("apps");
    },
    toChat,
    windowTabs,
  });

  const { canGoBack, canGoForward, goBack, goForward } = useHistorySteps({
    browser,
    setTasksFace,
    tasksFace: isTasksViewUp ? tasksFace : undefined,
    windowTabs,
  });

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

  // What goes with a message, read at the moment of sending.
  const { draftContext, sendContext } = contextReaders({
    appsBySlug,
    browser,
    children: children.data,
    drafts,
    href: location.href,
    screenView,
    state: state.data,
    tasksFace: isTasksViewUp ? tasksFace : undefined,
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
    showDraft,
    startingId,
    startThread,
  } = useDrafts({
    compose,
    draftContext,
    ids,
    place,
    saveDefaultModelURI,
    toChat,
    topics,
    windowTabs,
  });
  // New pressed in the rail while the window stood on a screen outside its own
  // opens its draft here, after the window has put back what it restored.
  const [isNewOnArrival, setNewOnArrival] = useAtom(newThreadOnArrivalAtom);
  useEffect(() => {
    if (isNewOnArrival) {
      setNewOnArrival(false);
      newDraft();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /**
   * Puts the group on screen away: the inbox takes the width, and comes
   * back if it was hidden, since nothing else would be left on screen.
   */
  const leaveGroup = () => {
    windowTabs.leaveGroup();
    setInboxOpen(true);
  };
  // The inbox's rows as the pane lists them, for stepping through them by
  // chord; the pane says what it shows, since it holds the filters.
  const listedThreads = useRef<StoreId.Session[]>([]);
  useWindowCommands(
    {
      back: goBack,
      closeTab: () => {
        if (active) {
          requestClose(active.id);
        }
      },
      forward: goForward,
      newTab: openNewTab,
      newThread: newDraft,
      // In Files whatever was on screen: a file from outside the app is the
      // person's own, never something a thread asked for.
      openFile: openFileInFiles,
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
        // The inbox is the chat's; elsewhere the chord has nothing to move.
        if (isChat) {
          setInboxOpen((isOpen) => !isOpen || !showsRightArea);
        }
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
    },
    { isReady: ids !== undefined },
  );
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

  if (ensure.error) {
    return (
      <WindowFrame>
        <p className="p-4 pt-12 text-sm text-destructive">
          Could not open the conversation: {ensure.error.message}
        </p>
      </WindowFrame>
    );
  }

  if (!screens || !state.data) {
    return (
      <WindowFrame>
        <div className="flex h-full flex-1 items-center justify-center">
          <Spinner className="size-6" />
        </div>
      </WindowFrame>
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
          <WindowFrame
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
                trailing={<WindowCorner />}
              />
            }
            overlay={
              <ComposeLayer
                browser={browser}
                childTitles={childTitles}
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
                onCloseThread={(sessionId) => {
                  compose.remove(sessionId);
                }}
                onExpandThread={landThread}
                onModelChange={setDefaultModelURI}
                onOpenApps={() => {
                  choosePlace("apps");
                }}
                onPressThreadTab={landOnTab}
                onStart={startThread}
                openOutside={(href) => {
                  openScreen(href, { newTab: true });
                }}
                sendContext={() => sendContextRef.current()}
                threads={threads.data ?? []}
                topics={topics}
              />
            }
            rail={
              <AppRail
                onChoose={choosePlace}
                onNew={() => {
                  newDraft();
                }}
                place={place}
              />
            }
            rowRef={setRowElement}
          >
            <div className="flex min-h-0 min-w-0 flex-1">
              {/* The inbox is the chat's: hidden rather than unmounted while
                the window stands in another place, so the list is as it was
                on the way back. `contents` so the column lays out in the row
                as if the wrapper were not there. */}
              <div className={isChat ? "contents" : "hidden"}>
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
                            arrivedId={arrivedId}
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
              </div>
              {/* Home stands over the main area: the tabs and their guests
              stay mounted under it, put away. */}
              {isHome && (
                <HomePlace
                  onOpenFile={openFileInFiles}
                  onOpenThread={(sessionId) => {
                    openScreen(`${THREADS_HREF}/${sessionId}`);
                  }}
                />
              )}
              {/* Hidden rather than unmounted while nothing is on screen, so
              every tab keeps what it has for when something opens again. */}
              <main
                className={cn(
                  "relative flex min-w-0 flex-1 flex-col",
                  showsRightArea && !isHome ? undefined : "hidden",
                )}
              >
                {/* The conversation, and the pane of the group's tabs beside
                it, the way a task's page keeps its pane: put away and
                brought back by the toggle over the conversation, sized by
                the edge between them, and the pane's state each group's
                own. In a place the pane is the whole area: a place is its
                tabs, with no conversation beside them. */}
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
                          popOut={
                            threadUp === undefined
                              ? undefined
                              : {
                                  isOut: floating.includes(threadUp),
                                  onToggle: () => {
                                    if (floating.includes(threadUp)) {
                                      compose.remove(threadUp);
                                    } else {
                                      compose.float(threadUp);
                                    }
                                  },
                                }
                          }
                          thread={threads.data?.find(
                            (thread) => thread.id === threadUp,
                          )}
                          topics={topics}
                          trailing={showsPane ? null : paneToggle}
                        />
                        <div className="relative min-h-0 flex-1">
                          <ThreadStage
                            floating={floating}
                            sendContext={() => sendContextRef.current()}
                            sessionId={threadUp}
                          />
                          {/* A thread in its small view has its conversation
                          there: the column keeps the head and says where
                          the words went. */}
                          {threadUp !== undefined &&
                            floating.includes(threadUp) && (
                              <div className="absolute inset-0 bg-background">
                                <PoppedOut
                                  onBringBack={() => {
                                    compose.remove(threadUp);
                                  }}
                                  thread={threads.data?.find(
                                    (thread) => thread.id === threadUp,
                                  )}
                                />
                              </div>
                            )}
                        </div>
                      </div>
                    </div>
                  }
                  fills={!isChat}
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
                          onNew={openNewTab}
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
                              {/* A place has no conversation to fold the
                              pane away for. */}
                              {isChat && paneToggle}
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
                      {!isTreeFileTab && (
                        <TabLocationRow
                          canGoBack={canGoBack}
                          canGoForward={canGoForward}
                          homeHref={newTabHrefOf(windowTabs.group)}
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
                      )}
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
                              compose={[...compose.hosts, ...slotHosts]}
                              ref={setBrowser}
                              threadOfTask={childThreads}
                            />
                          </ActiveTabProvider>
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
          </WindowFrame>
        </PageOpenContext>
      </FileOpenContext>
    </OrchestratorContext>
  );
}
