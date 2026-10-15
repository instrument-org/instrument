import { PlanningDotIcon } from "@/client/components/icons/planning-dot";
import { StopProcessButton } from "@/client/components/task/stop-process-button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId, type StoreId } from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { StopCircleIcon } from "@phosphor-icons/react/StopCircle";
import { XIcon } from "@phosphor-icons/react/X";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { useChatTasks } from "./child-tasks-query";
import { type Chat } from "./chats";
import { taskStoppedLine } from "./task-stopped-line";
import { taskTimeLabel } from "./task-time";
import { useNow } from "./use-now";

type RunningTask = Chat["runningTasks"][number];
type ChatTask = NonNullable<ReturnType<typeof useChatTasks>["data"]>[number];

/**
 * The chat's tasks, running ones first, hanging from the line under the
 * chat's title. A task pressed opens beside the chat.
 */
export function ChatTasksPopover({
  align = "end",
  chatId,
  onOpen,
  tasks,
  trigger,
}: {
  align?: "center" | "end";
  chatId: ChatId;
  /** Opens a task's page, as a tab of the chat's. */
  onOpen: (sessionId: StoreId.Session) => void;
  tasks: RunningTask[];
  /** A button, which the popover hangs from. */
  trigger: ReactNode;
}) {
  const [isOpen, setOpen] = useState(false);
  const listed = useChatTasks(chatId).data;
  return (
    <Popover onOpenChange={setOpen} open={isOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} className="w-80 p-1">
        <TaskRows
          chatId={chatId}
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

/**
 * The chat's tasks under the line under its title: running, then finished, newest
 * first in each. A task at work or waiting on a card has a stop at its row's
 * end, once the list says whether it has anything to stop.
 */
function TaskRows({
  chatId,
  listed,
  onOpen,
  running,
}: {
  chatId: ChatId;
  /** The chat's tasks, once read. */
  listed: ChatTask[] | undefined;
  onOpen: (sessionId: StoreId.Session) => void;
  /** What the chat's record says is running, drawn until the list arrives. */
  running: RunningTask[];
}) {
  const now = useNow();
  const stop = useMutation(rpcClient.workspace.session.stop.mutationOptions());
  const byNewest = [...(listed ?? [])].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
  const atWork: (RunningTask & { stoppable?: boolean })[] = listed
    ? byNewest.flatMap((task) =>
        task.standing.kind === "running" || task.standing.kind === "waiting"
          ? [
              {
                id: task.id,
                stoppable: task.stoppable,
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
          action={
            task.stoppable && (
              <StopProcessButton
                className="size-6"
                // Only the task whose stop is on its way: the rest stay
                // stoppable while it goes.
                disabled={
                  stop.isPending && stop.variables?.sessionId === task.id
                }
                label="Stop this task"
                onClick={() => {
                  stop.mutate({ id: chatId, sessionId: task.id });
                }}
              />
            )
          }
          key={task.id}
          mark={<PlanningDotIcon className="size-3.5" />}
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
          {finished.map((task) => {
            const stopped = taskStoppedLine(task.stoppedBy);
            return (
              <Row
                isQuiet
                key={task.id}
                mark={
                  task.standing.kind === "failed" ? (
                    <XIcon className="size-3.5 text-error-700 dark:text-error-300" />
                  ) : stopped ? (
                    <StopCircleIcon className="size-3.5" />
                  ) : (
                    <CheckIcon className="size-3.5" />
                  )
                }
                onOpen={() => {
                  onOpen(task.id);
                }}
                title={task.title}
                trailing={taskTimeLabel(task.updatedAt, now)}
              >
                {/* A task that did not finish says why, in the red the Tasks
                    screen gives the same line; one the user or the chat
                    stopped says who did. */}
                {task.standing.kind === "failed" ? (
                  <span className="min-w-0 truncate text-error-700 dark:text-error-300">
                    {task.standing.line}
                  </span>
                ) : (
                  stopped && <span className="min-w-0 truncate">{stopped}</span>
                )}
              </Row>
            );
          })}
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
  action,
  children,
  isQuiet = false,
  mark,
  onOpen,
  title,
  trailing,
}: {
  /** A control at the row's end, such as a working task's stop: the open button's sibling, since a button cannot hold another. */
  action?: ReactNode;
  /** The line under the title: a running task's step, or why one failed. */
  children?: ReactNode;
  isQuiet?: boolean;
  mark: ReactNode;
  onOpen: () => void;
  title: string;
  trailing?: string;
}) {
  const row = (
    <button
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-accent",
        isQuiet && "text-muted-foreground",
        action && "pr-9",
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
  if (!action) {
    return row;
  }
  return (
    <div className="relative">
      {row}
      <span className="absolute top-1/2 right-1.5 -translate-y-1/2">
        {action}
      </span>
    </div>
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
