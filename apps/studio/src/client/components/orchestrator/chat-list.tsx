import { type Draft } from "@/client/atoms/orchestrator";
import { Skeleton } from "@/client/components/ui/skeleton";
import { cn } from "@/client/lib/utils";
import { memo, type RefObject, useLayoutEffect, useRef, useState } from "react";

import { type AppsBySlug } from "./apps-by-slug";
import { useChatActionsFor } from "./chat-actions";
import { ChatRow } from "./chat-row";
import { byActivity, type Chat, type Topic } from "./chats";
import { DraftRow } from "./draft-row";
import { type RowDensity, SLIM_NAME_COLUMN } from "./row-shell";
import { useNow } from "./use-now";

/** The width the list has to have, in px, before its rows lie down to one line each. */
const SLIM_FROM = 600;

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
  density: RowDensity;
  handlers: RefObject<{
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
      actions={actionsFor(chat)}
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
 * The inbox: every chat by when something last happened in it, newest at
 * the top, so a reply landing lifts its chat to the head of the list, or,
 * given drafts instead, every draft by when it was last touched. The rows
 * take one line each when the list is wide enough for a mailbox's columns,
 * and three when it is not; the list measures its own width for that, since
 * the pane and the column beside it set it. It opens at the top and stays
 * where the reader scrolled to.
 */
export function ChatList({
  appsBySlug,
  arrivedId,
  chats,
  drafts,
  emptyLine,
  isLoading,
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
  const density = useDensity(ref);
  const actionsFor = useChatActionsFor();
  // The handlers as the list last had them, for the rows to call: the ones
  // the list is handed are new whenever the window re-renders, and a row
  // handed a new one would render again with every other row each time a
  // chat is opened.
  const handlers = useRef({ onNewTopic, onOpen, onSetTopics });
  useLayoutEffect(() => {
    handlers.current = { onNewTopic, onOpen, onSetTopics };
  });
  useLayoutEffect(() => {
    ref.current?.scrollTo({ top: 0 });
  }, [scrollSignal]);
  const rows = drafts
    ? byActivity(drafts).map((draft) => (
        <DraftRow
          density={density}
          draft={draft}
          key={draft.id}
          now={now}
          onDelete={() => {
            onDeleteDraft(draft.id);
          }}
          onOpen={() => {
            onOpenDraft(draft.id);
          }}
          topics={topics}
        />
      ))
    : byActivity(chats).map((chat) => (
        <ListedChat
          actionsFor={actionsFor}
          appsBySlug={appsBySlug}
          chat={chat}
          density={density}
          handlers={handlers}
          isArriving={chat.id === arrivedId}
          isOpen={chat.id === openId}
          key={chat.id}
          now={now}
          topics={topics}
        />
      ));
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
      data-density={density}
      ref={ref}
    >
      {rows.length === 0 ? (
        isLoading ? (
          <div aria-busy className="mx-2" role="status">
            {SKELETON_WIDTHS.map(([title, peek]) => (
              <RowSkeleton
                density={density}
                key={`${title} ${peek}`}
                peek={peek}
                title={title}
              />
            ))}
          </div>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {emptyLine}
          </p>
        )
      ) : (
        // Inset from the list's edges, so the hairlines between rows stop
        // short of them and the open row's card has air at its sides.
        <div className="mx-2">{rows}</div>
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

/** A row's shape at the list's density, standing in while the chats load. */
function RowSkeleton({
  density,
  peek,
  title,
}: {
  density: RowDensity;
  peek: string;
  title: string;
}) {
  return (
    <div
      className={cn(
        "flex gap-2 border-t border-border px-2 first:border-t-0",
        density === "slim" ? "h-9 items-center" : "flex-col py-2.5",
      )}
    >
      {density === "slim" ? (
        <>
          <span className="size-5 shrink-0" />
          <span className={SLIM_NAME_COLUMN}>
            <Skeleton className="h-3" style={{ width: title }} />
          </span>
          <Skeleton className="h-3 flex-1" style={{ maxWidth: peek }} />
        </>
      ) : (
        <>
          <div className="flex h-5 items-center">
            <Skeleton className="h-3" style={{ width: title }} />
          </div>
          <Skeleton className="h-3" style={{ width: peek }} />
        </>
      )}
    </div>
  );
}

/**
 * Which shape the rows take, from the list's own width: the pane is resized
 * by hand and the column beside the list changes shape on its own, so the
 * list is measured rather than told. Tall until measured, which is the shape
 * that fits anywhere.
 */
function useDensity(ref: React.RefObject<HTMLDivElement | null>): RowDensity {
  const [isSlim, setSlim] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    const measure = () => {
      setSlim(element.clientWidth >= SLIM_FROM);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);
  return isSlim ? "slim" : "tall";
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
