import { ROW_TINT } from "@/client/components/orchestrator/row-shell";
import { taskTimeLabel } from "@/client/components/orchestrator/task-time";
import { useNow } from "@/client/components/orchestrator/use-now";
import { cn } from "@/client/lib/utils";
import { type TaskId } from "@instrument-org/workspace/client";

/** One task as the list needs it. */
export interface TaskListItem {
  id: TaskId;
  line: string;
  /** Where it stands, as the list draws it. */
  standing: "done" | "failed" | "running" | "waiting";
  title: string;
  updatedAt: Date;
}

/**
 * A thread's tasks, in the pane beside it: headed Tasks, newest first, one
 * row each with the title and when anything last happened at its right,
 * then the task's own line under it, the running step behind a brand dot in
 * the shimmer, what it waits on in amber, and how it ended otherwise. No day
 * heads, no filters, no search: a thread has a handful, and the row says
 * where each stands. A row pressed opens the task in the pane's place.
 */
export function ThreadTaskList({
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
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The rows carry their own side padding, so the tint a row wears
          under the pointer is as wide as the hairlines and the words sit in
          from its rounded edge. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <h1 className="px-2 pt-6 pb-2 text-lg font-medium text-muted-foreground">
          Tasks
        </h1>
        {rows.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            Nothing yet. Ask for something in the thread and it shows up here.
          </p>
        ) : (
          rows.map((item) => (
            <button
              className={cn(
                "relative flex w-full flex-col gap-1 border-b border-border px-2 py-3 text-left focus-visible:outline-hidden",
                ROW_TINT,
              )}
              key={item.id}
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
              <span className="flex w-full min-w-0 items-center gap-2 text-[13px]">
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
          ))
        )}
      </div>
    </div>
  );
}
