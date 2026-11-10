import { useSteadyCallbacks } from "@/client/hooks/use-steady-callbacks";
import { OUTSIDE_FILES_MAX } from "@instrument-org/shared";
import { showProjectInFiles } from "@/client/lib/show-in-files";
import {
  draftsAtom,
  removeDraftAtom,
  updateDraftAtom,
} from "@/client/drafts/store";
import {
  newChatBoxesAtom,
  pickNewChatProjectAtom,
} from "@/client/drafts/new-chat-box";
import { type Draft, draftGroupOf, holdsSomething } from "@/shared/drafts";
import {
  type AppPlace,
  chatFiltersAtom,
  chatGroupAtom,
  filesFolderAtom,
  inboxOpenAtom,
  paneOpenByGroupAtom,
  chatsOutOf,
} from "@/client/atoms/window";
import { settingsModalAtom } from "@/client/atoms/settings-modal";
import { AppErrorFallback } from "@/client/components/app-error-fallback";
import { FileOpenContext } from "@/client/components/file-open-context";
import { NavControls } from "@/client/components/nav-controls";
import { WithDeveloperStrip } from "@/client/components/developer-strip/developer-strip-slot";
import { settingsTabOf } from "@/client/components/settings/settings-index";
import { WindowZoomRoot } from "@/client/components/window/window-zoom-root";
import { PageOpenContext } from "@/client/components/page-open-context";
import { ThemeProvider } from "@/client/components/theme-provider";
import { Spinner } from "@/client/components/ui/spinner";
import { TooltipProvider } from "@/client/components/ui/tooltip";
import { SetupHost } from "@/client/components/setup/setup-host";
import { WindowBorder } from "@/client/components/window-border";
import { ChromeInsetProvider } from "@/client/hooks/use-chrome-inset";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import {
  ActiveTabProvider,
  TabIdProvider,
} from "@/client/hooks/use-active-tab";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { useGroupTabRouters } from "@/client/hooks/use-group-tab-routers";
import { PortalContainerProvider } from "@/client/hooks/use-portal-container";
import { useRefetchOnWindowSwitch } from "@/client/hooks/use-refetch-on-window-switch";
import { useRefreshSkillsOnChange } from "@/client/hooks/use-refresh-skills-on-change";
import { useRefreshProjectsOnChange } from "@/client/hooks/use-refresh-projects-on-change";
import { useTabRouters } from "@/client/hooks/use-tab-routers";
import { getGuest, pageHoldingKeyboard } from "@/client/lib/browser-pool";
import { keptInOtherWindows } from "@/client/lib/kept-state";
import { resolveComputerFileBase } from "@/client/lib/computer-file-url";
import { ICON_CONTEXT_VALUE } from "@/client/lib/icon-context";
import {
  focusScreenHome,
  installKeyboardHome,
} from "@/client/lib/keyboard-home";
import { storageLocationQueryOptions } from "@/client/lib/output-folder";
import { sharedQueryClient, type TabRouter } from "@/client/lib/tab-router";
import { getRouterHistory } from "@/client/lib/tab-router-history";
import { getTabRouter } from "@/client/lib/tab-router-registry";
import { restoreTabView } from "@/client/lib/tab-view-state";
import { setTabPathname } from "@/client/lib/tabs-model";
import { spokenMessage, toast } from "@/client/lib/toast";
import { captureComponentError } from "@/client/lib/capture-exception";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { fileHref, folderHref } from "@/shared/computer-href";
import { type Tab, type TabId } from "@/shared/tabs";

