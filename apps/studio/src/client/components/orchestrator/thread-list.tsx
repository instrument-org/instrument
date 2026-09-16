import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@/client/components/ui/message-scroller";
import { Fragment, useLayoutEffect } from "react";

import { type AppsBySlug } from "./apps-by-slug";
import { ThreadRow } from "./thread-row";
import { groupByDay, type Thread, type Topic } from "./threads";
import { useNow } from "./use-now";

/** How long the list is given to settle after it arrives before the edge is taken a last time. */
const SETTLE_MS = 250;

/**
 * The chat: every thread in time order under its day head, newest at the
 * foot. The list opens at its end and follows it while the newest thread is
 * working, the way a transcript follows a reply, and stays where the reader
 * scrolled to otherwise.
 */
export function ThreadList({
  appsBySlug,
  emptyLine,
  isFollowing,
  onNewTopic,
  onOpen,
  onPickTopic,
  onSetTopics,
  scrollSignal,
  threads,
  topics,
}: {
  appsBySlug: AppsBySlug;
  /** What the list says when it has nothing to show. */
  emptyLine: string;
  /** Whether the end of the list is being watched: a thread working there, or a message just sent. */
  isFollowing: boolean;
  onNewTopic: () => void;
  onOpen: (thread: Thread) => void;
  /** A row's topic pill: the list narrowed to that topic. */
  onPickTopic: (topicId: string) => void;
  onSetTopics: (thread: Thread, topics: string[]) => void;
  /** Counts up whenever the list should be taken to its end, whatever the reader was doing. */
  scrollSignal: number;
  threads: Thread[];
  topics: Topic[];
}) {
  const now = useNow();
  const groups = groupByDay(threads, now);
  return (
    <MessageScrollerProvider
      autoScroll={isFollowing}
      defaultScrollPosition="end"
    >
      <ScrollToEndBridge signal={scrollSignal} />
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          {/* `justify-end`: a short list sits at the foot beside the composer,
            the way a chat reads from the bottom up. */}
          <MessageScrollerContent className="min-h-full justify-end gap-0 px-2 pt-1 pb-4">
            {groups.length === 0 ? (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                {emptyLine}
              </p>
            ) : (
              groups.map(([label, group]) => (
                <Fragment key={label}>
                  {/* The head stays at the top while its day scrolls under it:
                    the rows say only the time of day, and this is their date. */}
                  <p className="sticky top-0 z-10 flex items-center gap-3 bg-background px-2 py-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    <span className="h-px flex-1 bg-border" />
                    {label}
                    <span className="h-px flex-1 bg-border" />
                  </p>
                  {group.map((thread) => (
                    <ThreadRow
                      appsBySlug={appsBySlug}
                      key={thread.id}
                      onNewTopic={onNewTopic}
                      onOpen={() => {
                        onOpen(thread);
                      }}
                      onPickTopic={onPickTopic}
                      onSetTopics={(next) => {
                        onSetTopics(thread, next);
                      }}
                      thread={thread}
                      topics={topics}
                    />
                  ))}
                </Fragment>
              ))
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        {/* Fade the list into the composer with a background gradient rather
          than a viewport mask, so the scrollbar stays crisp. */}
        <div className="pointer-events-none absolute right-3 bottom-0 left-0 h-6 bg-linear-to-t from-background to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-4">
          <MessageScrollerButton className="pointer-events-auto" />
        </div>
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

/**
 * Runs the scroller's scroll-to-end from below its provider, once per change
 * of the signal: on arrival, and again on every send, so a reader who had
 * scrolled back returns to the live edge when they ask for something new.
 */
function ScrollToEndBridge({ signal }: { signal: number }) {
  const { scrollToEnd } = useMessageScroller();
  useLayoutEffect(() => {
    scrollToEnd();
    // The rows settle after they are laid out (icons size themselves, the
    // asks clamp), and an end reached before that is short of the end.
    const frame = requestAnimationFrame(() => {
      scrollToEnd();
    });
    const later = setTimeout(() => {
      scrollToEnd();
    }, SETTLE_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(later);
    };
  }, [scrollToEnd, signal]);
  return null;
}
