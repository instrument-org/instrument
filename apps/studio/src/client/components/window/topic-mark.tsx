import { topicColor } from "@/client/components/window/topic-colors";
import { topicTint } from "@/client/components/window/topic-tint";
import { cn } from "@/client/lib/utils";

import { TopicGlyph } from "./topic-icons";

/** What a topic is marked with, whatever the user has and has not chosen. */
export interface TopicMarkSpec {
  color?: string;
  emoji?: string;
  icon?: string;
  name?: string;
}

/**
 * The mark that stands for a topic wherever one is named: its icon or its
 * emoji on a tile of its color, never a word. Sized for where it sits, from a row's header
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
  const glyph =
    size === "lg" ? "size-6" : size === "sm" ? "size-2.5" : "size-3";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-grid shrink-0 place-items-center leading-none topic-tint select-none",
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
      <TopicGlyph className={glyph} topic={topic} />
    </span>
  );
}
