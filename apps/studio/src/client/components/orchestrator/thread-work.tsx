import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { useState } from "react";

import { type Thread } from "./threads";

/**
 * What the thread is working on right now, folded to one line over its
 * composer: the tasks filed from it that are still at work, with the step
 * the newest is on in the live shimmer, or what it has stopped to ask for.
 *
 * Over the composer rather than in the transcript, and folded whether there
 * is one task or a dozen: it is the sign that the conversation can keep
 * going while work happens elsewhere, so it must not grow into the column
 * or read as a reply. Opened, it lists each task, and pressing one opens
 * the task's own page beside the thread. Nothing at all while nothing runs.
 */
export function ThreadWork({
  onOpen,
  tasks,
}: {
  /** Opens a task's page, as a tab of the thread's. */
  onOpen: (taskId: Thread["runningTasks"][number]["id"]) => void;
  tasks: Thread["runningTasks"];
}) {
  const [isOpen, setOpen] = useState(false);
  if (tasks.length === 0) {
    return null;
  }
  // The one whose line the fold shows: a task waiting on the user first,
  // since that is the one the user can do something about.
  const lead = tasks.find((task) => task.waiting) ?? tasks[0];
  return (
    <div className="mb-2 shrink-0 overflow-hidden rounded-lg bg-card ring-1 ring-border">
      <button
        aria-expanded={isOpen}
        className="flex h-7 w-full items-center gap-1.5 px-2 text-left text-[11px]"
        onClick={() => {
          setOpen((open) => !open);
        }}
        type="button"
      >
        {isOpen ? (
          <CaretDownIcon className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <CaretRightIcon className="size-3 shrink-0 text-muted-foreground" />
        )}
        {isOpen ? (
          <span className="text-muted-foreground">
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
          </span>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-1 truncate">
            {tasks.length > 1 && (
              <span className="shrink-0 text-muted-foreground">
                {tasks.length} tasks ·
              </span>
            )}
            <WorkLine task={lead} />
          </span>
        )}
      </button>
      {isOpen &&
        tasks.map((task) => (
          <button
            className="flex w-full items-center gap-1.5 border-t border-border/60 px-2 py-1 text-left hover:bg-accent/50"
            key={task.id}
            onClick={() => {
              onOpen(task.id);
            }}
            type="button"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium">
                {task.title}
              </span>
              <span className="block max-w-full truncate text-[11px]">
                <WorkLine task={task} />
              </span>
            </span>
            <CaretRightIcon className="size-3 shrink-0 text-muted-foreground" />
          </button>
        ))}
    </div>
  );
}

/**
 * A task's line: what it is waiting on, in the amber a waiting thread wears,
 * or the step it is on in the shimmer that says something is happening, so
 * the line needs no mark beside it.
 */
function WorkLine({
  task,
}: {
  task: Thread["runningTasks"][number] | undefined;
}) {
  if (!task) {
    return null;
  }
  if (task.waiting) {
    return (
      <span className="min-w-0 truncate text-warning-700 dark:text-warning-300">
        {task.waiting}
      </span>
    );
  }
  // `brand-shiny-text` is an inline-block, which a parent's truncate cannot
  // shrink, so the step carries its own.
  return (
    <span className={cn("brand-shiny-text min-w-0 truncate")}>
      {task.step ?? task.title}
    </span>
  );
}
