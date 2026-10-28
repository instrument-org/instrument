import { stripMarkdown } from "@instrument-org/shared/strip-markdown";

import { type Topic } from "./chats";

/**
 * The second line of the list's head while the list is one topic, in the
 * tint the head wears then: the start of the instructions every chat under
 * it follows, so what Instrument knows about the topic is in view without
 * opening it, with Edit topic for its details quietly under them. The topic's
 * mark and name are the picker's, just above, so they are not said again,
 * and the picker is the way back to the chats. A topic with no
 * instructions shows Edit topic alone.
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
    <div className="flex shrink-0 flex-col items-start gap-1 px-4 pb-3 text-sm leading-5">
      {instructions && (
        <p className="line-clamp-2 text-foreground/75">{instructions}</p>
      )}
      <button
        className="text-[13px] text-foreground/45 hover:text-foreground/75"
        onClick={() => {
          onDetails(topic);
        }}
        type="button"
      >
        Edit topic
      </button>
    </div>
  );
}
