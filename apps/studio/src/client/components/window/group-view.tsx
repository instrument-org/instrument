import {
  CHAT_DEFAULT_SHARE,
  chatClosedByGroupAtom,
  chatShareAtom,
  sidebarOpenAtom,
} from "@/client/atoms/tab-groups";
import { TaskBackgroundProcesses } from "@/client/components/task/task-background-processes";
import { CaptionRoom } from "@/client/components/window-controls";
import { useIsActiveTab, useTabId } from "@/client/hooks/use-active-tab";
import { formatAcceleratorText } from "@/client/lib/format-accelerator";
import { rpcClient } from "@/client/rpc/client";
import { folderHref } from "@/shared/computer-href";
import { draftGroupOf } from "@/shared/drafts";
import { WINDOW_SHORTCUTS } from "@/shared/window-shortcuts";
import { type ChatId } from "@instrument-org/workspace/client";
import { ArrowClockwiseIcon } from "@phosphor-icons/react/ArrowClockwise";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { noop } from "radashi";
import {
  type ComponentProps,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";

import { BookmarksBar } from "./bookmarks-bar";
import { type PageChromeSlots } from "./browser-tabs";
import { ChatMenuItems } from "./chat-header";
import { chatListOptions } from "./chat-list-query";
import { type Chat, chatAsSent, draftTitle } from "./chats";
import { ChatScreen } from "./chat-screen";
import { ChatTab, ClosedChatTab } from "./chat-tab";
import { useWindow } from "./context";
import { DeleteChatDialog } from "./delete-chat-dialog";
import { heldFilesAtom, stripWithHeldFiles } from "./file-drops";
import { GroupItem } from "./group-item";
import { SidebarToggleRoom } from "./inbox-toggle";
import { NewChatView } from "./new-chat-view";
import { PaneTabs } from "./pane-tabs";
import { useShell } from "./shell-context";
import { SplitView } from "./split-view";
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
import { TabLocationRow, TabRowControl } from "./tab-location-row";
import { useTabSurface } from "./tab-surface";
import { useChatRename } from "./use-chat-rename";
import { useTitleArrival } from "./use-title-arrival";
import { useWindowTabs } from "./window-tabs";

/**
 * One tab group, as the window's tab shows it: a split of two cards, the
 * work and the chat. A group with no tabs is its chat alone, a chat site
 * open in a browser: a tab bar with the chat's tab first, the tab up, over a
 * toolbar and the bookmarks as a page has them. Once a tab is open the chat
 * moves to a card of its own on the right, its tab the card's head, and the
 * work's card beside it has the tabs, the toolbar and what the tab up shows.
 * The X on the chat's tab closes its card, leaving the work the whole group
 * and the chat's tab at the end of the work's tabs, where a press opens it
 * again, and closes the group while the chat is all of it. Closing the last tab brings the chat back to the whole group.
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
  // Files dragged in and held over the strip, or over a new tab, stand
  // where they would land.
  const withFiles = stripWithHeldFiles(
    group,
    tabs,
    useAtomValue(heldFilesAtom),
  );
  const stripTabs = incoming
    ? tabs
        .filter((tab) => tab.id !== incoming.tab.id)
        .toSpliced(incoming.index, 0, incoming.tab)
    : (withFiles?.tabs ?? tabs);
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
  /** A page in a tab of this group, which moves the chat into its column. */
  const openPage = (url: string) => {
    appWindow.browser?.open(url, { group });
  };
  /** Files at a folder, as a tab of this group. */
  const openFiles = (href: string) => {
    windowTabs.openScreen(href, { group, select: true });
  };
  // The chat's tab: the tab up, first on the tab bar, while the chat is the
  // whole group, and its card's head while the card is open. Its X closes
  // the card, or the group while the chat is all of it.
  const chatTabOf = (stands: ChatTabPlacement["stands"]) => {
    const placement = {
      className: { head: undefined, up: "ml-1.5" }[stands],
      isWorking,
      onClose: () => {
        if (isChatFirst) {
          shell.closeGroup(group);
        } else {
          groups.setChatOpen(group, false);
        }
      },
      stands,
    } as const;
    if (chat === undefined) {
      return <ChatTab {...placement} title="New chat" />;
    }
    if (!headChat) {
      return (
        <ChatTab
          {...placement}
          title={sentWords === undefined ? "New chat" : draftTitle(sentWords)}
        />
      );
    }
    return (
      <StartedChatTab
        {...placement}
        chat={headChat}
        group={group}
        onArchived={leave}
        onDeleted={() => {
          windowTabs.dropGroup(chat);
          leave();
        }}
      />
    );
  };

  /** The chat, or a new chat's composer for a group whose chat has not started. */
  const conversation =
    chat === undefined ? (
      <NewChatView
        draftId={draft}
        ensureGroup={() => group}
        isCentered={isChatFirst}
        isPaneShown
        {...(isChatFirst ? { onAddress: openPage } : {})}
        onOpenBeside={() => undefined}
        tabId={tabId}
        takesCaret={isChatFirst}
      />
    ) : (
      <div className="absolute inset-0">
        <ChatScreen
          chatId={chat}
          isUp={isActive}
          key={chat}
          layoutContext={() => shell.layoutContext(chat)}
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
    );

  const tabBar = ({
    className,
    first,
    trailing,
  }: {
    className: string;
    /** What stands ahead of the tabs, after the room for the traffic lights. */
    first?: ReactNode;
    trailing: ReactNode;
  }) => (
    <PaneTabs
      carriedKey={carry.carriedKey}
      chatTitles={shell.chatTitles}
      chosenId={incoming ? incoming.tab.id : (withFiles?.chosenId ?? up?.id)}
      className={className}
      heldAt={incoming ? incoming.heldAt : (withFiles?.heldAt ?? carry.held)}
      isChatWorking={isWorking}
      isIncoming={incoming !== undefined}
      lead={
        <>
          {isSidebarOpen ? null : <SidebarToggleRoom />}
          {first}
        </>
      }
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

  // The work's card: its tabs, the toolbar and what the tab up shows. While
  // the chat's card is closed, this card reaches the window's top right, so
  // its tabs end in the chat's tab and the room for the caption buttons off
  // the Mac.
  const work = {
    body:
      up === undefined ? null : (
        <GroupItem
          closeTab={shell.requestClose}
          group={group}
          isChatWorking={isWorking}
          isShown
          onPageChrome={setPageChrome}
          onPageHost={setPageHost}
          up={up}
        />
      ),
    head: isChatFirst
      ? null
      : tabBar({
          className: WORK_TABS,
          trailing: chatClosed && (
            <>
              <ClosedChatTab
                isWorking={isWorking}
                onOpen={() => {
                  groups.setChatOpen(group, true);
                }}
                title={
                  headChat?.title ??
                  (sentWords === undefined ? "New chat" : draftTitle(sentWords))
                }
              />
              <CaptionRoom />
            </>
          ),
        }),
  };

  // Over the chat while it is the whole group: the toolbar a page has, for a
  // chat that has no history of its own, so its arrows and reload rest. Its
  // field opens a page as a tab of this group, and shows ⌘L until it is
  // pressed, since the caret starts in the composer. The bookmarks under it
  // lead with Files.
  const toolbar = (
    <>
      <TabLocationRow
        canGoBack={false}
        canGoForward={false}
        className="border-b-0"
        fieldHint={<LocationKeys />}
        fieldTakesCaret={false}
        location={NEW_TAB_LOCATION}
        onBack={noop}
        onForward={noop}
        onSite={openPage}
        onVisit={(href) => {
          windowTabs.openScreen(href, { group, select: true });
        }}
        reload={
          <TabRowControl
            chord="reloadPage"
            disabled
            icon={<ArrowClockwiseIcon className="size-4" />}
            label="Reload"
            onClick={noop}
          />
        }
      />
      <BookmarksBar files={{ group, onOpen: openFiles }} onOpen={openPage} />
    </>
  );
  // The chat's card. As the whole group, its head is a browser's tab bar
  // with the chat's tab up first on it; beside the work, its head is the
  // chat's tab alone. Either way it reaches the window's top right.
  const chatHead = isChatFirst ? (
    <>
      {tabBar({
        className: CHAT_FIRST_TABS,
        first: chatTabOf("up"),
        trailing: <CaptionRoom />,
      })}
      {toolbar}
    </>
  ) : (
    <div className="flex h-10 shrink-0 items-center px-1.5 [-webkit-app-region:drag]">
      {chatTabOf("head")}
      <CaptionRoom />
    </div>
  );

  // The chat stays where it is in the tree as it moves between the whole
  // group and its card beside the work, so its transcript and composer are
  // never drawn afresh.
  return (
    <div
      className={GROUP_GROUNDS}
      // The group draws its own cards, so the window's card stands back.
      {...(isActive ? { "data-own-cards": "" } : {})}
    >
      <SplitView
        end={{ body: conversation, head: chatHead }}
        endStands={isChatFirst ? "fills" : chatClosed ? "closed" : "open"}
        onEndCollapse={() => {
          groups.setChatOpen(group, false);
        }}
        paneKey={group}
        share={{ atom: chatShareAtom, initial: CHAT_DEFAULT_SHARE }}
        start={work}
      />
    </div>
  );
}

/**
 * The group's grounds: a strip darker than the toolbar under it, as a
 * browser's tab strip is, for the tab bar over a chat that is the whole
 * group (`group-strip`).
 */
const GROUP_GROUNDS =
  "relative flex min-h-0 min-w-0 flex-1 [--group-strip:color-mix(in_oklab,var(--gray-200)_70%,var(--background))] dark:[--group-strip:color-mix(in_oklab,black_16%,var(--background))]";

/** The work's tabs, on the card's own ground, the tab up lifted off it. */
const WORK_TABS = "[--tab-selected:var(--card)]";

/** The tab bar over a chat that is the whole group, its chat's tab lifted off it. */
const CHAT_FIRST_TABS = "group-strip pr-2.5";

/** Where the toolbar over a chat stands: nowhere yet, as a new tab is. */
const NEW_TAB_LOCATION = { kind: "newTab" } as const;

/** The chord that puts the caret in the address field, at the end of the empty field. */
function LocationKeys() {
  return (
    <span className="pointer-events-none absolute top-1/2 right-2.5 inline-flex h-4.5 -translate-y-1/2 items-center rounded-[4px] bg-foreground/[0.04] px-1 font-sans text-[11px] font-medium text-muted-foreground/70 ring-1 ring-foreground/[0.06]">
      {formatAcceleratorText(WINDOW_SHORTCUTS.search.accelerator)}
    </span>
  );
}

/** Where the chat's tab stands and what a press on it does, as `GroupView` places it. */
type ChatTabPlacement = Pick<
  ComponentProps<typeof ChatTab>,
  "className" | "isWorking" | "onClose" | "stands"
>;

/**
 * The chat's tab for a chat that has started: its title, its menu, its
 * rename, and the commands it left running.
 */
function StartedChatTab({
  chat,
  group,
  onArchived,
  onDeleted,
  ...placement
}: ChatTabPlacement & {
  chat: Chat;
  group: string;
  onArchived: () => void;
  onDeleted: () => void;
}) {
  const shell = useShell();
  const windowTabs = useWindowTabs();
  const [isDeleting, setDeleting] = useState(false);
  const rename = useChatRename(chat);
  const titleArrival = useTitleArrival(chat);
  const folderWithFiles = useChatFolderWithFiles(chat.id);
  return (
    <>
      <DeleteChatDialog
        chat={chat}
        onDeleted={onDeleted}
        onOpenChange={setDeleting}
        open={isDeleting}
      />
      <ChatTab
        {...placement}
        badge={<TaskBackgroundProcesses chatId={chat.id} />}
        menu={(components, { startRename }) => (
          <ChatMenuItems
            chat={chat}
            components={components}
            // The chat's own folder while it has files, as a tab of the
            // group, brought up where one already shows it.
            {...(folderWithFiles === null
              ? {}
              : {
                  onShowFolder: () => {
                    windowTabs.openOrFocusScreen(folderHref(folderWithFiles), {
                      group,
                      select: true,
                    });
                  },
                })}
            onArchived={onArchived}
            onDelete={() => {
              setDeleting(true);
            }}
            onRename={startRename}
            projectMenu={{
              onNew: shell.onNewProject,
              // Picking the project it is under takes it off.
              onPick: (id) => {
                shell.setChatProject(chat.id, chat.project === id ? null : id);
              },
              projects: shell.projects,
            }}
          />
        )}
        rename={rename}
        title={chat.title}
        titleArrival={titleArrival}
      />
    </>
  );
}

/**
 * The chat's own folder while it has files in it beside its `CHAT.md`, and
 * null otherwise: in a chat that has only talked, and in a workspace whose
 * chats keep no folder of their own.
 */
function useChatFolderWithFiles(chat: ChatId): null | string {
  const { data } = useQuery(
    rpcClient.workspace.chats.live.folderWithFiles.experimental_liveOptions({
      input: { id: chat },
    }),
  );
  return data ?? null;
}
