import {
  chatGroupAtom,
  CHATS_HREF,
  type Draft,
  draftGroupOf,
  draftsAtom,
  findersByTabAtom,
  inboxOpenAtom,
  pageSlotsAtom,
  paneOpenByGroupAtom,
  screenViewsAtom,
} from "@/client/atoms/window";
import { AppErrorFallback } from "@/client/components/app-error-fallback";
import { FileOpenContext } from "@/client/components/file-open-context";
import { NavControls } from "@/client/components/nav-controls";
import { OnboardingZoomRoot } from "@/client/components/onboarding/zoom-root";
import { PageOpenContext } from "@/client/components/page-open-context";
import { ThemeProvider } from "@/client/components/theme-provider";
import { Spinner } from "@/client/components/ui/spinner";
import { TooltipProvider } from "@/client/components/ui/tooltip";
import { WindowBorder } from "@/client/components/window-border";
import {
  ActiveTabProvider,
  TabIdProvider,
} from "@/client/hooks/use-active-tab";
import { useDefaultModelURI } from "@/client/hooks/use-default-model-uri";
import { useGroupTabRouters } from "@/client/hooks/use-group-tab-routers";
import { PortalContainerProvider } from "@/client/hooks/use-portal-container";
import { useRefreshSkillsOnChange } from "@/client/hooks/use-refresh-skills-on-change";
import { useTabRouters } from "@/client/hooks/use-tab-routers";
import { getGuest } from "@/client/lib/browser-pool";
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
import { type Tab, type TabId } from "@/shared/tabs";
import {
  type ChatId,
  encodeBrowserTargetId,
  StoreId,
  WINDOW_ID,
} from "@instrument-org/workspace/client";
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
  useRouterState,
} from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AppRail } from "./app-rail";
import { AppTabStrip } from "./app-tab-strip";
import {
  appTabsAtom,
  groupOfHref,
  hrefOfAppTab,
  INBOX_HREF,
  isChatHref,
  isSiteGroup,
  newSiteGroup,
  pageHrefOf,
  placeOfHref,
  putAwaySitesAtom,
  useAppTabs,
} from "./app-tabs";
import { useAppsBySlug } from "./apps-by-slug";
import {
  BrowserTabs,
  type BrowserTabsHandle,
  type ComposeHost,
} from "./browser-tabs";
import { chatListOptions } from "./chat-list-query";
import { ChatPane } from "./chat-pane";
import { ComposeLayer } from "./compose-layer";
import { type WindowContextValue as Screens, WindowContext } from "./context";
import { useSignInLanding } from "./use-sign-in-landing";
import { InboxPeek } from "./inbox-peek";
import { inboxLandsAtOnceAtom } from "./inbox-room";
import { WindowLook } from "./look-panel";
import { NewTopicDialog } from "./new-topic-dialog";
import { contextReaders } from "./send-context";
import {
  pageSlotByTabAtom,
  type WindowShell as Shell,
  ShellContext,
} from "./shell-context";
import { useStagedAskActions } from "./staged-asks";
import { useTaskTitles } from "./task-titles";
import { useCompose } from "./use-compose";
import { useDrafts } from "./use-drafts";
import { useInboxPeek } from "./use-inbox-peek";
import { useOpeners } from "./use-openers";
import { CommandMenu } from "./command-menu";
import { usePageThumbnailHousekeeping } from "./use-page-thumbnail-housekeeping";
import { useWindowSteps } from "./use-tab-steps";
import { useSetChatTopics } from "./use-set-chat-topics";
import { backfillCandidates } from "./use-topic-backfill";
import { useWindowCommands } from "./use-window-commands";
import { WindowBar, WindowCorner } from "./window-bar";
import { WindowFrame } from "./window-frame";
import { chatOfGroup, chatOfHref } from "./window-href";
import { useWindowTabs } from "./window-tabs";

// Resolve the computer file channel once at boot so file URLs derive locally
// from a host path; not awaited, so it never holds up the first render.
void resolveComputerFileBase();

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
 */
