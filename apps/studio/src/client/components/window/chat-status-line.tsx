import { PlanningDotIcon } from "@/client/components/icons/planning-dot";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/client/components/ui/tooltip";
import { useTaskBackgroundProcesses } from "@/client/hooks/use-task-background-processes";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId, type StoreId } from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { StopIcon } from "@phosphor-icons/react/Stop";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { XIcon } from "@phosphor-icons/react/X";
import { useMutation } from "@tanstack/react-query";

import { ChatTasksPopover } from "./chat-activity";
import { useChatTasks } from "./child-tasks-query";
import { type Chat, limitedText } from "./chats";

/**
 * What the line under a chat's title says, and in which voice. `stopped` is
 * a task that failed, beside its X.
 */
type StatusLine = {
  text: string;
  tone: "done" | "failed" | "limited" | "run" | "stopped" | "wait";
};

/** Said while the chat works and nothing has named the step yet. */
const WORKING = "Instrument is working";

/**
 * Said with the check once the chat's own work is done. A step's label is
 * worded as under way ("Creating the file"), which a check beside it would
 * contradict.
 */
const DONE = "Done";

/**
 * The one line under a chat's title that says where its work stands, in the
 * voice the chat's row in the list uses: while anything runs, the step it is
 * on beside the planning dot, the chat's own work and its tasks' alike, so
 * this is the chat's only loading state; while a card or a question waits on
 * the user, that it does, behind the amber question, whatever else still
 * runs; and at rest, a check beside the task that finished last or that the
 * chat's own work is done, so the line stays once work is done. Nothing
 * once the user stopped the chat's turn, or the user or the chat stopped
 * that task. Only labels of work and task names are said here, never the
 * agent's own words. Once nothing is at work or waiting, it adds how many
 * jobs the chat and its tasks left running after a middle dot, still and in
 * muted gray, since a job running is not the agent at work. While anything
 * runs, its dot turns into a Stop when pointed at, which ends the chat's turn
 * and every task's. Pressed anywhere else, it opens the task card: the
 * chat's own steps, or with tasks or jobs, those to pick from. Nothing at
 * all in a chat that has only talked and left nothing running.
 */
export function ChatStatusLine({
  chat,
  onOpenTask,
}: {
  chat: Parameters<typeof statusLine>[0]["chat"] &
    Pick<Chat, "id" | "ownStep" | "ownWorking">;
  /** Opens one of the chat's tasks beside it. */
  onOpenTask: (sessionId: StoreId.Session) => void;
}) {
  const listed = useChatTasks(chat.id).data;
  const jobs = useTaskBackgroundProcesses(chat.id).length;
  const line = statusLine({ chat, listed });
  // What the chat left running is said once nothing is at work or waiting
  // on the user, whose step or question has the line until then.
  const jobsLine =
    jobs > 0 && line?.tone !== "run" && line?.tone !== "wait"
      ? jobsRunning(jobs)
      : undefined;
  if (!line && !jobsLine) {
    return null;
  }
  const text = (
    <>
      {line && (
        <span
          className={cn(
            "min-w-0 truncate",
            line.tone === "run" && "brand-shiny-text",
            line.tone === "wait" && "text-foreground/80",
            line.tone === "failed" && "text-error-700 dark:text-error-300",
            (line.tone === "done" ||
              line.tone === "limited" ||
              line.tone === "stopped") &&
              "text-muted-foreground",
          )}
        >
          {line.text}
        </span>
      )}
      {line && jobsLine && (
        <span aria-hidden className="shrink-0 text-muted-foreground/60">
          ·
        </span>
      )}
      {jobsLine && (
        <span className="shrink-0 text-muted-foreground">{jobsLine}</span>
      )}
    </>
  );
  // While anything runs, the mark is also the chat's Stop: pointing at the
  // line puts a stop in the dot's place, and the rest of the line still
  // lists the tasks.
  const mark = !line ? null : line.tone === "run" ? (
    <StopChatButton chatId={chat.id} />
  ) : (
    <StatusMark tone={line.tone} />
  );
  // Pressed, the line opens the task card: the chat's own steps, or its
  // tasks to pick from.
  return (
    <div
      aria-live="polite"
      className="group/line flex max-w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] leading-5 hover:bg-accent has-data-[state=open]:bg-accent"
    >
      {mark}
      <ChatTasksPopover
        align="center"
        chatId={chat.id}
        onOpen={onOpenTask}
        // The chat's own row says only what its own session did: the line
        // above speaks for the tasks too, and a task's step or name there
        // would read as the chat's.
        own={{
          line: chat.ownWorking
            ? (chat.ownStep ?? WORKING)
            : chat.lastStep &&
                (chat.state === "idle" || chat.state === "working")
              ? DONE
              : undefined,
          title: chat.title,
          working: chat.ownWorking,
        }}
        tasks={chat.runningTasks}
        trigger={
          <button className="flex min-w-0 items-center gap-1.5" type="button">
            {text}
          </button>
        }
      />
    </div>
  );
}

