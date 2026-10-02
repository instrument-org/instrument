import {
  TASK_CHAT_WIDTH_MIN,
  TASK_PANE_WIDTH_MIN,
} from "@/client/atoms/task-pane";
import {
  BROWSER_HREF,
  CHATS_HREF,
  inboxOpenAtom,
  inboxWidthAtom,
  paneOpenByGroupAtom,
  type ScreenView,
  screenViewAtom,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  windowTabsAtom,
} from "@/client/atoms/window";
import { FileOpenContext } from "@/client/components/file-open-context";
import { PageOpenContext } from "@/client/components/page-open-context";
import {
  type RailBounds,
  StudioSidebarRail,
} from "@/client/components/studio-sidebar-rail";
import {
  groupOfHref,
  INBOX_HREF,
  isChatHref,
  isSiteHref,
  putAwaySitesAtom,
} from "@/client/components/window/app-tabs";
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { type PageChromeSlots } from "@/client/components/window/browser-tabs";
import { ChatHeader } from "@/client/components/window/chat-header";
import { ChatPane } from "@/client/components/window/chat-pane";
import { ChatRail } from "@/client/components/window/chat-rail";
import { ChatScreen } from "@/client/components/window/chat-screen";
import { GroupItem } from "@/client/components/window/compose-window";
import { useWindow, WindowContext } from "@/client/components/window/context";
import { computerTabOf } from "@/client/components/window/file-tabs";
import { useInboxRoom } from "@/client/components/window/inbox-room";
import { InboxToggle } from "@/client/components/window/inbox-toggle";
import { NoChatOpen } from "@/client/components/window/no-chat-open";
import { RightPane } from "@/client/components/window/right-pane";
import { screenLocation } from "@/client/components/window/screen-presentation";
import { useShell } from "@/client/components/window/shell-context";
import { tasksHref } from "@/client/components/window/tab-location";
import { TabLocationRow } from "@/client/components/window/tab-location-row";
import {
  chatOfHref,
  useWindowTabs,
} from "@/client/components/window/window-tabs";
import { useIsActiveTab } from "@/client/hooks/use-active-tab";
import { cn } from "@/client/lib/utils";
import { instrumentFolderHref } from "@/shared/computer-href";
import {
  encodeBrowserTargetId,
  StoreId,
} from "@instrument-org/workspace/client";
import {
  createFileRoute,
  Outlet,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { type ReactNode, useEffect, useState } from "react";

/** Dragged narrower than this, the inbox column slides shut rather than stopping at its floor. */
const INBOX_COLLAPSE_THRESHOLD = 240;
/** The least the conversation and its pane keep beside the inbox while the inbox is dragged wider. */
const MAIN_WIDTH_MIN = 560;
/** The rail's width with its pictures, `w-30`, and folded to its marks, `w-14`. */
const RAIL_WIDTH = 120;
const RAIL_COMPACT_WIDTH = 56;
/**
 * How much room past the floors of the conversation and the pane the rail
 * keeps its pictures for: with less, it folds to its marks before either is
 * squeezed to its floor.
 */
const RAIL_FOLD_SLACK = 126;

/**
 * How much more room than it needs a row must have before what gave way for
 * it comes back, so a window held near the edge does not flicker between the
 * two.
 */
const ROOM_MARGIN = 48;

export const Route = createFileRoute("/_app")({
  component: TabContent,
});

/**
 * The column the inbox stands in: a resizable rail that stops at its widest,
 * with a chat or the empty side beside it, and slides shut when dragged under
 * its floor or put away by the chat's toggle.
 */
function ChatColumn({
  bounds,
  children,
  isAtOnce,
  isOpen,
  onCollapse,
}: {
  bounds: RailBounds;
  children: ReactNode;
  /** Whether it comes and goes at once, for a change the row's width made. */
  isAtOnce: boolean;
  isOpen: boolean;
  onCollapse: () => void;
}) {
  return (
    <StudioSidebarRail
      bounds={bounds}
      isAtOnce={isAtOnce}
      isOpen={isOpen}
      label="Resize the inbox"
      onCollapse={onCollapse}
      panelClassName="bg-background"
      widthAtom={inboxWidthAtom}
    >
      {children}
    </StudioSidebarRail>
  );
}

/**
 * The chat: the inbox down the left, and beside it the chat this tab has
 * open, its transcript and composer, the thing it has up drawn large, and
 * what it holds down its right edge. Choosing another chat in the inbox
 * moves this tab there, one step on in its history.
 */
function ChatView({ chat }: { chat: StoreId.Session | undefined }) {
  const shell = useShell();
  const appWindow = useWindow();
  const { appTabs, chats, chatTitles, rowWidth, setPaneOpen } = shell;
  const windowTabs = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const [isInboxOpen, setInboxOpen] = useAtom(inboxOpenAtom);
  const sidebarWidth = useAtomValue(inboxWidthAtom);
  const paneOpenByGroup = useAtomValue(paneOpenByGroupAtom);
  const isActive = useIsActiveTab();
  const showsRightArea = chat !== undefined;
  const bounds = inboxBounds(rowWidth, { canCollapse: showsRightArea });

  // The chat's tabs, and the one it has up.
  const tabs =
    chat === undefined
      ? []
      : windowTabs.allTabs.filter((tab) => tab.group === chat);
  const up = windowTabs.tabUpIn(chat);
  const isPaneWanted = chat === undefined || (paneOpenByGroup[chat] ?? true);
  const showsPane = up !== undefined && isPaneWanted;
  // Drawn only once there is something in it.
  const showsRail = chat !== undefined && tabs.length > 0;

  // What gives way as the window narrows, one thing at a time and in one
  // order: the pane gives up width, then the rail folds to its marks while
  // the pane and the conversation still have some room past their floors,
  // then both go down to those floors, and only then does the inbox step
  // aside. Widening brings them back in the other order, each a margin past
  // the width it left at.
  const floors = TASK_CHAT_WIDTH_MIN + (showsPane ? TASK_PANE_WIDTH_MIN : 0);
  const needs = floors + (showsRail ? RAIL_COMPACT_WIDTH : 0);
  const { isCrossing, isShown, isSteppedAside } = useInboxRoom({
    isActive,
    margin: ROOM_MARGIN,
    needs,
    room: showsRightArea && rowWidth > 0 ? rowWidth - sidebarWidth : undefined,
  });
  // The rail folds on the room beside the inbox, counting an inbox that
  // stepped aside as still there: the room it leaves is the conversation's,
  // and a rail that unfolded into it would fold again as the window went on
  // narrowing, each change setting off the next.
  const beside =
    rowWidth -
    ((isInboxOpen || isSteppedAside) && showsRightArea ? sidebarWidth : 0);
  const [isRailCompact, setRailCompact] = useState(false);
  const railFolds =
    showsRail &&
    rowWidth > 0 &&
    beside <
      floors + RAIL_WIDTH + RAIL_FOLD_SLACK + (isRailCompact ? ROOM_MARGIN : 0);
  useEffect(() => {
    setRailCompact(railFolds);
  }, [railFolds]);

  /** Puts the chat away: the inbox is shown again if it was hidden, with the empty side beside it. */
  const leaveChat = () => {
    appTabs.navigate(INBOX_HREF);
    setInboxOpen(true);
  };

  const isFloating = shell.compose.entries.some(
    (entry) => entry.kind === "chat" && entry.sessionId === chat,
  );
  const [pageHost, setPageHost] = useState<HTMLDivElement | null>(null);
  const [pageChrome, setPageChrome] = useState<PageChromeSlots>();
  usePageSlot(
    showsPane && up.kind === "page" ? pageHost : null,
    pageChrome,
    showsPane && up.kind === "page",
  );
  const reportView = useScreenViewOfTab();

  const chatRecord = chats?.find((entry) => entry.id === chat);

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ChatColumn
        bounds={bounds}
        isAtOnce={isCrossing}
        // With no chat open there is no toggle to bring it back by, so it
        // stays.
        isOpen={isShown || !showsRightArea}
        onCollapse={() => {
          setInboxOpen(false);
        }}
      >
        {/* `select-text`: the window's shell is chrome and turns selection off; the chat is text. */}
        <div className="flex min-h-0 w-full flex-1 flex-col select-text [&_.prose]:text-[13px] [&_.prose]:leading-5 [&_.text-sm]:text-[13px]">
          {/* A plain click on a row opens in this tab, and a middle or
            modified click asks for a tab of its own. */}
          <ChatPane
            arrivedId={shell.arrivedId}
            drafts={shell.drafts}
            onDeleteDraft={shell.deleteDraft}
            onListed={isActive ? shell.onListed : undefined}
            onOpenChat={(entry) => {
              appWindow.openScreen(`${CHATS_HREF}/${entry.id}`);
            }}
            onOpenDraft={shell.showDraft}
            openChatId={chat}
          />
        </div>
      </ChatColumn>
      {chat === undefined && <NoChatOpen onNew={shell.newDraft} />}
      {chat !== undefined && (
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <div className="relative min-w-0 flex-1">
              <RightPane
                conversation={
                  <div className="relative flex h-full min-h-0 flex-col">
                    <div className="absolute inset-0 flex flex-col">
                      <ChatHeader
                        chat={chatRecord}
                        // Ahead of the title, the inbox column put away or
                        // brought back, so the chat and its tabs can have
                        // the window.
                        leading={<InboxToggle isCollapsible={showsRightArea} />}
                        onDeleted={() => {
                          // The chat and the tabs it had are gone; the inbox
                          // takes the tab back.
                          windowTabs.forgetGroup(chat);
                          appTabs.navigate(INBOX_HREF, { replace: true });
                          setInboxOpen(true);
                        }}
                        onNewTopic={shell.onNewTopic}
                        onSetTopics={(next) => {
                          shell.setChatTopics(chat, next);
                        }}
                        onViewTasks={() => {
                          appWindow.openScreen(tasksHref(chat), {
                            ownTab: true,
                          });
                        }}
                        popOut={{
                          isOut: isFloating,
                          // Popped out, the chat stays listed and is simply
                          // no longer the one this tab has open.
                          onToggle: () => {
                            if (isFloating) {
                              shell.compose.remove(chat);
                            } else {
                              shell.compose.float(chat);
                              leaveChat();
                            }
                          },
                        }}
                        topics={shell.topics}
                      />
                      <div className="relative min-h-0 flex-1">
                        <div className="absolute inset-0">
                          <ChatScreen
                            isUp={isActive}
                            key={chat}
                            onGone={() => {
                              // As for a deleted chat: its tabs go, and the
                              // inbox takes the tab back.
                              windowTabs.forgetGroup(chat);
                              appTabs.navigate(INBOX_HREF, { replace: true });
                              setInboxOpen(true);
                            }}
                            sendContext={() =>
                              shell.sendContext({
                                isViewOpen: showsPane,
                                sessionId: chat,
                              })
                            }
                            sentPrompt={shell.sentWords.get(chat)}
                            sessionId={chat}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                }
                fills={false}
                isOpen={showsPane}
                onCollapse={() => {
                  setPaneOpen(chat, false);
                }}
                paneKey={chat}
              >
                <div
                  className={cn(
                    "flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-border",
                    // A page's bottom corners follow what they meet: square
                    // against the conversation at the left and against the
                    // rail at the right, round only where the pane reaches
                    // the card's own corner.
                    showsRail
                      ? "[--guest-bottom-radius:0] [--pane-bottom-right-radius:0]"
                      : "[--guest-bottom-radius:0_var(--radius-2xl)]",
                  )}
                >
                  {up && (
                    <GroupItem
                      closeTab={shell.requestClose}
                      group={chat}
                      isFramed={false}
                      // Puts the view away; what it showed stays on the
                      // rail, whose tiles are where a tab is closed.
                      onClose={() => {
                        setPaneOpen(chat, false);
                      }}
                      onPageChrome={setPageChrome}
                      onPageHost={setPageHost}
                      onScreenView={reportView}
                      outside={{
                        label: "Open in a tab",
                        note: "Opens in a tab of its own.",
                        onOpen: (tab) => {
                          appTabs.open(tab.href);
                        },
                      }}
                      up={up}
                    />
                  )}
                </div>
              </RightPane>
            </div>
            {showsRail && (
              <ChatRail
                activeId={up?.id}
                appsBySlug={appsBySlug}
                chatTitles={chatTitles}
                isChatWorking={chatRecord?.state === "working"}
                isCompact={railFolds}
                isViewOpen={showsPane}
                onAddComputer={() => {
                  windowTabs.openScreen(instrumentFolderHref(), {
                    activate: true,
                    group: chat,
                  });
                  setPaneOpen(chat, true);
                }}
                onAddWeb={() => {
                  windowTabs.openScreen(BROWSER_HREF, {
                    activate: true,
                    group: chat,
                  });
                  setPaneOpen(chat, true);
                }}
                onClose={shell.requestClose}
                onReorder={(keys) => {
                  windowTabs.reorder(keys, chat);
                }}
                onSelect={(id) => {
                  windowTabs.selectIn(chat, id);
                  setPaneOpen(chat, true);
                }}
                tabs={tabs}
                targetOf={(tab) =>
                  encodeBrowserTargetId(
                    tab.taskId ?? shell.ids.taskId,
                    StoreId.SessionSchema.parse(tab.id),
                  )
                }
                taskTitles={shell.childTitles}
              />
            )}
          </div>
        </main>
      )}
    </div>
  );
}

