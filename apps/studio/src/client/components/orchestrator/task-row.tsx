import {
  ChannelFace,
  type ChannelMark,
} from "@/client/components/orchestrator/channel-rail";
import { cn } from "@/client/lib/utils";

/** Where a task stands, as the list says it. */
export type TaskStandingKind = "done" | "running" | "waiting";

/**
 * One task in the list: what it is called, what became of it, where it was
 * asked for, and when.
 *
 * Nothing stands beside the row to mark it. A task at work says so in the
 * traveling highlight on its second line, and a dot would say the same thing
 * again in a column every row has to leave room for. The second line is the
 * task's own account of itself rather than the word "done", which is what
 * makes the list worth reading instead of clicking through.
 *
 * The channel and the time are columns of a fixed width, so the eye can run
 * down them. Sized to their contents they cannot be: "now" and "Sep 28" are
 * different lengths, and every row that held one would put its channel mark
 * somewhere the row above did not.
 */
export function TaskRow({
  channel,
  isOpen,
  line,
  onOpen,
  standing,
  time,
  title,
}: {
  channel?: ChannelMark & { name: string };
  isOpen: boolean;
  line: string;
  onOpen: () => void;
  standing: TaskStandingKind;
  time: string;
  title: string;
}) {
  return (
    <button
      className={cn(
        "flex h-11 w-full items-center gap-2.5 rounded-md px-2 text-left hover:bg-foreground/5",
        isOpen && "bg-foreground/8",
      )}
      onClick={onOpen}
      type="button"
    >
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-[13px] font-medium",
            standing === "done" && "text-foreground/80",
          )}
        >
          {title}
        </span>
        <span
          className={cn(
            "block max-w-full truncate text-[11px]",
            standing === "running"
              ? "brand-shiny-text"
              : standing === "waiting"
                ? "text-warning-700 dark:text-warning-300"
                : "text-muted-foreground",
          )}
        >
          {line}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
        <span className="grid w-4 place-items-center">
          {channel && <ChannelFace channel={channel} className="text-[12px]" />}
        </span>
        <span className="hidden w-20 truncate @[22rem]/tasks:block">
          {channel?.name}
        </span>
      </span>
      {/* A floor rather than a width: it holds every "now" and every "Sep 28"
        at the same left edge, and a locale whose short date runs longer
        widens its own row instead of running under the channel beside it. */}
      <span className="min-w-12 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
        {time}
      </span>
    </button>
  );
}
