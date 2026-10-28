import { type Draft } from "@/shared/drafts";
import { Skeleton } from "@/client/components/ui/skeleton";
import { keepKeyboardInList, letGoOfList } from "@/client/lib/keyboard-home";
import { cn } from "@/client/lib/utils";
import { PictureInPictureIcon } from "@phosphor-icons/react/PictureInPicture";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Fragment,
  memo,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { type AppsBySlug } from "./apps-by-slug";
import { useChatActionsFor } from "./chat-actions";
import { PlaceIcon } from "./place-icons";
import { ChatRow } from "./chat-row";
import { byLastUserMessage, byActivity, type Chat, type Topic } from "./chats";
import { DraftRow } from "./draft-row";
import { type RowAction } from "./row-shell";
import { useNow } from "./use-now";

/**
 * One chat's row, rendered again only when something it shows changes:
 * the list itself renders again on every chat opened and every change the
 * list's query brings, and a row that followed it would redraw the whole
 * inbox each time for the two rows whose mark moved.
 */
const ListedChat = memo(function ListedChat({
  actionsFor,
  chat,
  handlers,
  isOut,
  ...row
}: {
  actionsFor: ReturnType<typeof useChatActionsFor>;
  appsBySlug: AppsBySlug;
  chat: Chat;
  handlers: RefObject<{
    onArchived: (chat: Chat) => void;
    onDelete: (chat: Chat) => void;
    onNewTopic: (chat: Chat, name?: string) => void;
    onOpen: (chat: Chat) => void;
    onPopOut: ((chat: Chat) => void) | undefined;
    onSetTopic: (chat: Chat, topic: null | string) => void;
  }>;
  isArriving: boolean;
  isOpen: boolean;
  /** Whether the chat already stands in a window of its own over the row. */
  isOut: boolean;
  now: Date;
  search: string;
  spaceTopicId: string | undefined;
  topics: Topic[];
}) {
  // First on the tile and beside the ways to open it in the menu, while the
  // chat is not already up in a window of its own; one put down to the bar
  // is raised again.
  const popOut: RowAction[] =
    handlers.current.onPopOut && !isOut
      ? [
          {
            icon: <PictureInPictureIcon className="size-3.5" />,
            id: "popOut",
            label: "Pop out",
            run: () => {
              handlers.current.onPopOut?.(chat);
            },
          },
        ]
      : [];
  return (
    <ChatRow
      {...row}
      actions={[...popOut, ...actionsFor(chat)].map((action) =>
        action.id === "archive"
          ? {
              ...action,
              run: () => {
                action.run();
                handlers.current.onArchived(chat);
              },
            }
          : action,
      )}
      chat={chat}
      onDelete={() => {
        handlers.current.onDelete(chat);
      }}
      onNewTopic={(name) => {
        handlers.current.onNewTopic(chat, name);
      }}
      onOpen={() => {
        handlers.current.onOpen(chat);
      }}
      onSetTopic={(next) => {
        handlers.current.onSetTopic(chat, next);
      }}
    />
  );
});

/** A row's height before it is measured: a chat with a line under its title. */
const ROW_ESTIMATE = 88;

/**
 * The title's and the latest line's widths of each placeholder row, varied so
 * the list reads as rows of text on their way rather than as a grid of bars.
 */
const SKELETON_WIDTHS = [
  ["45%", "80%"],
  ["60%", "65%"],
  ["35%", "90%"],
  ["55%", "70%"],
  ["40%", "85%"],
  ["50%", "60%"],
] as const;

/**
 * How many rows stand in while the chats load: more than the tallest pane
 * holds, clipped to it, so the list arrives into the height it had rather
 * than growing past a few rows.
 */
const SKELETON_ROWS = 16;

/**
 * The inbox: every chat by when the user last messaged it, newest at
 * the top, with live activity updating each row in place, or,
 * given drafts instead, every draft by when it was last touched. It opens at
 * the top and stays where the reader scrolled to.
 */
