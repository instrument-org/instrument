import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { cn } from "@/client/lib/utils";
import { type RPCOutput } from "@/client/rpc/client";
import { ListChecksIcon } from "@phosphor-icons/react/ListChecks";
import { useState } from "react";

import { TaskRow } from "./task-row";
import { activityLabel } from "./threads";
import { useNow } from "./use-now";

/** A task under a thread, as the workspace lists it: where it stands, and the thread it was filed from. */
export type ChildTask =
  RPCOutput["workspace"]["orchestrator"]["children"][number];

/** How many tasks past the active ones the list shows, newest first. */
const SETTLED_SHOWN = 8;

/**
 * The tasks at the window bar's end: how many are at work or waiting, as a
 * badge, and behind it the list of them, the active ones first and then the
 * ones lately settled. This is the way to the detailed level of what the
 * agent is doing. A task pressed opens its thread and then the task as a tab
 * of the thread's; the list itself never takes the right area.
 */
export function TasksBadge({
  onOpen,
  tasks,
}: {
  /** Opens a task where it belongs: in its thread's group. */
  onOpen: (task: ChildTask) => void;
  tasks: ChildTask[];
}) {
  const [open, setOpen] = useState(false);
  const now = useNow();
  const byNewest = [...tasks].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  const active = byNewest.filter(
    (task) =>
      task.standing.kind === "running" || task.standing.kind === "waiting",
  );
  const settled = byNewest
    .filter((task) => !active.includes(task))
    .slice(0, SETTLED_SHOWN);
  const isWorking = active.some((task) => task.standing.kind === "running");
  const label =
    active.length === 0
      ? "Tasks"
      : `${active.length} ${active.length === 1 ? "task" : "tasks"} active`;
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              aria-label={label}
              className={cn(
                "flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-muted-foreground hover:bg-foreground/5 hover:text-foreground data-[state=open]:bg-foreground/8 data-[state=open]:text-foreground",
              )}
              type="button"
            >
              <ListChecksIcon className="size-4" />
              {active.length > 0 && (
                <span
                  className={cn(
                    "text-[11px] font-medium tabular-nums",
                    isWorking
                      ? "brand-shiny-text"
                      : "text-warning-700 dark:text-warning-300",
                  )}
                >
                  {active.length}
                </span>
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        aria-label="Tasks"
        className="@container/tasks flex w-112 flex-col p-1"
        maxHeight="40rem"
        side="bottom"
        sideOffset={4}
      >
        {active.length === 0 && settled.length === 0 ? (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">
            No tasks yet.
          </p>
        ) : (
          <div className="flex max-h-full flex-col overflow-y-auto">
            {active.length > 0 && <Head>Active</Head>}
            {active.map((task) => (
              <Row
                key={task.id}
                now={now}
                onOpen={() => {
                  setOpen(false);
                  onOpen(task);
                }}
                task={task}
              />
            ))}
            {settled.length > 0 && <Head>Settled</Head>}
            {settled.map((task) => (
              <Row
                key={task.id}
                now={now}
                onOpen={() => {
                  setOpen(false);
                  onOpen(task);
                }}
                task={task}
              />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** A section's head in the list. */
function Head({ children }: { children: string }) {
  return (
    <p className="px-2 pt-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </p>
  );
}

function Row({
  now,
  onOpen,
  task,
}: {
  now: Date;
  onOpen: () => void;
  task: ChildTask;
}) {
  return (
    <TaskRow
      isOpen={false}
      line={task.standing.line}
      onOpen={onOpen}
      standing={task.standing.kind}
      threadTitle={task.threadTitle}
      time={activityLabel(task.updatedAt, now)}
      title={task.title}
    />
  );
}
