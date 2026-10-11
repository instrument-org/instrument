import { type AIGatewayModel } from "@instrument-org/ai-gateway";

import { type ChatId } from "../../../schemas/chat-id";
import { StoreId } from "../../../schemas/store-id";
import { addChildTask, type ChatTask } from "../../chat/children";
import { defaultTaskName } from "../../default-task-name";
import {
  handOverBackgroundProcesses,
  listBackgroundProcesses,
} from "../../background-processes";
import { updateHeldTabs } from "../../held-tabs";
import { newMessage } from "../../new-message";
import { Store } from "../../store";
import { getWorkspaceActorRef } from "../../workspace-actor-ref";
import {
  type SubcommandInput,
  type SubcommandShell,
  subcommand,
} from "../subcommands";
import { normalizeId } from "../background-jobs";
import { TASK_COMMAND } from "../task-command";
import { recordHandOff } from "../task-hand-off";
import { subprocessStdin } from "../utils";
import { type TaskCommandContext } from "./context";
import { promptFrom } from "./delivery";
import { chatModel } from "./model-choice";
import {
  handedTabsLine,
  refuseTabsDrivenElsewhere,
  resolveTabs,
} from "./tab-choice";

const NEW_USAGE = `  ${TASK_COMMAND.name} new --name '<title>' [--tab <id>]... [--job <id>]... <<'EOF'
  <what to do now>
  EOF
      Start a task: you, carrying on in the background with this conversation
      as it stands, in this same folder and with the same folders, apps and
      memories, doing what stdin says while you keep answering here. stdin
      says what to do now and repeats none of the conversation. --tab hands it
      a tab of the user's, page and all. --job hands it a command of yours
      still running in the background (an id \`jobs\` lists), which it then
      waits on rather than you. Prints its id, t1. You are told when it finishes;
      do not poll it.
`;

/**
 * `task new`: starts a task, which is always a fork of the chat. No flag
 * hands it folders, files or apps, since it reaches exactly the chat's.
 */
export const newSubcommand = subcommand<TaskCommandContext>({
  flags: ["job", "name", "tab"],
  repeatable: ["job", "tab"],
  run: runFork,
  usage: NEW_USAGE,
});

async function runFork(
  input: SubcommandInput,
  context: TaskCommandContext,
  { stdin }: SubcommandShell,
) {
  const chatSessionId = context.sessionId;
  if (!chatSessionId) {
    throw new Error("there is no conversation to carry on outside a turn.");
  }
  const directive = promptFrom(input.positional.join(" "), stdin);
  if (!directive) {
    throw new Error(
      `what to do is required, on stdin through a quoted heredoc.\n\n${NEW_USAGE}`,
    );
  }
  if (input.positional.length > 0 && subprocessStdin(stdin)) {
    throw new Error(
      `unexpected ${input.positional.length === 1 ? "argument" : "arguments"} ${input.positional.map((argument) => `"${argument}"`).join(", ")} beside what to do on stdin. A path with a space in it needs quotes.`,
    );
  }
  const jobs = handedJobs(input.all("job"), chatSessionId);
  const { model, modelURI } = await chatModel("new", context);
  const handedTabs = await resolveTabs(input.all("tab"));
  await refuseTabsDrivenElsewhere(handedTabs, context.chatId);
  const name = input.value("name")?.trim() || defaultTaskName(directive);

  const task = await startFork({
    callPartId: context.callPartId,
    chatId: context.chatId,
    chatSessionId,
    handedTabs,
    model,
    modelURI,
    name,
    onSession: (forkSessionId) => {
      handOverBackgroundProcesses({
        from: chatSessionId,
        ids: jobs,
        to: forkSessionId,
        toChatId: context.chatId,
      });
    },
    assignment:
      jobs.length > 0
        ? `${directive}\n\nStill running in the background, and yours now under the same ids: ${jobs.join(", ")}. Wait on them with \`fg\` rather than starting them again.`
        : directive,
  });
  recordHandOff({ kind: "created", sessionId: task.id });
  return `Started task ${task.handle} ("${name}"). It is running now, in this folder with your folders.\n${handedTabsLine(handedTabs)}You will be told when it finishes; do not poll it or wait on it, and say nothing more about it until then unless the user asked something else.\n`;
}

