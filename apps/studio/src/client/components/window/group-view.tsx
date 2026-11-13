import {
  CHAT_DEFAULT_SHARE,
  chatClosedByGroupAtom,
  chatShareAtom,
  sidebarOpenAtom,
} from "@/client/atoms/tab-groups";
import { ToolbarTooltip } from "@/client/components/toolbar-tooltip";
import { CaptionRoom } from "@/client/components/window-controls";
import { WorkingDots } from "@/client/components/transcript/task-card";
import { useIsActiveTab, useTabId } from "@/client/hooks/use-active-tab";
import { cn } from "@/client/lib/utils";
import { draftGroupOf } from "@/shared/drafts";
import { type ChatId } from "@instrument-org/workspace/client";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useLayoutEffect, useState } from "react";

import { type PageChromeSlots } from "./browser-tabs";
import { ChatHeader } from "./chat-header";
import { chatListOptions } from "./chat-list-query";
import { chatAsSent, draftTitle } from "./chats";
import { ChatScreen } from "./chat-screen";
import { useWindow } from "./context";
import { GroupItem } from "./group-item";
import { SidebarToggleRoom } from "./inbox-toggle";
import { isHomeTab } from "./tab-model";
import { NewChatView } from "./new-chat-view";
import { PaneTabs } from "./pane-tabs";
import { RightPane } from "./right-pane";
import { useShell } from "./shell-context";
import { tabCarryViewAtom } from "./tab-carry-view";
import {
  useTabGroupActions,
  useOpenGroups,
  windowTabGroupsAtom,
} from "./tab-groups";
import {
  groupTabLandingAtom,
  incomingGroupTab,
  useGroupTabCarry,
} from "./tab-drag";
import { useTabSurface } from "./tab-surface";
import { useWindowTabs } from "./window-tabs";

/**
 * One tab group, as the window's tab shows it: its tabs over the work, the
 * toolbar under them, and its chat in a column on the right, closed by its
 * X to a Chat button at the end of the tabs. The tabs and the chat's head
 * share the window's top line, and the room between their controls drags
 * the window. A group always has a tab, a new tab when it has nothing else.
 */
