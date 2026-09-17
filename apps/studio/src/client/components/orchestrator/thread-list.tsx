import { type Draft } from "@/client/atoms/orchestrator";
import { useLayoutEffect, useRef, useState } from "react";

import { type AppsBySlug } from "./apps-by-slug";
import { DraftRow } from "./draft-row";
import { type RowDensity } from "./row-shell";
import { ThreadRow } from "./thread-row";
import { byActivity, type Thread, type Topic } from "./threads";
import { useNow } from "./use-now";

/** The width the list has to have, in px, before its rows lie down to one line each. */
const SLIM_FROM = 600;

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
  drafts,
  emptyLine,
  isLoading,
  onDeleteDraft,
  onNewTopic,
  onOpen,
  onOpenDraft,
  onSetTopics,
  openId,
  scrollSignal,
  threads,
  topics,
}: {
  appsBySlug: AppsBySlug;
  /** The drafts to list in place of the threads, while the column stands in Drafts. */
  drafts?: Draft[];
  /** What the list says when it has nothing to show. */
  emptyLine: string;
  /** Whether the threads are still on their way: nothing is said about an empty list until they have arrived. */
  isLoading: boolean;
  onDeleteDraft: (id: string) => void;
  onNewTopic: () => void;
  onOpen: (thread: Thread) => void;
  onOpenDraft: (id: string) => void;
  onSetTopics: (thread: Thread, topics: string[]) => void;
  /** The thread open beside the list, which its row is marked as. */
  openId: string | undefined;
  /** Counts up whenever the list should be taken back to its top, whatever the reader was doing. */
  scrollSignal: number;
  threads: Thread[];
  topics: Topic[];
}) {
  const now = useNow();
  const ref = useRef<HTMLDivElement>(null);
  const density = useDensity(ref);
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
        <ThreadRow
          appsBySlug={appsBySlug}
          density={density}
          isOpen={thread.id === openId}
          key={thread.id}
          now={now}
          onNewTopic={onNewTopic}
          onOpen={() => {
            onOpen(thread);
          }}
          onSetTopics={(next) => {
            onSetTopics(thread, next);
          }}
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
        <div className="divide-y divide-border">{rows}</div>
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
