import { BROWSER_HREF, paneOpenByGroupAtom } from "@/client/atoms/window";
import { FileOpenContext } from "@/client/components/file-open-context";
import { ActiveTabProvider } from "@/client/hooks/use-active-tab";
import { cn } from "@/client/lib/utils";
import { instrumentFolderHref } from "@/shared/computer-href";
import {
  encodeBrowserTargetId,
  type SessionMessageDataPart,
  StoreId,
  WINDOW_ID,
} from "@instrument-org/workspace/client";
import { ArrowsInSimpleIcon } from "@phosphor-icons/react/ArrowsInSimple";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { ChatsCircleIcon } from "@phosphor-icons/react/ChatsCircle";
import { MinusIcon } from "@phosphor-icons/react/Minus";
import { XIcon } from "@phosphor-icons/react/X";
import { useAtomValue } from "jotai";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { type PageChromeSlots } from "./browser-tabs";
import { ChatHeading } from "./chat-header";
import { ChatRail } from "./chat-rail";
import { ChatScreen } from "./chat-screen";
import { type Chat, draftTitle, type Topic } from "./chats";
import {
  CHAT_RAIL_WIDTH,
  CHAT_WINDOW_WIDTH,
  COMPOSE_BAR_WIDTH,
  COMPOSE_MOTION,
  GROWN,
} from "./compose-layout";
import {
  BarMarks,
  GroupItem,
  IncludedChip,
  WindowButton,
} from "./compose-window";
import { useWindow, WindowContext } from "./context";
import { DeleteChatDialog } from "./delete-chat-dialog";
import { isGroupShown, isIncludable } from "./draft-context";
import { computerTabOf } from "./file-tabs";
import { LinkSurface } from "./link-surface";
import { taskHref, tasksHref, tasksOfHref } from "./tab-location";
import { useTaskTitles } from "./task-titles";
import { useWindowTabs } from "./window-tabs";

/** A chat's small view's height, in layout px: enough of the conversation to follow a reply arriving. */
const CHAT_WINDOW_HEIGHT = 560;

/**
 * A chat put down: a dark bar along the window's foot with its title, the
 * pulse while it works, and the marks of what it holds, as a draft's bar
 * has, brought back up by a press, taken down by its cross. The chat itself is untouched by either.
 */
export function ChatBar({
  chat,
  onClose,
  onOpen,
  right,
}: {
  chat: Chat | undefined;
  onClose: () => void;
  onOpen: () => void;
  /** Where the bar stands along the foot, in layout px from the right edge. */
  right: number;
}) {
  const isWorking = chat?.state === "working";
  return (
    <motion.div
      animate={{ opacity: 1, right, y: 0 }}
      className="pointer-events-auto absolute bottom-[calc(1px/var(--app-zoom))] z-40 flex h-9 items-center overflow-hidden rounded-t-lg bg-gray-900 text-[12px] font-medium text-white shadow-xl-soft [clip-path:inset(-4rem_-4rem_0_-4rem)] dark:bg-gray-800 dark:ring-1 dark:ring-[color-mix(in_srgb,#fff_10%,var(--background))]"
      data-slot="chat-bar"
      exit={{ opacity: 0, y: 36 }}
      initial={{ opacity: 0, right, y: 36 }}
      style={{ width: COMPOSE_BAR_WIDTH }}
      transition={COMPOSE_MOTION}
    >
      <button
        className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left hover:bg-white/8"
        onClick={onOpen}
        type="button"
      >
        <ChatsCircleIcon className="size-3.5 shrink-0" />
        {/* The title shimmers while the chat works, the way a tab's does. The
          bar is dark in either theme, so the shimmer takes the dark theme's
          brighter green, which the `dark` around it selects. */}
        <span className="dark contents">
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              isWorking && "brand-shiny-text",
            )}
          >
            {chat?.title ?? "Chat"}
          </span>
        </span>
        {chat && <BarMarks group={chat.id} />}
      </button>
      <button
        aria-label="Close"
        className="grid h-full w-8 shrink-0 place-items-center text-white/80 hover:bg-white/8 hover:text-white"
        onClick={onClose}
        type="button"
      >
        <XIcon className="size-3.5" />
      </button>
    </motion.div>
  );
}

/**
 * A chat popped out: its conversation in a small window docked to the row's
 * bottom-right corner, over whatever place the window stands in, the way a
 * video keeps playing in its small window over the page that owns it, with
 * the rail of what the chat holds along its right edge, folded to its marks
 * when the window is narrower than it wants. Its head carries the chat's
 * title, topics and menu as the chat's own head draws them, and the window's
 * buttons.
 *
 * Grown, it is a window over the whole row, the way a draft grows: the
 * conversation, the thing pressed on the rail drawn large beside it, and the
 * rail. Pressing a tile in the small window grows it with that thing up, and
 * so does anything the conversation asks to have shown; what the agent opens
 * behind stays behind.
 */
