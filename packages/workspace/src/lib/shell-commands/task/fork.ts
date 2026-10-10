import { type ChatId } from "../../../schemas/chat-id";
import { type SessionMessage } from "../../../schemas/session/message";
import { type StoreId } from "../../../schemas/store-id";
import { type TaskId } from "../../../schemas/task-id";
import { isWorking } from "../../chat/activity";
import { folderReach } from "../../chat/folder-reach";
import { latestOrNewSessionId } from "../../chat/latest-session";
import { expectStop } from "../../chat/wake";
import { defaultTaskName } from "../../default-task-name";
import { getCurrentDate } from "../../get-current-date";
import { type FolderGrant, grantFolders } from "../../grant-folders";
import { initializeTask } from "../../initialize-task";
import {
  handOverBackgroundProcesses,
  listBackgroundProcesses,
} from "../../background-processes";
import { isToolPart } from "../../is-tool-part";
import { newMessage } from "../../new-message";
import { newTaskId } from "../../new-task-id";
import { chatTaskIds } from "../../record-folders";
import { Store } from "../../store";
import { taskDir } from "../../task-dir-utils";
import { getTaskState, setTaskState } from "../../task-record";
import { getTaskSettings, recordTaskActivity } from "../../task-settings";
import { getWorkspaceActorRef } from "../../workspace-actor-ref";
import { getWorkspaceConfig } from "../../workspace-config";
import { effectiveFolderAccess } from "../../workspace-fs-layout";
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
import { handedTabsLine, resolveTabs, tabsHeldElsewhere } from "./tab-choice";

const NEW_USAGE = `  ${TASK_COMMAND.name} new --name '<title>' [--tab <id>]... [--job <id>]... <<'EOF'
  <what to do now>
  EOF
      Start a task: you, carrying on in the background with this conversation
      as it stands, in this same folder and with the same folders, apps and
      memories, doing what stdin says while you keep answering here. stdin
      says what to do now and repeats none of the conversation. --tab hands it
      a tab of the user's, page and all. --job hands it a command of yours
      still running in the background (an id \`jobs\` lists), which it then
      waits on rather than you. Prints its id. You are told when it finishes;
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
    throw new Error("there is no conversation to fork outside a turn.");
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
  const sharedTabs = await tabsHeldElsewhere(handedTabs, context.chatId);
  const name = input.value("name")?.trim() || defaultTaskName(directive);

  const taskId = await startFork({
    chatId: context.chatId,
    chatSessionId,
    // Every folder the chat reaches comes along at the chat's own path and
    // access, so a path anywhere in the inherited conversation is the same
    // path here.
    folders: grantsOfChat(await folderReach(context.chatId)),
    handedTabs,
    idFrom: directive,
    keep: withoutCall(context.callPartId),
    model,
    modelURI,
    name,
    onSession: (forkSessionId, forkId) => {
      handOverBackgroundProcesses({
        from: chatSessionId,
        ids: jobs,
        to: forkSessionId,
        toTaskId: forkId,
      });
    },
    assignment:
      jobs.length > 0
        ? `${directive}\n\nStill running in the background, and yours now under the same ids: ${jobs.join(", ")}. Wait on them with \`fg\` rather than starting them again.`
        : directive,
  });
  recordHandOff({ kind: "created", taskId });
  return `Started task ${taskId} ("${name}"). It is running now, in this folder with your folders.\n${handedTabsLine(handedTabs)}${sharedTabs}You will be told when it finishes; do not poll it or wait on it, and say nothing more about it until then unless the user asked something else.\n`;
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
 * The chat's messages without the call that is starting this fork (`callPartId`,
 * the `bash` part `task new` runs in). Unanswered, it is dropped like any call
 * with no result; but a call that ran past its yield has already been
 * answered "still running in the background", and a fork that inherits that
 * answer reads its own start as the work already under way, and waits on it.
 * The call is in a step newer than the provider has cached, so the prefix is
 * unchanged.
 */
