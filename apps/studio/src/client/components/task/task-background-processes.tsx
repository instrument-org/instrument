import { Button } from "@/client/components/ui/button";
import { APP_NAME } from "@instrument-org/shared";
import { type TaskId } from "@instrument-org/workspace/client";
import { useState } from "react";

import { useNow } from "../../hooks/use-now";
import { useStopBackgroundProcess } from "../../hooks/use-stop-background-process";
import {
  type RunningBackgroundProcess,
  useTaskBackgroundProcesses,
} from "../../hooks/use-task-background-processes";
import { formatElapsed } from "../../lib/format-elapsed";
import { cn } from "../../lib/utils";
import { PlanningDotIcon } from "../icons/planning-dot";
import { BashCommandSection } from "../message-part/bash-command-section";
import { RunRowChevron } from "../run-row-chevron";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { StopProcessButton } from "./stop-process-button";

/** Seconds are on screen, so anything slower shows a number that is not true. */
const ELAPSED_TICK_MS = 1000;

/** Enough to hold a long one-liner without the popover becoming a scroller. */
const COMMAND_COLLAPSED_HEIGHT = 96;

/**
 * What the agent started and left running in this task.
 *
 * Renders nothing at all when nothing is running, rather than an empty state:
 * this is the only header control that comes and goes, because it is the only
 * one that is reporting rather than offering.
 */
export function TaskBackgroundProcesses({ taskId }: { taskId: TaskId }) {
  const running = useTaskBackgroundProcesses(taskId);

  if (running.length === 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* Reads as a state, not a count. An unread badge is a number in a dot,
            and this sitting beside the title in that shape would be taken for
            one -- so it says the word, and the dot is only there to say the
            state is live. */}
        <button
          aria-label={`${running.length} still running in this task`}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-card py-0.5 pr-2 pl-1.5 text-xs text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
          type="button"
        >
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-1.5 animate-ping rounded-full bg-brand-300 opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-brand-500" />
          </span>
          {running.length} running
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[min(480px,calc(var(--radix-popover-content-available-height)/var(--content-zoom)))] w-100 overflow-y-auto p-0"
      >
        <RunningList running={running} taskId={taskId} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * One process, laid out as a transcript row: the live dot, what the agent said
 * it was doing, and a chevron onto the command underneath.
 *
 * The agent already writes a readable label for every call it makes, so the row
 * leads with that rather than with `node -e "const http=require('http')..."`,
 * which makes the reader parse a program to learn they are looking at a web
 * server. The command is the ground truth about what is running, so it is one
 * click away rather than gone -- and it is drawn the way the transcript draws a
 * command, prompt and syntax highlighting and the section's own copy and wrap
 * controls, because it is the same thing shown somewhere else.
 */
function ProcessRow({
  disabled,
  now,
  onStop,
  process,
}: {
  disabled: boolean;
  now: number;
  onStop: () => void;
  process: RunningBackgroundProcess;
}) {
  const [expanded, setExpanded] = useState(false);
  // Falls back to the command, which is worse to read but never absent: the
  // model is told to write an explanation and mostly does, and a row with no
  // name at all would be the one case where the user learns nothing.
  const label = process.explanation ?? process.command;

  return (
    <li className={cn("group/run-row", expanded && "bg-muted/40")}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => {
            setExpanded((open) => !open);
          }}
          type="button"
        >
          <PlanningDotIcon />
          <span className="min-w-0 truncate text-sm" title={label}>
            {label}
          </span>
          <RunRowChevron isOpen={expanded} />
        </button>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatElapsed(process.startedAt, now)}
        </span>
        {/* Quiet until the row is under the pointer, the way the transcript's
            own per-row actions are: at rest the row is reporting, and three
            controls competing on one line is what made it hard to read. */}
        <StopProcessButton
          className="opacity-0 transition-opacity group-focus-within/run-row:opacity-100 group-hover/run-row:opacity-100"
          disabled={disabled}
          label="Stop this process"
          onClick={onStop}
        />
      </div>
      {expanded && (
        <div className="border-t border-border">
          <BashCommandSection
            collapsedHeight={COMMAND_COLLAPSED_HEIGHT}
            command={process.command}
          />
        </div>
      )}
    </li>
  );
}

/**
 * Split from the trigger so its clock only ticks while the popover is open. The
 * pill shows no duration, and a second-resolution timer behind a closed popover
 * would re-render the task header once a second for nothing.
 */
function RunningList({
  running,
  taskId,
}: {
  running: RunningBackgroundProcess[];
  taskId: TaskId;
}) {
  const now = useNow(ELAPSED_TICK_MS);
  const { busy, stop, stopAll } = useStopBackgroundProcess(taskId);

  return (
    <>
      <div className="flex items-center gap-2 border-b border-border bg-muted px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">Still running</div>
          {/* The one fact the rows cannot show: these can end without anybody
              pressing anything, so a server that disappears on its own is
              otherwise indistinguishable from a bug. */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            They stop when you quit {APP_NAME}, or after two hours.
          </p>
        </div>
        {/* Worded rather than an icon, and always here: it is the one control
            in the popover that acts on everything, and a reader deciding
            whether to press that wants to have read it rather than hovered it. */}
        <Button
          className="shrink-0"
          disabled={busy}
          onClick={stopAll}
          size="xs"
          variant="outline"
        >
          Stop all
        </Button>
      </div>
      <ul className="divide-y divide-border">
        {running.map((process) => (
          <ProcessRow
            disabled={busy}
            key={process.id}
            now={now}
            onStop={() => {
              stop(process.id);
            }}
            process={process}
          />
        ))}
      </ul>
    </>
  );
}
