import {
  CONVERSATION_WIDTH_MIN,
  PANE_WIDTH_MIN,
} from "@/client/atoms/right-pane";
import {
  BROWSER_HREF,
  inboxOpenAtom,
  inboxWidthAtom,
  paneOpenByGroupAtom,
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
  INBOX_HREF,
  putAwaySitesAtom,
  siteGroupOf,
} from "@/client/components/window/app-tabs";
import { useAppsBySlug } from "@/client/components/window/apps-by-slug";
import { type PageChromeSlots } from "@/client/components/window/browser-tabs";
import { ChatHeader } from "@/client/components/window/chat-header";
import { ChatPane } from "@/client/components/window/chat-pane";
import { ChatScreen } from "@/client/components/window/chat-screen";
import { ContextChips } from "@/client/components/window/context-chip";
import { GroupItem } from "@/client/components/window/group-item";
import { liveHostedFileAddress } from "@/client/components/window/hosted-page";
import { useWindow, WindowContext } from "@/client/components/window/context";
import { isPaneOpen } from "@/client/components/window/draft-context";
import { useGroupTab } from "@/client/components/window/group-tab";
import { useInboxRoom } from "@/client/components/window/inbox-room";
import { InboxToggle } from "@/client/components/window/inbox-toggle";
import { NewChatView } from "@/client/components/window/new-chat-view";
import { makeNewChatDraftAtom } from "@/client/drafts/new-chat-box";
import { draftGroupOf } from "@/shared/drafts";
import { PaneTabs } from "@/client/components/window/pane-tabs";
import { PaneToggle } from "@/client/components/window/pane-toggle";
import { RightPane } from "@/client/components/window/right-pane";
import { useRowSlots } from "@/client/components/window/row-slots";
import { screenLocation } from "@/client/components/window/screen-presentation";
import { useShell } from "@/client/components/window/shell-context";
import { useChatContext } from "@/client/components/window/use-chat-context";
import {
  surfaceLocation,
  tabSurfaceAtom,
  useTabSurface,
} from "@/client/components/window/tab-surface";
import { TabLocationRow } from "@/client/components/window/tab-location-row";
import { chatHref, matchScreen } from "@/client/components/window/window-href";
import { useWindowTabs } from "@/client/components/window/window-tabs";
import { useIsActiveTab, useTabId } from "@/client/hooks/use-active-tab";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { outputFolderHref, useOutputFolder } from "@/client/lib/output-folder";
import { type ChatId, StoreId } from "@instrument-org/workspace/client";
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
      // Its edge as faint as the rows' hairlines, drawn over what the
      // column holds rather than as its border, so a project's wash shows
      // through it the way it shows through the rows'.
      panelClassName="border-r-0 bg-background after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-10 after:w-px after:bg-border/70"
      widthAtom={inboxWidthAtom}
    >
      {children}
    </StudioSidebarRail>
  );
}

/**
 * The chat: the inbox down the left, and beside it the chat this tab has
 * open, its transcript and composer, or with no chat open a new chat being
 * written; and in the pane the thing it has up drawn large under a row of
 * its tabs. Choosing another chat in the inbox moves this tab there, one
 * step on in its history.
 */
