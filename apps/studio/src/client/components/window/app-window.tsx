import { keyboardSide } from "@/client/lib/keyboard-place";
import { OUTSIDE_FILES_MAX } from "@instrument-org/shared";
import {
  setFilesTabOpener,
  showProjectInFiles,
} from "@/client/lib/show-in-files";
import {
  draftsAtom,
  draftsLoadedAtom,
  removeDraftAtom,
  updateDraftAtom,
} from "@/client/drafts/store";
import {
  newChatBoxesAtom,
  pickNewChatProjectAtom,
  settleMadeDraft,
} from "@/client/drafts/new-chat-box";
import { type Draft, holdsSomething } from "@/shared/drafts";
import {
  type AppPlace,
  chatFiltersByTabAtom,
  filesFolderAtom,
  NEW_TAB_HREF,
  type WindowTab,
} from "@/client/atoms/window";
import { openBuiltInPage } from "@/client/atoms/page-requests";
import { AppErrorFallback } from "@/client/components/app-error-fallback";
import { FileOpenContext } from "@/client/components/file-open-context";
import { WithDeveloperStrip } from "@/client/components/developer-strip/developer-strip-slot";
import { WindowZoomRoot } from "@/client/components/window/window-zoom-root";
import { PageOpenContext } from "@/client/components/page-open-context";
import { ThemeProvider } from "@/client/components/theme-provider";
import { Spinner } from "@/client/components/ui/spinner";
import { TooltipProvider } from "@/client/components/ui/tooltip";
import { SetupHost } from "@/client/components/setup/setup-host";
import { WindowBorder } from "@/client/components/window-border";
import { ChromeInsetProvider } from "@/client/hooks/use-chrome-inset";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { SCREENS, screenOfHref } from "@/shared/instrument-screens";
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
import { pageHoldingKeyboard } from "@/client/lib/browser-pool";
import { resolveComputerFileBase } from "@/client/lib/computer-file-url";
import { ICON_CONTEXT_VALUE } from "@/client/lib/icon-context";
import {
  focusChatComposer,
  focusScreenHome,
  installKeyboardHome,
} from "@/client/lib/keyboard-home";
import { storageLocationQueryOptions } from "@/client/lib/output-folder";
import { sharedQueryClient, type TabRouter } from "@/client/lib/tab-router";
import { getRouterHistory } from "@/client/lib/tab-router-history";
import { getTabRouter } from "@/client/lib/tab-router-registry";
import { restoreTabView } from "@/client/lib/tab-view-state";
import {
  closeGroupSide,
  closeGroupTab,
  closeTabGroup,
  forgetClosed,
  setTabPathname,
} from "@/client/lib/tabs-model";
import { freshTabId } from "@/client/lib/tab-actions";
import { type TabId, TabIdSchema } from "@/shared/tabs";
import { spokenMessage, toast } from "@/client/lib/toast";
import { captureComponentError } from "@/client/lib/capture-exception";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { fileHref, folderHref } from "@/shared/computer-href";
import { type Tab } from "@/shared/tabs";

import { useRestoredTabsWaiting } from "./use-restored-tabs-waiting";
import { type ChatId } from "@instrument-org/workspace/client";
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