/**
 * The ids `--job` names, each a command of the chat's still running in the
 * background, which the fork takes over so that it, not the chat, waits on
 * it: the route for work the chat hands off partway, with a build or a
 * download already under way.
 */
function handedJobs(args: string[], sessionId: StoreId.Session): string[] {
  const running = new Set(
    listBackgroundProcesses(sessionId)
      .filter((process) => process.status === "running")
      .map((process) => process.id),
  );
  return args.map((arg) => {
    const id = normalizeId(arg);
    if (!id || !running.has(id)) {
      throw new Error(
        `--job ${arg} is not a command of yours still running; \`jobs\` lists them.`,
      );
    }
    return id;
  });
}

/**
 * The last of the chat's messages a task carries on from: the one before the
 * step whose call (`callPartId`, the `bash` part `task new` runs in) starts
 * it, which is the last message the request that wrote that call was sent.
 * The task's first request then sends that same prefix, which the provider
 * has cached, and nothing of the step still under way, whose calls have no
 * results yet and whose own result would read as the work already started.
 * The newest message when no call is named.
 */
async function forkPoint({
  callPartId,
  chatId,
  chatSessionId,
}: {
  callPartId: StoreId.Part | undefined;
  chatId: ChatId;
  chatSessionId: StoreId.Session;
}): Promise<StoreId.Message> {
  const messages = await Store.getMessagesWithParts({
    sessionId: chatSessionId,
    chatId,
  });
  if (messages.isErr()) {
    throw messages.error;
  }
  const calling = messages.value.findIndex((message) =>
    message.parts.some((part) => part.metadata.id === callPartId),
  );
  const before =
    calling === -1 ? messages.value.at(-1) : messages.value[calling - 1];
  if (!before) {
    throw new Error("there is no conversation to carry on from yet.");
  }
  return before.id;
}

/**
 * Starts a task of a chat: a session in the chat's store that carries the
 * chat's conversation on from where it stands, works in the chat's folder
 * with the chat's folders, model and effort, and runs the agent on
 * `assignment` as its own first turn. Returns the task once it has
 * been asked to start.
 */
async function startFork({
  assignment,
  callPartId,
  chatId,
  chatSessionId,
  handedTabs = [],
  model,
  modelURI,
  name,
  onSession,
}: {
  /** What the chat asks the task to do, as it wrote it. */
  assignment: string;
  /** The call starting it, whose step the task leaves out. */
  callPartId: StoreId.Part | undefined;
  chatId: ChatId;
  chatSessionId: StoreId.Session;
  handedTabs?: Awaited<ReturnType<typeof resolveTabs>>;
  model: AIGatewayModel.Type;
  modelURI: Parameters<typeof newMessage>[0]["modelURI"];
  name: string;
  /** Called with the task's session before its first turn starts. */
  onSession?: (sessionId: StoreId.Session) => void;
}): Promise<ChatTask> {
  const chatSession = await Store.getSession(chatSessionId, chatId);
  if (chatSession.isErr()) {
    throw chatSession.error;
  }
  const now = new Date();
  const task = await addChildTask(chatId, {
    createdAt: now,
    forkedAtMessageId: await forkPoint({ callPartId, chatId, chatSessionId }),
    id: StoreId.newSessionId(),
    // The chat's rollover boundary holds for what the task carries on from,
    // so it sends what the chat sends rather than history the chat dropped.
    ...(chatSession.value.rolledOverAfterMessageId
      ? {
          rolledOverAfterMessageId: chatSession.value.rolledOverAfterMessageId,
          rolledOverUnderUsableTokens:
            chatSession.value.rolledOverUnderUsableTokens,
        }
      : {}),
    status: "running",
    title: name,
    updatedAt: now,
  });
  const sessionId = task.id;
  if (handedTabs.length > 0) {
    await updateHeldTabs(chatId, sessionId, (held) => [
      ...held,
      ...handedTabs.map((id) => ({ id, openedBy: "handed" as const })),
    ]);
  }

  const message = await newMessage({
    fromChat: { kind: "assignment", text: assignment },
    modelURI,
    prompt: "",
    sessionId,
    chatId,
  });
  if (message.isErr()) {
    throw message.error;
  }
  onSession?.(sessionId);
  getWorkspaceActorRef().send({
    type: "createSession",
    value: {
      id: chatId,
      message: message.value,
      model,
      sessionId,
    },
  });
  return task;
}
