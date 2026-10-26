import { BROWSER_HREF } from "@/client/atoms/window";
import { FileOpenContext } from "@/client/components/file-open-context";
import { ActiveTabProvider } from "@/client/hooks/use-active-tab";
import { cn } from "@/client/lib/utils";
import { outputFolderHref, useOutputFolder } from "@/client/lib/output-folder";
import {
  type ChatId,
  browserTargetOf,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { ChatsCircleIcon } from "@phosphor-icons/react/ChatsCircle";
import { MinusIcon } from "@phosphor-icons/react/Minus";
import { XIcon } from "@phosphor-icons/react/X";
import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useAppsBySlug } from "./apps-by-slug";
import { type PageChromeSlots } from "./browser-tabs";
import { ChatHeader } from "./chat-header";
import { ChatScreen } from "./chat-screen";
import { ChatTiles } from "./chat-tiles";
import { ChatMarkIcon } from "./chat-mark";
import {
  type Chat,
  chatMarkShown,
  draftTitle,
  railMarkOf,
  type Topic,
} from "./chats";
import {
  CHAT_WINDOW_WIDTH,
  COMPOSE_BAR_WIDTH,
  COMPOSE_GUEST_LAYER,
  COMPOSE_MOTION,
} from "./compose-layout";
import { BarMarks, WindowButton } from "./compose-window";
import { useWindow, WindowContext } from "./context";
import { ContextChips } from "./context-chip";
import { GroupItem } from "./group-item";
import { computerTabOf } from "./file-tabs";
import { LinkSurface } from "./link-surface";
import { usePageHost } from "./page-hosts";
import { taskHref, tasksHref, tasksOfHref } from "./tab-location";
import { useTaskTitles } from "./task-titles";
import { useChatContext } from "./use-chat-context";
import { useWindowTabs } from "./window-tabs";
import { ShimmerSweep } from "@/client/components/shimmer-sweep";

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
  // Put down, the chat is off screen, so it wears what its tab behind would.
  const { dot, isWorking } = chatMarkShown(
    chat ? railMarkOf([chat]) : undefined,
    { isUp: false },
  );
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
        <ChatMarkIcon
          dot={dot}
          icon={<ChatsCircleIcon className="size-3.5 shrink-0" />}
          // The bar's own ground, dark in either theme.
          ring="ring-gray-900 dark:ring-gray-800"
        />
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
            {isWorking && <ShimmerSweep text={chat?.title ?? "Chat"} />}
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
 * Pressing a tile peeks at that thing in a card over the conversation.
 * Expand takes the chat out of the corner into a tab of the window's own;
 * Expand on the card, and anything the conversation asks to have shown, do
 * the same with that thing up in the chat's pane. What the agent opens
 * behind stays behind.
 */