import {
  appTabsAtom,
  groupOfHref,
  isChatHref,
  isSiteGroup,
  placeOfHref,
  putAwaySitesAtom,
  siteGroupsInOtherWindows,
  siteGroupsOf,
  useAppTabs,
} from "./app-tabs";
import { useAppsBySlug } from "./apps-by-slug";
import { editField } from "./omnibar-field";
import { BrowserTabs, type BrowserTabsHandle } from "./browser-tabs";
import { chatListOptions, chromeOfChats } from "./chat-list-query";
import { type ChatFilters, inPlace } from "./chats";
import { useComputerVolumes } from "./computer-volumes";
import { type WindowContextValue as Screens, WindowContext } from "./context";
import {
  chatOfTab,
  closedGroupTabOf,
  closedSideOf,
  closedTabGroupOf,
  isBlankNewTab,
  isNewChatTab,
  selectedTabIn,
  sideIndexOf,
  upsAmong,
} from "./tab-model";
import { useTabTitle } from "./tab-title";
import {
  sidebarRowOrderAtom,
  tabAtChord,
  useHeldChordHints,
} from "./held-chord-hints";
import { toastWithUndo } from "./undo-offers";
import { useSignInLanding } from "./use-sign-in-landing";
import { WindowLook } from "./look-panel";
import { ProjectDialog } from "./project-dialog";
import { screenActionOf, useRecordScreen } from "./screen-action";
import { layoutReadOf } from "./group-awareness";
import { contextReaders } from "./send-context";
import { type WindowShell as Shell, ShellContext } from "./shell-context";
import { useStagedAskActions } from "./staged-asks";
import { tabSurfaceAtom } from "./tab-surface";
import { useTaskTitles } from "./task-titles";
import { useDrafts } from "./use-drafts";
import { useOpeners } from "./use-openers";
import { CommandMenu } from "./command-menu";
import { usePageThumbnailHousekeeping } from "./use-page-thumbnail-housekeeping";
import { useWindowSteps } from "./use-tab-steps";
import { useSetChatProject } from "./use-set-chat-project";
import { backfillCandidates } from "./use-project-backfill";
import { useWindowCommands } from "./use-window-commands";
import { useWindowDropFallback } from "./use-window-drop-fallback";
import { WindowFrame } from "./window-frame";
import { GroupSidebar, sidebarBounds } from "./group-sidebar";
import { TrafficLightsWithSidebar } from "./inbox-toggle";
import { isGroupScreenHref } from "./group-screen";
import { DragLayer } from "./drag/drag-layer";
import { useDragSystem } from "./drag/use-drag-system";
import { useGroupTabMoves } from "./tab-drag";
import {
  groupAlong,
  isPinnedGroup,
  isWorthKeeping,
  startTabGroupsFromZero,
  useOpenGroups,
  useTabGroupActions,
  useTabGroupUpkeep,
} from "./tab-groups";
import { windowTabGroupsAtom } from "./open-groups";
import {
  sidebarOpenAtom,
  sidebarProjectAtom,
  sidebarWidthAtom,
} from "@/client/atoms/tab-groups";
import { StudioSidebarRail } from "@/client/components/studio-sidebar-rail";
import {
  CHATS_INDEX_HREF,
  groupHref,
  chatOfHref,
  matchScreen,
  newChatHref,
  sameHref,
} from "./window-href";
import {
  chatFiltersUpAtom,
  groupOnScreenAtom,
  newScreenId,
  useWindowTabs,
  windowTabsAtom,
} from "./window-tabs";
import { flashStripTab } from "./tab-strip";
import { useFollowFolderMoves } from "./follow-folder-moves";
import { forgetMovedAway, hasMovedAway, receiveTab } from "./move-tab";
import { sitesLeaving, sitesNoLongerHere, sitesPutAway } from "./site-let-go";

// Resolve the computer file channel once at boot so file URLs derive locally
// from a host path; not awaited, so it never holds up the first render.
void resolveComputerFileBase();

/** What a close from the sidebar put on the window's closed list, and the tabs it held. */
interface Closing {
  entries: TabId[];
  tabs: WindowTab[];
}

/**
 * The app window: its tabs across the bar, each a router of its own kept
 * mounted and live behind the one on screen, and around them what the window
 * keeps once whatever tab is up: the rail, the drafts, the window's browser,
 * and its chords.
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
  // Before the tabs are read, so a window that has kept no tab groups opens
  // on none of what an earlier build left in them.
  const store = useStore();
  useState(() => {
    startTabGroupsFromZero(store);
  });
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

/**
 * The caret into the address field of the tab up on the side with the
 * keyboard, with what is in it selected.
 */
function focusField() {
  const field = (keyboardSide() ?? document).querySelector<HTMLInputElement>(
    "[data-app-tab-active] [data-tab-location] input",
  );
  if (field) {
    editField(field);
    field.select();
  }
}

/** How long the Chats page has to come up before its search takes the caret, in frames. */
const CHATS_SEARCH_WAIT_FRAMES = 30;

/**
 * The caret into the Chats page's search once the page is up, with what is
 * in it selected: the one on the side with the keyboard, where the page
 * opens.
 */
