import { useLayoutEffect, useRef, useState } from "react";

import { type AppsBySlug } from "./apps-by-slug";
import { type RowDensity, ThreadRow } from "./thread-row";
import { byActivity, type Thread, type Topic } from "./threads";
import { useNow } from "./use-now";

/** The width the list has to have, in px, before its rows lie down to one line each. */
export const SLIM_FROM = 600;

/**
 * The inbox: every thread by when something last happened in it, newest at
 * the top, so a reply landing lifts its thread to the head of the list. The
 * rows take one line each when the list is wide enough for a mailbox's
 * columns, and three when it is not; the list measures its own width for
 * that, since the pane and the column beside it set it. It opens at the top
 * and stays where the reader scrolled to.
 */
export function ThreadList({
  appsBySlug,
  emptyLine,
  onNewTopic,
  onOpen,
  onSetTopics,
  scrollSignal,
  threads,
  topics,
}: {
  appsBySlug: AppsBySlug;
  /** What the list says when it has nothing to show. */
  emptyLine: string;
  onNewTopic: () => void;
  onOpen: (thread: Thread) => void;
  onSetTopics: (thread: Thread, topics: string[]) => void;
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
  const rows = byActivity(threads);
  return (
    <div
      className="min-h-0 flex-1 overflow-y-auto pb-4"
      data-density={density}
      ref={ref}
    >
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          {emptyLine}
        </p>
      ) : (
        <div className="divide-y divide-border">
          {rows.map((thread) => (
            <ThreadRow
              appsBySlug={appsBySlug}
              density={density}
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
          ))}
        </div>
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
