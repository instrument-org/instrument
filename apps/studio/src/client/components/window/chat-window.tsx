import { FileOpenContext } from "@/client/components/file-open-context";
import { ActiveTabProvider } from "@/client/hooks/use-active-tab";
import { cn } from "@/client/lib/utils";
import {
  type ChatId,
  type SessionMessageDataPart,
} from "@instrument-org/workspace/client";
import { fileHref, folderHref } from "@/shared/computer-href";
import { ChipPresence } from "@/client/components/attached-item-preview";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/ArrowsOutSimple";
import { ChatsCircleIcon } from "@phosphor-icons/react/ChatsCircle";
import { MinusIcon } from "@phosphor-icons/react/Minus";
import { XIcon } from "@phosphor-icons/react/X";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useEffect, useRef } from "react";

import { ChatHeader } from "./chat-header";
import { ChatScreen } from "./chat-screen";
import { ChatMarkIcon } from "./chat-mark";
import {
  type Chat,
  chatMarkShown,
  draftTitle,
  railMarkOf,
  type Project,
} from "./chats";
import {
  CHAT_WINDOW_WIDTH,
  COMPOSE_BAR_WIDTH,
  COMPOSE_MOTION,
} from "./compose-layout";
import { WindowButton } from "./compose-window";
import { asksOwnPlace, useWindow, WindowContext } from "./context";
import { ContextChips, ContextSuggestion } from "./context-chip";
import { type ContextItem } from "./context-items";
import { computerTabOf } from "./file-tabs";
import { LinkSurface } from "./link-surface";
import { taskHref, tasksOfHref } from "./tab-location";
import { useChatContext } from "./use-chat-context";
import { useWindowTabs } from "./window-tabs";
import { ShimmerSweep } from "@/client/components/shimmer-sweep";

/** A chat's small view's height, in layout px: enough of the conversation to follow a reply arriving. */
const CHAT_WINDOW_HEIGHT = 560;

/**
 * A chat put down: a dark bar along the window's foot with its title and
 * the pulse while it works, brought back up by a press, taken down by its
 * cross. The chat itself is untouched by either. Flush with the foot in the
 * light theme, where it has no ring to double the edge the system draws
 * there; a screen pixel up in the dark one, where it has.
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
  const isPresent = useIsPresent();
  // Put down, the chat is off screen, so it wears what its tab behind would.
  const { dot, isWorking } = chatMarkShown(
    chat ? railMarkOf([chat]) : undefined,
    { isUp: false },
  );
  return (
    <motion.div
      animate={{ opacity: 1, right, y: 0 }}
      className="pointer-events-auto absolute bottom-0 z-40 flex h-9 items-center overflow-hidden rounded-t-lg bg-gray-900 text-[12px] font-medium text-white shadow-xl-soft [clip-path:inset(-4rem_-4rem_0_-4rem)] dark:bottom-[calc(1px/var(--app-zoom))] dark:bg-gray-800 dark:ring-1 dark:ring-[color-mix(in_srgb,#fff_10%,var(--background))]"
      data-slot="chat-bar"
      exit={{ opacity: 0, y: 36 }}
      inert={!isPresent}
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
 * video keeps playing in its small window over the page that owns it. Its head
 * carries the chat's title, projects and menu as the chat's own head draws
 * them, and the window's buttons.
 *
 * Expand takes the chat out of the corner into a tab of the window's own, and
 * anything the conversation asks to have shown does the same with that thing up
 * in the chat's pane. What the agent opens behind stays behind.
 */