import { useRestoredTabsWaiting } from "./use-restored-tabs-waiting";
import { type ChatId, browserTargetOf } from "@instrument-org/workspace/client";
import { IconContext } from "@phosphor-icons/react/dist/lib/context";
import {
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  CatchBoundary,
  RouterContextProvider,
  RouterProvider,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import {
  type ComponentProps,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { AppRail } from "./app-rail";
import { appsSeenAtAtom, appsSignedOutSince } from "./apps-rail-mark";
import { AppTabStrip } from "./app-tab-strip";
import {
  appTabsAtom,
  groupOfHref,
  INBOX_HREF,
  isChatHref,
  isSiteGroup,
  newSiteGroup,
  pageHrefOf,
  placeOfHref,
  putAwaySitesAtom,
  siteGroupsInOtherWindows,
  siteGroupsOf,
  useAppTabs,
} from "./app-tabs";
import { COMPOSE_KEY } from "@/shared/kept-state";
import { useAppsBySlug } from "./apps-by-slug";
import { BrowserTabs, type BrowserTabsHandle } from "./browser-tabs";
import { chatListOptions, chromeOfChats } from "./chat-list-query";
import { ChatPane } from "./chat-pane";
import { inPlace, NO_FILTERS, strongestMark } from "./chats";
import { ComposeLayer } from "./compose-layer";
import { useComputerVolumes } from "./computer-volumes";
import { type WindowContextValue as Screens, WindowContext } from "./context";
import { isPaneOpen, shownPaneTab } from "./draft-context";
import { useSignInLanding } from "./use-sign-in-landing";
import { InboxPeek } from "./inbox-peek";
import { inboxLandsAtOnceAtom } from "./inbox-room";
import { WindowLook } from "./look-panel";
import { ProjectDialog } from "./project-dialog";
import { screenActionOf, useRecordScreen } from "./screen-action";
import { contextReaders } from "./send-context";
import { type WindowShell as Shell, ShellContext } from "./shell-context";
import { useStagedAskActions } from "./staged-asks";
import { tabSurfaceAtom } from "./tab-surface";
import { useTaskTitles } from "./task-titles";
import { useCompose } from "./use-compose";
import { useDrafts } from "./use-drafts";
import { useInboxPeek } from "./use-inbox-peek";
import { useOpeners } from "./use-openers";
import { CommandMenu } from "./command-menu";
import { usePageThumbnailHousekeeping } from "./use-page-thumbnail-housekeeping";
import { useWindowSteps } from "./use-tab-steps";
import { useSetChatProject } from "./use-set-chat-project";
import { backfillCandidates } from "./use-project-backfill";
import { useWindowCommands } from "./use-window-commands";
import { useShowActivity } from "./activity-button";
import { WindowBar, WindowCorner } from "./window-bar";
import { useWindowDropFallback } from "./use-window-drop-fallback";
import { WindowFrame } from "./window-frame";
import {
  chatHref,
  chatOfGroup,
  chatOfHref,
  matchScreen,
  newChatHref,
  sameHref,
} from "./window-href";
import {
  groupOnScreenAtom,
  useWindowTabs,
  windowTabsAtom,
} from "./window-tabs";
import {
  forgetMovedAway,
  hasMovedAway,
  moveTabOut,
  receiveTab,
} from "./move-tab";
import { sitesLeaving, sitesNoLongerHere, sitesPutAway } from "./site-let-go";

// Resolve the computer file channel once at boot so file URLs derive locally
// from a host path; not awaited, so it never holds up the first render.
void resolveComputerFileBase();

/** The drafts floating in what another window kept of its floating windows. */
function floatingDraftIdsOf(kept: unknown): string[] {
  return (Array.isArray(kept) ? (kept as unknown[]) : []).flatMap((entry) =>
    typeof entry === "object" &&
    entry !== null &&
    "draftId" in entry &&
    typeof entry.draftId === "string"
      ? [entry.draftId]
      : [],
  );
}

/** The groups the window's places once kept their tabs under, which nothing shows now. */
const RETIRED_GROUPS = [
  "place:apps",
  "place:discover",
  "place:files",
  "place:home",
];

/**
 * The app window: its tabs across the bar, each a router of its own kept
 * mounted and live behind the one on screen, and around them what the window
 * keeps once whatever tab is up: the rail, the drafts and popped-out chats
 * along the foot, the window's browser, and its chords.
 *
 * A first launch has no workspace until setup's first step places one, so
 * the window draws setup alone, and loads again once the workspace runs.
 */
export function AppWindow() {
  return window.api.initialSetupState?.facts.hasWorkspace === false ? (
    <SetupWindow />
  ) : (
    <WorkspaceWindow />
  );
}

/** The window's shell above the developer band, which opens a debug page in the tab up. */
function WindowContent(props: ComponentProps<typeof WindowShell>) {
  const navigate = useNavigate();
  return (
    <WithDeveloperStrip
      onOpenDebugPages={() => {
        void navigate({ to: "/debug" });
      }}
    >
      <WindowShell {...props} />
    </WithDeveloperStrip>
  );
}

/** The window before the workspace has a folder: setup over the window's own ground. */
function SetupWindow() {
  return (
    <QueryClientProvider client={sharedQueryClient}>
      <ThemeProvider>
        {/* oxlint-disable-next-line studio/one-tooltip-provider */}
        <TooltipProvider>
          <IconContext.Provider value={ICON_CONTEXT_VALUE}>
            <WindowZoomRoot>
              <WithDeveloperStrip>
                <ChromeInsetProvider top={TOOLBAR_HEIGHT}>
                  <div className="relative h-full bg-ground">
                    <SetupHost />
                  </div>
                </ChromeInsetProvider>
              </WithDeveloperStrip>
            </WindowZoomRoot>
          </IconContext.Provider>
          <WindowBorder />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function WorkspaceWindow() {
  const model = useAtomValue(appTabsAtom);
  const routers = useTabRouters(model.tabs);
  const activeRouter = getTabRouter(model.selectedId);
  return (
    <QueryClientProvider client={sharedQueryClient}>
      <ThemeProvider>
        {/* The window's one TooltipProvider for its own chrome; each tab's
          root route keeps its own for what the tab draws. */}
        {/* oxlint-disable-next-line studio/one-tooltip-provider */}
        <TooltipProvider>
          <CatchBoundary
            errorComponent={AppErrorFallback}
            getResetKey={() => "window"}
            onCatch={captureComponentError}
          >
            <IconContext.Provider value={ICON_CONTEXT_VALUE}>
              <WindowZoomRoot>
                {activeRouter ? (
                  <RouterContextProvider router={activeRouter}>
                    <WindowContent routers={routers} tabs={model.tabs} />
                  </RouterContextProvider>
                ) : null}
              </WindowZoomRoot>
            </IconContext.Provider>
          </CatchBoundary>
          {/* Past the boundary, so a window showing its crash card keeps
            its edge too. */}
          <WindowBorder />
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
  // Where the keyboard was in this tab, which it goes back to as the tab
  // comes up, or the screen's home where it was nowhere yet, unless it is
  // somewhere on screen by then (the tab strip's own arrows, a field a
  // command opened).
  const lastFocused = useRef<HTMLElement | null>(null);
  const arrivesWithFocus = Boolean(tab.arrivingView?.focus);
  useEffect(() => {
    if (!isActive) {
      return;
    }
    const restore = () => {
      const focused = document.activeElement;
      const kept = lastFocused.current;
      const isOnScreen =
        focused instanceof HTMLElement &&
        focused !== document.body &&
        (focused.tagName === "WEBVIEW"
          ? pageHoldingKeyboard() !== null
          : focused.checkVisibility({
              opacityProperty: true,
              visibilityProperty: true,
            }));
      if (isOnScreen || arrivesWithFocus) {
        return;
      }
      if (kept?.isConnected) {
        kept.focus({ preventScroll: true });
      } else {
        focusScreenHome({ leaving: false });
      }
    };
    // A page is drawn outside every tab, and the one the tab going away
    // showed holds the keyboard until its slot lets it go and the pool hands
    // the keyboard back, which is after this commit: the keyboard is read
    // once that has settled.
    if (document.activeElement?.tagName !== "WEBVIEW") {
      restore();
      return;
    }
    const frame = requestAnimationFrame(restore);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [arrivesWithFocus, isActive]);
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
  // Arriving from another window: its keyboard and scrolling go back as what
  // they stood on comes in, and only then is the tab drawn as it was.
  const arrivingView = tab.arrivingView;
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!arrivingView || !root) {
      return;
    }
    return restoreTabView(root, arrivingView, () => {
      setModel((model) => ({
        ...model,
        tabs: model.tabs.map((each) => {
          if (each.id !== tab.id) {
            return each;
          }
          const { arrivingView: _done, ...rest } = each;
          return rest;
        }),
      }));
    });
  }, [arrivingView, setModel, tab.id]);
  return (
    <div
      ref={rootRef}
      data-app-tab-view={tab.id}
      className={cn(
        "absolute inset-0 flex",
        // Transparent as well as invisible, so a layer the compositor
        // promoted in a tab behind cannot stay painted over the one up.
        isActive ? "visible" : "invisible opacity-0",
      )}
      {...(isActive ? { "data-app-tab-active": "" } : {})}
      onFocus={(event) => {
        if (event.target instanceof HTMLElement) {
          lastFocused.current = event.target;
        }
      }}
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

/**
 * The chats' titles and rail marks, read from the chat list. A hook of its
 * own so the maps stay the same while the list does, which every tab's title
 * in the strip is drawn from. `isRead` is false until the list has been read.
 */
function useChatChrome() {
  const chrome = useQuery({
    ...chatListOptions(),
    select: chromeOfChats,
  }).data;
  return {
    chatMarks: new Map(chrome?.marks),
    chatTitles: new Map<ChatId, string>(chrome?.titles),
    isRead: chrome !== undefined,
    marks: chrome?.marks ?? [],
  };
}

/** The folder a Files address stands in, which Files in the rail goes back to; none for any other screen or a file's. */
function filesFolderOf(href: string) {
  const screen = matchScreen(href);
  return screen.kind === "computer" && screen.file === undefined
    ? folderHref(screen.root, { path: screen.path })
    : undefined;
}

function WindowShell({
  routers,
  tabs,
}: {
  routers: ReadonlyMap<string, TabRouter>;
  tabs: Tab[];
}) {
  const appTabs = useAppTabs();
  const showActivity = useShowActivity();
  const waitingTabs = useRestoredTabsWaiting(tabs, appTabs.model.selectedId);
  useRefreshSkillsOnChange();
  useRefreshProjectsOnChange();
  useRefetchOnWindowSwitch();
  useEffect(() => installKeyboardHome(), []);
  // Where the tab up stands, read off its own router, which the context above
  // is: the rail lights its place and the group on screen follows it. Each
  // part is read on its own, so a step that changes none of them (a file
  // selected in a folder) does not draw the window again; what needs the
  // whole address reads it from the router when it is asked.
  const upRouter = useRouter();
  const place = useRouterState({
    select: (routerState) => placeOfHref(routerState.location.href),
  });
  const isChat = useRouterState({
    select: (routerState) => isChatHref(routerState.location.href),
  });
  const chatUp = useRouterState({
    select: (routerState) => chatOfHref(routerState.location.href),
  });
  const filesFolder = useRouterState({
    select: (routerState) => filesFolderOf(routerState.location.href),
  });
  // The address the screen record names a screen by. A folder or a file is
  // recorded from what its tab shows, and a selection there writes the address.
  const screenHref = useRouterState({
    select: (routerState) =>
      matchScreen(routerState.location.href).kind === "computer"
        ? undefined
        : routerState.location.href,
  });
  const hrefNow = () => upRouter.state.location.href;
  const ensure = useQuery(
    rpcClient.workspace.window.ensure.queryOptions({
      // What the window opens on is made once, and the folders it reaches
      // stay put for as long as it is open.
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
  const opened = ensure.data;
  const childTitles = useTaskTitles();
  // Undefined until the list has been read.
  const chatChrome = useChatChrome();
  const { chatMarks, chatTitles } = chatChrome;
  // Steady, so the strip is drawn again only when its tabs are.
  const stripActions = useSteadyCallbacks({
    onClose: (id: TabId) => {
      appTabs.close(id);
    },
    onCloseOthers: (id: TabId) => {
      appTabs.closeOthers(id);
    },
    onCloseToRight: (id: TabId) => {
      appTabs.closeToRight(id);
    },
    onDuplicate: (id: TabId) => {
      duplicateAppTab(id);
    },
    onNew: () => {
      appTabs.openNewTab();
    },
    onReopenLast: () => {
      appTabs.reopen();
    },
    onReorder: (ids: TabId[]) => {
      appTabs.reorder(ids);
    },
    onSelect: (id: TabId) => {
      appTabs.select(id);
    },
  });
  const [defaultModelURI, setDefaultModelURI, saveDefaultModelURI] =
    useDefaultModelURI();
  const drafts = useAtomValue(draftsAtom);
  const updateDraft = useSetAtom(updateDraftAtom);
  const removeDraft = useSetAtom(removeDraftAtom);
  const setChatGroup = useSetAtom(chatGroupAtom);
  const setFilesFolder = useSetAtom(filesFolderAtom);
  const [chatFilters, setChatFilters] = useAtom(chatFiltersAtom);
  const [isInboxOpen, setInboxOpen] = useAtom(inboxOpenAtom);
  const pickNewChatProject = useSetAtom(pickNewChatProjectAtom);
  const setInboxLandsAtOnce = useSetAtom(inboxLandsAtOnceAtom);
  const sendContextRef = useRef<Shell["sendContext"]>(() =>
    Promise.resolve(undefined),
  );
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
  // What the window's arrows and chords walk: the tab up's history, through
  // a site's page first.
  const windowSteps = useWindowSteps();
  // Every screen a group's tab stands on is walked by a router of its own.
  useGroupTabRouters(windowTabs.allTabs, windowTabs.screenMoved);

  // Apps in the rail wears a dot for an app signed out since Apps was last
  // shown; showing Apps is what counts as seeing it.
  const appList = useQuery(rpcClient.apps.live.list.experimental_liveOptions());
  const [appsSeenAt, setAppsSeenAt] = useAtom(appsSeenAtAtom);
  useEffect(() => {
    if (place === "apps") {
      setAppsSeenAt(Date.now());
    }
  }, [place, setAppsSeenAt]);
  const appsMark = appsSignedOutSince(appList.data?.apps ?? [], appsSeenAt);

  // The chat a tab last had open is where Chat in the rail takes a tab.
  useEffect(() => {
    if (!isChat) {
      return;
    }
    setChatGroup(chatUp ?? null);
  }, [chatUp, isChat, setChatGroup]);

  // The folder a tab last stood in is where Files in the rail takes a tab.
  // A file's address names where it was opened from rather than the folder
  // on screen, so one with a file open leaves the folder as it was.
  useEffect(() => {
    if (filesFolder !== undefined) {
      setFilesFolder(filesFolder);
    }
  }, [filesFolder, setFilesFolder]);

  const compose = useCompose(rowWidth);
  // The chats floating on screen, which show where they stand themselves, so
  // the rail's Chat dot leaves them out.
  const floatingChats = chatsOutOf(compose.placed);
  // A draft is written over the screen, never on it, and a draft with no
  // words is not kept past its window, so one left over from a launch goes,
  // unless its window came back with it. A window whose draft is gone goes.
  // Once, over what was restored.
  const sweepRestored = useEffectEvent(() => {
    // Another window's are as much its own as this one's are this one's.
    const floating = new Set([
      ...compose.entries.flatMap((entry) =>
        entry.kind === "draft" ? [entry.draftId] : [],
      ),
      ...keptInOtherWindows(COMPOSE_KEY).flatMap(floatingDraftIdsOf),
    ]);
    // A reply waiting in a chat's box is kept by the chat, not by a window
    // of its own, so nothing here takes one away.
    const isKept = (draft: Draft) =>
      draft.chatId !== undefined ||
      holdsSomething(draft) ||
      floating.has(draft.id);
    // A draft's folder goes with it, and what was pasted into it. Once a launch,
    // since a window opening later finds another's new chat box as empty as these.
    void rpcClient.window.takeLaunchSweep.call().then((isFirstUp) => {
      if (isFirstUp) {
        for (const draft of drafts) {
          if (!isKept(draft)) {
            windowTabs.dropGroup(draftGroupOf(draft.id));
            void removeDraft(draft.id);
          }
        }
      }
    });
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
  });
  useEffect(() => {
    sweepRestored();
  }, []);

  // A site opened at the window's level lives for as long as an open tab
  // can come back to it, by its history as its router holds it now. Past
  // that its page goes, guest and all, so a closed tab's video stops; its
  // record is put aside for as long as Shift+Cmd+T can reopen the tab, which
  // brings the page back at its address.
  const setPutAway = useSetAtom(putAwaySitesAtom);
  const sitesHeldHere = useRef(new Set<string>());
  const siteGroups = [
    ...new Set(
      windowTabs.allTabs.flatMap((tab) =>
        tab.group !== undefined && isSiteGroup(tab.group) ? [tab.group] : [],
      ),
    ),
  ].join("\n");
  const settleSites = useEffectEvent(() => {
    const open = new Set(
      appTabs.model.tabs.flatMap((tab) => {
        const router = routers.get(tab.id);
        return siteGroupsOf([
          ...(router
            ? getRouterHistory(router).entries
            : (tab.history?.entries ?? [])),
          tab.pathname,
        ]);
      }),
    );
    const reopenable = new Set(
      appTabs.model.recentlyClosed.flatMap((tab) =>
        siteGroupsOf([...(tab.history?.entries ?? []), tab.pathname]),
      ),
    );
    for (const group of open) {
      sitesHeldHere.current.add(group);
      forgetMovedAway(group);
    }
    const noLongerHere = sitesNoLongerHere(
      siteGroups.split("\n").filter(Boolean),
      open,
      sitesHeldHere.current,
    );
    const leaving =
      noLongerHere.length === 0
        ? []
        : sitesLeaving(noLongerHere, siteGroupsInOtherWindows(), hasMovedAway);
    setPutAway((current) =>
      sitesPutAway(current, {
        noLongerHere,
        open,
        recordOf: (group) =>
          windowTabs.allTabs.filter((tab) => tab.group === group),
        reopenable,
      }),
    );
    for (const group of leaving) {
      windowTabs.dropGroup(group);
    }
  });
  useEffect(() => {
    settleSites();
  }, [siteGroups, appTabs.model]);

  const setPaneOpen = (group: string, isOpen: boolean) => {
    setPaneOpenByGroup((current) => ({ ...current, [group]: isOpen }));
  };
  /** Brings the pane up for the group on screen, for something opened into it. */
  const revealPane = () => {
    if (windowTabs.groupOnScreen !== undefined) {
      setPaneOpen(windowTabs.groupOnScreen, true);
    }
  };
  // Where the tab up wants the window's page drawn. The browser's own face
  // lives in one element for the window's whole life, handed from tab to tab,
  // so a page and its edit session never remount as tabs are switched.
  const surfaces = useAtomValue(tabSurfaceAtom);
  const pageSlot = surfaces[appTabs.model.selectedId ?? ""]?.slot ?? null;
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
   * Takes a chat out of the corner: the window goes and the chat comes up in
   * a tab of the window's own, the one that already has it or a new one, its
   * pane opened when the window asked for something to be shown.
   */
  const expandChat = (
    chatId: ChatId,
    { showsPane }: { showsPane: boolean },
  ) => {
    compose.remove(chatId);
    appTabs.openOrFocusChat(chatId);
    if (showsPane) {
      setPaneOpen(chatId, true);
    }
  };

  const { openNamedPath, openPage, openScreen } = useOpeners({
    appTabs,
    browser,
    chatTitles,
    isOpen: opened !== undefined,
    paneOpenByGroup,
    revealPane,
    setPaneOpen,
    windowTabs,
  });

  const appsBySlug = useAppsBySlug();
  // What a new tab shows, asked for as the window comes up rather than as the
  // tab mounts, so the page lays out from the cache instead of growing a
  // section at a time as each answer lands. The new tab's own code is split
  // from the window's, so it is fetched now too, or the first Cmd+T waits on
  // it. The free trial's offer is the Add a provider sheet's one remote
  // answer, so it is in the cache before the sheet opens.
  const queryClient = useQueryClient();
  const { activeRouter } = appTabs;
  useEffect(() => {
    if (!opened) {
      return;
    }
    void queryClient.prefetchQuery(
      rpcClient.workspace.computer.places.queryOptions(),
    );
    void queryClient.prefetchQuery(storageLocationQueryOptions());
    void queryClient.prefetchQuery(rpcClient.billing.offer.queryOptions());
    void activeRouter?.loadRouteChunk(activeRouter.routesById["/_app/new-tab"]);
  }, [activeRouter, opened, queryClient]);

  const requestClose = (id: string) => {
    // Any group's: a popped-out chat's rail closes its tabs here too.
    windowTabs.close(id);
  };

  usePageThumbnailHousekeeping();
  useSignInLanding(openScreen);

  const projectsQuery = useQuery(
    rpcClient.workspace.projects.list.queryOptions(),
  );
  const projects = projectsQuery.data ?? [];
  const createProject = useMutation(
    rpcClient.workspace.projects.create.mutationOptions({
      onError: (error) => {
        // A name a project can't take comes back in words written for people.
        toast.error("Couldn't make the project", {
          cause: error,
          description: spokenMessage(error, ["BAD_REQUEST"]),
        });
      },
      onSuccess: () => void projectsQuery.refetch(),
    }),
  );
  const setChatProject = useSetChatProject();
  // The new-project dialog, asked for from a chat's head or a draft's, with
  // what was typed in the picker: the project it makes files that chat or
  // that draft.
  const [newProject, setNewProject] = useState<{
    /** The chat it files, when that is not the one the tab up has open: a popped-out chat's. */
    chatId?: ChatId;
    draftId?: string;
    name?: string;
  }>();
  // The chat a new project is asked for from: filed under it as it lands,
  // and left out of the other chats its dialog offers to file.
  const projectFor = newProject?.chatId ?? chatUp;
  const { data: candidates = [] } = useQuery({
    ...chatListOptions(),
    select: (chats) =>
      backfillCandidates(chats.filter((chat) => chat.id !== projectFor)),
    // Followed only while the dialog is up.
    subscribed: newProject !== undefined,
  });
  // The inbox is on screen in Chat unless it was put away beside a chat;
  // anywhere else, Chat in the rail peeks it out.
  const inboxPeek = useInboxPeek({
    canPeek: !isChat || (chatUp !== undefined && !isInboxOpen),
  });

  // What the tab in view says it shows: a chat's or a site's tab up while
  // its pane is open, or the screen the window's tab is at.
  const groupUp = windowTabs.active;
  const groupInView = windowTabs.groupOnScreen;
  const surfaceInView =
    groupInView === undefined
      ? surfaces[appTabs.model.selectedId ?? ""]
      : groupUp?.kind === "screen" &&
          (chatOfGroup(groupInView) === undefined ||
            isPaneOpen(groupInView, paneOpenByGroup))
        ? surfaces[groupUp.id]
        : undefined;
  const screenView = surfaceInView?.view ?? null;
  // The screen in front, for the action log once it settles.
  const settings = useAtomValue(settingsModalAtom);
  useRecordScreen(
    screenActionOf({
      appName: (slug) => appsBySlug.get(slug)?.name,
      chatTitle: (chat) => chatTitles.get(chat),
      ...(surfaceInView?.walked
        ? { folderPath: surfaceInView.walked.hostPath }
        : {}),
      ...(screenHref === undefined ? {} : { href: screenHref }),
      ...(settings === null ? {} : { settingsTab: settingsTabOf(settings) }),
      view: screenView,
    }),
  );
  // What goes with a message, read at the moment of sending.
  const volumes = useComputerVolumes();
  const readersNow = () =>
    contextReaders({
      appsBySlug,
      appTabId: appTabs.model.selectedId,
      browser,
      chatTitles,
      drafts,
      href: hrefNow(),
      paneOpenByGroup,
      screenView,
      state: opened,
      surfaces,
      ...(volumes ? { volumes } : {}),
      windowTabs,
    });
  const draftContext = (draftId: string) => readersNow().draftContext(draftId);
  useLayoutEffect(() => {
    sendContextRef.current = (options) => readersNow().sendContext(options);
  });
  const {
    arrivedId,
    closeDraft,
    discardDraft,
    discardingIds,
    draftFromLink,
    draftWith,
    expandDraft,
    newDraft,
    popOutDraft,
    sentProjects,
    sentWords,
    showDraft,
    startChat,
    startingIds,
  } = useDrafts({
    folders: opened?.folders ?? {},
    compose,
    draftContext,
    isOpen: opened !== undefined,
    isChat,
    openChat: (chatId) => {
      appTabs.navigate(chatHref(chatId));
    },
    openDraftInChat: (id) => {
      setInboxOpen(true);
      appTabs.navigate(newChatHref(id));
    },
    openNewChat: (projectId) => {
      const tabId = appTabs.model.selectedId;
      if (tabId) {
        pickNewChatProject({ projectId, tabId });
      }
      setInboxOpen(true);
      appTabs.navigate(newChatHref());
    },
    openDrafts: () => {
      setInboxOpen(true);
      if (place !== "chat") {
        appTabs.goToPlace("chat");
      }
    },
    saveDefaultModelURI,
    projects,
    windowTabs,
  });
  // The chat or draft each tab had up beside the list when it stepped into
  // a project, by the tab, which stepping back out brings back.
  const beforeProject = useRef(new Map<string, string>());
  // The chat up as the list stepped into a project, which the tab is on its
  // way away from: never a chat that takes the list back out.
  const [leavingChat, setLeavingChat] = useState<ChatId>();
  if (leavingChat !== undefined && chatUp !== leavingChat) {
    setLeavingChat(undefined);
  }
  /**
   * The list standing in a project, from its row, the command menu, or a
   * project just made, from wherever the tab is: the inbox comes up, and
   * whatever chat or draft was up beside it is put away for a new chat
   * filed under the project, and remembered for the way back out. A search
   * or a place left over from before would hide the chats it was asked for,
   * so both go.
   */
  const enterProject = (projectId: string) => {
    const tabId = appTabs.model.selectedId;
    if (tabId && isChat && chatFilters.projects.length === 0) {
      if (sameHref(hrefNow(), newChatHref())) {
        beforeProject.current.delete(tabId);
      } else {
        beforeProject.current.set(tabId, hrefNow());
      }
    }
    setLeavingChat(chatUp);
    setChatFilters({ ...NO_FILTERS, projects: [projectId] });
    if (inboxPeek.isOpen) {
      setInboxLandsAtOnce(true);
    }
    setInboxOpen(true);
    if (tabId) {
      pickNewChatProject({ projectId, tabId });
    }
    appTabs.navigate(newChatHref());
  };
  /**
   * The list back in the inbox from its project. The new chat the project
   * put up, still unwritten, gives way to the chat or draft this tab had up
   * before it; anything opened in the project since stays.
   */
  const leaveProject = () => {
    const tabId = appTabs.model.selectedId;
    const back = tabId ? beforeProject.current.get(tabId) : undefined;
    if (tabId) {
      beforeProject.current.delete(tabId);
    }
    setChatFilters((current) => inPlace(current, undefined));
    if (back !== undefined && sameHref(hrefNow(), newChatHref())) {
      appTabs.navigate(back);
    }
  };
  // A chat filed elsewhere coming up beside a project's list, from the
  // command menu, a link or a notice, takes the list out of the project, so
  // the open chat always has its row. A chat being started is not filed
  // yet, and the chat the list just stepped away from is on its way out.
  const standingProject =
    chatFilters.projects.length === 1 ? chatFilters.projects[0] : undefined;
  const { data: chatUpProject } = useQuery({
    ...chatListOptions(),
    select: (chats) => chats.find((chat) => chat.id === chatUp)?.project,
  });
  const isChatOutsideProject =
    standingProject !== undefined &&
    chatUp !== undefined &&
    chatUp !== leavingChat &&
    !sentWords.has(chatUp) &&
    chatUp !== arrivedId &&
    chatTitles.has(chatUp) &&
    chatUpProject !== standingProject;
  useEffect(() => {
    if (isChatOutsideProject) {
      beforeProject.current.clear();
      setChatFilters((current) => inPlace(current, undefined));
    }
  }, [isChatOutsideProject, setChatFilters]);
  // However the list leaves a project (its Inbox, a chat from elsewhere,
  // the project deleted), a new chat in any tab that the project filed and
  // that has nothing written yet stops being filed under it.
  const store = useStore();
  const lastStanding = useRef(standingProject);
  useEffect(() => {
    const left = lastStanding.current;
    lastStanding.current = standingProject;
    if (left === undefined || left === standingProject) {
      return;
    }
    const boxes = store.get(newChatBoxesAtom);
    for (const [tabId, box] of Object.entries(boxes)) {
      if (box?.projectId === left && box.draftId === null) {
        pickNewChatProject({ projectId: undefined, tabId });
      }
    }
  }, [pickNewChatProject, standingProject, store]);
  /**
   * The tab up to one of the rail's places, from the rail, its chords, or the
   * command menu. Chat asked for is the inbox asked for too, even where the
   * row is narrow enough that it stepped aside. Peeked out already, the list
   * stays where it is drawn rather than sliding in again under it. The
   * place the tab is already in takes it back to its root (the inbox, the
   * home folder, the browser's start, the apps), except that a chat
   * with its inbox put away gets the inbox back first and stays open. A
   * place asked for in a tab of its own waits behind, the way a bookmark
   * middle-clicked in a browser does.
   */
  const choosePlace = (
    next: AppPlace,
    { newTab = false, newWindow = false } = {},
  ) => {
    if (newWindow) {
      appTabs.goToPlace(next, { newWindow });
      return;
    }
    const bringsInboxBack =
      next === "chat" && chatUp !== undefined && !isInboxOpen;
    if (next === "chat") {
      if (inboxPeek.isOpen) {
        setInboxLandsAtOnce(true);
      }
      setInboxOpen(true);
    }
    if (next === place && !newTab) {
      if (!bringsInboxBack) {
        appTabs.goToPlace(next, { root: true });
      }
      return;
    }
    appTabs.goToPlace(next, { behind: newTab, newTab });
  };
  // The inbox's rows as the tab up lists them, for stepping through them by
  // chord.
  const listedChats = useRef<ChatId[]>([]);
  // A file let go of where nothing else takes it opens the way one dropped
  // on the Dock icon does.
  useWindowDropFallback(({ hostPath, isFolder }) => {
    appTabs.open(isFolder ? folderHref(hostPath) : fileHref(hostPath));
  });
  useWindowCommands(
    {
      back: () => {
        windowSteps.go("back");
      },
      // The tab a chat's pane shows, wherever the keyboard is, and the
      // window's own tab only once no pane tab is in view: one close a
      // press, read from the tabs as they are at that moment.
      closeTab: () => {
        const paneTab = shownPaneTab(
          store.get(windowTabsAtom),
          store.get(groupOnScreenAtom),
          store.get(paneOpenByGroupAtom),
        );
        if (paneTab) {
          requestClose(paneTab.id);
        } else if (appTabs.model.selectedId) {
          appTabs.close(appTabs.model.selectedId);
        }
      },
      forward: () => {
        windowSteps.go("forward");
      },
      goToPlace: choosePlace,
      newChat: newDraft,
      newChatFromLink: draftFromLink,
      newTab: appTabs.openNewTab,
      // What arrives from outside the app comes up in the tab already showing
      // it, however far that tab has walked within it, and in a tab of its
      // own where none does. Main has already picked this window as the one
      // showing it, or the one in front where none does.
      missingFile: (name, folder) => {
        toast(
          `${name} is no longer there`,
          folder === undefined
            ? { description: "The folder it was in is gone too." }
            : undefined,
        );
        if (folder !== undefined) {
          const href = folderHref(folder);
          if (!appTabs.selectShowing(href)) {
            openScreen(href, { newTab: true });
          }
        }
      },
      notOpened: (count) => {
        toast(
          count === 1
            ? "1 more file didn't open"
            : `${count} more files didn't open`,
          {
            description: `One link opens up to ${OUTSIDE_FILES_MAX} files at a time.`,
          },
        );
      },
      openFile: (hostPath) => {
        const href = fileHref(hostPath);
        if (!appTabs.selectShowing(href)) {
          appTabs.open(href);
        }
      },
      openScreen: (href) => {
        if (!appTabs.selectShowing(href)) {
          openScreen(href, { newTab: true });
        }
      },
      showTab: appTabs.selectShowing,
      moveTabToNewWindow: () => {
        if (appTabs.model.selectedId) {
          void moveTabOut(appTabs.model.selectedId, { kind: "new" });
        }
      },
      receiveTab,
      reopenTab: appTabs.reopen,
      search: focusField,
      showActivity: () => {
        showActivity();
      },
      selectRelative: appTabs.selectRelative,
      selectTab: appTabs.selectIndex,
      toggleInbox: () => {
        // The inbox is the chat's; elsewhere the chord has nothing to move.
        if (isChat) {
          setInboxOpen((isOpen) => !isOpen || chatUp === undefined);
        }
      },
      selectChat: (direction) => {
        appTabs.stepChat(listedChats.current, chatUp, direction);
      },
    },
    { isReady: opened !== undefined },
  );
  const { moveTo: moveAsks } = useStagedAskActions();
  const screens: null | Screens = opened
    ? {
        // No session: a line a button hands over at the top level opens a
        // draft with the line in it rather than a chat, so the person reads
        // what is about to be asked, adds to it, and sends it themselves.
        ask: (prompt) => {
          draftWith(prompt);
        },
        askAbout: (items, words) => {
          draftWith(words, items);
        },
        browser,
        focusComposer: () => {
          newDraft();
        },
        // With no chat beside the file, a new draft takes what was marked,
        // opened over the file now that the marking is done.
        moveAsksToDraft: (askIds) => {
          moveAsks(askIds, { draftId: draftWith(), kind: "draft" });
        },
        openPage,
        openPath: openNamedPath,
        openScreen,
      }
    : null;

  // A site's tab and the page its group has up, which is what the strip's
  // menu duplicates or reloads.
  const pageOfAppTab = (id: TabId) => {
    const href = tabs.find((tab) => tab.id === id)?.pathname;
    const group = href === undefined ? undefined : groupOfHref(href);
    if (group === undefined || !isSiteGroup(group)) {
      return;
    }
    const up = windowTabs.selectedTabIn(group);
    return up?.kind === "page" ? up : undefined;
  };
  /**
   * A copy of a tab beside it: a screen at the same place with its history,
   * and a site as a new page at the same address, since one page cannot be
   * two tabs' at once.
   */
  const duplicateAppTab = (id: TabId) => {
    const page = pageOfAppTab(id);
    if (page === undefined) {
      appTabs.duplicate(id);
      return;
    }
    const group = newSiteGroup();
    browser?.open(page.url, { group });
    appTabs.duplicate(id, pageHrefOf(group));
  };
  /** A site's page reloaded in place, for the strip's Reload; undefined for a tab that is no site. */
  const reloadablePageOf = (id: TabId) => {
    const page = pageOfAppTab(id);
    if (page === undefined) {
      return;
    }
    return () => {
      getGuest(browserTargetOf(page.id))?.reload();
    };
  };

  if (ensure.error) {
    return (
      <WindowFrame>
        <p className="p-4 pt-12 text-sm text-destructive">
          Could not open the conversation: {ensure.error.message}
        </p>
      </WindowFrame>
    );
  }

  if (!screens) {
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
    defaultModelURI,
    discardDraft,
    // Only a draft holding something is a draft to come back to; one being
    // written with nothing in it yet is its window's alone, one being sent is
    // already its chat, and one just discarded is gone unless its Undo brings
    // it back. A reply waiting in a chat's box belongs to that chat and is
    // read there rather than listed here, until the chat is deleted: then it
    // is listed, so its words can be sent as a chat of their own.
    chatTitles,
    drafts: drafts.filter(
      (draft) =>
        draft.sendingTo === undefined &&
        (draft.chatId === undefined ||
          (chatChrome.isRead && !chatTitles.has(draft.chatId))) &&
        holdsSomething(draft) &&
        !startingIds.has(draft.id) &&
        !discardingIds.has(draft.id),
    ),
    goToPlace: choosePlace,
    newDraft: () => {
      newDraft();
    },
    onListed: (listed) => {
      listedChats.current = listed;
    },
    onNewDraftProject: (draftId, name) => {
      setNewProject({ draftId, ...(name ? { name } : {}) });
    },
    onNewProject: (name) => {
      setNewProject(name ? { name } : {});
    },
    leaveProject,
    openProject: enterProject,
    openProjectInFiles: (project) => {
      void showProjectInFiles(project);
    },
    popOutDraft,
    requestClose,
    rowWidth,
    sendContext: (options) => sendContextRef.current(options),
    sentProjects,
    sentWords,
    setChatProject,
    setDefaultModelURI,
    setPaneOpen,
    showDraft,
    startChat,
    projects,
  };

  return (
    <WindowContext value={screens}>
      <FileOpenContext
        value={(filePath, options) => {
          openNamedPath(filePath, options);
        }}
      >
        <PageOpenContext value={openPage}>
          <WindowFrame
            bar={
              <WindowBar
                leading={<NavControls steps={windowSteps} />}
                tabs={
                  <AppTabStrip
                    chatMarks={chatMarks}
                    chatTitles={chatTitles}
                    childTitles={childTitles}
                    {...stripActions}
                    onReload={reloadablePageOf}
                    selectedId={appTabs.model.selectedId}
                    tabs={tabs}
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
                modelURI={defaultModelURI}
                onChangeDraft={(id, update) => {
                  updateDraft({ id, update });
                }}
                onCloseChat={(chatId) => {
                  compose.remove(chatId);
                }}
                onCloseDraft={closeDraft}
                onDiscardDraft={discardDraft}
                onExpandChat={expandChat}
                onExpandDraft={expandDraft}
                onModelChange={setDefaultModelURI}
                onNewChatProject={(chatId, name) => {
                  setNewProject({ chatId, ...(name ? { name } : {}) });
                }}
                onNewProject={(draftId, name) => {
                  setNewProject({ draftId, ...(name ? { name } : {}) });
                }}
                onSetChatProject={setChatProject}
                onStart={startChat}
                sendContext={(options) => sendContextRef.current(options)}
                sentWords={sentWords}
                projects={projects}
              />
            }
            rail={
              <AppRail
                appsMark={appsMark}
                chatInView={chatUp}
                chatMark={strongestMark(
                  chatChrome.marks.flatMap(([id, mark]) =>
                    floatingChats.has(id) ? [] : [mark],
                  ),
                )}
                onChoose={choosePlace}
                onHoverChat={inboxPeek.onRailHover}
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
                  return router && !waitingTabs.has(tab.id) ? (
                    <AppTabView
                      isActive={tab.id === appTabs.model.selectedId}
                      key={tab.id}
                      router={router}
                      tab={tab}
                    />
                  ) : null;
                })}
              </div>
              <InboxPeek
                isOpen={inboxPeek.isOpen}
                leavesAtOnce={inboxPeek.leavesAtOnce}
                onPointerEnter={inboxPeek.onPointerEnter}
                onPointerLeave={inboxPeek.onPointerLeave}
                panelRef={inboxPeek.panelRef}
              >
                <ChatPane
                  arrivedId={arrivedId}
                  drafts={shell.drafts}
                  // Only the chat in Chat is ever the open one here, and
                  // archiving it puts it away, with the inbox back in its
                  // column.
                  onArchiveOpen={() => {
                    inboxPeek.close();
                    appTabs.navigate(INBOX_HREF);
                    setInboxOpen(true);
                  }}
                  onDeleted={(id) => {
                    windowTabs.dropGroup(id);
                    if (id === chatUp) {
                      inboxPeek.close();
                      appTabs.navigate(INBOX_HREF, { replace: true });
                      setInboxOpen(true);
                    }
                  }}
                  onDeleteDraft={discardDraft}
                  onOpenChat={(entry) => {
                    inboxPeek.close();
                    // Peeked out over another place, the chat pops out over
                    // it, so the place stays where it was; in Chat, with the
                    // inbox put away, it opens beside where the inbox was.
                    if (isChat) {
                      openScreen(chatHref(entry.id));
                    } else {
                      compose.float(entry.id);
                    }
                  }}
                  onOpenDraft={(id) => {
                    inboxPeek.close();
                    showDraft(id);
                  }}
                  onPopOut={(entry) => {
                    inboxPeek.close();
                    compose.float(entry.id);
                    // The chat up in Chat leaves it for its own window, with
                    // the inbox back in its column.
                    if (entry.id === chatUp && isChat) {
                      appTabs.navigate(INBOX_HREF);
                      setInboxOpen(true);
                    }
                  }}
                  openChatId={chatUp}
                  outIds={chatsOutOf(compose.entries)}
                />
              </InboxPeek>
              <CommandMenu
                openPage={(url) => {
                  openPage(url, { newTab: true });
                }}
                openScreen={openScreen}
              />
            </ShellContext>
            {/* Where the window's page waits while the tab up has none to
              show; hidden, so a guest left over it is parked. */}
            <div hidden ref={holderRef} />
            {createPortal(
              <ActiveTabProvider isActive={pageSlot?.isShown ?? false}>
                <BrowserTabs
                  chromeInto={pageSlot?.chrome?.into ?? null}
                  fieldInto={pageSlot?.chrome?.fieldInto ?? null}
                  ref={setBrowser}
                  reloadInto={pageSlot?.chrome?.reloadInto ?? null}
                  rowWidth={rowWidth}
                />
              </ActiveTabProvider>,
              stage,
            )}
            {/* Asked for from a chat's head or a draft's, so the project it
              makes is filed on that chat or draft as it lands. */}
            <ProjectDialog
              candidates={candidates}
              mode="create"
              {...(newProject?.name ? { name: newProject.name } : {})}
              onCreate={(project, alsoFile) => {
                const forDraft = newProject?.draftId;
                const filedOn =
                  forDraft === undefined &&
                  projectFor !== undefined &&
                  chatTitles.has(projectFor)
                    ? projectFor
                    : undefined;
                createProject.mutate(project, {
                  onSuccess: (created) => {
                    for (const id of alsoFile) {
                      setChatProject(id, created.id);
                    }
                    if (forDraft !== undefined) {
                      updateDraft({
                        id: forDraft,
                        update: (draft) => ({
                          ...draft,
                          projectId: created.id,
                          projectSource: "chosen",
                        }),
                      });
                    }
                    if (filedOn) {
                      setChatProject(filedOn, created.id);
                    }
                  },
                });
              }}
              onOpenChange={(open) => {
                if (!open) {
                  setNewProject(undefined);
                }
              }}
              open={newProject !== undefined}
              // A retired project's name brings it back, so only the ones in
              // use are names a new project cannot take.
              otherNames={projects.flatMap((project) =>
                project.retired ? [] : [project.name],
              )}
              taken={projects.flatMap((project) =>
                project.emoji ? [project.emoji] : [],
              )}
            />
          </WindowFrame>
          {/* What a tab's Expand asks to see large, over the window. */}
          <WindowLook />
        </PageOpenContext>
      </FileOpenContext>
    </WindowContext>
  );
}
