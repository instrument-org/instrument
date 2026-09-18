import { topicColor } from "@/client/components/orchestrator/topic-colors";
import { topicTint } from "@/client/components/orchestrator/topic-tint";
import { cn } from "@/client/lib/utils";

/** What a topic is marked with, whatever the user has and has not chosen. */
export interface TopicMarkSpec {
  color?: string;
  emoji?: string;
  name?: string;
}

/**
 * The mark that stands for a topic wherever one is named: its emoji on a tile
 * of its color, never a word. Sized for where it sits, from a row's header
 * line up to the dialog that chooses it.
 */
export function TopicMark({
  className,
  size = "md",
  topic,
}: {
  className?: string;
  size?: "lg" | "md" | "sm";
  topic: TopicMarkSpec;
}) {
  const box =
    size === "lg"
      ? "size-11 rounded-xl text-[22px]"
      : size === "sm"
        ? "size-3.5 rounded-sm text-[9px]"
        : "size-4 rounded text-[10px]";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 place-items-center leading-none topic-tint",
        box,
        className,
      )}
      style={{
        // A tint rather than a fill: the emoji has to stay legible on it, and a
        // row of solid squares would read as a toolbar.
        background: "var(--topic-tint-surface, var(--card))",
        ...topicTint(topicColor(topic)),
      }}
      title={topic.name}
    >
      <TopicFace topic={topic} />
    </span>
  );
}

/**
 * What stands for a topic with no tile under it: its emoji if it has one, and
 * otherwise the first letter of its name, so a topic whose emoji the user never
 * chose still has to be told apart from its neighbors at a glance.
 */
function TopicFace({ topic }: { topic: TopicMarkSpec }) {
  if (topic.emoji) {
    return <span>{topic.emoji}</span>;
  }
  // By grapheme, so a name that starts with an emoji or an accented letter
  // gives one character rather than half of one.
  const [first] = new Intl.Segmenter().segment(topic.name ?? "?");
  return (
    <span
      className="font-semibold uppercase"
      // The tint's ink rather than the color itself: a pale pick's own hex
      // would vanish on its own tile.
      style={{ color: "var(--topic-tint-ink, currentColor)" }}
    >
      {first?.segment ?? "?"}
    </span>
  );
}