export function ChatWindow({
  arrives,
  chat,
  onClose,
  onMinimize,
  onExpand,
  onNewProject,
  onSetProject,
  right,
  sendContext,
  sentWords,
  chatId,
  projects,
  width,
}: {
  /** Whether the window arrives with a motion: a draft becoming the chat is the same window, so it does not. */
  arrives: boolean;
  chat: Chat | undefined;
  onClose: () => void;
  onMinimize: () => void;
  /** Takes the chat into a tab of the window's own, its pane open when the window asked for something to be shown. */
  onExpand: (options: { showsPane: boolean }) => void;
  /** Makes a project, named for what was typed in the picker when anything was, and files the chat under it. */
  onNewProject: (name?: string) => void;
  onSetProject: (project: null | string) => void;
  /** Where the window stands along the foot, in layout px from the right edge. */
  right: number;
  /** What goes with a reply: what the person took from what is behind the window. */
  sendContext: (options: {
    isViewOpen: boolean;
    taken: readonly ContextItem[];
  }) => Promise<SessionMessageDataPart.ViewContextDataPart | undefined>;
  /** The words the draft this window was sent, while the chat they start is on its way. */
  sentWords?: string;
  chatId: ChatId;
  projects: Project[];
  /** The window's width, narrower than its own on a row with less room. */
  width?: number;
}) {
  // On its way out it is still drawn, with the handlers of the render before
  // it left, so it takes no input then: a second press of Expand would act on
  // tabs as they stood before the first.
  const isPresent = useIsPresent();
  const appWindow = useWindow();
  const windowTabs = useWindowTabs();

  // What goes with the next message besides its words, as the chips over the
  // composer: what the person took from what is behind the chat, which is
  // offered beside them. The send reads the same list at the press, and the
  // row is empty again once the message has gone.
  const context = useChatContext({
    chatId,
    isPoppedOut: true,
    isViewOpen: false,
  });
  const contextRef = useRef({ isViewOpen: false, taken: context.taken });
  useEffect(() => {
    contextRef.current = { isViewOpen: false, taken: context.taken };
  });
  const contextToSend = async () => {
    const sending = await sendContext(contextRef.current);
    context.sent();
    return sending;
  };
  /** A chip pressed: what it names comes up on the screen behind the chat, where it was taken from. */
  const showBehind = (item: ContextItem) => {
    if (item.kind !== "tab") {
      return;
    }
    const [one] = item.items ?? [];
    if (one) {
      appWindow.openScreen(
        one.kind === "folder" ? folderHref(one.path) : fileHref(one.path),
      );
    } else if (item.tab.kind === "page") {
      if (item.tab.url !== undefined) {
        appWindow.openPage(item.tab.url);
      }
    } else {
      appWindow.openScreen(item.tab.href);
    }
  };

  /** Takes the chat into a tab with what is up in it shown in its pane. */
  const showUp = () => {
    onExpand({ showsPane: true });
  };
  const select = (id: string) => {
    windowTabs.select(id);
    showUp();
  };
  // A new tab each time: the person asked for another, even of a kind the
  // chat already has open. One a link opened closes on back from its start.
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
      inert={!isPresent}
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
        onNewProject={onNewProject}
        onSetProject={onSetProject}
        projects={projects}
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
      <div className="relative flex min-h-0 flex-1">
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
                if (options?.show && !asksOwnPlace(options)) {
                  openPage(url);
                  return;
                }
                appWindow.openPage(url, options);
              },
              openPath: (path, options) => {
                if (options?.show && !asksOwnPlace(options)) {
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
                if (asksOwnPlace(options)) {
                  appWindow.openScreen(href, options);
                  return;
                }
                if (options?.show && computerTabOf(href)) {
                  openHere(href, { isOpened: true });
                  return;
                }
                const tasks = tasksOfHref(href);
                if (options?.show && tasks) {
                  openTasksHere(taskHref(tasks.task, chatId));
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
                if (asksOwnPlace(options)) {
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
                          onShow={showBehind}
                        />
                      ) : undefined
                    }
                    // What is behind is offered beside the plus, as a
                    // docked draft offers it, and goes over the words once
                    // taken.
                    composerOffer={
                      <AnimatePresence initial={false}>
                        {context.suggestion && (
                          <ChipPresence key={context.suggestion.key}>
                            <ContextSuggestion
                              item={context.suggestion}
                              onTake={() => {
                                if (context.suggestion) {
                                  context.take(context.suggestion);
                                }
                              }}
                            />
                          </ChipPresence>
                        )}
                      </AnimatePresence>
                    }
                    isUp
                    onGone={onClose}
                    sendContext={contextToSend}
                    sentPrompt={sentWords}
                    chatId={chatId}
                  />
                </ActiveTabProvider>
              </LinkSurface>
            </FileOpenContext>
          </WindowContext>
        </div>
      </div>
    </motion.div>
  );
}
