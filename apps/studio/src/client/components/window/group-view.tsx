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
import { PlusIcon } from "@phosphor-icons/react/Plus";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode, useEffect, useState } from "react";

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
import { useTabGroupActions, useOpenGroups } from "./tab-groups";
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
 * X to a Chat button at the end of the tabs. A group with only its chat has
 * the chat across the whole card and no tab row.
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
  const hasWork = up !== undefined && tabs.length > 0;

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
  // A group whose chat has not started and has only new tabs has nothing
  // to show in the column: the new tab's composer starts the chat.
  const isOnlyNewTabs = draft !== undefined && tabs.every(isHomeTab);
  const showsColumn = hasWork && !chatClosed && !isOnlyNewTabs;

  // A chat across the whole card is open, so the column it moves to when a
  // tab arrives is open too, whatever its X did before the tabs went.
  useEffect(() => {
    if (!hasWork && group !== undefined && closedByGroup[group] === true) {
      groups.setChatOpen(group, true);
    }
  });

  const [pageHost, setPageHost] = useState<HTMLDivElement | null>(null);
  const [pageChrome, setPageChrome] = useState<PageChromeSlots>();
  useTabSurface(
    "slot",
    hasWork && up.kind === "page" && pageHost
      ? { chrome: pageChrome, host: pageHost, isShown: true }
      : null,
  );

  /** This group closed, once its chat is archived or deleted. */
  const leave = () => {
    if (group !== undefined) {
      groups.close(group, open);
    }
  };
  const newTab = () => {
    groups.newTab(group);
  };
  const plus = (
    <ToolbarTooltip label="New tab">
      <button
        aria-label="New tab"
        className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
        onClick={newTab}
        type="button"
      >
        <PlusIcon className="size-4" />
      </button>
    </ToolbarTooltip>
  );
  const closeColumn =
    group === undefined ? null : (
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

  /** The chat, or a new chat's composer for a group whose chat has not started. */
  const conversation = (trailing: ReactNode, leading?: ReactNode) =>
    chat === undefined ? (
      group === undefined ? null : (
        <NewChatView
          draftId={draft}
          ensureGroup={() => group}
          isPaneShown={hasWork}
          leading={leading}
          onOpenBeside={() => undefined}
          tabId={tabId}
          trailing={trailing}
        />
      )
    ) : (
      <div className="flex h-full min-h-0 flex-col">
        {/* With the chat alone in the card, its head is the window's top
            row, so the room between its controls drags the window. */}
        <div
          className={cn(
            "shrink-0",
            !hasWork &&
              "[-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag] [&_input]:[-webkit-app-region:no-drag]",
          )}
        >
          <ChatHeader
            chat={headChat}
            fallbackTitle={
              sentWords === undefined ? undefined : draftTitle(sentWords)
            }
            leading={leading}
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
            trailing={trailing}
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
                  isViewOpen: hasWork,
                  taken: [],
                })
              }
              sentPrompt={shell.sentWords.get(chat)}
              takesCaret={!hasWork}
            />
          </div>
        </div>
      </div>
    );

  // Whichever row reaches the card's top right ends clear of the caption
  // buttons off the Mac: the chat's head while it has the card or the
  // column, else the tabs.
  if (!hasWork || group === undefined) {
    return (
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {conversation(
          <>
            {plus}
            <CaptionRoom />
          </>,
          isSidebarOpen ? undefined : <SidebarToggleRoom />,
        )}
      </div>
    );
  }

  const chatButton =
    chatClosed && !isOnlyNewTabs ? (
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

  const work = (
    <div className="flex h-full min-h-0 flex-col">
      <PaneTabs
        carriedKey={carry.carriedKey}
        chatTitles={shell.chatTitles}
        chosenId={incoming ? incoming.tab.id : up.id}
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
        onNew={newTab}
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
            {!showsColumn && <CaptionRoom />}
          </>
        }
      />
      <div className="relative min-h-0 flex-1 [--guest-bottom-radius:0]">
        <GroupItem
          closeTab={shell.requestClose}
          group={group}
          isChatWorking={isWorking}
          isShown
          onPageChrome={setPageChrome}
          onPageHost={setPageHost}
          up={up}
        />
      </div>
    </div>
  );

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <RightPane
        conversation={work}
        isOpen={showsColumn}
        onCollapse={() => {
          groups.setChatOpen(group, false);
        }}
        paneKey={group}
        share={{ atom: chatShareAtom, initial: CHAT_DEFAULT_SHARE }}
      >
        <div className="flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-border bg-background">
          {conversation(
            <>
              {closeColumn}
              <CaptionRoom />
            </>,
          )}
        </div>
      </RightPane>
    </div>
  );
}