export function withoutCall(
  callPartId: StoreId.Part | undefined,
): (messages: SessionMessage.WithParts[]) => SessionMessage.WithParts[] {
  return (messages) =>
    messages.flatMap((message) => {
      const parts = message.parts.filter(
        (part) => part.metadata.id !== callPartId,
      );
      if (parts.length === message.parts.length) {
        return [message];
      }
      return parts.length === 0 ? [] : [{ ...message, parts }];
    });
}

/**
 * Every folder the chat reaches, at the chat's own path and access, so a path
 * anywhere in the inherited conversation is the same path in the fork.
 */
export function grantsOfChat(
  chatFolders: Awaited<ReturnType<typeof folderReach>>,
): FolderGrant[] {
  return Object.values(chatFolders).map((folder) => ({
    access: effectiveFolderAccess(folder),
    mountName: folder.mountName,
    path: folder.path,
    source: folder.source,
  }));
}

/**
 * Starts a fork of a chat: a task of the chat's that works in its
 * folder, inherits its conversation, and runs the agent on `assignment` as its
 * own first turn. Returns the fork's id once its
 * session has been asked to start.
 */
export async function startFork({
  assignment,
  chatId,
  chatSessionId,
  folders,
  handedTabs = [],
  idFrom,
  keep,
  model,
  modelURI,
  name,
  onSession,
}: {
  /** What the chat asks the fork to do, as it wrote it. */
  assignment: string;
  chatId: ChatId;
  chatSessionId: StoreId.Session;
  folders: FolderGrant[];
  handedTabs?: Awaited<ReturnType<typeof resolveTabs>>;
  /** What the fork's id is made from. */
  idFrom: string;
  /** Which of the chat's messages it inherits, in order; all when absent. */
  keep?: (messages: SessionMessage.WithParts[]) => SessionMessage.WithParts[];
  model: Parameters<typeof newMessage>[0]["model"];
  modelURI: Parameters<typeof newMessage>[0]["modelURI"];
  name: string;
  /** Called with the fork's session before its first turn starts. */
  onSession?: (sessionId: StoreId.Session, taskId: TaskId) => void;
}): Promise<TaskId> {
  const workspaceConfig = getWorkspaceConfig();
  const taskId = await newTaskId({ prompt: idFrom, workspaceConfig });
  const effort = (await getTaskSettings(taskDir(chatId)))?.reasoningEffort;
  const initialized = await initializeTask(
    {
      chatId,
      initialSettings: {
        fork: true,
        name,
        ...(effort ? { reasoningEffort: effort } : {}),
        workdir: chatId,
      },
      taskId,
      workspaceConfig,
    },
    {},
  );
  if (initialized.isErr()) {
    throw initialized.error;
  }
  // Granted on the fork's record rather than attached to its first message:
  // the conversation it inherits already names every folder at these paths,
  // so a list on the assignment would only repeat it.
  const held = await getTaskState(taskDir(taskId));
  await setTaskState(taskDir(taskId), {
    attachedFolders: grantFolders(
      Object.values(held.attachedFolders ?? {}),
      folders,
      getCurrentDate().getTime(),
    ).folders,
  });
  if (handedTabs.length > 0) {
    await setTaskState(taskDir(taskId), {
      browserTabs: handedTabs.map((id) => ({ id, openedBy: "handed" })),
    });
  }

  const session = await latestOrNewSessionId(taskId);
  if (session.isErr()) {
    throw session.error;
  }
  const sessionId = session.value;
  await inheritConversation({
    chatId,
    chatSessionId,
    forkId: taskId,
    forkSessionId: sessionId,
    keep,
  });

  const message = await newMessage({
    fromChat: { kind: "assignment", text: assignment },
    model,
    modelURI,
    prompt: "",
    sessionId,
    taskId,
  });
  if (message.isErr()) {
    throw message.error;
  }
  onSession?.(sessionId, taskId);
  getWorkspaceActorRef().send({
    type: "createSession",
    value: {
      id: taskId,
      message: message.value,
      model,
      sessionId,
    },
  });
  await recordTaskActivity(taskId);
  return taskId;
}

