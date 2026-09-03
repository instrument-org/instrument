import { Button } from "@/client/components/ui/button";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { type TaskId } from "@instrument-org/workspace/client";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { StopIcon } from "@phosphor-icons/react/Stop";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { useNow } from "../../hooks/use-now";
import {
  type RunningBackgroundProcess,
  useTaskBackgroundProcesses,
} from "../../hooks/use-task-background-processes";
import { cn } from "../../lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

/** Seconds are on screen, so anything slower shows a number that is not true. */
const ELAPSED_TICK_MS = 1000;

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
        className="max-h-[min(420px,calc(var(--radix-popover-content-available-height)/var(--content-zoom)))] w-88 overflow-y-auto p-0"
      >
        <RunningList running={running} taskId={taskId} />
      </PopoverContent>
    </Popover>
  );
}

function formatElapsed(startedAt: Date, now: number): string {
  const seconds = Math.max(0, Math.round((now - startedAt.getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  return minutes < 60
    ? `${minutes}m`
    : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * One process, named the way the agent named the call that started it.
 *
 * The command is behind a disclosure rather than on the row: the agent already
 * wrote a human-readable label for what it was doing, and a row that leads with
 * `node -e "const http=require('http')..."` makes the reader parse a program to
 * learn they are looking at a web server. The command is still the ground truth
 * about what is running, so it is one click away rather than gone.
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
    <li className="p-3">
      <div className="flex items-center gap-2">
        <button
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => {
            setExpanded((open) => !open);
          }}
          type="button"
        >
          <CaretRightIcon
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-90",
            )}
          />
          <span className="truncate text-[13px]" title={label}>
            {label}
          </span>
        </button>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatElapsed(process.startedAt, now)}
        </span>
        <StopButton
          disabled={disabled}
          label="Stop this process"
          onClick={onStop}
        />
      </div>
      {expanded && (
        <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
          {process.command}
        </pre>
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

  const { isPending: isStopping, mutate: stop } = useMutation(
    rpcClient.workspace.task.backgroundProcesses.stop.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't stop it", { description: error.message });
      },
    }),
  );
  const { isPending: isStoppingAll, mutate: stopAll } = useMutation(
    rpcClient.workspace.task.backgroundProcesses.stopAll.mutationOptions({
      onError: (error) => {
        toast.error("Couldn't stop them", { description: error.message });
      },
    }),
  );
  const busy = isStopping || isStoppingAll;

  return (
    <>
      <div className="flex items-start gap-2 border-b border-border p-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">Still running</div>
          {/* The one fact the rest of the popover cannot show: these can end
              without anybody pressing anything, so a server that disappears on
              its own is otherwise indistinguishable from a bug. Everything the
              row already says -- what it is, how long, how to stop it -- is
              left to the row. */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            They stop when you quit {APP_NAME}, or after two hours.
          </p>
        </div>
        {running.length > 1 && (
          <StopButton
            disabled={busy}
            label={`Stop all ${running.length} processes`}
            onClick={() => {
              stopAll({ id: taskId });
            }}
          />
        )}
      </div>
      <ul className="divide-y divide-border">
        {running.map((process) => (
          <ProcessRow
            disabled={busy}
            key={process.id}
            now={now}
            onStop={() => {
              stop({ id: taskId, processId: process.id });
            }}
            process={process}
          />
        ))}
      </ul>
    </>
  );
}

/**
 * An icon rather than the word, because these sit at the end of a row that is
 * already carrying a name and a duration, and a second run of text there reads
 * as more to consider rather than as something to press. The tooltip says what
 * pressing it does, which the icon alone cannot distinguish between stopping
 * one and stopping every one.
 */
function StopButton({
  disabled,
  label,
  onClick,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          className="shrink-0"
          disabled={disabled}
          onClick={onClick}
          size="icon-sm"
          variant="ghost"
        >
          <StopIcon weight="fill" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