export function GroupView({
  chat,
  draft,
}: {
  chat: ChatId | undefined;
  /** The draft of a group whose chat has not started, as the address names it. */
  draft?: string;
}) {
  const shell = useShell();
  const appWindow = useWindow();
  const windowTabs = useWindowTabs();
  const groups = useTabGroupActions();
  const { open } = useOpenGroups();
  const listed = useAtomValue(windowTabGroupsAtom);
  const closedByGroup = useAtomValue(chatClosedByGroupAtom);
  const isSidebarOpen = useAtomValue(sidebarOpenAtom);
  const isActive = useIsActiveTab();
  const tabId = useTabId();

  const group = chat ?? (draft === undefined ? undefined : draftGroupOf(draft));
  const tabs =
    group === undefined
      ? []
      : windowTabs.allTabs.filter((tab) => tab.group === group);
  const up = windowTabs.selectedTabIn(group);
  const carry = useGroupTabCarry({ group: group ?? "", tabs });
  // Another window's tab held over the strip stands among its tabs at the pointer.
  const incoming = incomingGroupTab(
    useAtomValue(tabCarryViewAtom),
    useAtomValue(groupTabLandingAtom),
    windowTabs.allTabs,
  );
  const stripTabs = incoming
    ? tabs
        .filter((tab) => tab.id !== incoming.tab.id)
        .toSpliced(incoming.index, 0, incoming.tab)
    : tabs;
  const isListed = group !== undefined && listed?.includes(group) === true;

  const { data: chatRecord } = useQuery({
    ...chatListOptions(),
    select: (chats) => chats.find((entry) => entry.id === chat),
  });
  const sentWords = chat === undefined ? undefined : shell.sentWords.get(chat);
  const headChat =
    chatRecord && sentWords !== undefined && chat !== undefined
      ? chatAsSent(chatRecord, {
          project: shell.sentProjects.get(chat),
          words: sentWords,
        })
      : chatRecord;
  const isWorking = chatRecord?.working === true;
  const chatClosed = group === undefined || closedByGroup[group] === true;
  // The new tab has nothing to type into, so the chat's composer takes the
  // caret while it is up.
  const takesCaret = !chatClosed && up !== undefined && isHomeTab(up);

  // A group with no tab, such as a chat opened from History, gets a new
  // tab, and a chat's group with tabs but none up brings up its first. Only
  // a group this window lists: a draft's group handed to its chat is not.
  useLayoutEffect(() => {
    if (!isActive || group === undefined || !isListed) {
      return;
    }
    const [first] = tabs;
    if (first === undefined) {
      groups.newTab(group);
    } else if (up === undefined) {
      windowTabs.select(first.id);
    }
  });

  const [pageHost, setPageHost] = useState<HTMLDivElement | null>(null);
  const [pageChrome, setPageChrome] = useState<PageChromeSlots>();
  useTabSurface(
    "slot",
    up?.kind === "page" && pageHost
      ? { chrome: pageChrome, host: pageHost, isShown: true }
      : null,
  );

  if (group === undefined) {
    return <div className="relative flex min-h-0 min-w-0 flex-1" />;
  }

  /** This group closed, once its chat is archived or deleted. */
  const leave = () => {
    groups.close(group, open);
  };
  const closeColumn = (
    <ToolbarTooltip label="Close chat">
      <button
        aria-label="Close chat"
        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
        onClick={() => {
          groups.setChatOpen(group, false);
        }}
        type="button"
      >
        <XIcon className="size-4" />
      </button>
    </ToolbarTooltip>
  );
  const headTrailing = (
    <>
      {closeColumn}
      <CaptionRoom />
    </>
  );

  /** The chat, or a new chat's composer for a group whose chat has not started. */
  const conversation =
    chat === undefined ? (
      <NewChatView
        draftId={draft}
        ensureGroup={() => group}
        isPaneShown
        onOpenBeside={() => undefined}
        tabId={tabId}
        takesCaret={takesCaret}
        trailing={headTrailing}
      />
    ) : (
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag] [&_input]:[-webkit-app-region:no-drag]">
          <ChatHeader
            chat={headChat}
            className="h-10 pr-2"
            fallbackTitle={
              sentWords === undefined ? undefined : draftTitle(sentWords)
            }
            onArchived={leave}
            onDeleted={() => {
              windowTabs.dropGroup(chat);
              leave();
            }}
            onNewProject={shell.onNewProject}
            onSetProject={(next) => {
              shell.setChatProject(chat, next);
            }}
            projects={shell.projects}
            trailing={headTrailing}
          />
        </div>
        <div className="relative min-h-0 flex-1">
          <div className="absolute inset-0">
            <ChatScreen
              chatId={chat}
              isUp={isActive}
              key={chat}
              onGone={() => {
                windowTabs.dropGroup(chat);
                leave();
              }}
              sendContext={() =>
                shell.sendContext({
                  chatId: chat,
                  isViewOpen: up !== undefined,
                  taken: [],
                })
              }
              sentPrompt={shell.sentWords.get(chat)}
              takesCaret={takesCaret}
            />
          </div>
        </div>
      </div>
    );

  const chatButton = chatClosed ? (
    <button
      aria-label="Chat"
      className={cn(
        "ml-2 flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-card text-sm font-medium shadow-xs ring-1 ring-border hover:bg-foreground/[0.03]",
        isWorking ? "px-3 text-brand-600 dark:text-brand-400" : "px-2.5",
      )}
      onClick={() => {
        groups.setChatOpen(group, true);
      }}
      type="button"
    >
      {isWorking ? (
        <WorkingDots />
      ) : (
        <>
          <ChatCircleIcon className="size-4" />
          Chat
        </>
      )}
    </button>
  ) : null;

  // Whichever row reaches the card's top right ends clear of the caption
  // buttons off the Mac: the chat's head while its column is open, else
  // the tabs.
  const work = (
    <div className="flex h-full min-h-0 flex-col">
      <PaneTabs
        carriedKey={carry.carriedKey}
        chatTitles={shell.chatTitles}
        chosenId={incoming ? incoming.tab.id : up?.id}
        heldAt={incoming ? incoming.heldAt : carry.held}
        isChatWorking={isWorking}
        isIncoming={incoming !== undefined}
        lead={isSidebarOpen ? null : <SidebarToggleRoom />}
        onClose={shell.requestClose}
        onDuplicate={(tab) => {
          if (tab.kind === "page") {
            appWindow.browser?.open(tab.url ?? tab.openedUrl, { group });
          } else {
            windowTabs.openScreen(tab.href, { group, select: true });
          }
        }}
        onNew={() => {
          groups.newTab(group);
        }}
        onSelect={(id) => {
          windowTabs.select(id);
        }}
        onTabDrag={carry.onDrag}
        onTabDragEnd={carry.onDragEnd}
        onTabDragStart={carry.onDragStart}
        tabs={stripTabs}
        taskTitles={shell.childTitles}
        trailing={
          <>
            {chatButton}
            {chatClosed && <CaptionRoom />}
          </>
        }
      />
      <div className="relative min-h-0 flex-1 [--guest-bottom-radius:0]">
        {up !== undefined && (
          <GroupItem
            closeTab={shell.requestClose}
            group={group}
            isChatWorking={isWorking}
            isShown
            onPageChrome={setPageChrome}
            onPageHost={setPageHost}
            up={up}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <RightPane
        conversation={work}
        isOpen={!chatClosed}
        onCollapse={() => {
          groups.setChatOpen(group, false);
        }}
        paneKey={group}
        share={{ atom: chatShareAtom, initial: CHAT_DEFAULT_SHARE }}
      >
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-border bg-background">
          {conversation}
        </div>
      </RightPane>
    </div>
  );
}
