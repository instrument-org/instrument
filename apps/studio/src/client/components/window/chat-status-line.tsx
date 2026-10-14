import { PlanningDotIcon } from "@/client/components/icons/planning-dot";
import { cn } from "@/client/lib/utils";
import { type StoreId } from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { HourglassIcon } from "@phosphor-icons/react/Hourglass";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { StopCircleIcon } from "@phosphor-icons/react/StopCircle";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { XIcon } from "@phosphor-icons/react/X";

import { ChatTasksPopover } from "./chat-activity";
import { useChatTasks } from "./child-tasks-query";
import { type Chat } from "./chats";

/**
 * What the line under a chat's title says, and in which voice. `stopped` is
 * a task that failed, beside its X; `halted` is a turn the user stopped, the
 * chat's own or a task's, or a task's turn the chat stopped, beside a stop
 * mark.
 */
type StatusLine = {
  text: string;
  tone: "done" | "failed" | "halted" | "limited" | "run" | "stopped" | "wait";
};

/** Said while the chat works and nothing has named the step yet. */
const WORKING = "Instrument is working";

/**
 * Said once a usage limit stopped the chat's last turn, which is not an error:
 * the notice over its reply box says what to do.
 */
export const LIMITED = "Stopped at a usage limit";

/** Said once the user stopped the chat's turn, until the next one starts, or a task named like the chat. */
const HALTED = "You stopped Instrument";

/** Said for a task named like the chat once the chat stopped it. */
const HALTED_BY_CHAT = "The chat stopped its task";

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
 * chat's own work is done, so the line stays once work is done, or a stop
 * mark when the user stopped the chat's turn, or the user or the chat
 * stopped that task. Only labels
 * of work and task names are said here, never the agent's own words.
 * Pressed, it lists the chat's tasks, the same list the activity at the
 * head's right opens; with no task filed it is only a line. Nothing at all in
 * a chat that has only talked.
 */
export function ChatStatusLine({
  chat,
  onOpenTask,
}: {
  chat: Chat;
  /** Opens one of the chat's tasks beside it. */
  onOpenTask: (sessionId: StoreId.Session) => void;
}) {
  const listed = useChatTasks(chat.id).data;
  const line = statusLine({ chat, listed });
  if (!line) {
    return null;
  }
  const content = (
    <span className="flex max-w-full min-w-0 items-center gap-1.5 text-[12px] leading-5">
      <StatusMark tone={line.tone} />
      <span
        className={cn(
          "min-w-0 truncate",
          line.tone === "run" && "brand-shiny-text",
          line.tone === "wait" && "text-foreground/80",
          line.tone === "failed" && "text-error-700 dark:text-error-300",
          (line.tone === "done" ||
            line.tone === "halted" ||
            line.tone === "limited" ||
            line.tone === "stopped") &&
            "text-muted-foreground",
        )}
      >
        {line.text}
      </span>
    </span>
  );
  if (!listed?.length) {
    return (
      <div aria-live="polite" className="flex max-w-full min-w-0">
        {content}
      </div>
    );
  }
  return (
    <ChatTasksPopover
      align="center"
      chatId={chat.id}
      onOpen={onOpenTask}
      tasks={chat.runningTasks}
      trigger={
        <button
          aria-live="polite"
          className="flex max-w-full min-w-0 rounded-md px-1.5 hover:bg-accent data-[state=open]:bg-accent"
          type="button"
        >
          {content}
        </button>
      }
    />
  );
}

/** The mark the chat's row and the tasks list put beside the same state. */
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
    case "halted": {
      return (
        <StopCircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
      );
    }
    case "limited": {
      return (
        <HourglassIcon className="size-3.5 shrink-0 text-muted-foreground" />
      );
    }
  }
}

/**
 * Where the chat's work stands, as one line, said only in labels of work and
 * task names. Running: the step the chat's record names (the chat's own turn
 * first, then a task at work), or the plain line. Stalled, which the record
 * says over anything still running: what the user is waited on for. Stopped
 * by the user: that they stopped it, until the next turn starts. At
 * rest, the task that finished last, while it ended after both the chat's
 * own last step and the user's newest message: its name beside a check, or
 * a stop mark when the user or the chat stopped it. Otherwise that the chat's work is
 * done, with a check. Nothing in a chat that has done no work. Never the chat's own title
 * again, right under it: a task named like the chat says it is done, who
 * stopped it, or the step it stopped on when it failed.
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
  const waiting = chat.runningTasks.find((task) => task.waiting);
  if (waiting?.waiting) {
    return { text: waiting.waiting, tone: "wait" };
  }
  if (chat.state === "waiting") {
    return { text: "Waiting on you", tone: "wait" };
  }
  if (chat.state === "failed") {
    return { text: "Stopped on an error", tone: "failed" };
  }
  if (chat.state === "stopped") {
    return { text: HALTED, tone: "halted" };
  }
  if (chat.state === "limited") {
    return { text: LIMITED, tone: "limited" };
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
    // A task the user or the chat stopped ended no more on its own than a
    // failed one did.
    const halted = failed
      ? undefined
      : task.stoppedBy === "user"
        ? HALTED
        : task.stoppedBy === "chat"
          ? HALTED_BY_CHAT
          : undefined;
    const text =
      differs(task.title) ?? (failed ? differs(task.step) : (halted ?? DONE));
    return text
      ? { text, tone: failed ? "stopped" : halted ? "halted" : "done" }
      : undefined;
  }
  return own || task ? { text: DONE, tone: "done" } : undefined;
}
