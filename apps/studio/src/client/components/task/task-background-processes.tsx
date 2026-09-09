import { Button } from "@/client/components/ui/button";
import { APP_NAME } from "@instrument-org/shared";
import { type TaskId } from "@instrument-org/workspace/client";

import { useNow } from "../../hooks/use-now";
import { useStopBackgroundProcess } from "../../hooks/use-stop-background-process";
import {
  type RunningBackgroundProcess,
  useTaskBackgroundProcesses,
} from "../../hooks/use-task-background-processes";
import { formatElapsed } from "../../lib/format-elapsed";
import { BashCommandPreview } from "../message-part/bash-command-section";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { RunningBadge } from "./running-badge";
import { StopProcessButton } from "./stop-process-button";

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
        <button
          aria-label={`${running.length} still running in this task`}
          className="shrink-0 rounded-full hover:text-foreground data-[state=open]:bg-accent"
          type="button"
        >
          <RunningBadge count={running.length} />
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

/**
 * One process: what the agent called it, the command behind that, how long it
 * has been going, and the control that ends it.
 *
 * Both lines, always. The name is what makes the list readable, and the command
 * is what settles which of two servers this is -- putting the second behind a
 * disclosure meant a popover with expansion states, and putting it behind a
 * hover meant hunting for it inside a surface that is itself a hover away. It
 * is clamped to one line because a `node -e` one-liner would otherwise take the
 * popover with it.
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
  return (
    <li className="flex items-start gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        {/* Absent when the model skipped it, which it is free to do. The
            command below is then the only name there is, and it is already
            there rather than needing to be fetched out from behind something. */}
        {process.explanation && (
          <div className="truncate text-sm" title={process.explanation}>
            {process.explanation}
          </div>
        )}
        <BashCommandPreview
          className="text-xs text-muted-foreground"
          command={process.command}
          singleLine
        />
      </div>
      <span className="shrink-0 py-0.5 text-xs text-muted-foreground tabular-nums">
        {formatElapsed(process.startedAt, now)}
      </span>
      <StopProcessButton
        disabled={disabled}
        label="Stop this process"
        onClick={onStop}
      />
    </li>
  );
}

/**
 * Split from the trigger so its clock only ticks while the popover is open. The
 * badge shows no duration, and a second-resolution timer behind a closed
 * popover would re-render the task header once a second for nothing.
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
      <div className="flex items-center gap-2 border-b border-border bg-muted px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">Still running</div>
          {/* The one fact the rows cannot show: these can end without anybody
              pressing anything, so a server that disappears on its own is
              otherwise indistinguishable from a bug. */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            They stop when you quit {APP_NAME}, or after two hours.
          </p>
        </div>
        {/* Worded rather than an icon: it is the one control here that acts on
            everything, and a reader deciding whether to press that wants to
            have read it. "all" only once there is more than one to mean. */}
        <Button
          className="shrink-0"
          disabled={busy}
          onClick={stopAll}
          size="xs"
          variant="outline"
        >
          {running.length > 1 ? "Stop all" : "Stop"}
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