function ChatView({
  chat,
  draft,
}: {
  chat: ChatId | undefined;
  /** The draft the new chat is written into, when no chat is open and the address names one. */
  draft?: string;
}) {
  const shell = useShell();
  const appWindow = useWindow();
  const { appTabs, chats, chatTitles, rowWidth, setPaneOpen } = shell;
  const windowTabs = useWindowTabs();
  const outputFolder = useOutputFolder();
  const setInboxOpen = useSetAtom(inboxOpenAtom);
  const sidebarWidth = useAtomValue(inboxWidthAtom);
  const paneOpenByGroup = useAtomValue(paneOpenByGroupAtom);
  const isActive = useIsActiveTab();
  const tabId = useTabId();
  const makeNewChatDraft = useSetAtom(makeNewChatDraftAtom);
  const bounds = inboxBounds(rowWidth);

  // The group whose tabs stand in the pane: the chat's, or the new chat's
  // draft's.
  const group = chat ?? (draft === undefined ? undefined : draftGroupOf(draft));
  /** The group, making the new chat's draft first where it has none, for something to open beside it. */
  const ensureGroup = () => group ?? draftGroupOf(makeNewChatDraft({ tabId }));
  // The group's tabs, and the one it has up.
  const tabs =
    group === undefined
      ? []
      : windowTabs.allTabs.filter((tab) => tab.group === group);
  const up = windowTabs.selectedTabIn(group);
  const isPaneWanted =
    group === undefined || isPaneOpen(group, paneOpenByGroup);
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
    room: rowWidth > 0 ? rowWidth - sidebarWidth : undefined,
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
  /** A browser beside the chat, or beside the new chat. */
  const addWeb = () => {
    const opened = ensureGroup();
    windowTabs.openScreen(BROWSER_HREF, {
      group: opened,
      select: true,
    });
    setPaneOpen(opened, true);
  };
  /** The pane's button, which shows the group's tab up or opens a browser beside it when it has none. */
  const paneToggle = (
    <PaneToggle
      isOpen={showsPane}
      onToggle={() => {
        const newest = tabs.at(-1);
        if (showsPane && group !== undefined) {
          setPaneOpen(group, false);
        } else if (up === undefined && newest && group !== undefined) {
          windowTabs.select(newest.id);
          setPaneOpen(group, true);
        } else if (up === undefined || group === undefined) {
          addWeb();
        } else {
          setPaneOpen(group, true);
        }
      }}
    />
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ChatColumn
        bounds={bounds}
        isAtOnce={isAtOnce}
        isOpen={isShown}
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
              appWindow.openScreen(chatHref(entry.id));
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
      {
        <main
          className="relative flex min-w-0 flex-1 flex-col"
          // Escape in an empty composer goes back out to the chat's row in
          // the list, ahead of the editor, which would take it to select
          // what holds the caret. A composer with words in it keeps Escape.
          onKeyDownCapture={(event) => {
            const target = event.target;
            if (
              event.key !== "Escape" ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey ||
              event.defaultPrevented ||
              !(target instanceof HTMLElement) ||
              !target.isContentEditable ||
              (target.textContent ?? "").trim() !== ""
            ) {
              return;
            }
            const row = document.querySelector<HTMLElement>(
              "[data-app-tab-active] [data-chat-list] [data-open]",
            );
            if (!row?.checkVisibility()) {
              return;
            }
            event.preventDefault();
            row.focus();
          }}
        >
          <div className="flex min-h-0 flex-1">
            <div className="relative min-w-0 flex-1">
              <RightPane
                conversation={
                  <div className="relative flex h-full min-h-0 flex-col">
                    {chat === undefined ? (
                      <div className="absolute inset-0 flex flex-col">
                        <NewChatView
                          draftId={draft}
                          ensureGroup={ensureGroup}
                          leading={<InboxToggle />}
                          onOpenBeside={(opened) => {
                            setPaneOpen(opened, true);
                          }}
                          tabId={tabId}
                          trailing={paneToggle}
                        />
                      </div>
                    ) : (
                      <div className="absolute inset-0 flex flex-col">
                        <ChatHeader
                          chat={chatRecord}
                          leading={<InboxToggle />}
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
                          onNewProject={shell.onNewProject}
                          onSetProject={(next) => {
                            shell.setChatProject(chat, next);
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
                          projects={shell.projects}
                          trailing={paneToggle}
                        />
                        <div className="relative min-h-0 flex-1">
                          <div className="absolute inset-0">
                            <ChatScreenInPlace
                              chatId={chat}
                              isUp={isActive}
                              isViewOpen={showsPane}
                              key={chat}
                              onGone={() => {
                                // As for a deleted chat: its tabs go, and the
                                // inbox takes the tab back.
                                windowTabs.dropGroup(chat);
                                appTabs.navigate(INBOX_HREF, { replace: true });
                                setInboxOpen(true);
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                }
                fills={false}
                isOpen={showsPane}
                onCollapse={() => {
                  if (group !== undefined) {
                    setPaneOpen(group, false);
                  }
                }}
                paneKey={group ?? NEW_CHAT_PANE}
              >
                <div
                  className={cn(
                    "flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-border",
                    // A page's bottom corners follow what they meet: square
                    // against the conversation at the left, round where the
                    // pane reaches the card's own corner.
                    "[--guest-bottom-radius:0_18px]",
                  )}
                >
                  {up && group !== undefined && (
                    <PaneTabs
                      chatTitles={chatTitles}
                      chosenId={up.id}
                      isChatWorking={chatRecord?.working === true}
                      onAddComputer={() => {
                        windowTabs.openScreen(outputFolderHref(outputFolder), {
                          group,
                          select: true,
                        });
                      }}
                      onAddWeb={addWeb}
                      onClose={shell.requestClose}
                      onHide={() => {
                        setPaneOpen(group, false);
                      }}
                      onReorder={(keys) => {
                        windowTabs.reorder(keys, group);
                      }}
                      onSelect={(id) => {
                        windowTabs.select(id);
                      }}
                      tabs={tabs}
                      taskTitles={shell.childTitles}
                    />
                  )}
                  {up && group !== undefined && (
                    <GroupItem
                      closeTab={shell.requestClose}
                      group={group}
                      isShown={showsPane}
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
      }
    </div>
  );
}

/** The pane's key while a new chat has no draft yet, and so no tabs. */
const NEW_CHAT_PANE = "new-chat";

/**
 * A chat's screen in the window's place, with the chips over its composer
 * for what goes with a reply: the chat's own tab while its pane is open,
 * until left out, and nothing else, since nothing stands behind it.
 */
function ChatScreenInPlace({
  chatId,
  isUp,
  isViewOpen,
  onGone,
}: {
  chatId: ChatId;
  isUp: boolean;
  isViewOpen: boolean;
  onGone: () => void;
}) {
  const shell = useShell();
  const context = useChatContext({ chatId, isPoppedOut: false, isViewOpen });
  return (
    <ChatScreen
      chatId={chatId}
      composerLead={
        context.chips.length > 0 ? (
          <ContextChips items={context.chips} onLeaveOut={context.leaveOut} />
        ) : undefined
      }
      isUp={isUp}
      onGone={onGone}
      sendContext={() =>
        shell.sendContext({
          chatId,
          isPoppedOut: false,
          isViewOpen,
          leftOut: context.leftOut,
        })
      }
      sentPrompt={shell.sentWords.get(chatId)}
    />
  );
}

/**
 * How wide the inbox column may be: the row less what the conversation
 * keeps, within the column's own floor and ceiling. It slides shut under its
 * floor, since the head beside it, a chat's or a new chat's, holds the
 * toggle that brings it back.
 */
function inboxBounds(rowWidth: number): RailBounds {
  return {
    collapse: INBOX_COLLAPSE_THRESHOLD,
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
  const { allTabs } = useWindowTabs();
  const surface = useAtomValue(tabSurfaceAtom)[tabId];
  usePageSlot(null, undefined, false);
  const { rowProps, slots } = useRowSlots();
  const location = surfaceLocation(
    screenLocation(href, {
      appsBySlug,
      chatTitles: shell.chatTitles,
      taskTitles: shell.childTitles,
    }),
    surface,
  );
  // The apps' catalog is a place you arrive at from the rail, with nothing
  // above it to walk back up to and nothing to type an address for: a row
  // there would only offer to leave for the web. A new tab's own menu takes
  // addresses, so a row over it would be a second field. The release notes
  // are a page to read, with no place above them either.
  const screenKind = matchScreen(href).kind;
  const hasLocationRow =
    location.kind !== "apps" &&
    location.kind !== "task" &&
    screenKind !== "newTab" &&
    screenKind !== "releaseNotes";
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {hasLocationRow && (
        <TabLocationRow
          fillsTab
          {...(location.kind === "file"
            ? {
                liveAddress: () =>
                  liveHostedFileAddress(allTabs, tabId, location.path),
              }
            : {})}
          location={location}
          {...rowProps}
        />
      )}
      <WindowContext
        value={{
          ...appWindow,
          rowField: slots.field,
          rowLead: slots.lead,
          rowReload: slots.reload,
          rowTail: slots.tail,
        }}
      >
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
  const screen = matchScreen(href);
  switch (screen.kind) {
    case "chat": {
      return <ChatView chat={screen.chat} />;
    }
    case "chatLink": {
      return <ChatView chat={undefined} />;
    }
    case "inbox": {
      return <ChatView chat={undefined} draft={screen.draft} />;
    }
    case "chatOfSession": {
      return <ChatOfSession sessionId={screen.session} />;
    }
    case "site": {
      return <SiteView group={siteGroupOf(screen.id)} />;
    }
    default: {
      return <RouteScreen href={href} />;
    }
  }
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
      router.history.replace(answer.id ? chatHref(answer.id) : INBOX_HREF);
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
  useTabSurface("slot", host ? { chrome, host, isShown } : null);
}
