import { ChannelMark } from "@/client/components/orchestrator/channel-strip";
import { cn } from "@/client/lib/utils";
import { FileTextIcon } from "@phosphor-icons/react/FileText";

/** Where a task stands, as the list says it. */
export type TaskStandingKind = "done" | "running" | "waiting";

/**
 * One task in the list: what it is called, what became of it, where it was
 * asked for, and when.
 *
 * No mark of ours on the row, because every row is ours; a dot only where
 * something is still to happen. The second line is the task's own account of
 * itself rather than the word "done", which is what makes the list worth
 * reading instead of clicking through.
 */
export function TaskRow({
  channel,
  isOpen,
  line,
  madeSomething,
  onOpen,
  standing,
  time,
  title,
}: {
  channel?: string;
  isOpen: boolean;
  line: string;
  madeSomething?: boolean;
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
      <span className="flex w-2 shrink-0 justify-center">
        {standing !== "done" && (
          <span
            className={cn(
              "size-1.5 rounded-full",
              standing === "running" ? "bg-brand-500" : "bg-warning-500",
            )}
          />
        )}
      </span>
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
            "block truncate text-[11px]",
            standing === "running"
              ? "text-brand-700"
              : standing === "waiting"
                ? "text-warning-700"
                : "text-muted-foreground",
          )}
        >
          {line}
        </span>
      </span>
      {channel && (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
          <ChannelMark name={channel} />
          <span className="hidden @[22rem]/tasks:inline">#&nbsp;{channel}</span>
        </span>
      )}
      {madeSomething && (
        <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
        {time}
      </span>
    </button>
  );
}
