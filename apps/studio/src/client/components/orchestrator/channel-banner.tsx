import { cn } from "@/client/lib/utils";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/CaretRight";
import { useState } from "react";

/** A task of this channel, as the line under the banner says it. */
export interface BannerTask {
  isDone?: boolean;
  step: string;
  taskId: string;
  title: string;
}

/**
 * What this channel is working on, folded to one line.
 *
 * Folded is where it lives: one line whether the channel has one task or a
 * dozen, so a conversation that spawns many of them cannot grow the sidebar.
 * No mark beside the step, because the step's own shimmer is what says
 * something is happening.
 */
export function BannerWork({
  onOpen,
  tasks,
}: {
  /** Opening one is opening the task itself, which is a tab of its own. */
  onOpen: (taskId: string) => void;
  tasks: BannerTask[];
}) {
  const [isOpen, setOpen] = useState(false);
  if (tasks.length === 0) {
    return null;
  }
  const newest = tasks[0];
  return (
    <div className="mb-1.5 shrink-0 overflow-hidden rounded-lg bg-card ring-1 ring-border">
      <button
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px]"
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
          <span className="flex min-w-0 flex-1 gap-1 truncate">
            {tasks.length > 1 ? `${tasks.length} tasks · ` : ""}
            {/* `brand-shiny-text` is an inline-block, which a parent's truncate
              cannot shrink, so the step carries its own. */}
            <span
              className={cn(
                "min-w-0 truncate",
                !newest?.isDone && "brand-shiny-text",
              )}
            >
              {newest?.step}
            </span>
          </span>
        )}
      </button>
      {isOpen &&
        tasks.map((task) => (
          <button
            className="flex w-full items-center gap-1.5 border-t border-border/60 px-2 py-1 text-left hover:bg-accent/50"
            key={task.taskId}
            onClick={() => {
              onOpen(task.taskId);
            }}
            type="button"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium">
                {task.title}
              </span>
              <span
                className={cn(
                  "block max-w-full truncate text-[11px]",
                  task.isDone ? "text-muted-foreground" : "brand-shiny-text",
                )}
              >
                {task.step}
              </span>
            </span>
            <CaretRightIcon className="size-3 shrink-0 text-muted-foreground" />
          </button>
        ))}
    </div>
  );
}
