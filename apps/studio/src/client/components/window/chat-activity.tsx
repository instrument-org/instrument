import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { Spinner } from "@/client/components/ui/spinner";
import { cn } from "@/client/lib/utils";
import { type ChatId, type TaskId } from "@instrument-org/workspace/client";
import { CaretDownIcon } from "@phosphor-icons/react/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { ListChecksIcon } from "@phosphor-icons/react/ListChecks";
import { XIcon } from "@phosphor-icons/react/X";
import { type ReactNode, useState } from "react";

import { useChatTasks } from "./child-tasks-query";
import { type Chat } from "./chats";
import { taskTimeLabel } from "./task-time";
import { useNow } from "./use-now";

type RunningTask = Chat["runningTasks"][number];
type ChatTask = NonNullable<ReturnType<typeof useChatTasks>["data"]>[number];

/**
 * What a chat has in flight, at its head's right: while any task filed from
 * it is at work, a spinner and the step the newest is on in the live
 * shimmer, with how many more run; on a head with no room for the step, the
 * spinner and the count alone. While none runs, a quiet mark and how many
 * tasks the chat has filed. Pressed, it lists the chat's tasks, the running
 * ones first with each one's step and the finished ones under them with when
 * they ended, and a task pressed opens beside the chat. Nothing at all for a
 * chat that has filed no task.
 */
export function ChatActivity({
  chatId,
  isCompact = false,
  onOpen,
  tasks,
}: {
  chatId: ChatId;
  /** Whether it stands as the spinner and the count whatever the room, for a head as narrow as the floating chat's. */
  isCompact?: boolean;
  /** Opens a task's page, as a tab of the chat's. */
  onOpen: (taskId: TaskId) => void;
  tasks: RunningTask[];
}) {
  const [isOpen, setOpen] = useState(false);
  const listed = useChatTasks(chatId).data;
  // The one whose step the head shows: a task held for the user first,
  // since that is the one the user can do something about.
  const lead = tasks.find((task) => task.waiting) ?? tasks[0];
  const filed = listed?.length ?? 0;
  if (!lead && filed === 0) {
    return null;
  }
  const others = tasks.length - 1;
  return (
    <Popover onOpenChange={setOpen} open={isOpen}>
      <PopoverTrigger asChild>
        {lead ? (
          <button
            aria-label={`${tasks.length} ${tasks.length === 1 ? "task" : "tasks"} working`}
            className="flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-accent data-[state=open]:bg-accent"
            type="button"
          >
            <Spinner className="size-3.5 shrink-0" delay={0} />
            {/* The step needs the head's room: under it, the count alone. */}
            <span
              className={cn(
                "hidden min-w-0 items-center gap-1",
                !isCompact && "@lg/head:flex",
              )}
            >
              <WorkLine task={lead} />
              {others > 0 && (
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  +{others}
                </span>
              )}
            </span>
            <span
              className={cn(
                "text-muted-foreground tabular-nums",
                !isCompact && "@lg/head:hidden",
              )}
            >
              {tasks.length}
            </span>
            <CaretDownIcon className="size-3 shrink-0 text-muted-foreground" />
          </button>
        ) : (
          <button
            aria-label={`${filed} ${filed === 1 ? "task" : "tasks"}`}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
            type="button"
          >
            <ListChecksIcon className="size-3.5 shrink-0" />
            <span className="tabular-nums">{filed}</span>
            <CaretDownIcon className="size-3 shrink-0" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-1">
        <TaskRows
          listed={listed}
          onOpen={(id) => {
            setOpen(false);
            onOpen(id);
          }}
          running={tasks}
        />
      </PopoverContent>
    </Popover>
  );
}

/** The chat's tasks under the head's activity: running, then finished, newest first in each. */
function TaskRows({
  listed,
  onOpen,
  running,
}: {
  /** The chat's tasks, once read. */
  listed: ChatTask[] | undefined;
  onOpen: (taskId: TaskId) => void;
  /** What the chat's record says is running, drawn until the list arrives. */
  running: RunningTask[];
}) {
  const now = useNow();
  const byNewest = [...(listed ?? [])].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  const atWork = listed
    ? byNewest.flatMap((task) =>
        task.standing.kind === "running" || task.standing.kind === "waiting"
          ? [
              {
                id: task.id,
                title: task.title,
                ...(task.standing.kind === "waiting"
                  ? { waiting: task.standing.line }
                  : { step: task.standing.line }),
              },
            ]
          : [],
      )
    : running;
  const finished = byNewest.filter(
    (task) => task.standing.kind === "done" || task.standing.kind === "failed",
  );
  return (
    <div className="flex max-h-96 flex-col overflow-y-auto">
      {atWork.length > 0 && <Heading>Running</Heading>}
      {atWork.map((task) => (
        <Row
          key={task.id}
          mark={<Spinner className="size-3.5" delay={0} />}
          onOpen={() => {
            onOpen(task.id);
          }}
          title={task.title}
        >
          <WorkLine task={task} />
        </Row>
      ))}
      {finished.length > 0 && (
        <>
          {atWork.length > 0 && <div className="my-1 h-px bg-border" />}
          <Heading>Finished</Heading>
          {finished.map((task) => (
            <Row
              isQuiet
              key={task.id}
              mark={
                task.standing.kind === "failed" ? (
                  <XIcon className="size-3.5 text-error-700 dark:text-error-300" />
                ) : (
                  <CheckIcon className="size-3.5" />
                )
              }
              onOpen={() => {
                onOpen(task.id);
              }}
              title={task.title}
              trailing={taskTimeLabel(task.updatedAt, now)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground">
      {children}
    </div>
  );
}

function Row({
  children,
  isQuiet = false,
  mark,
  onOpen,
  title,
  trailing,
}: {
  /** The line under the title: a running task's step. */
  children?: ReactNode;
  isQuiet?: boolean;
  mark: ReactNode;
  onOpen: () => void;
  title: string;
  trailing?: string;
}) {
  return (
    <button
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-accent",
        isQuiet && "text-muted-foreground",
      )}
      onClick={onOpen}
      type="button"
    >
      <span className="grid size-3.5 shrink-0 place-items-center">{mark}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{title}</span>
        {children && (
          <span className="flex min-w-0 text-[11px]">{children}</span>
        )}
      </span>
      {trailing && (
        <span className="shrink-0 text-[11px] tabular-nums">{trailing}</span>
      )}
    </button>
  );
}

/**
 * A task's line: what holds it from starting, in the amber a waiting chat
 * wears, or the step it is on in the shimmer that says something is
 * happening.
 */
function WorkLine({
  task,
}: {
  task: { step?: string; title: string; waiting?: string };
}) {
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
    <span className="brand-shiny-text min-w-0 truncate">
      {task.step ?? task.title}
    </span>
  );
}
