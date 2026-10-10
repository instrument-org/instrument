import { PlanningDotIcon } from "@/client/components/icons/planning-dot";
import { useAgentSessionStatus } from "@/client/hooks/use-agent-session-status";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  joinedMidTurn,
  latestStepIn,
  type SessionMessage,
  type StoreId,
} from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { QuestionIcon } from "@phosphor-icons/react/Question";
import { WarningCircleIcon } from "@phosphor-icons/react/WarningCircle";
import { XIcon } from "@phosphor-icons/react/X";
import { useQuery } from "@tanstack/react-query";

import { ChatTasksPopover } from "./chat-activity";
import { useChatTasks } from "./child-tasks-query";
import { type Chat } from "./chats";

/** What the line under a chat's title says, and in which voice. */
type StatusLine = {
  text: string;
  tone: "done" | "failed" | "run" | "stopped" | "wait";
};

/** Said while the chat works and nothing has named the step yet. */
const WORKING = "Instrument is working";

/**
 * The one line under a chat's title that says where its work stands, in the
 * voice the chat's row in the list uses: while anything runs, the step it is
 * on beside the planning dot, the chat's own work and its tasks' alike, so
 * this is the chat's only loading state; what it waits on the user for,
 * behind the amber question; and at rest, the last thing it did with a
 * check, so the line stays once work is done. Only labels of work and task
 * names are said here, never the agent's own words. Pressed, it lists the
 * chat's tasks, the same list the activity at the head's right opens; with no
 * task filed it is only a line. Nothing at all in a chat that has only
 * talked.
 */
export function ChatStatusLine({
  chat,
  onOpenTask,
}: {
  chat: Chat;
  /** Opens one of the chat's tasks beside it. */
  onOpenTask: (taskId: StoreId.Session) => void;
}) {
  const { isAgentRunning } = useAgentSessionStatus({
    id: chat.id,
    sessionId: chat.sessionId,
  });
  // The same live list the transcript reads, so this shares its subscription.
  const messages =
    useQuery(
      rpcClient.workspace.message.live.list.experimental_liveOptions({
        input: { id: chat.id, sessionId: chat.sessionId },
      }),
    ).data ?? [];
  const listed = useChatTasks(chat.id).data;
  const line = statusLine({
    chat,
    isAgentRunning,
    listed,
    messages,
  });
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
          (line.tone === "done" || line.tone === "stopped") &&
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
  }
}

/**
 * Where the chat's work stands, as one line, said only in labels of work and
 * task names. Running: the chat's own turn names its newest step (its phase,
 * or the call's explanation), then a task at work its step or its name, then
 * the plain line. Stalled: what the user is waited on for. At rest: the last
 * thing done, the chat's own last step or the task that finished last,
 * whichever came later, with a check. Nothing in a chat that has done no work.
 * Never the chat's own title again, right under it: a task named like the
 * chat says its last step instead, and one with nothing else to say says
 * nothing.
 */
export function statusLine({
  chat,
  isAgentRunning,
  listed,
  messages,
}: {
  chat: Pick<Chat, "runningTasks" | "state" | "title">;
  isAgentRunning: boolean;
  listed:
    | {
        standing: { kind: string };
        step?: string;
        title: string;
        updatedAt: Date;
      }[]
    | undefined;
  messages: SessionMessage.WithParts[];
}): StatusLine | undefined {
  const moving = chat.runningTasks.filter((task) => !task.waiting);
  const turnStart = messages.findLastIndex(
    (message) => message.role === "user" && !joinedMidTurn(message),
  );
  // Sent and not yet answered: the turn is starting before the agent says so,
  // which the chat's record confirms, so a message nothing went on to answer
  // does not spin forever.
  const isStarting =
    chat.state === "working" &&
    turnStart !== -1 &&
    turnStart === messages.length - 1;
  if (isAgentRunning || isStarting) {
    // Only this turn's calls, so a new turn never shows the last one's step.
    const step = latestStepIn(messages.slice(turnStart + 1));
    return {
      text: step ?? moving[0]?.step ?? moving[0]?.title ?? WORKING,
      tone: "run",
    };
  }
  const lead = moving[0];
  if (lead) {
    return { text: lead.step ?? lead.title, tone: "run" };
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
  const own = lastStep(messages);
  const task = listed
    ?.filter(
      (each) =>
        each.standing.kind === "done" || each.standing.kind === "failed",
    )
    .toSorted((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  const differs = (text: string | undefined) =>
    text?.trim() && text.trim() !== chat.title.trim() ? text : undefined;
  if (task && (!own || task.updatedAt.getTime() >= own.at)) {
    const text = differs(task.title) ?? differs(task.step);
    return text
      ? { text, tone: task.standing.kind === "failed" ? "stopped" : "done" }
      : undefined;
  }
  const text = differs(own?.step);
  return text ? { text, tone: "done" } : undefined;
}

/** The chat's newest labeled step, and when the message holding it was sent. */
function lastStep(
  messages: SessionMessage.WithParts[],
): { at: number; step: string } | undefined {
  for (const message of messages.toReversed()) {
    const step = latestStepIn([message]);
    if (step !== undefined) {
      return { at: message.metadata.createdAt.getTime(), step };
    }
  }
  return undefined;
}
