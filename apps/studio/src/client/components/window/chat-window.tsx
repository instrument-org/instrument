import { BROWSER_HREF } from "@/client/atoms/window";
import { FileOpenContext } from "@/client/components/file-open-context";
import { ActiveTabProvider } from "@/client/hooks/use-active-tab";
import { cn } from "@/client/lib/utils";
import { instrumentFolderHref } from "@/shared/computer-href";
import {
  type ChatId,
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
import { motion } from "motion/react";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { type PageChromeSlots } from "./browser-tabs";
import { ChatActivity } from "./chat-activity";
import { ChatHeading } from "./chat-header";
import { ChatScreen } from "./chat-screen";
import { ChatTiles } from "./chat-tiles";
import { type Chat, draftTitle, type Topic } from "./chats";
import {
  CHAT_WINDOW_WIDTH,
  COMPOSE_BAR_WIDTH,
  COMPOSE_MOTION,
  GROWN,
} from "./compose-layout";
import { BarMarks, WindowButton } from "./compose-window";
import { useWindow, WindowContext } from "./context";
import { heldChipOf, IncludedChip } from "./context-chip";
import { DeleteChatDialog } from "./delete-chat-dialog";
import { GroupItem } from "./group-item";
import { isIncludable } from "./draft-context";
import { computerTabOf } from "./file-tabs";
import { LinkSurface } from "./link-surface";
import { taskHref, tasksHref, tasksOfHref } from "./tab-location";
import { useTaskTitles } from "./task-titles";
import { type ComposePeek } from "./use-compose";
import { useTabInView } from "./use-tab-in-view";
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
 * what the chat holds in a row of tiles over its composer. Its head carries
 * the chat's title, topics and menu as the chat's own head draws them, and
 * the window's buttons.
 *
 * Grown, it is a window over the whole row, the way a draft grows: the
 * conversation, and the thing pressed among its tiles drawn large beside
 * it. Pressing a tile in the small window peeks at that thing in a card over
 * the conversation, and Expand on the card grows the window with it up, as
 * does anything the conversation asks to have shown; what the agent opens
 * behind stays behind.
 */
export function ChatWindow({
  arrives,
  chat,
  onClose,
  onCloseTab,
  onMinimize,
  onNewTopic,
  onOpenInChats,
  onPageChrome,
  onPageHost,
  onPeek,
  onPlacementChange,
  onSetTopics,
  placement,
  right,
  sendContext,
  sentWords,
  chatId,
  topics,
  width,
}: {
  /** Whether the window arrives with a motion: a draft becoming the chat is the same window, so it does not. */
  arrives: boolean;
  chat: Chat | undefined;
  onClose: () => void;
  /** Closes one of the chat's tabs, the way the window's strip does: asking first while a task is working in it. */
  onCloseTab: (id: string) => void;
  onMinimize: () => void;
  /** Makes a topic, named for what was typed in the picker when anything was, and files the chat under it. */
  onNewTopic: (name?: string) => void;
  /** Takes the window to its chat in Chats: the window goes and the chat is selected. */
  onOpenInChats: () => void;
  /** The element the chat's page is drawn into while the window is grown with a page up, null while none is. */
  /** Where the address row takes the page's reload and controls, while a page is up. */
  onPageChrome: (slots: PageChromeSlots | undefined) => void;
  onPageHost: (element: HTMLElement | null) => void;
  /** What the small window peeks at, for the layer that draws a page into the card; undefined while it peeks at nothing, or at something that is not a page. */
  onPeek: (peek: ComposePeek | undefined) => void;
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
  chatId: ChatId;
  topics: Topic[];
  /** The window's width, narrower than its own on a row with less room. */
  width?: number;
}) {
  const appWindow = useWindow();
  const windowTabs = useWindowTabs();
  const appsBySlug = useAppsBySlug();
  const tabs = windowTabs.allTabs.filter((tab) => tab.group === chatId);
  const up = windowTabs.selectedTabIn(chatId);
  const isExpanded = placement === "expanded";
  // Whether the thing up is drawn large; only a grown window has the room.
  const [isViewOpen, setViewOpen] = useState(false);
  const showsItem = isExpanded && isViewOpen && up !== undefined;
  const isWorking =
    chat === undefined ? sentWords !== undefined : chat.state === "working";
  const [isDeleting, setDeleting] = useState(false);
  const taskTitles = useTaskTitles();

  // The tab peeked at in the small window: a look, kept here and nowhere
  // else, so the tab the chat has up, which is what it shows grown and in
  // Chats, is not moved by it. Growing the window ends the look.
  const [peekId, setPeekId] = useState<string>();
  if (isExpanded && peekId !== undefined) {
    setPeekId(undefined);
  }
  const peekTab = tabs.find((tab) => tab.id === peekId);
  const [peekHost, setPeekHost] = useState<HTMLDivElement | null>(null);
  const [peekChrome, setPeekChrome] = useState<PageChromeSlots>();
  const peekPageId = peekTab?.kind === "page" ? peekTab.id : undefined;
  const reportPeek = useEffectEvent(onPeek);
  useEffect(() => {
    reportPeek(
      peekPageId === undefined
        ? undefined
        : { chrome: peekChrome, into: peekHost, tabId: peekPageId },
    );
  }, [peekChrome, peekHost, peekPageId]);
  useEffect(
    () => () => {
      reportPeek(undefined);
    },
    [],
  );
  // The card stands over the conversation from near the window's head down
  // to just over the tiles, however tall the composer under them grows.
  // Measured in layout px, which the card's height is set in under the
  // window's zoom.
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const [tilesRow, setTilesRow] = useState<HTMLDivElement | null>(null);
  const [peekRoom, setPeekRoom] = useState(0);
  const isPeeking = peekTab !== undefined;
  useLayoutEffect(() => {
    if (!isPeeking || !body || !tilesRow) {
      return;
    }
    const measure = () => {
      const box = body.getBoundingClientRect();
      const scale = body.offsetHeight > 0 ? box.height / body.offsetHeight : 1;
      setPeekRoom((tilesRow.getBoundingClientRect().top - box.top) / scale);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    // The composer's column: the tiles move whenever it changes height.
    if (tilesRow.parentElement) {
      observer.observe(tilesRow.parentElement);
    }
    return () => {
      observer.disconnect();
    };
  }, [body, isPeeking, tilesRow]);
  /** Grows the window with the thing peeked at up, for good. */
  const expandPeek = () => {
    if (peekTab) {
      select(peekTab.id);
    }
  };
  const chatTitles = new Map<ChatId, string>(
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
  // What is in view is read the way a draft reads it, so a screen of the
  // window's own (a folder, an app) is behind the chat as a site or another
  // chat's tab is.
  const [leftOutId, setLeftOutId] = useState<string>();
  const [isComposing, setComposing] = useState(false);
  const inView = useTabInView();
  const behind =
    inView !== undefined &&
    windowTabs.groupOnScreen !== chatId &&
    isIncludable(inView)
      ? inView
      : undefined;
  // A screen of the window's own keeps its tab's id wherever it walks, so
  // it is left out where it stood, and comes back once it is somewhere else.
  const behindKey =
    behind?.kind === "screen" ? `${behind.id} ${behind.href}` : behind?.id;
  const isBehindLeftOut = behindKey !== undefined && behindKey === leftOutId;
  const behindChip =
    behind && !isBehindLeftOut
      ? heldChipOf({ items: undefined, tab: behind }, { appsBySlug })
      : undefined;
  const behindChipRef = useRef(behindChip);
  const isBehindLeftOutRef = useRef(isBehindLeftOut);
  const showsItemRef = useRef(false);
  useEffect(() => {
    behindChipRef.current = behindChip;
    isBehindLeftOutRef.current = isBehindLeftOut;
    showsItemRef.current = showsItem;
  });
  // The chat's own tab while the window shows it; what is behind the window
  // otherwise, unless that was left out, with its chip for the transcript.
  const contextToSend = async () => {
    if (showsItemRef.current) {
      return sendContext({ isViewOpen: true });
    }
    if (isBehindLeftOutRef.current) {
      return;
    }
    const chip = behindChipRef.current;
    const viewing = await sendContext({ isViewOpen: false });
    return viewing && chip ? { ...viewing, attached: [chip] } : viewing;
  };

  /** Grows the window with what is up in the chat drawn large. */
  const showUp = () => {
    setViewOpen(true);
    onPlacementChange("expanded");
  };
  const select = (id: string) => {
    windowTabs.select(id);
    showUp();
  };
  // The tab before it comes up in its place; the view goes with the last.
  const closeTab = (id: string) => {
    onCloseTab(id);
    if (up?.id === id && tabs.length === 1) {
      setViewOpen(false);
    }
  };
  // A new tab each time: the person asked for another, even of a kind the
  // chat already has open.
  const openHere = (href: string) => {
    windowTabs.openScreen(href, {
      group: chatId,
      isOpened: true,
      select: true,
    });
    showUp();
  };
  /** The chat's tasks or one of them, up large in this window: the tab already at that address, or a new one. */
  const openTasksHere = (href: string) => {
    windowTabs.openOrFocusScreen(href, {
      group: chatId,
      isOpened: true,
      select: true,
    });
    showUp();
  };
  const openPage = (url: string) => {
    const id = appWindow.browser?.openOrFocus(url, { group: chatId });
    if (id !== undefined) {
      select(id);
    }
  };

  const tiles = tabs.length > 0 && (
    <div ref={setTilesRow}>
      <ChatTiles
        appsBySlug={appsBySlug}
        chatTitles={chatTitles}
        chosenId={isExpanded ? (showsItem ? up.id : undefined) : peekTab?.id}
        isChatWorking={isWorking}
        onAddComputer={() => {
          openHere(instrumentFolderHref());
        }}
        onAddWeb={() => {
          openHere(BROWSER_HREF);
        }}
        onClose={closeTab}
        onReorder={(keys) => {
          windowTabs.reorder(keys, chatId);
        }}
        // Small, a press peeks, and a press on the tile peeked at puts it down;
        // grown, a press brings the thing up beside the conversation.
        onSelect={(id) => {
          if (isExpanded) {
            select(id);
          } else {
            setPeekId((current) => (current === id ? undefined : id));
          }
        }}
        tabs={tabs}
        targetOf={(tab) =>
          encodeBrowserTargetId(WINDOW_ID, StoreId.SessionSchema.parse(tab.id))
        }
        taskTitles={taskTitles}
      />
    </div>
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
              width: width ?? CHAT_WINDOW_WIDTH,
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
                openTasksHere(tasksHref(chatId));
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
        {chat && (
          <ChatActivity
            chatId={chat.id}
            isCompact
            onOpen={(id) => {
              openTasksHere(taskHref(id, chatId));
            }}
            tasks={chat.runningTasks}
          />
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
      <div className="relative flex min-h-0 flex-1" ref={setBody}>
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
                    group: chatId,
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
                      ? tasksHref(chatId)
                      : taskHref(tasks.task, chatId),
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
                  group: chatId,
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
                            setLeftOutId(behindKey);
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
                    chatId={chatId}
                    tiles={tiles}
                  />
                </ActiveTabProvider>
              </LinkSurface>
            </FileOpenContext>
          </WindowContext>
        </div>
        {peekTab && (
          <div
            className="absolute inset-x-2 top-2 z-20 flex flex-col overflow-hidden rounded-xl bg-background shadow-xl-soft ring-1 ring-gray-300 select-none [--guest-bottom-radius:var(--radius-xl)] dark:ring-gray-600"
            data-slot="chat-peek"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setPeekId(undefined);
              }
            }}
            style={{ height: Math.max(0, peekRoom - 16) }}
          >
            <GroupItem
              closeTab={closeTab}
              group={chatId}
              isFramed={false}
              onClose={() => {
                setPeekId(undefined);
              }}
              onExpand={expandPeek}
              onPageChrome={setPeekChrome}
              onPageHost={setPeekHost}
              up={peekTab}
            />
          </div>
        )}
        {showsItem && (
          <div className="flex min-w-0 flex-1 flex-col bg-sidebar">
            <div className="min-h-0 flex-1">
              <GroupItem
                closeTab={closeTab}
                group={chatId}
                isFramed={false}
                // The row's × puts the view away; the thing stays in the
                // chat, among its tiles, as it does beside a chat in the window.
                onClose={() => {
                  setViewOpen(false);
                }}
                onPageChrome={onPageChrome}
                onPageHost={setPageHost}
                up={up}
              />
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