/** How many jobs the chat and its tasks left running, said after the line's state. */
function jobsRunning(count: number) {
  return `${count} ${count === 1 ? "command" : "commands"} running`;
}

/**
 * The planning dot, which turns into a stop while the line is pointed at
 * or the button has focus. Pressed, it stops the chat's own turn and every
 * task of the chat's.
 */
function StopChatButton({ chatId }: { chatId: ChatId }) {
  const stop = useMutation(rpcClient.workspace.session.stop.mutationOptions());
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label="Stop"
          className="group/stop grid size-5 shrink-0 place-items-center rounded-full disabled:opacity-50"
          disabled={stop.isPending}
          onClick={() => {
            stop.mutate({ id: chatId });
          }}
          type="button"
        >
          <span className="contents group-hover/line:hidden group-focus-visible/stop:hidden">
            <PlanningDotIcon />
          </span>
          <StopIcon
            className="hidden size-3.5 text-foreground/75 group-hover/line:block group-focus-visible/stop:block"
            weight="fill"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>Stop</TooltipContent>
    </Tooltip>
  );
}

/**
 * The mark the chat's row and the tasks list put beside the same state. A
 * stop at a usage limit has none: the words say it, and the reply box's note
 * says what to do.
 */
function StatusMark({ tone }: { tone: StatusLine["tone"] }) {
  switch (tone) {
    case "run": {
      return <PlanningDotIcon />;
    }
    case "wait": {
      return (
        <QuestionIcon
          className="size-3.5 shrink-0 text-warning-700 dark:text-warning-300"
          weight="bold"
        />
      );
    }
    case "failed": {
      return (
        <WarningCircleIcon
          className="size-3.5 shrink-0 text-error-700 dark:text-error-300"
          weight="bold"
        />
      );
    }
    case "stopped": {
      return (
        <XIcon className="size-3.5 shrink-0 text-error-700 dark:text-error-300" />
      );
    }
    case "done": {
      return <CheckIcon className="size-3.5 shrink-0 text-muted-foreground" />;
    }
    case "limited": {
      return null;
    }
  }
}

/**
 * Where the chat's work stands, as one line, said only in labels of work and
 * task names. Running: the step the chat's record names (the chat's own turn
 * first, then a task at work), or the plain line. Stalled, which the record
 * says over anything still running: what the user is waited on for. Stopped
 * by the user: nothing, until the next turn starts. At rest, the task that
 * finished last, while it ended after both the chat's own last step and the
 * user's newest message: its name beside a check, or nothing when the user
 * or the chat stopped it. Otherwise that the chat's work is done, with a
 * check. Nothing in a chat that has done no work. Never the chat's own title
 * again, right under it: a task named like the chat says it is done, or the
 * step it stopped on when it failed.
 */
export function statusLine({
  chat,
  listed,
}: {
  chat: Pick<
    Chat,
    | "lastStep"
    | "lastUserMessageAt"
    | "latest"
    | "runningTasks"
    | "state"
    | "stoppedFor"
    | "title"
  >;
  listed:
    | {
        standing: { kind: string };
        step?: string;
        stoppedBy?: string;
        title: string;
        updatedAt: Date;
      }[]
    | undefined;
}): StatusLine | undefined {
  if (chat.state === "working") {
    return {
      text: chat.latest?.kind === "step" ? chat.latest.text : WORKING,
      tone: "run",
    };
  }
  if (chat.state === "waiting") {
    return { text: "Waiting on you", tone: "wait" };
  }
  if (chat.state === "failed") {
    return { text: "Stopped on an error", tone: "failed" };
  }
  if (chat.state === "stopped") {
    return undefined;
  }
  if (chat.state === "limited") {
    return { text: limitedText(chat), tone: "limited" };
  }
  const own = chat.lastStep;
  const task = listed
    ?.filter(
      (each) =>
        each.standing.kind === "done" || each.standing.kind === "failed",
    )
    .toSorted((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  const differs = (text: string | undefined) =>
    text?.trim() && text.trim() !== chat.title.trim() ? text : undefined;
  // A task is named while it ended after the chat's own last step and after
  // the user last wrote: their message moved on from it, even when the reply
  // to it was words alone and took no step. The reply its finish woke does
  // not, so a finished task stays named under the report of it.
  const since = Math.max(own?.at ?? 0, chat.lastUserMessageAt);
  if (task && task.updatedAt.getTime() >= since) {
    const failed = task.standing.kind === "failed";
    // A task the user or the chat stopped is not done, and saying so is
    // not news to whoever stopped it.
    if (!failed && task.stoppedBy) {
      return undefined;
    }
    const text = differs(task.title) ?? (failed ? differs(task.step) : DONE);
    return text ? { text, tone: failed ? "stopped" : "done" } : undefined;
  }
  return own || task ? { text: DONE, tone: "done" } : undefined;
}
