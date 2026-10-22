import { PlanningDotIcon } from "@/client/components/icons/planning-dot";
import { BashCommandPreview } from "@/client/components/message-part/bash-command-section";
import { StopProcessButton } from "@/client/components/task/stop-process-button";
import { Button } from "@/client/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/client/components/ui/popover";
import { useNow as useElapsedNow } from "@/client/hooks/use-now";
import { useStopBackgroundProcess } from "@/client/hooks/use-stop-background-process";
import {
  type RunningBackgroundProcess,
  useTaskBackgroundProcesses,
} from "@/client/hooks/use-task-background-processes";
import { formatElapsed } from "@/client/lib/format-elapsed";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { APP_NAME } from "@instrument-org/shared";
import { type ChatId, type StoreId } from "@instrument-org/workspace/client";
import { CaretLeftIcon } from "@phosphor-icons/react/CaretLeft";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { StopCircleIcon } from "@phosphor-icons/react/StopCircle";
import { XIcon } from "@phosphor-icons/react/X";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { useTabDeveloperMode } from "@/client/hooks/use-developer-mode";

import { ChildTranscript } from "./child-tasks";
import { useChatTasks } from "./child-tasks-query";
import { type Chat } from "./chats";
import { taskStoppedLine } from "./task-stopped-line";
import { taskTimeLabel } from "./task-time";
import { useNow } from "./use-now";

/** A job's elapsed time shows seconds, so its clock ticks every second while the list is open. */
const ELAPSED_TICK_MS = 1000;

type RunningTask = Chat["runningTasks"][number];
type ChatTask = NonNullable<ReturnType<typeof useChatTasks>["data"]>[number];

/** The chat's own work, which the card lists ahead of its tasks. */
export interface ChatOwnWork {
  /** Its step while it works, or how its work ended. */
  line?: string;
  title: string;
  working: boolean;
}

/**
 * The task card, hanging from the line under the chat's title: what the
 * chat and its tasks did, step by step, with every phase open. With no
 * task it opens straight onto the chat's own steps; with tasks it lists
 * the chat first and its tasks under it, running ones first, and opens
 * the one pressed in place. A task can still be opened beside the chat.
 */
