import { ChatTeardropTextIcon } from "@phosphor-icons/react/ChatTeardropText";

import { TopicPill } from "./thread-row";
import { activityLabel, type Thread, type Topic } from "./threads";
import { useNow } from "./use-now";

/**
 * The head of the right area while a thread's own tab is up, in place of the
 * address row: a thread is not somewhere to type an address into or step
 * back from, so it wears a little of its inbox row instead, the topic it is
 * filed under, its title, how many replies, and when anything last happened.
 */
export function ThreadHeader({
  onPickTopic,
  thread,
  topics,
}: {
  /** Opens the thread's topic list, for the pill. */
  onPickTopic?: () => void;
  thread: Thread | undefined;
  topics: Topic[];
}) {
  const now = useNow();
  if (!thread) {
    return (
      <div className="flex h-11 shrink-0 items-center border-b border-border px-4">
        <span className="text-sm text-muted-foreground">Thread</span>
      </div>
    );
  }
  const topic = topics.find((entry) => entry.id === thread.topics[0]);
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
      {topic && (
        <TopicPill
          onPick={() => {
            onPickTopic?.();
          }}
          topic={topic}
        />
      )}
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
        {thread.title}
      </h2>
      {thread.replyCount > 1 && (
        <span
          aria-label={`${thread.replyCount} replies`}
          className="inline-flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground tabular-nums"
        >
          <ChatTeardropTextIcon className="size-3" />
          {thread.replyCount}
        </span>
      )}
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
        {activityLabel(new Date(thread.updatedAt), now)}
      </span>
    </div>
  );
}