function focusChatsSearch() {
  let frames = 0;
  const attempt = () => {
    const shown = [
      ...document.querySelectorAll<HTMLInputElement>(
        "[data-app-tab-active] [data-chats-search] input",
      ),
    ].filter((box) => box.checkVisibility({ visibilityProperty: true }));
    const box =
      shown.find((each) => each.closest("[data-keyboard]")) ?? shown[0];
    if (box) {
      box.focus();
      box.select();
      return;
    }
    frames += 1;
    if (frames < CHATS_SEARCH_WAIT_FRAMES) {
      requestAnimationFrame(attempt);
    }
  };
  requestAnimationFrame(attempt);
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
  const store = useStore();
  const appTabs = useAppTabs();
  const groups = useTabGroupActions();
  const groupTabMoves = useGroupTabMoves();
  const groupList = useOpenGroups();
  useHeldChordHints();
  const [isSidebarOpen, setSidebarOpen] = useAtom(sidebarOpenAtom);
  const sidebarWidth = useAtomValue(sidebarWidthAtom);
  const groupUp = useRouterState({
    select: (routerState) => groupOfHref(routerState.location.href),
  });
  const appTabHref = useRouterState({
    select: (routerState) => routerState.location.href,
  });
  useTabGroupUpkeep(appTabHref, groupList.open);
  // Closing a group leaves its chats working: a chat goes on with no tab,
  // and the Chats page shows it at work. With `keep`, the group a row's menu asked
  // from, which the window moves to.
  // What went on the closed list comes back, for the sidebar's Undo.
  const closeGroups = (closed: readonly string[], keep?: string): Closing => {
    const closing: Closing = { entries: [], tabs: [] };
    // Each group goes on the window's closed list whole, so Shift+Cmd+T
    // brings it back as it was; a group of only blank new tabs leaves
    // nothing to bring back.
    for (const group of closed) {
      const kept = windowTabs.allTabs.flatMap((tab) => {
        const closedAs = closingAsWritten(tab);
        return tab.group === group && closedAs && !isBlankNewTab(closedAs)
          ? [closedAs]
          : [];
      });
      if (kept.length > 0) {
        const id = freshTabId();
        store.set(appTabsAtom, (current) =>
          closeTabGroup(current, {
            id,
            pathname: groupHref(group),
            tabs: kept,
            ups: upsAmong(windowTabs.layoutOf(group), kept),
          }),
        );
        closing.entries.push(id);
        closing.tabs.push(...kept);
      }
    }
    if (keep === undefined) {
      for (const group of closed) {
        groups.close(group, groupList.open);
      }
    } else {
      groups.closeAll(closed, keep);
    }
    return closing;
  };
  // The window shows one group at a time, in one tab: tabs restored from
  // the strip a build before this one kept fold into the one up.
  const foldRestoredTabs = useEffectEvent(() => {
    const { selectedId, tabs: restored } = appTabs.model;
    if (selectedId && restored.length > 1) {
      appTabs.closeOthers(selectedId);
    }
  });
  // Once, as the window opens.
  useEffect(() => {
    foldRestoredTabs();
  }, []);
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
  const { chatTitles } = chatChrome;
  const titleOfTab = useTabTitle(chatTitles);
  const [defaultModelURI, setDefaultModelURI, saveDefaultModelURI] =
    useDefaultModelURI();
  const drafts = useAtomValue(draftsAtom);
  const draftsLoaded = useAtomValue(draftsLoadedAtom);
  const updateDraft = useSetAtom(updateDraftAtom);
  const removeDraft = useSetAtom(removeDraftAtom);
  const setFilesFolder = useSetAtom(filesFolderAtom);
  const [chatFilters, setChatFilters] = useAtom(chatFiltersUpAtom);
  const pickNewChatProject = useSetAtom(pickNewChatProjectAtom);
  const sendContextRef = useRef<Shell["sendContext"]>(() =>
    Promise.resolve(undefined),
  );
  const layoutContextRef = useRef<Shell["layoutContext"]>(() => undefined);
  // The card the tabs are drawn in, measured in layout px, which the inbox
  // sizes itself against.
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
  const [browser, setBrowser] = useState<BrowserTabsHandle | null>(null);
  const windowTabs = useWindowTabs();
  // What the window's arrows and chords walk: the tab up's history, through
  // a site's page first.
  const windowSteps = useWindowSteps();
  // Every screen a group's tab stands on is walked by a router of its own.
  useGroupTabRouters(windowTabs.allTabs, windowTabs.screenMoved);
  // And each follows a chat's folder moving to the chat's title.
  useFollowFolderMoves(opened !== undefined);

  // The folder a tab last stood in is where Files in the rail takes a tab.
  // A file's address names where it was opened from rather than the folder
  // on screen, so one with a file open leaves the folder as it was.
  useEffect(() => {
    if (filesFolder !== undefined) {
      setFilesFolder(filesFolder);
    }
  }, [filesFolder, setFilesFolder]);

  // A draft with no words is not kept, so one left over from a launch goes.
  // Once, over what was restored, once main has read the drafts: before
  // then every draft looks gone.
  const isSwept = useRef(false);
  const sweepRestored = useEffectEvent(() => {
    // A reply waiting in a chat's box is kept by the chat, not by a window
    // of its own, so nothing here takes one away.
    const isKept = (draft: Draft) =>
      draft.chatId !== undefined || isWorthKeeping(draft);
    // A draft's folder goes with it, and what was pasted into it. Once a launch,
    // since a window opening later finds another's new chat box as empty as these.
    void rpcClient.window.takeLaunchSweep.call().then((isFirstUp) => {
      if (isFirstUp) {
        for (const draft of drafts) {
          if (!isKept(draft)) {
            void removeDraft(draft.id);
          }
        }
      }
    });
  });
  useEffect(() => {
    if (draftsLoaded && !isSwept.current) {
      isSwept.current = true;
      sweepRestored();
    }
  }, [draftsLoaded]);

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

  const appsBySlug = useAppsBySlug();
  const { openNamedPath, openPage, openScreen } = useOpeners({
    appsBySlug,
    appTabs,
    browser,
    chatTitles,
    closedEntryOf: (kind, id) =>
      store.get(appTabsAtom).recentlyClosed.find((entry) => {
        const closedTabs = closedTabGroupOf(entry) ?? [];
        const tab = closedGroupTabOf(entry);
        return kind === "group"
          ? closedTabs.some((each) => each.group === id) || tab?.group === id
          : closedTabs.some((each) => each.id === id) || tab?.id === id;
      })?.id,
    // The sidebar's X: onto the closed list whole, with an Undo.
    closeGroup: (group) => {
      if (!groupList.open.some((entry) => entry.group === group)) {
        return false;
      }
      offerUndo(closeGroups([group]));
      return true;
    },
    closeTab: (id) => {
      requestClose(id);
    },
    isOpen: opened !== undefined,
    newGroup: (fill, options) => groups.make({ fill, ...options }),
    openChat: (chat) => {
      groups.openChat(chat);
    },
    reopenClosed: (entry) => {
      reopenClosed(TabIdSchema.parse(entry));
    },
    showGroup: (group, { newWindow = false } = {}) => {
      if (newWindow) {
        groups.moveToNewWindow(group, groupList.open);
      } else {
        groups.show(group);
      }
    },
    windowTabs,
  });
  // Show in Folder, from anywhere in the window, opens Files as a tab of the
  // tab group up, read at the moment it is asked.
  useLayoutEffect(() => {
    setFilesTabOpener((href) => {
      openScreen(href, { newTab: true });
    });
  });

  // What a new tab shows, asked for as the window comes up rather than as the
  // tab mounts, so the page lays out from the cache instead of growing a
  // section at a time as each answer lands. The free trial's offer is the Add a provider sheet's one remote
  // answer, so it is in the cache before the sheet opens.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!opened) {
      return;
    }
    void queryClient.prefetchQuery(
      rpcClient.workspace.computer.places.queryOptions(),
    );
    void queryClient.prefetchQuery(storageLocationQueryOptions());
    void queryClient.prefetchQuery(rpcClient.billing.offer.queryOptions());
  }, [opened, queryClient]);

  /**
   * A new chat's tab as it closes, at the address of the draft words typed
   * a moment before make, so it can be reopened with them as one closed a
   * moment later can.
   */
  const closingAsWritten = (tab: undefined | WindowTab) => {
    const made = tab && settleMadeDraft(store, tab.id);
    if (tab?.kind !== "screen" || made === undefined) {
      return tab;
    }
    const screen = matchScreen(tab.href);
    return screen.kind === "inbox" && screen.draft === made
      ? tab
      : { ...tab, href: newChatHref(made) };
  };
  // A group's tab closed goes on the window's closed list, with the window's
  // own tabs, so Shift+Cmd+T brings it back.
  const requestClose = (id: string) => {
    const tab = windowTabs.allTabs.find((each) => each.id === id);
    const closedAs = closingAsWritten(tab);
    // A group's last tab closes the group.
    if (
      tab?.group !== undefined &&
      groupList.open.some((entry) => entry.group === tab.group) &&
      windowTabs.allTabs.every(
        (each) => each.group !== tab.group || each.id === id,
      )
    ) {
      closeGroups([tab.group]);
      return;
    }
    if (tab?.group !== undefined && closedAs && !isBlankNewTab(closedAs)) {
      const { group } = tab;
      const index = windowTabs.allTabs
        .filter((each) => each.group === group)
        .indexOf(tab);
      store.set(appTabsAtom, (current) =>
        closeGroupTab(current, {
          id: freshTabId(),
          index,
          pathname: groupHref(group),
          tab: closedAs,
        }),
      );
    }
    windowTabs.close(id);
  };
  /**
   * The whole side a tab stands on closed, onto the window's closed list as
   * one entry that brings the side back; a group of one side closes whole.
   */
  const closeSideOf = (id: string): Closing => {
    const tab = windowTabs.allTabs.find((each) => each.id === id);
    if (tab?.group === undefined) {
      return { entries: [], tabs: [] };
    }
    const { group } = tab;
    const layout = windowTabs.layoutOf(group);
    const side = sideIndexOf(layout, id);
    if (side === undefined || layout.sides.length < 2) {
      return closeGroups([group]);
    }
    const sideTabs = layout.sides[side]?.tabs ?? [];
    const upId = layout.sides[side]?.up;
    const kept = sideTabs.flatMap((each) => {
      const closedAs = closingAsWritten(each);
      return closedAs && !isBlankNewTab(closedAs) ? [closedAs] : [];
    });
    const closing: Closing = { entries: [], tabs: kept };
    if (kept.length > 0) {
      const entry = freshTabId();
      store.set(appTabsAtom, (current) =>
        closeGroupSide(current, {
          focused: layout.focused === side,
          id: entry,
          pathname: groupHref(group),
          side,
          tabs: kept,
          up: Math.max(
            0,
            kept.findIndex((each) => each.id === upId),
          ),
        }),
      );
      closing.entries.push(entry);
    }
    windowTabs.closeSide(group, side);
    return closing;
  };
  /** A toast saying what the sidebar closed, whose Undo brings it all back. */
  const offerUndo = ({ entries, tabs: closedTabs }: Closing) => {
    const [first] = closedTabs;
    if (entries.length === 0 || !first) {
      return;
    }
    toastWithUndo(
      closedTabs.length === 1
        ? `Closed ${titleOfTab(first)}`
        : `Closed ${closedTabs.length} tabs`,
      {
        journalIds: [],
        undo: () => {
          for (const entry of entries) {
            reopenClosed(entry);
          }
        },
      },
    );
  };
  /**
   * One entry of the window's closed list back, by its id: a whole tab group
   * as a group again, its tabs on their sides; a tab into its group, up
   * there, or as a group of its own when its group has closed.
   */
  const reopenClosed = (id: TabId) => {
    const entry = store
      .get(appTabsAtom)
      .recentlyClosed.find((each) => each.id === id);
    if (!entry) {
      return;
    }
    store.set(appTabsAtom, (current) => forgetClosed(current, { id }));
    // A tab id is never opened twice. A page's guest went with it, and
    // comes back when the page shows, at the address it had, the way a
    // launch brings a tab's page back.
    const side = closedSideOf(entry);
    if (
      side &&
      groupList.open.some((each) => each.group === side.group) &&
      windowTabs.allTabs.some((each) => each.group === side.group)
    ) {
      windowTabs.reopenSide({
        ...side,
        tabs: side.tabs.map((each) => ({ ...each, id: newScreenId() })),
      });
      groups.show(side.group);
      return;
    }
    const tab = closedGroupTabOf(entry);
    const isOpen =
      tab !== undefined &&
      groupList.open.some((each) => each.group === tab.group);
    if (tab && isOpen) {
      windowTabs.reopen(
        { ...tab, id: newScreenId() },
        entry.index ?? Number.POSITIVE_INFINITY,
      );
      groups.show(tab.group);
      return;
    }
    // A tab alone, or a side whose group has closed, stands on the one side
    // its new group has.
    const reopened = side
      ? side.tabs.map((each) => ({ ...each, side: undefined }))
      : (closedTabGroupOf(entry) ?? (tab ? [{ ...tab, side: undefined }] : []));
    groups.make({
      fill: (group) => {
        windowTabs.restoreGroup(
          group,
          reopened.map((each) => ({ ...each, group, id: newScreenId() })),
          side ? { active: side.up } : entry.ups,
        );
      },
    });
  };
  /**
   * What this window closed last back, unless a window closed since, which
   * comes back instead, the way a browser's one chord brings back either.
   */
  const reopenTab = () => {
    const [entry] = store
      .get(appTabsAtom)
      .recentlyClosed.filter(
        (each) =>
          closedGroupTabOf(each) !== undefined ||
          closedTabGroupOf(each) !== undefined,
      );
    void rpcClient.window.reopenClosed
      .call(entry && { after: entry.closedAt ?? 0 })
      .catch(() => false)
      .then((windowCameBack) => {
        if (entry && !windowCameBack) {
          reopenClosed(entry.id);
        }
      });
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
  const checkForUpdates = useMutation(
    rpcClient.preferences.checkForUpdates.mutationOptions(),
  );
  const setChatProject = useSetChatProject();
  // The new-project dialog, asked for from a chat's menu or a draft's, with
  // what was typed in the picker: the project it makes files that chat or
  // that draft.
  const [newProject, setNewProject] = useState<{
    /** The chat it files; without one, the chat the window's tab has open. */
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

  // What the tab in view says it shows: a chat's or a site's tab up while
  // its pane is open, or the screen the window's tab is at.
  const tabInView = windowTabs.active;
  const groupInView = windowTabs.groupOnScreen;
  const surfaceInView =
    groupInView === undefined
      ? surfaces[appTabs.model.selectedId ?? ""]
      : tabInView?.kind === "screen"
        ? surfaces[tabInView.id]
        : undefined;
  const screenView = surfaceInView?.view ?? null;
  // The screen in front, for the action log once it settles: a built-in
  // page up in the group by its own address, as Settings at its part.
  const builtInInView =
    tabInView?.kind === "screen" && screenOfHref(tabInView.href)
      ? tabInView.href
      : undefined;
  const hrefInView = builtInInView ?? screenHref;
  useRecordScreen(
    screenActionOf({
      appName: (slug) => appsBySlug.get(slug)?.name,
      chatTitle: (chat) => chatTitles.get(chat),
      ...(surfaceInView?.walked
        ? { folderPath: surfaceInView.walked.hostPath }
        : {}),
      ...(hrefInView === undefined ? {} : { href: hrefInView }),
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
      href: hrefNow(),
      screenView,
      state: opened,
      surfaces,
      ...(volumes ? { volumes } : {}),
      windowTabs,
    });
  const draftContext = (draft: Draft, tabId: string | undefined) =>
    readersNow().draftContext(draft, tabId);
  // A chat's tab group as a message goes from it, read at the press. The
  // tab sent from is where the chat's agent works from then on (`chatTab`).
  const layoutNow = (tabId: string) => {
    windowTabs.markPrompted(tabId);
    return layoutReadOf({ appsBySlug, chatTitles, windowTabs }, tabId);
  };
  useLayoutEffect(() => {
    sendContextRef.current = (options) => readersNow().sendContext(options);
    layoutContextRef.current = layoutNow;
  });
  const {
    arrivedId,
    discardDraft,
    discardingIds,
    draftFromLink,
    draftWith,
    sentProjects,
    sentWords,
    showDraft,
    startChat,
    startingIds,
  } = useDrafts({
    browser,
    folders: opened?.folders ?? {},
    draftContext,
    isOpen: opened !== undefined,
    layoutOf: (tabId) => layoutContextRef.current(tabId),
    isChat,
    openDraftInChat: (id) => {
      appTabs.navigate(newChatHref(id));
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
   * The sidebar standing in a project, from the command menu: out if it was
   * put away.
   */
  const enterProject = (projectId: string) => {
    setSidebarOpen(true);
    store.set(sidebarProjectAtom, projectId);
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
  // However a tab's list leaves a project (its Inbox, a chat from
  // elsewhere, the project deleted), that tab's new chat, filed by the
  // project and with nothing written yet, stops being filed under it.
  const filtersByTab = useAtomValue(chatFiltersByTabAtom);
  const lastFilters = useRef(filtersByTab);
  useEffect(() => {
    const before = lastFilters.current;
    lastFilters.current = filtersByTab;
    const standingIn = (filters: ChatFilters | undefined) =>
      filters?.projects.length === 1 ? filters.projects[0] : undefined;
    const boxes = store.get(newChatBoxesAtom);
    for (const [tabId, filters] of Object.entries(before)) {
      const left = standingIn(filters);
      const box = boxes[tabId];
      if (
        left !== undefined &&
        left !== standingIn(filtersByTab[tabId]) &&
        box?.projectId === left &&
        box.draftId === null
      ) {
        pickNewChatProject({ projectId: undefined, tabId });
      }
    }
  }, [filtersByTab, pickNewChatProject, store]);
  /**
   * The tab up to one of the places, from their chords, the command menu or
   * a place's mark in the address row. Chat is the chat of the tab group up:
   * its column opens when it was put away, and its composer takes the
   * keyboard. The place the tab is already in takes it back to its root (the
   * home folder, the browser's start, the apps). A place asked for in a tab
   * of its own waits behind, the way a bookmark middle-clicked in a browser
   * does.
   */
  const choosePlace = (
    next: AppPlace,
    { newTab = false, newWindow = false } = {},
  ) => {
    if (newWindow) {
      appTabs.goToPlace(next, { newWindow });
      return;
    }
    // The chat is the group's first chat's tab, or its first new chat's.
    if (next === "chat") {
      const group = groups.groupUp();
      const tab =
        group === undefined
          ? undefined
          : windowTabs
              .layoutOf(group)
              .sides.flatMap((side) => side.tabs)
              .find(
                (each) => chatOfTab(each) !== undefined || isNewChatTab(each),
              );
      if (tab) {
        windowTabs.select(tab.id);
        focusChatComposer();
      }
      return;
    }
    if (next === place && !newTab) {
      appTabs.goToPlace(next, { root: true });
      return;
    }
    appTabs.goToPlace(next, { behind: newTab, newTab });
  };
  // Everything held lands through the window's one drag (`useDragSystem`):
  // files let go where it takes none and nothing else does open the way
  // files dropped on the Dock icon do, as a tab group of their own.
  const drags = useDragSystem({ browser, chatTitles });
  useWindowDropFallback((files) => {
    drags.openFilesAsGroup(files);
  });
  // Something from outside the app that a tab already shows comes up there
  // and lights that tab, since a switch alone, or no change at all when the
  // tab was already up, is easy to miss.
  const showFromOutside = (href: string): boolean => {
    if (!appTabs.selectShowing(href)) {
      return false;
    }
    const shown = store.get(appTabsAtom).selectedId;
    if (shown) {
      flashStripTab(shown);
    }
    return true;
  };
  // The group on screen's tabs as they stand across it: the left side's
  // strip, then the right's.
  const tabsLeftToRight = () => {
    const group = windowTabs.groupOnScreen;
    return group === undefined
      ? []
      : windowTabs.layoutOf(group).sides.flatMap((side) => side.tabs);
  };
  useWindowCommands(
    {
      back: () => {
        windowSteps.go("back");
      },
      // The tab up on the side with the keyboard in the group on screen; the
      // group's last tab closes the group with it, which Shift+Cmd+T and
      // Activity bring back.
      closeTab: () => {
        const group = store.get(groupOnScreenAtom);
        if (group === undefined) {
          return;
        }
        const up = selectedTabIn(store.get(windowTabsAtom), group);
        if (up) {
          requestClose(up.id);
        } else {
          closeGroups([group]);
        }
      },
      forward: () => {
        windowSteps.go("forward");
      },
      focusSide: (side) => {
        const group = windowTabs.groupOnScreen;
        if (
          group !== undefined &&
          windowTabs.layoutOf(group).sides[side] !== undefined
        ) {
          windowTabs.focusSide(group, side);
        }
      },
      newChat: () => {
        groups.make();
      },
      newChatFromLink: draftFromLink,
      newTab: () => {
        groups.newTab();
      },
      // What arrives from outside the app comes up in the tab already showing
      // it, however far that tab has walked within it, and in a tab of its
      // own where none does. Main has already picked this window as the one
      // showing it, or the one in front where none does.
      // Said alone: the folder it was in opens in the hand-over's tab group.
      missingFile: (name, folder) => {
        toast(
          `${name} is no longer there`,
          folder === undefined
            ? { description: "The folder it was in is gone too." }
            : undefined,
        );
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
      pageNotOpened: (host, why) => {
        if (why === "noAnswer") {
          toast(`${host} didn't answer`, {
            description: "Try the link again in a moment.",
          });
        } else {
          toast(`Couldn't keep a copy of ${host}`, {
            description:
              "Instrument saves a page it opens into your Downloads folder, which didn't take it.",
          });
        }
      },
      // Fixed words: the link's own are in no toast, since a site can send
      // one with no click at all.
      linkNotOpened: () => {
        toast("Couldn't open that link", {
          action: {
            label: "Check for updates",
            onClick: () => {
              checkForUpdates.mutate();
            },
          },
          description:
            "This version of Instrument doesn't know that kind of link, but a newer one might.",
        });
      },
      // What arrives from outside the app is a tab group of its own at the
      // top of the list, except a chat already open in a tab, which comes
      // forward there.
      openFile: (hostPath) => {
        groups.make({ href: fileHref(hostPath) });
      },
      // Several at once are one group, a tab each in the order handed over,
      // on one side, with the first up.
      openGroup: (hrefs) => {
        groups.make({
          fill: (group) => {
            const [first] = hrefs.map((href) =>
              windowTabs.openScreen(href, { group }),
            );
            if (first !== undefined) {
              windowTabs.select(first);
            }
          },
        });
      },
      openScreen: (href) => {
        const chat = chatOfHref(href);
        if (chat !== undefined) {
          groups.revealChat(chat);
        } else if (isGroupScreenHref(href)) {
          groups.make({ href });
        } else {
          openScreen(href);
        }
      },
      // A group this window has open comes up, and so does a tab here
      // showing what the address shows.
      showTab: (href) => {
        const group = groupOfHref(href);
        if (
          group !== undefined &&
          store.get(windowTabGroupsAtom)?.includes(group)
        ) {
          groups.show(group);
          return true;
        }
        return showFromOutside(href);
      },
      // The tab up in the group, to a group and a window of its own, as
      // dragging it off the window does.
      moveTabToNewWindow: () => {
        const up = windowTabs.active;
        if (up) {
          groupTabMoves.toNewWindow(up.id);
        }
      },
      // A new tab on the other side of the group on screen, after the tab
      // up there, with the keyboard, as its tabs' menus' New Tab in Split;
      // where the group has one side, it becomes the right side.
      newTabInSplit: () => {
        const group = windowTabs.groupOnScreen;
        if (group === undefined) {
          return;
        }
        const layout = windowTabs.layoutOf(group);
        const other = layout.focused === 1 ? 0 : 1;
        const upThere = layout.sides[other]?.up;
        windowTabs.openIn(
          { group, href: NEW_TAB_HREF, id: newScreenId(), kind: "screen" },
          {
            group,
            select: true,
            side: other,
            ...(upThere === undefined ? {} : { after: upThere }),
          },
        );
      },
      // The side with the keyboard of the group on screen closed whole, as
      // its strip's Close Split does; nothing where the group has one side.
      closeSplit: () => {
        const group = windowTabs.groupOnScreen;
        if (group === undefined) {
          return;
        }
        const layout = windowTabs.layoutOf(group);
        const first = layout.sides[layout.focused]?.tabs[0];
        if (layout.sides.length === 2 && first) {
          offerUndo(closeSideOf(first.id));
        }
      },
      receiveGroupTab: groupTabMoves.receive,
      receiveTab,
      reopenTab,
      search: focusField,
      // The Chats page, every chat open or not, with the caret in its search.
      searchChats: () => {
        openBuiltInPage(CHATS_INDEX_HREF);
        focusChatsSearch();
      },
      showActivity: () => {
        openBuiltInPage(SCREENS.activity.href);
      },
      // The tab chords step the tabs of the group up, as a browser's step
      // its strip, across both sides and round from either end.
      selectRelative: (direction) => {
        const { active } = windowTabs;
        const groupTabs = tabsLeftToRight();
        const at = groupTabs.findIndex((tab) => tab.id === active?.id);
        const next =
          groupTabs[(at + direction + groupTabs.length) % groupTabs.length];
        if (next) {
          windowTabs.select(next.id);
        }
      },
      // Cmd+1 to Cmd+8 by place, and Cmd+9 the last.
      selectTab: (index) => {
        const next = tabAtChord(tabsLeftToRight(), index);
        if (next) {
          windowTabs.select(next.id);
        }
      },
      // Control+1 to Control+9 (Alt off the Mac): the sidebar's rows by
      // place, as it lists them, pinned first.
      selectGroup: (index) => {
        const order = store.get(sidebarRowOrderAtom) ?? [
          ...groupList.open.filter(isPinnedGroup).map((entry) => entry.group),
          ...groupList.open
            .filter((entry) => !isPinnedGroup(entry))
            .map((entry) => entry.group),
        ];
        const next = order[index - 1];
        if (next !== undefined) {
          groups.show(next);
        }
      },
      toggleSidebar: () => {
        setSidebarOpen((isOpen) => !isOpen);
      },
      selectChat: (direction) => {
        const next = groupAlong(groupList.open, groupUp, direction);
        if (next !== undefined) {
          groups.show(next);
        }
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
        browser,
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
    arrivedId,
    childTitles,
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
    closeGroup: (group) => {
      closeGroups([group]);
    },
    closeSide: (tab) => {
      offerUndo(closeSideOf(tab));
    },
    goToPlace: choosePlace,
    newGroup: () => {
      groups.make();
    },
    newTab: () => {
      groups.newTab();
    },
    onNewDraftProject: (draftId, name) => {
      setNewProject({ draftId, ...(name ? { name } : {}) });
    },
    onNewProject: (chatId, name) => {
      setNewProject({ chatId, ...(name ? { name } : {}) });
    },
    leaveProject,
    openProject: enterProject,
    openProjectInFiles: (project) => {
      void showProjectInFiles(project);
    },
    reopenClosed,
    reopenTab,
    requestClose,
    rowWidth,
    layoutContext: (tabId) => layoutContextRef.current(tabId),
    sendContext: (options) => sendContextRef.current(options),
    sentProjects,
    sentWords,
    setChatProject,
    setDefaultModelURI,
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
            corner={<TrafficLightsWithSidebar />}
            hasBar={false}
            rail={
              <StudioSidebarRail
                bounds={sidebarBounds(
                  rowWidth + (isSidebarOpen ? sidebarWidth : 0),
                )}
                isOpen={isSidebarOpen}
                label="Resize the sidebar"
                onCollapse={() => {
                  setSidebarOpen(false);
                }}
                panelClassName="border-r-0 bg-transparent"
                widthAtom={sidebarWidthAtom}
              >
                {/* The sidebar's History lists the window's closed tabs and
                  restores them, which it reads from the shell. */}
                <ShellContext value={shell}>
                  <GroupSidebar
                    chatTitles={chatTitles}
                    groupUp={groupUp}
                    onClose={(group) => {
                      offerUndo(closeGroups([group]));
                    }}
                    onCloseAll={(closed, keep) => {
                      offerUndo(closeGroups(closed, keep));
                    }}
                    onCloseSide={(tab) => {
                      offerUndo(closeSideOf(tab));
                    }}
                    onDuplicate={(entry) => {
                      groups.duplicate(entry);
                    }}
                    onNew={(projectId) => {
                      groups.make(projectId === undefined ? {} : { projectId });
                    }}
                    onNewChatProject={(chatId, name) => {
                      setNewProject({ chatId, ...(name ? { name } : {}) });
                    }}
                    onNewProject={() => {
                      setNewProject({});
                    }}
                    onPin={(group, pinned) => {
                      groups.pin(group, pinned);
                    }}
                    onReopenLast={reopenTab}
                    onShow={(group, { newWindow }) => {
                      if (newWindow) {
                        groups.moveToNewWindow(group, groupList.open);
                      } else {
                        groups.show(group);
                      }
                    }}
                    open={groupList.open}
                    projects={projects}
                  />
                </ShellContext>
              </StudioSidebarRail>
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
              <CommandMenu
                openPage={(url) => {
                  openPage(url);
                }}
                openScreen={openScreen}
              />
            </ShellContext>
            <DragLayer
              chatTitles={chatTitles}
              entries={[...groupList.open, ...groupList.elsewhere]}
            />
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