export function ChatList({
  appsBySlug,
  arrivedId,
  chats,
  drafts,
  emptyLine,
  hasFoot = false,
  isLoading,
  onArchiveOpen,
  onDelete,
  onDeleteDraft,
  onNewTopic,
  onOpen,
  onOpenDraft,
  onPopOut,
  onSetTopic,
  onWiden,
  openId,
  outIds,
  outside = 0,
  scrollSignal,
  search = "",
  spaceTopicId,
  topics,
}: {
  appsBySlug: AppsBySlug;
  /** The chat that just started from a draft, whose row arrives with a motion of its own. */
  arrivedId?: string;
  chats: Chat[];
  /** The drafts to list in place of the chats, while the column stands in Drafts. */
  drafts?: Draft[];
  /** What the list says when it has nothing to show. */
  emptyLine: string;
  /** Whether something is laid over the list's foot, which the last row scrolls clear of and the rows fade out under. */
  hasFoot?: boolean;
  /** Whether the chats are still on their way: nothing is said about an empty list until they have arrived. */
  isLoading: boolean;
  /** Told when the open chat's row archives it, so the window can put the chat away with it. */
  onArchiveOpen?: () => void;
  /** Asks before a chat goes to the trash, through the caller's dialog. */
  onDelete: (chat: Chat) => void;
  onDeleteDraft: (id: string) => void;
  /** Opens the new-topic dialog for a chat: the topic it makes is filed on that chat. */
  onNewTopic: (chat: Chat, name?: string) => void;
  onOpen: (chat: Chat) => void;
  onOpenDraft: (id: string) => void;
  /** Floats a chat in a window of its own over the row; a row offers it only when given. */
  onPopOut?: (chat: Chat) => void;
  onSetTopic: (chat: Chat, topic: null | string) => void;
  /** Lifts the place, topic, and app filters so the search reads every chat. */
  onWiden?: () => void;
  /** The chat open beside the list, which its row is marked as. */
  openId: string | undefined;
  /** The chats already up in a window of their own, whose rows do not offer to pop them out. */
  outIds?: ReadonlySet<string>;
  /** How many chats the search finds that the filters keep out of the list. */
  outside?: number;
  /** Changes whenever the list should be taken back to its top, whatever the reader was doing. */
  scrollSignal: number | string;
  /** The words a row marks where they turn up: the search the chats were found by, when they were found by their words. */
  search?: string;
  /** The topic the list stands in, whose name a row leaves off since every row there wears it. */
  spaceTopicId?: string;
  topics: Topic[];
}) {
  const now = useNow();
  const ref = useRef<HTMLDivElement>(null);
  const actionsFor = useChatActionsFor();
  // The handlers as the list last had them, for the rows to call: the ones
  // the list is handed are new whenever the window re-renders, and a row
  // handed a new one would render again with every other row each time a
  // chat is opened.
  const onArchived = (chat: Chat) => {
    if (chat.id === openId) {
      onArchiveOpen?.();
    }
  };
  const handlers = useRef({
    onArchived,
    onDelete,
    onNewTopic,
    onOpen,
    onPopOut,
    onSetTopic,
  });
  useLayoutEffect(() => {
    handlers.current = {
      onArchived,
      onDelete,
      onNewTopic,
      onOpen,
      onPopOut,
      onSetTopic,
    };
  });
  useLayoutEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [scrollSignal]);
  const rows: {
    key: string;
    node: () => ReactNode;
    /** Opens the row's chat beside the list; a draft's row has none. */
    open?: () => void;
  }[] = drafts
    ? byActivity(drafts).map((draft) => ({
        key: draft.id,
        node: () => (
          <DraftRow
            draft={draft}
            now={now}
            onDelete={() => {
              onDeleteDraft(draft.id);
            }}
            onOpen={() => {
              onOpenDraft(draft.id);
            }}
            spaceTopicId={spaceTopicId}
            topics={topics}
          />
        ),
      }))
    : byLastUserMessage(chats).map((chat) => ({
        key: chat.id,
        open: () => {
          handlers.current.onOpen(chat);
        },
        node: () => (
          <ListedChat
            actionsFor={actionsFor}
            appsBySlug={appsBySlug}
            chat={chat}
            handlers={handlers}
            isArriving={chat.id === arrivedId}
            isOpen={chat.id === openId}
            isOut={outIds?.has(chat.id) ?? false}
            now={now}
            search={search}
            spaceTopicId={spaceTopicId}
            topics={topics}
          />
        ),
      }));
  // Only the rows in view and a screen's worth either side are mounted: a
  // workspace holds hundreds of chats, and every mounted row carries its
  // menus and chips. Rows differ in height, so each is measured as it mounts.
  // oxlint-disable-next-line react/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_ESTIMATE,
    getItemKey: (index) => rows[index]?.key ?? index,
    getScrollElement: () => ref.current,
    overscan: 8,
  });
  // The mounted rows stay siblings in the flow, with the height of the rows
  // above and below them standing in as spacers: a row draws its hairline
  // against the row before it, drops it as the first, and hides it beside a
  // hovered or open row, all through sibling selectors a wrapper per row
  // would break.
  const listRef = useRef<HTMLDivElement>(null);
  const items = virtualizer.getVirtualItems();
  const before = items[0]?.start ?? 0;
  const after = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);
  useLayoutEffect(() => {
    const mounted = [...(listRef.current?.children ?? [])].filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element.dataset.spacer === undefined,
    );
    for (const [position, element] of mounted.entries()) {
      const item = items[position];
      if (item) {
        element.dataset.index = String(item.index);
        virtualizer.measureElement(element);
      }
    }
  });
  const isScrollable = useIsScrollable(ref, rows.length);
  // The chat a held arrow stopped on, opened as the key is let go of.
  const pendingOpen = useRef<null | { open: () => void; timer: number }>(null);
  const clearPending = () => {
    if (pendingOpen.current) {
      window.clearTimeout(pendingOpen.current.timer);
      pendingOpen.current = null;
    }
  };
  const openPending = () => {
    const pending = pendingOpen.current;
    clearPending();
    pending?.open();
  };
  // The keyboard onto a row once it is drawn, which a row scrolled to may
  // not be yet.
  const focusRowWhenDrawn = (index: number) => {
    let frames = 0;
    const attempt = () => {
      const row = listRef.current?.querySelector<HTMLElement>(
        `[data-index="${index}"]`,
      );
      if (row) {
        row.focus({ preventScroll: true });
        return;
      }
      frames += 1;
      if (frames < DRAW_WAIT_FRAMES) {
        requestAnimationFrame(attempt);
      }
    };
    attempt();
  };
  const widen = (
    <button
      className="text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground"
      onClick={onWiden}
      type="button"
    >
      {outside} more outside this filter
    </button>
  );
  return (
    // Fading into the head over it once there is anything scrolled under
    // it, and at its foot while there is more below. No pad at the top: the
    // first row's hairline meets the head, tinted as it is under a topic.
    <div
      className={cn(
        "min-h-0 flex-1 overflow-y-auto",
        hasFoot ? "pb-14 [--scroll-fade-foot:4rem]" : "pb-4",
        isScrollable && "scroll-fade-y",
      )}
      data-chat-list
      // After the composer of the chat open beside it.
      data-keyboard-home="2"
      // Up and down walk the rows, opening each chat as the keyboard passes
      // it while the keyboard stays in the list; Return goes on into the
      // chat's composer.
      onKeyDown={(event) => {
        const row =
          event.target instanceof HTMLElement &&
          event.target.dataset.index !== undefined
            ? event.target
            : null;
        if (
          !row ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey
        ) {
          return;
        }
        const at = Number(row.dataset.index);
        if (event.key === "Enter") {
          openPending();
          letGoOfList();
          if (rows[at]?.open) {
            focusComposerWhenDrawn();
          }
          return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
          return;
        }
        event.preventDefault();
        const next = at + (event.key === "ArrowDown" ? 1 : -1);
        const entry = rows[next];
        if (!entry) {
          return;
        }
        keepKeyboardInList(event.currentTarget);
        // Held down, the rows go by as fast as the key repeats, and the
        // chat the key stops on opens once it is let go of (or rests).
        clearPending();
        if (event.repeat && entry.open) {
          pendingOpen.current = {
            open: entry.open,
            timer: window.setTimeout(openPending, HELD_OPEN_REST_MS),
          };
        } else {
          entry.open?.();
        }
        virtualizer.scrollToIndex(next);
        focusRowWhenDrawn(next);
      }}
      onKeyUp={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          openPending();
        }
      }}
      ref={ref}
    >
      {rows.length === 0 ? (
        isLoading ? (
          <div aria-busy className="h-full overflow-hidden" role="status">
            {Array.from({ length: SKELETON_ROWS }, (_, index) => {
              const [title, peek] =
                SKELETON_WIDTHS[index % SKELETON_WIDTHS.length] ??
                SKELETON_WIDTHS[0];
              return <RowSkeleton key={index} peek={peek} title={title} />;
            })}
          </div>
        ) : (
          // In the middle of the list's room, a touch above center where
          // the eye expects it, under the plate No chat open draws its mark
          // on, smaller here.
          <div className="grid h-full place-items-center px-8 pb-16">
            <div className="flex flex-col items-center text-center text-[13px]">
              <span
                aria-hidden
                className="mb-3 grid size-11 place-items-center rounded-xl text-muted-foreground/30 inset-ring inset-ring-current/60"
              >
                <PlaceIcon className="size-6" place="chat" weight="thin" />
              </span>
              <p className="max-w-56 leading-5 text-balance text-muted-foreground/60">
                {emptyLine}
              </p>
              {outside > 0 && <p className="mt-2">{widen}</p>}
            </div>
          </div>
        )
      ) : (
        // Edge to edge, as the open row's bar and the hover tint are: each
        // row pads its words in by 12px, a step inside the 8px line the
        // search and the filters stand on.
        <div ref={listRef}>
          {before > 0 && (
            <div aria-hidden data-spacer style={{ height: before }} />
          )}
          {items.map((item) => (
            <Fragment key={item.key}>{rows[item.index]?.node()}</Fragment>
          ))}
          {after > 0 && (
            <div aria-hidden data-spacer style={{ height: after }} />
          )}
        </div>
      )}
      {/* The search reads inside the place the column stands in, so what it
        finds elsewhere is said at the list's end, or under the empty line
        when nothing was found here, and pressing it widens the same search
        to every chat. */}
      {outside > 0 && !isLoading && rows.length > 0 && (
        <p className="px-4 py-2 text-center text-sm">{widen}</p>
      )}
    </div>
  );
}