/**
 * Copies the chat's session into the fork's: the baseline (system prompt and
 * context message) and every message so far, under the same ids, so the
 * fork's first request renders the same bytes as the chat's up to the
 * fork's own turn. Each copy is marked `inherited` in its metadata, which no
 * model request carries, so a transcript can set the background apart
 * without moving the prefix.
 *
 * Left out: a tool call that has not answered yet, which is the `fork` call
 * itself, since a call with no result is a request a provider refuses.
 * Usage and timing come off the copied replies, which the chat already
 * counted, so the fork's spend is its own.
 */
async function inheritConversation({
  chatId,
  chatSessionId,
  forkId,
  forkSessionId,
  keep = (messages) => messages,
}: {
  chatId: ChatId;
  chatSessionId: StoreId.Session;
  forkId: TaskId;
  forkSessionId: StoreId.Session;
  keep?: (messages: SessionMessage.WithParts[]) => SessionMessage.WithParts[];
}) {
  const messages = await Store.getMessagesWithParts({
    sessionId: chatSessionId,
    taskId: chatId,
  });
  if (messages.isErr()) {
    throw messages.error;
  }
  for (const message of keep(messages.value)) {
    const copy = inherited(message, forkSessionId);
    if (!copy) {
      continue;
    }
    const saved = await Store.saveMessageWithParts(copy, forkId);
    if (saved.isErr()) {
      throw saved.error;
    }
  }
  // The chat's rollover boundary holds for the copy, under the same ids, so
  // the fork sends what the chat sends rather than history the chat dropped.
  const chatSession = await Store.getSession(chatSessionId, chatId);
  const forkSession = await Store.getSession(forkSessionId, forkId);
  if (
    chatSession.isOk() &&
    forkSession.isOk() &&
    chatSession.value.rolledOverAfterMessageId
  ) {
    const saved = await Store.saveSession(
      {
        ...forkSession.value,
        rolledOverAfterMessageId: chatSession.value.rolledOverAfterMessageId,
        rolledOverUnderUsableTokens:
          chatSession.value.rolledOverUnderUsableTokens,
      },
      forkId,
    );
    if (saved.isErr()) {
      throw saved.error;
    }
  }
}

function inherited(
  message: SessionMessage.WithParts,
  sessionId: StoreId.Session,
): SessionMessage.WithParts | undefined {
  const parts = message.parts
    .filter((part) => !isToolPart(part) || part.state.startsWith("output-"))
    .map((part) => inSession(part, sessionId));
  if (parts.length === 0 && message.parts.length > 0) {
    return undefined;
  }
  if (message.role === "assistant") {
    const {
      completionTokensPerSecond: _rate,
      msToFinish: _finish,
      msToFirstChunk: _firstChunk,
      usage: _usage,
      ...metadata
    } = message.metadata;
    return {
      ...message,
      metadata: { ...metadata, inherited: true, sessionId },
      parts,
    };
  }
  return { ...markedInherited(message, sessionId), parts };
}

/** A message filed under another session, marked as inherited. */
function markedInherited<
  T extends { metadata: { inherited?: boolean; sessionId: StoreId.Session } },
>(item: T, sessionId: StoreId.Session): T {
  return {
    ...item,
    metadata: { ...item.metadata, inherited: true, sessionId },
  };
}

/** The same record, filed under another session. */
function inSession<T extends { metadata: { sessionId: StoreId.Session } }>(
  item: T,
  sessionId: StoreId.Session,
): T {
  return { ...item, metadata: { ...item.metadata, sessionId } };
}

/**
 * The chat's forks still running, for a stop of the chat to end with them:
 * Stop means all of the user's work, wherever it is running.
 */
export async function runningForks(chatId: ChatId): Promise<TaskId[]> {
  const ids = chatTaskIds(chatId).filter((id) => isWorking(id));
  const settings = await Promise.all(
    ids.map((id) => getTaskSettings(taskDir(id))),
  );
  return ids.filter((_, index) => settings[index]?.fork === true);
}

/** Ends a fork's turn, as a stop the chat expects rather than news. */
export function stopFork(taskId: TaskId): void {
  expectStop(taskId);
  getWorkspaceActorRef().send({ type: "stopSessions", value: { id: taskId } });
}
