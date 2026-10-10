import {
  CONVERSATION_WIDTH_MIN,
  PANE_WIDTH_MIN,
} from "@/client/atoms/right-pane";
import {
  BROWSER_HREF,
  CHATS_HREF,
  inboxOpenAtom,
  inboxWidthAtom,
  NEW_TAB_HREF,
  paneOpenByGroupAtom,
  screenViewsAtom,
  walkedFoldersAtom,
  chatsOutOf,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
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
import { ChatScreen } from "@/client/components/window/chat-screen";
import { ChatTiles } from "@/client/components/window/chat-tiles";
import { GroupItem } from "@/client/components/window/group-item";
import { useWindow, WindowContext } from "@/client/components/window/context";
import { computerTabOf } from "@/client/components/window/file-tabs";
import { useGroupTab } from "@/client/components/window/group-tab";
import { useInboxRoom } from "@/client/components/window/inbox-room";
import { InboxToggle } from "@/client/components/window/inbox-toggle";
import { NoChatOpen } from "@/client/components/window/no-chat-open";
import { RightPane } from "@/client/components/window/right-pane";
import { screenLocation } from "@/client/components/window/screen-presentation";
import {
  pageSlotByTabAtom,
  useShell,
} from "@/client/components/window/shell-context";
import { tasksHref } from "@/client/components/window/tab-location";
import { TabLocationRow } from "@/client/components/window/tab-location-row";
import {
  chatOfHref,
  chatSessionOfHref,
  parseHref,
} from "@/client/components/window/window-href";
import { useWindowTabs } from "@/client/components/window/window-tabs";
import { useIsActiveTab, useTabId } from "@/client/hooks/use-active-tab";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { outputFolderHref } from "@/shared/computer-href";
import {
  type ChatId,
  encodeBrowserTargetId,
  StoreId,
  WINDOW_ID,
} from "@instrument-org/workspace/client";
import {
  createFileRoute,
  Outlet,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { type ReactNode, useEffect, useState } from "react";

/** Dragged narrower than this, the inbox column slides shut rather than stopping at its floor. */
const INBOX_COLLAPSE_THRESHOLD = 240;
/** The least the conversation and its pane keep beside the inbox while the inbox is dragged wider. */
const MAIN_WIDTH_MIN = 560;
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
 * open, its transcript and composer with what it holds in a row over it,
 * and the thing it has up drawn large. Choosing another chat in the inbox
 * moves this tab there, one step on in its history.
 */
function ChatView({ chat }: { chat: ChatId | undefined }) {
  const shell = useShell();
  const appWindow = useWindow();
  const { appTabs, chats, chatTitles, rowWidth, setPaneOpen } = shell;
  const windowTabs = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const setInboxOpen = useSetAtom(inboxOpenAtom);
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
  const up = windowTabs.selectedTabIn(chat);
  const isPaneWanted = chat === undefined || (paneOpenByGroup[chat] ?? true);
  const showsPane = up !== undefined && isPaneWanted;

  // What gives way as the window narrows, one thing at a time and in one
  // order: the pane gives up width, then the pane and the conversation go
  // down to their floors, and only then does the inbox step aside. Widening
  // brings them back in the other order, each a margin past the width it
  // left at.
  const needs = CONVERSATION_WIDTH_MIN + (showsPane ? PANE_WIDTH_MIN : 0);
  const { isAtOnce, isShown } = useInboxRoom({
    isActive,
    margin: ROOM_MARGIN,
    needs,
    room: showsRightArea && rowWidth > 0 ? rowWidth - sidebarWidth : undefined,
  });
  /** Puts the chat away: the inbox is shown again if it was hidden, with the empty side beside it. */
  const leaveChat = () => {
    appTabs.navigate(INBOX_HREF);
    setInboxOpen(true);
  };

  const isFloating = shell.compose.entries.some(
    (entry) => entry.kind === "chat" && entry.chatId === chat,
  );
  const [pageHost, setPageHost] = useState<HTMLDivElement | null>(null);
  const [pageChrome, setPageChrome] = useState<PageChromeSlots>();
  usePageSlot(
    showsPane && up.kind === "page" ? pageHost : null,
    pageChrome,
    showsPane && up.kind === "page",
  );
  const chatRecord = chats?.find((entry) => entry.id === chat);
  /** A browser beside the chat, the way the tiles' Browser does. */
  const addWeb = () => {
    if (chat === undefined) {
      return;
    }
    windowTabs.openScreen(BROWSER_HREF, {
      group: chat,
      select: true,
    });
    setPaneOpen(chat, true);
  };

  // Drawn only once there is something in it.
  const tiles = chat !== undefined && tabs.length > 0 && (
    <ChatTiles
      appsBySlug={appsBySlug}
      chatTitles={chatTitles}
      chosenId={showsPane ? up.id : undefined}
      isChatWorking={chatRecord?.state === "working"}
      onAddComputer={() => {
        windowTabs.openScreen(outputFolderHref(), {
          group: chat,
          select: true,
        });
        setPaneOpen(chat, true);
      }}
      onAddWeb={addWeb}
      onClose={shell.requestClose}
      onReorder={(keys) => {
        windowTabs.reorder(keys, chat);
      }}
      onSelect={(id) => {
        windowTabs.select(id);
        setPaneOpen(chat, true);
      }}
      tabs={tabs}
      targetOf={(tab) =>
        encodeBrowserTargetId(WINDOW_ID, StoreId.SessionSchema.parse(tab.id))
      }
      taskTitles={shell.childTitles}
    />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ChatColumn
        bounds={bounds}
        isAtOnce={isAtOnce}
        // With no chat open there is no toggle to bring it back by, so it
        // stays.
        isOpen={isShown || !showsRightArea}
        onCollapse={() => {
          setInboxOpen(false);
        }}
      >
        <div className="flex min-h-0 w-full flex-1 flex-col [&_.prose]:text-[13px] [&_.prose]:leading-5 [&_.text-sm]:text-[13px]">
          {/* A plain click on a row opens in this tab, and a middle or
            modified click asks for a tab of its own. */}
          <ChatPane
            arrivedId={shell.arrivedId}
            drafts={shell.drafts}
            // An archived chat is put away, so it leaves the side beside
            // the list with it.
            onArchiveOpen={leaveChat}
            // A chat deleted from its row takes its tabs with it, and the
            // inbox takes the tab back when it was the one open.
            onDeleted={(id) => {
              windowTabs.dropGroup(id);
              if (id === chat) {
                appTabs.navigate(INBOX_HREF, { replace: true });
                setInboxOpen(true);
              }
            }}
            onDeleteDraft={shell.discardDraft}
            onListed={isActive ? shell.onListed : undefined}
            onOpenChat={(entry) => {
              appWindow.openScreen(`${CHATS_HREF}/${entry.id}`);
            }}
            onOpenDraft={shell.showDraft}
            // As from the chat's head: popped out, the chat open here is
            // no longer the one this tab has open.
            onPopOut={(entry) => {
              shell.compose.float(entry.id);
              if (entry.id === chat) {
                leaveChat();
              }
            }}
            openChatId={chat}
            outIds={chatsOutOf(shell.compose.entries)}
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
                        // An archived chat is put away, so it leaves the
                        // side beside the list with it.
                        onArchived={leaveChat}
                        onDeleted={() => {
                          // The chat and the tabs it had are gone; the inbox
                          // takes the tab back.
                          windowTabs.dropGroup(chat);
                          appTabs.navigate(INBOX_HREF, { replace: true });
                          setInboxOpen(true);
                        }}
                        onNewTopic={shell.onNewTopic}
                        // A task opens beside the chat, in the pane.
                        onOpenTask={(id) => {
                          appWindow.openScreen(`/tasks/${id}`, {
                            group: chat,
                            ownTab: true,
                            show: true,
                          });
                        }}
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
                              windowTabs.dropGroup(chat);
                              appTabs.navigate(INBOX_HREF, { replace: true });
                              setInboxOpen(true);
                            }}
                            sendContext={() =>
                              shell.sendContext({
                                chatId: chat,
                                isViewOpen: showsPane,
                              })
                            }
                            sentPrompt={shell.sentWords.get(chat)}
                            tiles={tiles}
                            chatId={chat}
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
                    // against the conversation at the left, round where the
                    // pane reaches the card's own corner.
                    "[--guest-bottom-radius:0_var(--radius-2xl)]",
                  )}
                >
                  {up && (
                    <GroupItem
                      closeTab={shell.requestClose}
                      group={chat}
                      isFramed={false}
                      // Puts the view away; what it showed stays among the
                      // chat's tiles, which are where a tab is closed.
                      onClose={() => {
                        setPaneOpen(chat, false);
                      }}
                      onPageChrome={setPageChrome}
                      onPageHost={setPageHost}
                      up={up}
                    />
                  )}
                </div>
              </RightPane>
            </div>
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
 * A screen that is its own route (the Finder, a file, the apps, an app, a
 * skill), under the row that says where it stands. Its steps are
 * the tab's history, walked by the arrows in the window's bar.
 */