/**
 * How wide the inbox column may be: the row less what the conversation
 * keeps, within the column's own floor and ceiling. It slides shut under its
 * floor only while a chat is open, since that chat's head holds the toggle
 * that brings it back.
 */
function inboxBounds(
  rowWidth: number,
  { canCollapse }: { canCollapse: boolean },
): RailBounds {
  return {
    ...(canCollapse ? { collapse: INBOX_COLLAPSE_THRESHOLD } : {}),
    initial: SIDEBAR_WIDTH_MIN,
    max: Math.min(
      SIDEBAR_WIDTH_MAX,
      Math.max(SIDEBAR_WIDTH_MIN, rowWidth - MAIN_WIDTH_MIN),
    ),
    min: SIDEBAR_WIDTH_MIN,
  };
}

/**
 * A screen that is its own route (the Finder, a file, the apps, an app,
 * Discover, a skill), under the row that says where it stands. Its steps are
 * the tab's history, walked by the arrows in the window's bar.
 */
function RouteScreen({ href }: { href: string }) {
  const appWindow = useWindow();
  const shell = useShell();
  const appsBySlug = useAppsBySlug();
  const screenView = useAtomValue(screenViewAtom);
  usePageSlot(null, undefined, false);
  // The row's head and tail, where a file's viewer puts a toggle for its
  // panel and its actions.
  const [rowLead, setRowLead] = useState<HTMLElement | null>(null);
  const [rowTail, setRowTail] = useState<HTMLElement | null>(null);
  const computerTab = computerTabOf(href);
  const isFileScreen = computerTab?.file !== undefined;
  const fromHref = screenLocation(href, {
    appsBySlug,
    chatTitles: shell.chatTitles,
    taskTitles: shell.childTitles,
  });
  const location =
    fromHref.kind === "folder" && screenView?.folder
      ? { ...fromHref, path: screenView.folder.display }
      : fromHref;
  // The catalogs (the apps and Discover's ideas) are places you arrive at
  // from the rail, with nothing above them to walk back up to and nothing to
  // type an address for: a row there would only offer to leave for the web.
  const hasLocationRow = location.kind !== "apps" && location.kind !== "ideas";
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {hasLocationRow && (
        <TabLocationRow
          // A folder's Finder puts the toggle for its sidebar at the head of
          // the row, where a file puts the toggle for its tree.
          {...(computerTab
            ? {
                leading: (
                  <div
                    className="flex shrink-0 items-center empty:hidden"
                    ref={setRowLead}
                  />
                ),
              }
            : {})}
          {...(isFileScreen
            ? {
                trailing: (
                  <div
                    className="flex shrink-0 items-center gap-0.5"
                    ref={setRowTail}
                  />
                ),
              }
            : {})}
          location={location}
        />
      )}
      <WindowContext value={{ ...appWindow, rowLead, rowTail }}>
        <FileOpenContext
          value={(path, options) => {
            appWindow.openPath(path, options);
          }}
        >
          <PageOpenContext
            value={(url, options) => {
              appWindow.openPage(url, options);
            }}
          >
            <div className="relative min-h-0 flex-1">
              <Outlet />
            </div>
          </PageOpenContext>
        </FileOpenContext>
      </WindowContext>
    </div>
  );
}