/** How long a held arrow rests on a row before its chat opens, in ms. */
const HELD_OPEN_REST_MS = 150;

/** How long a row or a composer has to be drawn before the keyboard is put on it, in frames. */
const DRAW_WAIT_FRAMES = 30;

/**
 * The keyboard into the composer of the chat open beside the list, once it
 * is drawn: the one already open, or the one Return just opened.
 */
function focusComposerWhenDrawn() {
  let frames = 0;
  const attempt = () => {
    const words = document.querySelector<HTMLElement>(
      '[data-app-tab-active] [data-keyboard-home="1"] [contenteditable="true"]',
    );
    if (words?.checkVisibility()) {
      words.focus();
      return;
    }
    frames += 1;
    if (frames < DRAW_WAIT_FRAMES) {
      requestAnimationFrame(attempt);
    }
  };
  requestAnimationFrame(attempt);
}

/**
 * A row's shape, standing in while the chats load, at a row's own height: the
 * title's line, then the two lines' room a row keeps for its latest line.
 */
function RowSkeleton({ peek, title }: { peek: string; title: string }) {
  return (
    <div className="border-t border-border/70 px-4 py-2.5">
      <div className="flex h-5 items-center">
        <Skeleton className="h-3" style={{ width: title }} />
      </div>
      <div className="mt-0.5 flex min-h-10 flex-col justify-center gap-2">
        <Skeleton className="h-3" style={{ width: peek }} />
        <Skeleton className="h-3" style={{ width: "40%" }} />
      </div>
    </div>
  );
}

/**
 * Whether the list runs past its own height, measured on every change of its
 * size or its rows. The fade has to be taken off a list that stops
 * scrolling, since its scroll timeline holds the last fade it drew once the
 * list fits, and a filter narrows the list that far all the time.
 */
function useIsScrollable(
  ref: React.RefObject<HTMLDivElement | null>,
  rowCount: number,
): boolean {
  const [isScrollable, setScrollable] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const measure = () => {
      setScrollable(element.scrollHeight > element.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref, rowCount]);
  return isScrollable;
}