export function ChatWindow({
  arrives,
  chat,
  onClose,
  onCloseTab,
  onMinimize,
  onExpand,
  onNewTopic,
  onSetTopic,
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
  /** Takes the chat into a tab of the window's own, its pane open when the window asked for something to be shown. */
  onExpand: (options: { showsPane: boolean }) => void;
  /** Makes a topic, named for what was typed in the picker when anything was, and files the chat under it. */
  onNewTopic: (name?: string) => void;
  onSetTopic: (topic: null | string) => void;
  /** Where the window stands along the foot, in layout px from the right edge. */
  right: number;
  /** What goes with a reply: what is behind the window. */
  sendContext: (options: {
    isViewOpen: boolean;
    leftOut: readonly string[];
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
  const outputFolder = useOutputFolder();
  const tabs = windowTabs.allTabs.filter((tab) => tab.group === chatId);
  const isWorking = chat === undefined ? sentWords !== undefined : chat.working;
  const taskTitles = useTaskTitles();

  // The tab peeked at in the small window: a look, kept here and nowhere
  // else, so the tab the chat has up, which is what its pane shows in a
  // tab, is not moved by it.
  const [peekId, setPeekId] = useState<string>();
  const peekTab = tabs.find((tab) => tab.id === peekId);
  const [peekHost, setPeekHost] = useState<HTMLDivElement | null>(null);
  const [peekChrome, setPeekChrome] = useState<PageChromeSlots>();
  const peekPageId = peekTab?.kind === "page" ? peekTab.id : undefined;
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
  /** Takes the chat into a tab with the thing peeked at up in its pane. */
  const expandPeek = () => {
    if (peekTab) {
      select(peekTab.id);
    }
  };
  const chatTitles = new Map<ChatId, string>(
    chat === undefined ? [] : [[chat.id, chat.title]],
  );

  // The window draws only the page it peeks at, in the card's host.
  usePageHost(
    chatId,
    peekPageId === undefined
      ? undefined
      : {
          chrome: peekChrome ?? false,
          into: peekHost,
          isActive: true,
          layer: COMPOSE_GUEST_LAYER,
          place: `peek:${right}:${width ?? ""}`,
          tabId: peekPageId,
        },
  );

  // What goes with each message besides its words, as the chips over the
  // composer: what is in view behind the chat, each until its x is pressed.
  // The send reads the same list at the press.
  const context = useChatContext({
    chatId,
    isPoppedOut: true,
    isViewOpen: false,
  });
  const contextRef = useRef({ isViewOpen: false, leftOut: context.leftOut });
  useEffect(() => {
    contextRef.current = { isViewOpen: false, leftOut: context.leftOut };
  });
  const contextToSend = () => sendContext(contextRef.current);

  /** Takes the chat into a tab with what is up in it shown in its pane. */
  const showUp = () => {
    onExpand({ showsPane: true });
  };
  const select = (id: string) => {
    windowTabs.select(id);
    showUp();
  };
  // A new tab each time: the person asked for another, even of a kind the
  // chat already has open. One a link opened closes on back from its start;
  // one the person added from the tiles stays.
  const openHere = (href: string, { isOpened }: { isOpened: boolean }) => {
    windowTabs.openScreen(href, {
      group: chatId,
      isOpened,
      select: true,
    });
    showUp();
  };
  /** The chat's tasks or one of them, up in the chat's pane in a tab: the tab already at that address, or a new one. */
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
        chosenId={peekTab?.id}
        isChatWorking={isWorking}
        onAddComputer={() => {
          openHere(outputFolderHref(outputFolder), { isOpened: false });
        }}
        onAddWeb={() => {
          openHere(BROWSER_HREF, { isOpened: false });
        }}
        onClose={onCloseTab}
        onReorder={(keys) => {
          windowTabs.reorder(keys, chatId);
        }}
        // A press peeks, and a press on the tile peeked at puts it down.
        onSelect={(id) => {
          setPeekId((current) => (current === id ? undefined : id));
        }}
        tabs={tabs}
        targetOf={(tab) => browserTargetOf(tab.id)}
        taskTitles={taskTitles}
      />
    </div>
  );

  return (
    <motion.div
      animate={{ opacity: 1, right, y: 0 }}
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
        "bottom-[calc(1px/var(--app-zoom))] max-h-[calc(100%-3.5rem)] rounded-t-2xl [clip-path:inset(-4rem_-4rem_0_-4rem)]",
      )}
      data-slot="chat-window"
      exit={{ opacity: 0, y: 24 }}
      initial={arrives ? { opacity: 0, right, y: 24 } : false}
      style={{
        height: CHAT_WINDOW_HEIGHT,
        width: width ?? CHAT_WINDOW_WIDTH,
      }}
      transition={COMPOSE_MOTION}
    >
      <ChatHeader
        chat={chat}
        fallbackTitle={
          sentWords === undefined ? undefined : draftTitle(sentWords)
        }
        // An archived chat is put away, so its window goes with it.
        onArchived={onClose}
        onDeleted={onClose}
        onNewTopic={onNewTopic}
        onOpenTask={(id) => {
          openTasksHere(taskHref(id, chatId));
        }}
        onSetTopic={onSetTopic}
        onViewTasks={() => {
          openTasksHere(tasksHref(chatId));
        }}
        topics={topics}
        trailing={
          <div className="flex shrink-0 items-center gap-0.5">
            <WindowButton label="Minimize" onClick={onMinimize}>
              <MinusIcon className="size-4" />
            </WindowButton>
            <WindowButton
              label="Expand"
              onClick={() => {
                onExpand({ showsPane: false });
              }}
            >
              <ArrowsOutSimpleIcon className="size-4" />
            </WindowButton>
            <WindowButton label="Close" onClick={onClose}>
              <XIcon className="size-4" />
            </WindowButton>
          </div>
        }
      />
      <div className="relative flex min-h-0 flex-1" ref={setBody}>
        {/* The sizes are the chat column's. */}
        <div
          className={cn(
            "relative min-h-0 min-w-0 flex-1 [&_.prose]:text-[13px] [&_.prose]:leading-5 [&_.text-sm]:text-[13px]",
          )}
        >
          {/* What the conversation asks to have shown takes the chat into a
              tab with it up in the pane; what it opens behind (an agent's
              page arriving) stays behind. A screen the pane cannot draw
              goes where it can be. */}
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
                  openHere(href, { isOpened: true });
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
                      context.chips.length > 0 ? (
                        <ContextChips
                          items={context.chips}
                          onLeaveOut={context.leaveOut}
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
            className="absolute inset-x-2 top-2 z-20 flex flex-col overflow-hidden rounded-xl bg-background shadow-xl-soft ring-1 ring-gray-300 [--guest-bottom-radius:var(--radius-xl)] dark:ring-gray-600"
            data-slot="chat-peek"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setPeekId(undefined);
              }
            }}
            style={{ height: Math.max(0, peekRoom - 16) }}
          >
            <GroupItem
              closeTab={onCloseTab}
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
      </div>
    </motion.div>
  );
}