/**
 * A site opened at the window's own level: the page its group has up, under
 * the address row a chat's page wears. The window's own arrows walk the
 * page's history, then the tab's, so the row leaves its arrows to them.
 */
function SiteView({ group }: { group: string }) {
  const shell = useShell();
  const windowTabs = useWindowTabs();
  const up = windowTabs.tabUpIn(group);
  const [pageHost, setPageHost] = useState<HTMLDivElement | null>(null);
  const [pageChrome, setPageChrome] = useState<PageChromeSlots>();
  usePageSlot(up?.kind === "page" ? pageHost : null, pageChrome, true);
  const reportView = useScreenViewOfTab();
  // A tab reopened after its page was put away brings the page back, at
  // the address it had.
  const [putAway, setPutAway] = useAtom(putAwaySitesAtom);
  const setWindowTabs = useSetAtom(windowTabsAtom);
  const stashed = up === undefined ? putAway[group] : undefined;
  useEffect(() => {
    if (!stashed) {
      return;
    }
    setWindowTabs((current) => ({
      ...current,
      // Up at once when its group is the one on screen, which it is, being
      // this tab's.
      activeId:
        current.group === group
          ? (stashed[0]?.id ?? current.activeId)
          : current.activeId,
      tabs: [...current.tabs.filter((tab) => tab.group !== group), ...stashed],
    }));
    setPutAway((current) => {
      const { [group]: _restored, ...rest } = current;
      return rest;
    });
  }, [group, setPutAway, setWindowTabs, stashed]);
  // Back from the page's start is the window tab's own back, to where the
  // site was opened from.
  const router = useRouter();
  if (!up) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {stashed ? null : "This page is closed."}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <GroupItem
        before={{
          back: () => {
            router.history.back();
          },
          canGoBack: router.history.canGoBack(),
        }}
        closeTab={shell.requestClose}
        group={group}
        isFramed={false}
        onPageChrome={setPageChrome}
        onPageHost={setPageHost}
        onScreenView={reportView}
        outside={{
          label: "Open in a tab",
          note: "Opens in a tab of its own.",
          onOpen: (tab) => {
            shell.appTabs.open(tab.href);
          },
        }}
        up={up}
      />
    </div>
  );
}