export function ChatWindow({
  arrives,
  chat,
  isRailCompact,
  onClose,
  onCloseTab,
  onLandOnTab,
  onMinimize,
  onNewTopic,
  onOpenInChats,
  onPageChrome,
  onPageHost,
  onPlacementChange,
  onSetTopics,
  placement,
  right,
  sendContext,
  sentWords,
  sessionId,
  topics,
  width,
}: {
  /** Whether the window arrives with a motion: a draft becoming the chat is the same window, so it does not. */
  arrives: boolean;
  chat: Chat | undefined;
  /** Whether the rail stands as a column of marks, for a window with no room for its pictures. */
  isRailCompact: boolean;
  onClose: () => void;
  /** Closes one of the chat's tabs, the way the window's strip does: asking first while a task is working in it. */
  onCloseTab: (id: string) => void;
  /** Lands in Chats with the chat open and this tab up, for a thing the window cannot draw. */
  onLandOnTab: (tabId: string) => void;
  onMinimize: () => void;
  /** Makes a topic, named for what was typed in the picker when anything was, and files the chat under it. */
  onNewTopic: (name?: string) => void;
  /** Takes the window to its chat in Chats: the window goes and the chat is selected. */
  onOpenInChats: () => void;
  /** The element the chat's page is drawn into while the window is grown with a page up, null while none is. */
  /** Where the address row takes the page's reload and controls, while a page is up. */
  onPageChrome: (slots: PageChromeSlots | undefined) => void;
  onPageHost: (element: HTMLElement | null) => void;
  onPlacementChange: (placement: "docked" | "expanded") => void;
  onSetTopics: (topics: string[]) => void;
  placement: "docked" | "expanded";
  /** Where the window stands along the foot, in layout px from the right edge. */
  right: number;
  /** What goes with a reply: the chat's own tab up while the window shows it, what is behind the window otherwise. */
  sendContext: (options: {
    isViewOpen: boolean;
  }) => Promise<SessionMessageDataPart.ViewContextDataPart | undefined>;
  /** The words the draft this window was sent, while the chat they start is on its way. */
  sentWords?: string;
  sessionId: StoreId.Session;
  topics: Topic[];
  /** The window's width, rail and all, narrower than its own on a row with less room. */
  width?: number;
}) {
  const appWindow = useWindow();
  const windowTabs = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const tabs = windowTabs.allTabs.filter((tab) => tab.group === sessionId);
  const up = windowTabs.tabUpIn(sessionId);
  const isExpanded = placement === "expanded";
  // Whether the thing up is drawn large; only a grown window has the room.
  const [isViewOpen, setViewOpen] = useState(false);
  const showsItem = isExpanded && isViewOpen && up !== undefined;
  const isWorking =
    chat === undefined ? sentWords !== undefined : chat.state === "working";
  const [isDeleting, setDeleting] = useState(false);
  const taskTitles = useTaskTitles();
  const chatTitles = new Map<StoreId.Session, string>(
    chat === undefined ? [] : [[chat.id, chat.title]],
  );

  // The page's host, held as state so the ref React calls is one stable
  // setter (see the draft window's).
  const [pageHost, setPageHost] = useState<HTMLDivElement | null>(null);
  const onPageHostRef = useRef(onPageHost);
  useEffect(() => {
    onPageHostRef.current = onPageHost;
  });
  useEffect(() => {
    onPageHostRef.current(pageHost);
  }, [pageHost]);
  useEffect(
    () => () => {
      onPageHostRef.current(null);
    },
    [],
  );

  // What the window has up behind the chat, which goes with each message:
  // shown as a pill while the composer has the caret, so the person sees it
  // before sending, and left out of every message after its × is pressed,
  // until something else comes up behind.
  const paneOpenByGroup = useAtomValue(paneOpenByGroupAtom);
  const [leftOutId, setLeftOutId] = useState<string>();
  const [isComposing, setComposing] = useState(false);
  const behindTab = windowTabs.active;
  const behind =
    behindTab !== undefined &&
    windowTabs.group !== sessionId &&
    isGroupShown(windowTabs.group, paneOpenByGroup) &&
    isIncludable(behindTab)
      ? behindTab
      : undefined;
  const isBehindLeftOut = behind !== undefined && behind.id === leftOutId;
  const isBehindLeftOutRef = useRef(isBehindLeftOut);
  const showsItemRef = useRef(false);
  useEffect(() => {
    isBehindLeftOutRef.current = isBehindLeftOut;
    showsItemRef.current = showsItem;
  });
  // The chat's own tab while the window shows it; what is behind the window
  // otherwise, unless that was left out.
  const contextToSend = () =>
    showsItemRef.current
      ? sendContext({ isViewOpen: true })
      : isBehindLeftOutRef.current
        ? Promise.resolve(undefined)
        : sendContext({ isViewOpen: false });

  /** Grows the window with what is up in the chat drawn large. */
  const showUp = () => {
    setViewOpen(true);
    onPlacementChange("expanded");
  };
  const select = (id: string) => {
    windowTabs.selectIn(sessionId, id);
    showUp();
  };
  // Closing a tab moves to the one before it, the way the strip does; the
  // tab model only does that for the group on screen.
  const closeTab = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    const neighbor = tabs[index - 1] ?? tabs[index + 1];
    onCloseTab(id);
    if (up?.id === id) {
      if (neighbor) {
        windowTabs.selectIn(sessionId, neighbor.id);
      } else {
        setViewOpen(false);
      }
    }
  };
  // A new tab each time: the person asked for another, even of a kind the
  // chat already has open.
  const openHere = (href: string) => {
    windowTabs.openScreen(href, {
      activate: true,
      group: sessionId,
      isOpened: true,
    });
    showUp();
  };
  /** The chat's tasks or one of them, up large in this window: the tab already at that address, or a new one. */
  const openTasksHere = (href: string) => {
    windowTabs.openOrFocusScreen(href, {
      activate: true,
      group: sessionId,
      isOpened: true,
    });
    showUp();
  };
  const openPage = (url: string) => {
    const id = appWindow.browser?.openOrFocus(url, { group: sessionId });
    if (id !== undefined) {
      select(id);
    }
  };

  const rail = tabs.length > 0 && (
    <ChatRail
      activeId={up?.id}
      appsBySlug={appsBySlug}
      chatTitles={chatTitles}
      isChatWorking={isWorking}
      isCompact={isRailCompact}
      isViewOpen={showsItem}
      onAddComputer={() => {
        openHere(instrumentFolderHref());
      }}
      onAddWeb={() => {
        openHere(BROWSER_HREF);
      }}
      onClose={closeTab}
      onReorder={(keys) => {
        windowTabs.reorder(keys, sessionId);
      }}
      onSelect={select}
      tabs={tabs}
      targetOf={(tab) =>
        encodeBrowserTargetId(
          tab.taskId ?? WINDOW_ID,
          StoreId.SessionSchema.parse(tab.id),
        )
      }
      taskTitles={taskTitles}
    />
  );

  return (
    <motion.div
      animate={{ opacity: 1, right: isExpanded ? 0 : right, y: 0 }}
      // On the page's ground rather than the card's: the conversation is
      // drawn for that ground, its bubbles on the card's and its fades from
      // the page's, and on a card both go missing.
      // An opaque edge, and the shadow ramp without its own hairline: the
      // small view is drawn over the pane, over a page guest, and under a
      // draft window, and a see-through edge takes the color of whatever it
      // lands on and doubles wherever two of them cross.
      className={cn(
        "pointer-events-auto absolute z-40 flex flex-col overflow-hidden bg-background text-foreground shadow-xl-soft ring-1 ring-gray-300 dark:ring-gray-600",
        // A screen pixel off the foot at any zoom, so the ring stops short of
        // the edge the system draws along the window's bottom rather than
        // doubling it, and clipped at its own foot, so the ring's bottom side
        // and the shadow under it never reach that edge either. The bars
        // along the foot stand on the same line.
        isExpanded
          ? "z-41 rounded-2xl"
          : "bottom-[calc(1px/var(--app-zoom))] max-h-[calc(100%-3.5rem)] rounded-t-2xl [clip-path:inset(-4rem_-4rem_0_-4rem)]",
      )}
      data-slot="chat-window"
      exit={{ opacity: 0, y: 24 }}
      initial={
        arrives ? { opacity: 0, right: isExpanded ? 0 : right, y: 24 } : false
      }
      style={
        isExpanded
          ? GROWN
          : {
              height: CHAT_WINDOW_HEIGHT,
              width:
                width ??
                CHAT_WINDOW_WIDTH + (tabs.length > 0 ? CHAT_RAIL_WIDTH : 0),
            }
      }
      transition={COMPOSE_MOTION}
    >
      {chat && (
        <DeleteChatDialog
          chat={chat}
          onDeleted={onClose}
          onOpenChange={setDeleting}
          open={isDeleting}
        />
      )}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3 select-none">
        {/* No mark of work here: the line at the conversation's end says
          the chat is working, where its reply will land. */}
        <ChatsCircleIcon className="size-4 shrink-0 text-muted-foreground" />
        {chat ? (
          <ChatHeading
            chat={chat}
            menu={{
              // An archived chat is put away, so its window goes with it.
              onArchived: onClose,
              onOpenInChats,
              onViewTasks: () => {
                openTasksHere(tasksHref(sessionId));
              },
            }}
            onDelete={() => {
              setDeleting(true);
            }}
            onNewTopic={onNewTopic}
            onSetTopics={onSetTopics}
            titleClassName="text-[13px] font-semibold"
            topics={topics}
          />
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">
            {sentWords === undefined ? "Chat" : draftTitle(sentWords)}
          </h2>
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          <WindowButton label="Minimize" onClick={onMinimize}>
            <MinusIcon className="size-4" />
          </WindowButton>
          <WindowButton
            label={isExpanded ? "Shrink" : "Expand"}
            onClick={() => {
              onPlacementChange(isExpanded ? "docked" : "expanded");
            }}
          >
            {isExpanded ? (
              <ArrowsInSimpleIcon className="size-4" />
            ) : (
              <ArrowsOutSimpleIcon className="size-4" />
            )}
          </WindowButton>
          <WindowButton label="Close" onClick={onClose}>
            <XIcon className="size-4" />
          </WindowButton>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* `select-text`: the window's shell is chrome and turns selection off; the chat is text. The sizes are the chat column's. */}
        <div
          className={cn(
            "relative min-h-0 min-w-0 select-text [&_.prose]:text-[13px] [&_.prose]:leading-5 [&_.text-sm]:text-[13px]",
            showsItem ? "w-105 shrink-0 border-r border-border" : "flex-1",
          )}
          // The caret anywhere in the conversation column, the pill's own ×
          // included, keeps the pill up.
          onBlur={(event) => {
            if (
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            ) {
              setComposing(false);
            }
          }}
          onFocus={() => {
            setComposing(true);
          }}
        >
          {/* What the conversation asks to have shown comes up large in
              this window; what it opens behind (an agent's page arriving)
              stays behind. A screen this window cannot draw goes where it
              can be. */}
          <WindowContext
            value={{
              ...appWindow,
              openPage: (url, options) => {
                if (options?.show && !options.newTab) {
                  openPage(url);
                  return;
                }
                appWindow.openPage(url, options);
              },
              openPath: (path, options) => {
                if (options?.show && !options.newTab) {
                  appWindow.openPath(path, {
                    activate: true,
                    group: sessionId,
                    ownTab: true,
                  });
                  showUp();
                  return;
                }
                appWindow.openPath(path, options);
              },
              openScreen: (href, options) => {
                if (options?.newTab) {
                  appWindow.openScreen(href, options);
                  return;
                }
                if (options?.show && computerTabOf(href)) {
                  openHere(href);
                  return;
                }
                const tasks = tasksOfHref(href);
                if (options?.show && tasks) {
                  openTasksHere(
                    tasks.task === undefined
                      ? tasksHref(sessionId)
                      : taskHref(tasks.task, sessionId),
                  );
                  return;
                }
                appWindow.openScreen(href, options);
              },
            }}
          >
            {/* A file the conversation offers is asked for to be seen, so
                it is shown the same way. */}
            <FileOpenContext
              value={(path, options) => {
                if (options?.newTab) {
                  appWindow.openPath(path, options);
                  return;
                }
                appWindow.openPath(path, {
                  activate: true,
                  group: sessionId,
                  ownTab: true,
                });
                showUp();
              }}
            >
              <LinkSurface>
                <ActiveTabProvider isActive>
                  <ChatScreen
                    composerLead={
                      isComposing && behind && !isBehindLeftOut ? (
                        <IncludedChip
                          appsBySlug={appsBySlug}
                          items={undefined}
                          onLeaveOut={() => {
                            setLeftOutId(behind.id);
                          }}
                          said="In view behind the chat, so it goes to Instrument with your message."
                          tab={behind}
                        />
                      ) : undefined
                    }
                    isUp
                    onGone={onClose}
                    sendContext={contextToSend}
                    sentPrompt={sentWords}
                    sessionId={sessionId}
                  />
                </ActiveTabProvider>
              </LinkSurface>
            </FileOpenContext>
          </WindowContext>
        </div>
        {showsItem && (
          <div className="flex min-w-0 flex-1 flex-col bg-sidebar">
            <div className="min-h-0 flex-1">
              <GroupItem
                closeTab={closeTab}
                group={sessionId}
                isFramed={false}
                // The row's Hide puts the view away; the thing stays in the
                // chat, on the rail, as it does beside a chat in the window.
                onClose={() => {
                  setViewOpen(false);
                }}
                onPageChrome={onPageChrome}
                onPageHost={setPageHost}
                outside={{
                  label: "Open in Chats",
                  note: "Opens in Chats, beside the chat.",
                  onOpen: (tab) => {
                    onLandOnTab(tab.id);
                  },
                }}
                up={up}
              />
            </div>
          </div>
        )}
        {rail}
      </div>
    </motion.div>
  );
}