export function AppWindow() {
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
  useRefreshSkillsOnChange();
  // Where the tab up stands, read off its own router, which the context above
  // is: the rail lights its place and the group on screen follows it.
  const activeHref = useRouterState({
    select: (routerState) => routerState.location.href,
  });
  const ensure = useQuery(
    rpcClient.workspace.window.ensure.queryOptions({
      // What the window opens on is made once, and the folders it reaches
      // stay put for as long as it is open.
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
  const opened = ensure.data;
  const childTitles = useTaskTitles();
  const chats = useQuery(chatListOptions());
  const chatTitles = new Map<ChatId, string>(
    chats.data?.map((chat) => [chat.id, chat.title]) ?? [],
  );
  const [defaultModelURI, setDefaultModelURI, saveDefaultModelURI] =
    useDefaultModelURI();
  const [drafts, setDrafts] = useAtom(draftsAtom);
  const setChatGroup = useSetAtom(chatGroupAtom);
  const [isInboxOpen, setInboxOpen] = useAtom(inboxOpenAtom);
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
  const place = placeOfHref(activeHref);
  const isChat = isChatHref(activeHref);

  // The chat a tab last had open is where Chat in the rail takes a tab.
  useEffect(() => {
    if (!isChat) {
      return;
    }
    setChatGroup(chatOfHref(activeHref) ?? null);
  }, [activeHref, isChat, setChatGroup]);

  const compose = useCompose(rowWidth);
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
    // What drafts kept on disk goes with them, including any whose clear
    // never ran.
    void rpcClient.drafts.prune
      .call({ keep: drafts.filter(isKept).map((draft) => draft.id) })
      .catch(() => undefined);
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

  // A site opened at the window's level lives for as long as an open tab
  // can come back to it, by its history as its router holds it now. Past
  // that its page goes, guest and all, so a closed tab's video stops; its
  // record is put aside for as long as Shift+Cmd+T can reopen the tab, which
  // brings the page back at its address.
  const setPutAway = useSetAtom(putAwaySitesAtom);
  const siteGroups = [
    ...new Set(
      windowTabs.allTabs.flatMap((tab) =>
        tab.group !== undefined && isSiteGroup(tab.group) ? [tab.group] : [],
      ),
    ),
  ].join("\n");
  useEffect(() => {
    const groupsOf = (hrefs: string[]) =>
      hrefs.flatMap((href) => {
        const group = groupOfHref(href);
        return group !== undefined && isSiteGroup(group) ? [group] : [];
      });
    const open = new Set(
      appTabs.model.tabs.flatMap((tab) => {
        const router = routers.get(tab.id);
        return groupsOf([
          ...(router
            ? getRouterHistory(router).entries
            : (tab.history?.entries ?? [])),
          tab.pathname,
        ]);
      }),
    );
    const reopenable = new Set(
      appTabs.model.recentlyClosed.flatMap((tab) =>
        groupsOf([...(tab.history?.entries ?? []), tab.pathname]),
      ),
    );
    const leaving = siteGroups
      .split("\n")
      .filter((group) => group && !open.has(group));
    setPutAway((current) => {
      const next: typeof current = {};
      // Kept while a closed tab can bring it back, or while an open one is
      // on its way to (the site's view takes it back itself).
      for (const [group, stashed] of Object.entries(current)) {
        if (reopenable.has(group) || open.has(group)) {
          next[group] = stashed;
        }
      }
      for (const group of leaving) {
        if (reopenable.has(group)) {
          next[group] = windowTabs.allTabs.filter((tab) => tab.group === group);
        }
      }
      return next;
    });
    for (const group of leaving) {
      windowTabs.dropGroup(group);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // The pages screens draw into slots of their own (a page's file beside a
  // file tab's tree), shown while the screen that made the slot is up.
  const pageSlots = useAtomValue(pageSlotsAtom);
  const slotHosts: ComposeHost[] = Object.entries(pageSlots).flatMap(
    ([group, { insideOverlay, into, isShown = true, layer }]) =>
      into
        ? [
            {
              chrome: false,
              group,
              into,
              isActive: isShown,
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
  const pageSlot =
    useAtomValue(pageSlotByTabAtom)[appTabs.model.selectedId ?? ""] ?? null;
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
   * Takes a chat out of the corner: the window goes and the chat comes
   * up in the tab on screen, whole, its pane as it was.
   */
  const landChat = (chatId: ChatId) => {
    compose.remove(chatId);
    appTabs.navigate(`${CHATS_HREF}/${chatId}`);
  };

  const { openNamedPath, openPage, openScreen } = useOpeners({
    appTabs,
    browser,
    chats: chats.data,
    chatTitles,
    isOpen: opened !== undefined,
    revealPane,
    setPaneOpen,
    windowTabs,
  });

  const appsBySlug = useAppsBySlug();
  // What a new tab shows, asked for as the window comes up rather than as the
  // tab mounts, so the page lays out from the cache instead of growing a
  // section at a time as each answer lands.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!opened) {
      return;
    }
    void queryClient.prefetchQuery(
      rpcClient.workspace.computer.recents.queryOptions(),
    );
    void queryClient.prefetchQuery(
      rpcClient.workspace.computer.places.queryOptions(),
    );
  }, [opened, queryClient]);

  const requestClose = (id: string) => {
    // Any group's: a popped-out chat's rail closes its tabs here too.
    windowTabs.close(id);
  };

  usePageThumbnailHousekeeping();
  useSignInLanding(openScreen);

  const topicsQuery = useQuery(rpcClient.workspace.topics.list.queryOptions());
  const topics = topicsQuery.data ?? [];
  const createTopic = useMutation(
    rpcClient.workspace.topics.create.mutationOptions({
      onSuccess: () => void topicsQuery.refetch(),
    }),
  );
  const setChatTopics = useSetChatTopics();
  // The new-topic dialog, asked for from a chat's head or a draft's, with
  // what was typed in the picker: the topic it makes files that chat or
  // that draft.
  const [newTopic, setNewTopic] = useState<{
    /** The chat it files, when that is not the one the tab up has open: a popped-out chat's. */
    chatId?: ChatId;
    draftId?: string;
    name?: string;
  }>();
  const chatUp = chatOfHref(activeHref);
  // The inbox is on screen in Chat unless it was put away beside a chat;
  // anywhere else, Chat in the rail peeks it out.
  const inboxPeek = useInboxPeek({
    canPeek: !isChat || (chatUp !== undefined && !isInboxOpen),
  });

  // What the tab in view says it shows: a chat's or a site's tab up while
  // its pane is open, or the screen the window's tab is at.
  const screenViews = useAtomValue(screenViewsAtom);
  const groupUp = windowTabs.active;
  const groupInView = windowTabs.groupOnScreen;
  const screenView =
    groupInView === undefined
      ? (screenViews[appTabs.model.selectedId ?? ""] ?? null)
      : groupUp?.kind === "screen" &&
          (chatOfGroup(groupInView) === undefined ||
            (paneOpenByGroup[groupInView] ?? true))
        ? (screenViews[groupUp.id] ?? null)
        : null;
  // What goes with a message, read at the moment of sending.
  const finders = useAtomValue(findersByTabAtom);
  const { draftContext, sendContext } = contextReaders({
    appsBySlug,
    appTabId: appTabs.model.selectedId,
    browser,
    chatTitles,
    drafts,
    finders,
    href: activeHref,
    hrefOfAppTab: (id) =>
      id === appTabs.model.selectedId
        ? activeHref
        : hrefOfAppTab(appTabs.model, id),
    paneOpenByGroup,
    screenView,
    state: opened,
    viewsById: compose.viewsById,
    windowTabs,
  });
  sendContextRef.current = sendContext;
  const {
    arrivedId,
    closeDraft,
    discardDraft,
    discardingIds,
    newDraft,
    sentWords,
    showDraft,
    startChat,
    startingIds,
  } = useDrafts({
    activeHref,
    folders: opened?.folders ?? {},
    compose,
    draftContext,
    isOpen: opened !== undefined,
    isChat,
    openChat: (chatId) => {
      appTabs.navigate(`${CHATS_HREF}/${chatId}`);
    },
    openDrafts: () => {
      setInboxOpen(true);
      if (place !== "chat") {
        appTabs.goToPlace("chat");
      }
    },
    saveDefaultModelURI,
    topics,
    windowTabs,
  });
  // The inbox's rows as the tab up lists them, for stepping through them by
  // chord.
  const listedChats = useRef<ChatId[]>([]);
  useWindowCommands(
    {
      back: () => {
        windowSteps.go("back");
      },
      closeTab: () => {
        if (appTabs.model.selectedId) {
          appTabs.close(appTabs.model.selectedId);
        }
      },
      forward: () => {
        windowSteps.go("forward");
      },
      newChat: newDraft,
      newTab: appTabs.openNewTab,
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
          setInboxOpen((isOpen) => !isOpen || chatUp === undefined);
        }
      },
      // The next or previous row of the inbox from the chat up; from no
      // chat, the list's first or last.
      selectChat: (direction) => {
        const listed = listedChats.current;
        const at = chatUp === undefined ? -1 : listed.indexOf(chatUp);
        const next =
          at === -1
            ? direction === 1
              ? listed[0]
              : listed.at(-1)
            : listed[at + direction];
        if (next !== undefined) {
          openScreen(`${CHATS_HREF}/${next}`);
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
      getGuest(
        encodeBrowserTargetId(WINDOW_ID, StoreId.SessionSchema.parse(page.id)),
      )?.reload();
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
    discardDraft,
    // Only a draft with words is a draft to come back to; one being written
    // with none yet is its window's alone, one being sent is already its
    // chat, and one just discarded is gone unless its Undo brings it back.
    chats: chats.data,
    chatTitles,
    drafts: drafts.filter(
      (draft) =>
        hasWords(draft) &&
        !startingIds.has(draft.id) &&
        !discardingIds.has(draft.id),
    ),
    newDraft: () => {
      newDraft();
    },
    onListed: (listed) => {
      listedChats.current = listed;
    },
    onNewTopic: (name) => {
      setNewTopic(name ? { name } : {});
    },
    requestClose,
    rowWidth,
    sendContext: (options) => sendContextRef.current(options),
    sentWords,
    setChatTopics,
    setPaneOpen,
    showDraft,
    topics,
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
                    chatTitles={chatTitles}
                    childTitles={childTitles}
                    onClose={appTabs.close}
                    onCloseOthers={appTabs.closeOthers}
                    onCloseToRight={appTabs.closeToRight}
                    onDuplicate={duplicateAppTab}
                    onNew={appTabs.openNewTab}
                    onReload={reloadablePageOf}
                    onReorder={appTabs.reorder}
                    onSelect={appTabs.select}
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
                chats={chats.data ?? []}
                compose={compose}
                drafts={drafts}
                modelURI={defaultModelURI}
                onChangeDraft={(id, update) => {
                  setDrafts((current) =>
                    current.map((entry) => {
                      if (entry.id !== id) {
                        return entry;
                      }
                      const next = update(entry);
                      return next === entry
                        ? entry
                        : { ...next, updatedAt: Date.now() };
                    }),
                  );
                }}
                onCloseChat={(chatId) => {
                  compose.remove(chatId);
                }}
                onCloseDraft={closeDraft}
                onDiscardDraft={discardDraft}
                onCloseTab={requestClose}
                onModelChange={setDefaultModelURI}
                onNewChatTopic={(chatId, name) => {
                  setNewTopic({ chatId, ...(name ? { name } : {}) });
                }}
                onNewTopic={(draftId, name) => {
                  setNewTopic({ draftId, ...(name ? { name } : {}) });
                }}
                onOpenChat={landChat}
                onSetChatTopics={setChatTopics}
                onStart={startChat}
                openOutside={(href) => {
                  appTabs.open(href);
                }}
                sendContext={(options) => sendContextRef.current(options)}
                sentWords={sentWords}
                topics={topics}
              />
            }
            rail={
              <AppRail
                onChoose={(next, { newTab }) => {
                  // Chat asked for is the inbox asked for too, even where the
                  // row is narrow enough that it stepped aside. Peeked out
                  // already, the list stays where it is drawn rather than
                  // sliding in again under it.
                  if (next === "chat") {
                    if (inboxPeek.isOpen) {
                      setInboxLandsAtOnce(true);
                    }
                    setInboxOpen(true);
                  }
                  if (next === place && !newTab) {
                    return;
                  }
                  // A place asked for in a tab of its own waits behind, the
                  // way a bookmark middle-clicked in a browser does.
                  appTabs.goToPlace(next, { behind: newTab, newTab });
                }}
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
                      openScreen(`${CHATS_HREF}/${entry.id}`);
                    } else {
                      compose.float(entry.id);
                    }
                  }}
                  onOpenDraft={(id) => {
                    inboxPeek.close();
                    showDraft(id);
                  }}
                  openChatId={chatUp}
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
                  compose={[...compose.hosts, ...slotHosts]}
                  fieldInto={pageSlot?.chrome?.fieldInto ?? null}
                  ref={setBrowser}
                  reloadInto={pageSlot?.chrome?.reloadInto ?? null}
                />
              </ActiveTabProvider>,
              stage,
            )}
            {/* Asked for from a chat's head or a draft's, so the topic it
              makes is filed on that chat or draft as it lands. */}
            <NewTopicDialog
              candidates={backfillCandidates(
                (chats.data ?? []).filter(
                  (chat) => chat.id !== (newTopic?.chatId ?? chatUp),
                ),
              )}
              {...(newTopic?.name ? { name: newTopic.name } : {})}
              onCreate={(topic, alsoFile) => {
                const forDraft = newTopic?.draftId;
                const filedOn =
                  forDraft === undefined
                    ? chats.data?.find(
                        (chat) => chat.id === (newTopic?.chatId ?? chatUp),
                      )
                    : undefined;
                createTopic.mutate(topic, {
                  onSuccess: (created) => {
                    for (const id of alsoFile) {
                      setChatTopics(id, [created.id]);
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
                      setChatTopics(filedOn.id, [
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
    </WindowContext>
  );
}
