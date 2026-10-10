import { Spinner } from "@/client/components/ui/spinner";
import { useAgentSessionStatus } from "@/client/hooks/use-agent-session-status";
import { cn } from "@/client/lib/utils";
import { rpcClient } from "@/client/rpc/client";
import {
  isToolPart,
  type SessionMessage,
  type TaskId,
} from "@instrument-org/workspace/client";
import { CheckIcon } from "@phosphor-icons/react/Check";
import { useQuery } from "@tanstack/react-query";

import { ChatTasksPopover } from "./chat-activity";
import { useChatTasks } from "./child-tasks-query";
import { type Chat } from "./chats";

/** What the line under a chat's title says, and in which voice. */
type StatusLine =
  | { text: string; tone: "done" }
  | { text: string; tone: "run" }
  | { text: string; tone: "wait" };

/** Said while the chat works and nothing has named the step yet. */
const WORKING = "Instrument is working";

/**
 * The one line under a chat's title that says where its work stands: while
 * anything runs, the step it is on with a spinner, the chat's own work and
 * its tasks' alike, so this is the chat's only loading state; a task
 * stopped to ask the user for something, in amber; and once a task
 * finishes, a check and its name, until the user sends the chat its next
 * message. Pressed, it lists the chat's tasks, the same list the activity at
 * the head's right opens; with no task filed it is only a line. Nothing at
 * all while the chat is at rest with nothing new to say.
 */
export function ChatStatusLine({
  chat,
  onOpenTask,
}: {
  chat: Chat;
  /** Opens one of the chat's tasks beside it. */
  onOpenTask: (taskId: TaskId) => void;
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
    <span
      className={cn(
        "flex max-w-full min-w-0 items-center gap-1.5 text-xs",
        line.tone === "done" && "text-muted-foreground",
        line.tone === "run" && "text-brand-600 dark:text-brand-400",
        line.tone === "wait" && "text-warning-700 dark:text-warning-300",
      )}
    >
      {line.tone === "run" && (
        <Spinner className="size-3 shrink-0" delay={0} thickness={1.5} />
      )}
      {line.tone === "wait" && (
        <span className="size-1.5 shrink-0 rounded-full bg-warning-500" />
      )}
      {line.tone === "done" && (
        <CheckIcon className="size-3 shrink-0 text-brand-600 dark:text-brand-400" />
      )}
      <span className="truncate">{line.text}</span>
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
          className="flex max-w-full min-w-0 rounded-sm px-1 hover:bg-accent data-[state=open]:bg-accent"
          type="button"
        >
          {content}
        </button>
      }
    />
  );
}

/**
 * Where the chat's work stands, as one line. The chat's own turn names its
 * newest step; a task at work names the step it is on; one stopped on the
 * user says what it needs. A task that finished since the user last wrote
 * is named with a check until they write again, so the list of tasks
 * stays a press away once the work is done.
 */
export function statusLine({
  chat,
  isAgentRunning,
  listed,
  messages,
}: {
  chat: Pick<Chat, "runningTasks" | "state">;
  isAgentRunning: boolean;
  listed:
    | {
        standing: { kind: string };
        title: string;
        updatedAt: Date;
      }[]
    | undefined;
  messages: SessionMessage.WithParts[];
}): StatusLine | undefined {
  const moving = chat.runningTasks.filter((task) => !task.waiting);
  const lastTyped = messages.findLast(isTyped);
  // Sent and not yet answered: the turn is starting before the agent says so,
  // which the chat's record confirms, so a message nothing went on to answer
  // does not spin forever.
  const isStarting =
    chat.state === "working" &&
    lastTyped !== undefined &&
    messages.at(-1) === lastTyped;
  if (isAgentRunning || isStarting) {
    return {
      text: turnStep(messages) ?? moving[0]?.step ?? WORKING,
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
  const since = lastTyped?.metadata.createdAt.getTime() ?? 0;
  const finished = listed
    ?.filter(
      (task) =>
        task.standing.kind === "done" && task.updatedAt.getTime() > since,
    )
    .toSorted((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  return finished ? { text: finished.title, tone: "done" } : undefined;
}

/** A message the user typed, rather than a note the app sent the agent. */
function isTyped(message: SessionMessage.WithParts): boolean {
  return (
    message.role === "user" &&
    message.parts.some((part) => part.type === "text") &&
    !message.parts.some(
      (part) =>
        part.type === "data-taskEvent" ||
        part.type === "data-appEvent" ||
        part.type === "data-fromChat",
    )
  );
}

/**
 * The step the chat's current turn is on: the phase its newest call belongs
 * to, or that call's explanation when it named none. Only the turn since the
 * user's last message counts, so a new turn never shows the last one's step.
 * A call still streaming in has its phase written first, so the phase counts
 * once another field has started after it.
 */
export function turnStep(
  messages: SessionMessage.WithParts[],
): string | undefined {
  const turnStart = messages.findLastIndex(
    (message) => message.role === "user",
  );
  for (const message of messages.slice(turnStart + 1).toReversed()) {
    if (message.role !== "assistant") {
      continue;
    }
    for (const part of message.parts.toReversed()) {
      if (!isToolPart(part)) {
        continue;
      }
      const input: unknown = part.input;
      if (typeof input !== "object" || input === null) {
        continue;
      }
      const isActivityComplete =
        part.state !== "input-streaming" ||
        Object.keys(input).some((key) => key !== "activity");
      const label =
        "activity" in input &&
        typeof input.activity === "string" &&
        input.activity.trim() &&
        isActivityComplete
          ? input.activity
          : "explanation" in input && typeof input.explanation === "string"
            ? input.explanation
            : undefined;
      if (label?.trim()) {
        return label;
      }
    }
  }
  return undefined;
}
