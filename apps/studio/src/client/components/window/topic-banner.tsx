import { stripMarkdown } from "@instrument-org/shared/strip-markdown";

import { type Topic } from "./chats";
import { topicColor } from "./topic-colors";
import { TopicMark } from "./topic-mark";
import { topicTint } from "./topic-tint";

/**
 * What sits above the rows while the list is one topic: a card in the
 * topic's tint with its mark and name, Edit for its details, and the start
 * of the instructions every chat under it follows, so what Instrument knows
 * about the topic is in view without opening it. A topic with no
 * instructions is the one line, with Add instructions in Edit's place.
 */
export function TopicBanner({
  onDetails,
  topic,
}: {
  onDetails: (topic: Topic) => void;
  topic: Topic;
}) {
  const instructions = stripMarkdown(topic.instructions ?? "").trim();
  return (
    <div
      className="mx-2 mt-1 mb-1 shrink-0 rounded-lg bg-(--topic-tint-surface) px-3 py-2 text-xs leading-[1.45] topic-tint"
      style={topicTint(topicColor(topic))}
    >
      <div className="flex items-center gap-1.5 font-medium">
        {topic.emoji ? (
          <span className="leading-none">{topic.emoji}</span>
        ) : (
          <TopicMark className="size-4" topic={topic} />
        )}
        <span className="min-w-0 flex-1 truncate">{topic.name}</span>
        <button
          className="-mr-1 shrink-0 rounded-sm px-1 font-normal text-(--topic-tint-ink) hover:bg-(--topic-tint-edge)"
          onClick={() => {
            onDetails(topic);
          }}
          type="button"
        >
          {instructions ? "Edit" : "Add instructions"}
        </button>
      </div>
      {instructions && (
        <p className="mt-0.5 line-clamp-2 text-foreground/75">{instructions}</p>
      )}
    </div>
  );
}