/**
 * One of the window's tabs, as its address has it: the chat, a site opened
 * at the window's level, or a screen that is its own route under the row
 * that says where it stands. The window around the tabs is drawn once, by
 * the window, whatever tab is up.
 */
function TabContent() {
  const href = useRouterState({
    select: (routerState) => routerState.location.href,
  });
  if (isChatHref(href)) {
    return <ChatView chat={chatOfHref(href)} />;
  }
  const group = groupOfHref(href);
  if (isSiteHref(href) && group !== undefined) {
    return <SiteView group={group} />;
  }
  return <RouteScreen href={href} />;
}

/**
 * Where this tab wants the window's page drawn, told to the window while the
 * tab is the one up: a tab behind leaves the page to the tab in front.
 */
function usePageSlot(
  host: HTMLElement | null,
  chrome: PageChromeSlots | undefined,
  isShown: boolean,
) {
  const { reportPageSlot } = useShell();
  const isActive = useIsActiveTab();
  useEffect(() => {
    if (!isActive) {
      return;
    }
    reportPageSlot(host ? { chrome, host, isShown } : null);
  }, [chrome, host, isActive, isShown, reportPageSlot]);
}

/**
 * What a screen in this tab has up, told to the window while the tab is the
 * one up, for what goes with a message.
 */
function useScreenViewOfTab() {
  const isActive = useIsActiveTab();
  const setScreenView = useSetAtom(screenViewAtom);
  const [view, setView] = useState<null | ScreenView>(null);
  useEffect(() => {
    if (!isActive) {
      return;
    }
    setScreenView(view);
    // Only its own answer is cleared, so the next tab's is not cleared with it.
    return () => {
      setScreenView((current) => (current === view ? null : current));
    };
  }, [isActive, setScreenView, view]);
  return setView;
}