export function ChatTasksPopover({
  align = "end",
  chatId,
  onOpen,
  own,
  tasks,
  trigger,
}: {
  align?: "center" | "end";
  chatId: ChatId;
  /** Opens a task's page, as a tab of the chat's. */
  onOpen: (sessionId: StoreId.Session) => void;
  own: ChatOwnWork;
  tasks: RunningTask[];
  /** A button, which the popover hangs from. */
  trigger: ReactNode;
}) {
  const [isOpen, setOpen] = useState(false);
  const [picked, setPicked] = useState<StoreId.Session | undefined>();
  const listed = useChatTasks(chatId).data;
  const jobs = useTaskBackgroundProcesses(chatId);
  const chatSession = useQuery({
    ...rpcClient.workspace.chats.session.queryOptions({ input: { id: chatId } }),
    enabled: isOpen,
  }).data?.sessionId;
  const hasList = (listed?.length ?? tasks.length) > 0 || jobs.length > 0;
  const shown = picked ?? (hasList ? undefined : chatSession);
  const task = listed?.find((each) => each.id === shown);
  return (
    <Popover
      onOpenChange={(open) => {
        setOpen(open);
        if (!open) {
          setPicked(undefined);
        }
      }}
      open={isOpen}
    >
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        className={cn(
          "p-1",
          shown
            ? "flex h-[min(calc(70vh/var(--content-zoom)),40rem)] w-[min(40rem,calc(90vw/var(--content-zoom)))] flex-col"
            : "w-80",
        )}
      >
        {shown ? (
          <TaskCardSteps
            chatId={chatId}
            isWorking={
              task
                ? task.standing.kind === "running" ||
                  task.standing.kind === "waiting"
                : own.working
            }
            onBack={
              hasList
                ? () => {
                    setPicked(undefined);
                  }
                : undefined
            }
            onOpenBeside={
              task
                ? () => {
                    setOpen(false);
                    onOpen(task.id);
                  }
                : undefined
            }
            sessionId={shown}
            stoppedBy={task?.stoppedBy}
            title={task?.title ?? own.title}
          />
        ) : (
          <TaskRows
            chatId={chatId}
            jobs={jobs}
            listed={listed}
            onOpen={setPicked}
            onOpenChat={
              chatSession
                ? () => {
                    setPicked(chatSession);
                  }
                : undefined
            }
            own={own}
            running={tasks}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * One session's steps in the card: the chat's own or a task's, under a head
 * that names it, with every phase open the way the card is read.
 */
function TaskCardSteps({
  chatId,
  isWorking,
  onBack,
  onOpenBeside,
  sessionId,
  stoppedBy,
  title,
}: {
  chatId: ChatId;
  isWorking: boolean;
  /** Back to the list, where there is one. */
  onBack?: () => void;
  /** Opens the task as a tab of the chat's; none for the chat itself. */
  onOpenBeside?: () => void;
  sessionId: StoreId.Session;
  stoppedBy?: "agent" | "app" | "person";
  title: string;
}) {
  const isDeveloperMode = useTabDeveloperMode();
  return (
    <>
      <div className="flex h-8 shrink-0 items-center gap-1 px-1">
        {onBack && (
          <Button
            aria-label="All tasks"
            onClick={onBack}
            className="size-6"
            size="icon-sm"
            variant="ghost"
          >
            <CaretLeftIcon />
          </Button>
        )}
        <span className="min-w-0 flex-1 truncate px-1 text-[13px] font-medium">
          {title}
        </span>
        {onOpenBeside && (
          <Button onClick={onOpenBeside} size="xs" variant="ghost">
            Open
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <ChildTranscript
          chat={chatId}
          expandGroups
          isDeveloperMode={isDeveloperMode}
          isWorking={isWorking}
          sessionId={sessionId}
          stoppedBy={stoppedBy}
        />
      </div>
    </>
  );
}

/**
 * The chat's tasks under the line under its title: running, then the jobs
 * the chat and its tasks left running, then finished, newest first in each.
 * A task at work or waiting on a card has a stop at its row's end, once the
 * list says whether it has anything to stop.
 */
function TaskRows({
  chatId,
  jobs,
  listed,
  onOpen,
  onOpenChat,
  own,
  running,
}: {
  chatId: ChatId;
  /** Opens the chat's own steps, once its session is known. */
  onOpenChat: (() => void) | undefined;
  own: ChatOwnWork;
  /** What the chat and its tasks started and left running. */
  jobs: RunningBackgroundProcess[];
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
      {onOpenChat && (
        <>
          <Row
            isQuiet={!own.working}
            mark={
              own.working ? (
                <PlanningDotIcon className="size-3.5" />
              ) : (
                <CheckIcon className="size-3.5" />
              )
            }
            onOpen={onOpenChat}
            title="This chat"
          >
            {own.line &&
              (own.working ? (
                <WorkLine task={{ step: own.line, title: own.title }} />
              ) : (
                <span className="min-w-0 truncate">{own.line}</span>
              ))}
          </Row>
          <div className="my-1 h-px bg-border" />
        </>
      )}
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
      {jobs.length > 0 && (
        <>
          {atWork.length > 0 && <div className="my-1 h-px bg-border" />}
          <JobRows chatId={chatId} jobs={jobs} listed={listed} />
        </>
      )}
      {finished.length > 0 && (
        <>
          {(atWork.length > 0 || jobs.length > 0) && (
            <div className="my-1 h-px bg-border" />
          )}
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

/**
 * The jobs the chat and its tasks left running, newest first: each by the
 * agent's label for it over its command, the task that started it, how long
 * it has run, and a stop. Nothing here moves: a job running is not the agent
 * at work. Split from the list so its clock ticks only while it is shown.
 */
function JobRows({
  chatId,
  jobs,
  listed,
}: {
  chatId: ChatId;
  jobs: RunningBackgroundProcess[];
  listed: ChatTask[] | undefined;
}) {
  const now = useElapsedNow(ELAPSED_TICK_MS);
  const { busy, stop, stopAll } = useStopBackgroundProcess(chatId);
  const taskTitles = new Map(listed?.map((task) => [task.id, task.title]));
  return (
    <>
      <div className="flex items-center gap-2 pr-1 pl-2.5">
        <span className="flex-1 pt-1.5 pb-1 text-[11px] font-medium text-muted-foreground">
          Commands
        </span>
        <Button disabled={busy} onClick={stopAll} size="xs" variant="ghost">
          {jobs.length > 1 ? "Stop all" : "Stop"}
        </Button>
      </div>
      {jobs.toReversed().map((job) => {
        const task = taskTitles.get(job.sessionId);
        return (
          <div
            className="flex items-start gap-2 rounded-md py-1.5 pr-1 pl-2.5"
            key={job.id}
          >
            <span className="min-w-0 flex-1">
              {job.explanation ? (
                <>
                  <span className="block truncate text-[13px]">
                    {job.explanation}
                  </span>
                  <BashCommandPreview
                    className="text-[11px] text-muted-foreground"
                    command={job.command}
                    singleLine
                  />
                </>
              ) : (
                <BashCommandPreview
                  className="text-[13px]"
                  command={job.command}
                  singleLine
                />
              )}
              {task && (
                <span className="block truncate text-[11px] text-muted-foreground">
                  {task}
                </span>
              )}
            </span>
            <span className="shrink-0 py-0.5 text-[11px] text-muted-foreground tabular-nums">
              {formatElapsed(job.startedAt, now)}
            </span>
            <StopProcessButton
              className="size-6"
              disabled={busy}
              label="Stop this command"
              onClick={() => {
                stop(job.id);
              }}
            />
          </div>
        );
      })}
      <p className="px-2.5 pt-0.5 pb-1.5 text-[11px] text-muted-foreground">
        They stop when you quit {APP_NAME}, or after two hours.
      </p>
    </>
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
