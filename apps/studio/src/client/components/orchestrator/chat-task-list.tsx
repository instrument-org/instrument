import { ROW_TINT } from "@/client/components/orchestrator/row-shell";
import { StopProcessButton } from "@/client/components/task/stop-process-button";
import { Button } from "@/client/components/ui/button";
import { taskTimeLabel } from "@/client/components/orchestrator/task-time";
import { useNow } from "@/client/components/orchestrator/use-now";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type TaskId } from "@instrument-org/workspace/client";
import { useMutation } from "@tanstack/react-query";

/** One task as the list needs it. */
export interface TaskListItem {
  id: TaskId;
  line: string;
  /** Where it stands, as the list draws it. */
  standing: "done" | "failed" | "running" | "waiting";
  /** Whether a stop has something to end: an agent at work, or a hold on its start. */
  stoppable: boolean;
  title: string;
  updatedAt: Date;
}

/**
 * A chat's tasks, in the pane beside it: headed Tasks, newest first, one
 * row each with the title and when anything last happened at its right,
 * then the task's own line under it, the running step behind a brand dot in
 * the shimmer, what it waits on in amber, and how it ended otherwise. No day
 * heads, no filters, no search: a chat has a handful, and the row says
 * where each stands. A row pressed opens the task in the pane's place.
 * While a task works or is held from starting, a stop sits at its row's
 * edge, and while any listed task does, Stop all in the heading stops every
 * one of them; both cancel a held task's start as well.
 */
export function ChatTaskList({
  items,
  onOpen,
}: {
  items: TaskListItem[];
  onOpen: (id: TaskId) => void;
}) {
  // One clock for the whole render, so every row's "20m" is measured from
  // the same moment.
  const now = useNow();
  const rows = [...items].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  const stop = useMutation(rpcClient.workspace.session.stop.mutationOptions());
  const stoppable = rows.filter((item) => item.stoppable);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The rows carry their own side padding, so the tint a row wears
          under the pointer is as wide as the hairlines and the words sit in
          from its rounded edge. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <div className="flex items-center gap-3 px-2 pt-6 pb-2">
          <h1 className="min-w-0 flex-1 text-lg font-medium text-muted-foreground">
            Tasks
          </h1>
          {/* Worded rather than an icon: it acts on every task at work, and a
              reader deciding whether to press that wants to have read it. */}
          {stoppable.length > 0 && (
            <Button
              aria-label="Stop all working tasks"
              className="shrink-0"
              disabled={stop.isPending}
              onClick={() => {
                for (const item of stoppable) {
                  stop.mutate({ id: item.id });
                }
              }}
              size="xs"
              variant="outline"
            >
              Stop all
            </Button>
          )}
        </div>
        {rows.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            Nothing yet. Ask for something in the chat and it shows up here.
          </p>
        ) : (
          rows.map((item) => (
            // The tint is the wrapper's rather than the row button's, so it
            // stays on while the pointer is over the stop, which is the
            // button's sibling since a button cannot hold another.
            <div
              className={cn(
                "relative border-b border-border has-focus-visible:before:opacity-100",
                ROW_TINT,
              )}
              key={item.id}
            >
              <button
                className="flex w-full flex-col gap-1 px-2 py-3 text-left focus-visible:outline-hidden"
                onClick={() => {
                  onOpen(item.id);
                }}
                type="button"
              >
                <span className="flex w-full items-baseline gap-3">
                  <span className="min-w-0 flex-1 truncate text-[15px] text-foreground">
                    {item.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {taskTimeLabel(item.updatedAt, now)}
                  </span>
                </span>
                <span
                  className={cn(
                    "flex w-full min-w-0 items-center gap-2 text-[13px]",
                    item.stoppable && "pr-7",
                  )}
                >
                  {item.standing === "running" && (
                    <span className="size-2 shrink-0 rounded-full bg-brand-500" />
                  )}
                  <span
                    className={cn(
                      "min-w-0 truncate",
                      item.standing === "running"
                        ? "brand-shiny-text"
                        : item.standing === "waiting"
                          ? "text-warning-700 dark:text-warning-300"
                          : item.standing === "failed"
                            ? "text-error-700 dark:text-error-300"
                            : "text-muted-foreground",
                    )}
                  >
                    {item.line}
                  </span>
                </span>
              </button>
              {item.stoppable && (
                <StopProcessButton
                  className="absolute right-1 bottom-1.5 size-6"
                  disabled={stop.isPending}
                  label="Stop this task"
                  onClick={() => {
                    stop.mutate({ id: item.id });
                  }}
                />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
