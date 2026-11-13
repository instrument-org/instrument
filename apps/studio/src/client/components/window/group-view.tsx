import {
  CHAT_DEFAULT_SHARE,
  chatClosedByGroupAtom,
  chatShareAtom,
  sidebarOpenAtom,
} from "@/client/atoms/tab-groups";
import { CaptionRoom } from "@/client/components/window-controls";
import { WorkingDots } from "@/client/components/transcript/task-card";
import { useIsActiveTab, useTabId } from "@/client/hooks/use-active-tab";
import { cn } from "@/client/lib/utils";
import { draftGroupOf } from "@/shared/drafts";
import { type ChatId } from "@instrument-org/workspace/client";
import { ChatCircleIcon } from "@phosphor-icons/react/ChatCircle";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { type ReactNode, useEffect, useLayoutEffect, useState } from "react";

import { type PageChromeSlots } from "./browser-tabs";
import { ChatHeader } from "./chat-header";
import { chatListOptions } from "./chat-list-query";
import { chatAsSent, draftTitle } from "./chats";
import { ChatScreen } from "./chat-screen";
import { useWindow } from "./context";
import { GroupItem } from "./group-item";
import { SidebarToggleRoom } from "./inbox-toggle";
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
 * One tab group, as the window's tab shows it. The tab bar is always the
 * window's top line, with the chat's tab fixed at its right end. A group
 * with no tabs is its chat, filling the work area under the bar. Once a tab
 * is open the chat moves to a column on the right, its head sharing the top
 * line with the tabs, and the chat's tab opens and closes that column; the
 * toolbar and what the tab up shows take the rest. Closing the last tab
 * brings the chat back to the middle.
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
  // With no tab open, the chat is what the group shows.
  const isChatFirst = tabs.length === 0;

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

  // A chat's group with tabs but none up brings up its first. Only a group
  // this window lists: a draft's group handed to its chat is not.
  useLayoutEffect(() => {
    if (!isActive || group === undefined || !isListed) {
      return;
    }
    const [first] = tabs;
    if (first !== undefined && up === undefined) {
      windowTabs.select(first.id);
    }
  });

  // The chat in the middle is open, so the column it moves to when a tab
  // opens is open too, whatever its tab did before the last tab closed.
  useEffect(() => {
    if (isChatFirst && group !== undefined && closedByGroup[group] === true) {
      groups.setChatOpen(group, true);
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
  // The chat's tab, where the tab bar ends, with the room for the caption
  // buttons off the Mac after it.
  const chatTab = (
    <>
      <ChatTab
        isWorking={isWorking}
        onPress={() => {
          if (!isChatFirst) {
            groups.setChatOpen(group, chatClosed);
          }
        }}
        state={isChatFirst ? "selected" : chatClosed ? "closed" : "open"}
      />
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
        {...(isChatFirst
          ? {
              onAddress: (url: string) => {
                appWindow.browser?.open(url, { group });
              },
            }
          : {})}
        onOpenBeside={() => undefined}
        tabId={tabId}
        takesCaret={isChatFirst}
        trailing={isChatFirst ? undefined : chatTab}
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
            trailing={isChatFirst ? undefined : chatTab}
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
              takesCaret={isChatFirst}
            />
          </div>
        </div>
      </div>
    );

  const tabBar = (trailing: ReactNode) => (
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
      trailing={trailing}
    />
  );

  // The tabs over the work, ending in the chat's tab while its column is
  // closed; while it is open, the chat's tab ends the column's head.
  const work = (
    <div className="flex h-full min-h-0 flex-col">
      {!isChatFirst && tabBar(chatClosed ? chatTab : null)}
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

  // The chat stays where it is in the tree as it moves between the middle
  // and the column, so its transcript and composer are never drawn afresh.
  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {isChatFirst && tabBar(chatTab)}
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <RightPane
          conversation={work}
          fills={isChatFirst}
          isOpen={!chatClosed}
          onCollapse={() => {
            groups.setChatOpen(group, false);
          }}
          paneKey={group}
          share={{ atom: chatShareAtom, initial: CHAT_DEFAULT_SHARE }}
        >
          <div
            className={cn(
              "flex h-full min-h-0 w-full flex-col overflow-hidden bg-background",
              !isChatFirst && "border-l border-border",
            )}
          >
            {conversation}
          </div>
        </RightPane>
      </div>
    </div>
  );
}

/**
 * The chat's tab, fixed at the tab bar's right end in every state: selected
 * while the chat fills the middle, and the switch for its column once a tab
 * is open. A little more forward than a tab, so the chat is always found in
 * the same corner. While the agent works, the bubble gives way to the
 * working dots.
 */
function ChatTab({
  isWorking,
  onPress,
  state,
}: {
  isWorking: boolean;
  onPress: () => void;
  state: "closed" | "open" | "selected";
}) {
  return (
    <button
      aria-label="Chat"
      aria-pressed={state !== "closed"}
      className={cn(
        "ml-2 flex h-8 shrink-0 cursor-default items-center gap-1.5 rounded-xl px-2.5 text-sm font-medium text-foreground",
        state === "selected"
          ? "bg-card shadow-xs-soft"
          : state === "open"
            ? "bg-foreground/8 hover:bg-foreground/10"
            : "bg-card shadow-xs ring-1 ring-border hover:bg-foreground/[0.03]",
      )}
      data-chat-tab=""
      onClick={onPress}
      // A press here selects nothing, so it leaves the keyboard where it was.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      type="button"
    >
      <span className="grid size-4 place-items-center text-brand-600 dark:text-brand-400">
        {isWorking ? (
          <WorkingDots />
        ) : (
          <ChatCircleIcon className="size-4" weight="fill" />
        )}
      </span>
      Chat
    </button>
  );
}