function RouteScreen({ href }: { href: string }) {
  const appWindow = useWindow();
  const shell = useShell();
  const appsBySlug = useAppsBySlug();
  const tabId = useTabId();
  const screenView = useAtomValue(screenViewsAtom)[tabId];
  const walkedFolder = useAtomValue(walkedFoldersAtom)[tabId];
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
      ? {
          ...fromHref,
          ...(walkedFolder
            ? { hostPath: walkedFolder.hostPath, path: walkedFolder.walked }
            : { path: screenView.folder.display }),
        }
      : fromHref;
  // The apps' catalog is a place you arrive at from the rail, with nothing
  // above it to walk back up to and nothing to type an address for: a row
  // there would only offer to leave for the web. A new tab's own menu takes
  // addresses, so a row over it would be a second field.
  const hasLocationRow =
    location.kind !== "apps" && parseHref(href).pathname !== NEW_TAB_HREF;
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
          fillsTab
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
  const up = windowTabs.selectedTabIn(group);
  const [pageHost, setPageHost] = useState<HTMLDivElement | null>(null);
  const [pageChrome, setPageChrome] = useState<PageChromeSlots>();
  usePageSlot(up?.kind === "page" ? pageHost : null, pageChrome, true);
  // A tab reopened after its page was put away brings the page back, at
  // the address it had.
  const [putAway, setPutAway] = useAtom(putAwaySitesAtom);
  const stashed = up === undefined ? putAway[group] : undefined;
  useEffect(() => {
    if (!stashed) {
      return;
    }
    // Its guest went with it, and comes back when the page shows, at the
    // address it held, the way a launch brings a tab's page back: from
    // blank, so with none of the page's own history behind it.
    windowTabs.restoreGroup(group, stashed);
    setPutAway((current) => {
      const { [group]: _restored, ...rest } = current;
      return rest;
    });
    // Once per group put back; the task it opens under does not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, setPutAway, stashed]);
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
        up={up}
      />
    </div>
  );
}

/**
 * One of the window's tabs, as its address has it: the chat, a site opened
 * at the window's level, or a screen that is its own route under the row
 * that says where it stands. The window around the tabs is drawn once, by
 * the window, whatever tab is up. A tab of a chat's or a draft's group is
 * the screen alone, under the row its group's view draws.
 */
function TabContent() {
  const href = useRouterState({
    select: (routerState) => routerState.location.href,
  });
  const groupTab = useGroupTab();
  if (groupTab) {
    return <Outlet />;
  }
  const session = chatSessionOfHref(href);
  if (session) {
    return <ChatOfSession sessionId={session} />;
  }
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
 * A chat named by its session, the way addresses were written before a
 * chat had an id of its own: the tab moves to the chat's own address once
 * the workspace says which chat that session is, or to the inbox when it is
 * none's.
 */
function ChatOfSession({ sessionId }: { sessionId: StoreId.Session }) {
  const router = useRouter();
  const chat = useQuery(
    rpcClient.workspace.chats.ofSession.queryOptions({
      input: { sessionId },
      staleTime: Number.POSITIVE_INFINITY,
    }),
  );
  const answer = chat.data;
  useEffect(() => {
    if (answer) {
      router.history.replace(
        answer.id ? `${CHATS_HREF}/${answer.id}` : INBOX_HREF,
      );
    }
  }, [answer, router]);
  return <ChatView chat={undefined} />;
}

/**
 * Where this tab wants the window's page drawn, told to the window under the
 * tab's id; the window draws the page where the tab up wants it.
 */
function usePageSlot(
  host: HTMLElement | null,
  chrome: PageChromeSlots | undefined,
  isShown: boolean,
) {
  const setSlots = useSetAtom(pageSlotByTabAtom);
  const tabId = useTabId();
  useEffect(() => {
    if (!host) {
      return;
    }
    const slot = { chrome, host, isShown };
    setSlots((current) => ({ ...current, [tabId]: slot }));
    return () => {
      setSlots((current) => {
        if (current[tabId] !== slot) {
          return current;
        }
        const { [tabId]: _gone, ...rest } = current;
        return rest;
      });
    };
  }, [chrome, host, isShown, setSlots, tabId]);
}
