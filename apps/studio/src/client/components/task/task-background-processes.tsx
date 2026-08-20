import { Button } from "@/client/components/ui/button";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { type TaskId } from "@instrument-org/workspace/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

/**
 * How often the elapsed times re-render. Minute-resolution, so a slower tick
 * would show a stale number and a faster one would re-render for nothing.
 */
const ELAPSED_TICK_MS = 30_000;

/**
 * What the agent started and left running in this task.
 *
 * Renders nothing at all when nothing is running, rather than an empty state:
 * this is the only header control that comes and goes, because it is the only
 * one that is reporting rather than offering.
 */
export function TaskBackgroundProcesses({ taskId }: { taskId: TaskId }) {
  const queryClient = useQueryClient();
  const now = useNow();

  const listOptions =
    rpcClient.workspace.task.backgroundProcesses.list.queryOptions({
      input: { id: taskId },
    });
  const { data: processes } = useQuery(listOptions);

  // A revision counter, not the list: the popover is usually closed, and what
  // changes is whether anything is running at all.
  const { data: changed } = useQuery(
    rpcClient.workspace.task.backgroundProcesses.events.changed.experimental_liveOptions(
      { input: { id: taskId } },
    ),
  );
  const revision = changed?.revision;
  useEffect(() => {
    if (revision === undefined) {
      return;
    }
    void queryClient.invalidateQueries({
      queryKey: rpcClient.workspace.task.backgroundProcesses.key(),
    });
  }, [revision, queryClient]);

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

  const running = processes ?? [];
  if (running.length === 0) {
    return null;
  }
  const busy = isStopping || isStoppingAll;

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
        <div className="flex items-start gap-2 border-b border-border p-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium">Still running</div>
            {/* The explanation the header pill has no room for. Says who
                started them and what ends them, because neither is obvious to
                someone who only asked for a website. The two hours is named
                rather than left out: it is the one of the three that happens
                without anybody doing anything, so a server that disappears on
                its own is otherwise indistinguishable from a bug. */}
            <p className="mt-0.5 text-xs text-muted-foreground">
              Started while working on this task. They keep running until you
              stop them, you quit {APP_NAME}, or two hours pass.
            </p>
          </div>
          {running.length > 1 && (
            <Button
              className="shrink-0"
              disabled={busy}
              onClick={() => {
                stopAll({ id: taskId });
              }}
              size="sm"
              variant="ghost"
            >
              Stop all
            </Button>
          )}
        </div>
        <ul className="divide-y divide-border">
          {running.map((process) => (
            <li className="flex items-center gap-2 p-3" key={process.id}>
              <div className="min-w-0 flex-1">
                <div
                  className="truncate font-mono text-xs"
                  title={process.command}
                >
                  {process.command}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Running for {formatElapsed(process.startedAt, now)}
                </div>
              </div>
              <Button
                className="shrink-0"
                disabled={busy}
                onClick={() => {
                  stop({ id: taskId, processId: process.id });
                }}
                size="sm"
                variant="ghost"
              >
                Stop
              </Button>
            </li>
          ))}
        </ul>
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

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, ELAPSED_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}
