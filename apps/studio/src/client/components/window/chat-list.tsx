import { type Draft } from "@/client/atoms/window";
import { Skeleton } from "@/client/components/ui/skeleton";
import { cn } from "@/client/lib/utils";
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
import { ChatRow } from "./chat-row";
import { byActivity, type Chat, type Topic } from "./chats";
import { DraftRow } from "./draft-row";
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
  ...row
}: {
  actionsFor: ReturnType<typeof useChatActionsFor>;
  appsBySlug: AppsBySlug;
  chat: Chat;
  handlers: RefObject<{
    onArchived: (chat: Chat) => void;
    onNewTopic: (chat: Chat, name?: string) => void;
    onOpen: (chat: Chat) => void;
    onSetTopics: (chat: Chat, topics: string[]) => void;
  }>;
  isArriving: boolean;
  isOpen: boolean;
  now: Date;
  topics: Topic[];
}) {
  return (
    <ChatRow
      {...row}
      actions={actionsFor(chat).map((action) =>
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
      onNewTopic={(name) => {
        handlers.current.onNewTopic(chat, name);
      }}
      onOpen={() => {
        handlers.current.onOpen(chat);
      }}
      onSetTopics={(next) => {
        handlers.current.onSetTopics(chat, next);
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
 * The inbox: every chat by when something last happened in it, newest at
 * the top, so a reply landing lifts its chat to the head of the list, or,
 * given drafts instead, every draft by when it was last touched. It opens at
 * the top and stays where the reader scrolled to.
 */
export function ChatList({
  appsBySlug,
  arrivedId,
  chats,
  drafts,
  emptyLine,
  isLoading,
  onArchiveOpen,
  onDeleteDraft,
  onNewTopic,
  onOpen,
  onOpenDraft,
  onSetTopics,
  onWiden,
  openId,
  outside = 0,
  scrollSignal,
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
  /** Whether the chats are still on their way: nothing is said about an empty list until they have arrived. */
  isLoading: boolean;
  /** Told when the open chat's row archives it, so the window can put the chat away with it. */
  onArchiveOpen?: () => void;
  onDeleteDraft: (id: string) => void;
  /** Opens the new-topic dialog for a chat: the topic it makes is filed on that chat. */
  onNewTopic: (chat: Chat, name?: string) => void;
  onOpen: (chat: Chat) => void;
  onOpenDraft: (id: string) => void;
  onSetTopics: (chat: Chat, topics: string[]) => void;
  /** Lifts the place, topic, and app filters so the search reads every chat. */
  onWiden?: () => void;
  /** The chat open beside the list, which its row is marked as. */
  openId: string | undefined;
  /** How many chats the search finds that the filters keep out of the list. */
  outside?: number;
  /** Counts up whenever the list should be taken back to its top, whatever the reader was doing. */
  scrollSignal: number;
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
  const handlers = useRef({ onArchived, onNewTopic, onOpen, onSetTopics });
  useLayoutEffect(() => {
    handlers.current = { onArchived, onNewTopic, onOpen, onSetTopics };
  });
  useLayoutEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [scrollSignal]);
  const rows: { key: string; node: () => ReactNode }[] = drafts
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
            topics={topics}
          />
        ),
      }))
    : byActivity(chats).map((chat) => ({
        key: chat.id,
        node: () => (
          <ListedChat
            actionsFor={actionsFor}
            appsBySlug={appsBySlug}
            chat={chat}
            handlers={handlers}
            isArriving={chat.id === arrivedId}
            isOpen={chat.id === openId}
            now={now}
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
  return (
    // Fading into the search over it once there is anything scrolled under
    // it, and at its foot while there is more below. The top pad is the
    // list's own, so the fade starts right at the search's edge.
    <div
      className={cn(
        "min-h-0 flex-1 overflow-y-auto pt-1 pb-4",
        isScrollable && "scroll-fade-y",
      )}
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
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {emptyLine}
          </p>
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
        finds elsewhere is said at the list's end, whether or not anything
        was found here, and pressing it widens the same search to every
        chat. */}
      {outside > 0 && !isLoading && (
        <p className="px-4 py-2 text-center text-sm">
          <button
            className="text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-foreground"
            onClick={onWiden}
            type="button"
          >
            {outside} more outside this filter
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * A row's shape, standing in while the chats load, at a row's own height: the
 * title's line, then the two lines' room a row keeps for its latest line.
 */
function RowSkeleton({ peek, title }: { peek: string; title: string }) {
  return (
    <div className="border-t border-border px-3 py-2.5 first:border-t-0">
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
