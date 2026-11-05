import { type StoreId, type ChatId } from "@instrument-org/workspace/client";

import { useNow } from "../../hooks/use-now";
import { useStopBackgroundProcess } from "../../hooks/use-stop-background-process";
import {
  type RunningBackgroundProcess,
  useTaskBackgroundProcesses,
} from "../../hooks/use-task-background-processes";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { CommandListRow } from "./command-card";
import { RunningBadge } from "./running-badge";

/** Seconds are on screen, so anything slower shows a number that is not true. */
const ELAPSED_TICK_MS = 1000;

/**
 * What the agent started and left running, in a task or across a chat and its
 * tasks.
 *
 * Renders nothing at all when nothing is running, rather than an empty state:
 * it is reporting rather than offering, so with nothing to report it takes no
 * room in the header.
 */
export function TaskBackgroundProcesses({
  sessionId,
  chatId,
}: {
  /** One session's alone, a task's; without one, the whole chat's. */
  sessionId?: StoreId.Session;
  chatId: ChatId;
}) {
  const running = useTaskBackgroundProcesses(chatId, sessionId);

  if (running.length === 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`${running.length} still running`}
          className="shrink-0 rounded-lg hover:text-foreground data-[state=open]:bg-accent"
          type="button"
        >
          <RunningBadge count={running.length} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[min(420px,calc(var(--radix-popover-content-available-height)/var(--content-zoom)))] w-110 overflow-y-auto rounded-2xl p-0"
      >
        <RunningList running={running} sessionId={sessionId} chatId={chatId} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Split from the trigger so its clock only ticks while the popover is open. The
 * badge shows no duration, and a second-resolution timer behind a closed
 * popover would re-render the task header once a second for nothing.
 */
function RunningList({
  running,
  sessionId,
  chatId,
}: {
  running: RunningBackgroundProcess[];
  sessionId?: StoreId.Session;
  chatId: ChatId;
}) {
  const now = useNow(ELAPSED_TICK_MS);
  const { busy, stop } = useStopBackgroundProcess(chatId, sessionId);

  return (
    <ul className="divide-y divide-border">
      {running.map((process) => (
        <CommandListRow
          command={process}
          disabled={busy}
          key={process.id}
          now={now}
          onStop={() => {
            stop(process.id);
          }}
        />
      ))}
    </ul>
  );
}
