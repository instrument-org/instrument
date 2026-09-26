import { type Draft } from "@/client/atoms/orchestrator";
import { memo, type RefObject, useLayoutEffect, useRef, useState } from "react";

import { type AppsBySlug } from "./apps-by-slug";
import { DraftRow } from "./draft-row";
import { type RowDensity } from "./row-shell";
import { useThreadActionsFor } from "./thread-actions";
import { ThreadRow } from "./thread-row";
import { byActivity, type Thread, type Topic } from "./threads";
import { useNow } from "./use-now";

/** The width the list has to have, in px, before its rows lie down to one line each. */
const SLIM_FROM = 600;

/**
 * One thread's row, rendered again only when something it shows changes:
 * the list itself renders again on every thread opened and every change the
 * list's query brings, and a row that followed it would redraw the whole
 * inbox each time for the two rows whose mark moved.
 */
const ListedThread = memo(function ListedThread({
  actionsFor,
  handlers,
  thread,
  ...row
}: {
  actionsFor: ReturnType<typeof useThreadActionsFor>;
  appsBySlug: AppsBySlug;
  density: RowDensity;
  handlers: RefObject<{
    onNewTopic: (thread: Thread) => void;
    onOpen: (thread: Thread) => void;
    onSetTopics: (thread: Thread, topics: string[]) => void;
  }>;
  isArriving: boolean;
  isOpen: boolean;
  thread: Thread;
  topics: Topic[];
}) {
  return (
    <ThreadRow
      {...row}
      actions={actionsFor(thread)}
      onNewTopic={() => {
        handlers.current.onNewTopic(thread);
      }}
      onOpen={() => {
        handlers.current.onOpen(thread);
      }}
      onSetTopics={(next) => {
        handlers.current.onSetTopics(thread, next);
      }}
      thread={thread}
    />
  );
});

/**
 * The inbox: every thread by when something last happened in it, newest at
 * the top, so a reply landing lifts its thread to the head of the list, or,
 * given drafts instead, every draft by when it was last touched. The rows
 * take one line each when the list is wide enough for a mailbox's columns,
 * and three when it is not; the list measures its own width for that, since
 * the pane and the column beside it set it. It opens at the top and stays
 * where the reader scrolled to.
 */
export function ThreadList({
  appsBySlug,
  arrivedId,
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
  threads,
  topics,
}: {
  appsBySlug: AppsBySlug;
  /** The thread that just started from a draft, whose row arrives with a motion of its own. */
  arrivedId?: string;
  /** The drafts to list in place of the threads, while the column stands in Drafts. */
  drafts?: Draft[];
  /** What the list says when it has nothing to show. */
  emptyLine: string;
  /** Whether the threads are still on their way: nothing is said about an empty list until they have arrived. */
  isLoading: boolean;
  onDeleteDraft: (id: string) => void;
  /** Opens the new-topic dialog for a thread: the topic it makes is filed on that thread. */
  onNewTopic: (thread: Thread) => void;
  onOpen: (thread: Thread) => void;
  onOpenDraft: (id: string) => void;
  onSetTopics: (thread: Thread, topics: string[]) => void;
  /** Lifts the place, topic, and app filters so the search reads every thread. */
  onWiden?: () => void;
  /** The thread open beside the list, which its row is marked as. */
  openId: string | undefined;
  /** How many threads the search finds that the filters keep out of the list. */
  outside?: number;
  /** Counts up whenever the list should be taken back to its top, whatever the reader was doing. */
  scrollSignal: number;
  threads: Thread[];
  topics: Topic[];
}) {
  const now = useNow();
  const ref = useRef<HTMLDivElement>(null);
  const density = useDensity(ref);
  const actionsFor = useThreadActionsFor();
  // The handlers as the list last had them, for the rows to call: the ones
  // the list is handed are new whenever the window re-renders, and a row
  // handed a new one would render again with every other row each time a
  // thread is opened.
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
    : byActivity(threads).map((thread) => (
        <ListedThread
          actionsFor={actionsFor}
          appsBySlug={appsBySlug}
          density={density}
          handlers={handlers}
          isArriving={thread.id === arrivedId}
          isOpen={thread.id === openId}
          key={thread.id}
          thread={thread}
          topics={topics}
        />
      ));
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto pb-4"
      data-density={density}
      ref={ref}
    >
      {rows.length === 0 ? (
        !isLoading && (
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
        thread. */}
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
