import { AGENT_FILES_LANGUAGE, AGENT_NEEDS_LANGUAGE } from "../../../constants";
import { type ChatId } from "../../../schemas/chat-id";
import { type SessionMessage } from "../../../schemas/session/message";
import { type StoreId } from "../../../schemas/store-id";
import { type TaskId } from "../../../schemas/task-id";
import { folderReach } from "../../chat/folder-reach";
import { latestOrNewSessionId } from "../../chat/latest-session";
import { defaultTaskName } from "../../default-task-name";
import { initializeTask } from "../../initialize-task";
import { isToolPart } from "../../is-tool-part";
import { newMessage } from "../../new-message";
import { newTaskId } from "../../new-task-id";
import { Store } from "../../store";
import { systemNote } from "../../system-note";
import { taskDir } from "../../task-dir-utils";
import { setTaskState } from "../../task-record";
import { getTaskSettings, recordTaskActivity } from "../../task-settings";
import { getWorkspaceActorRef } from "../../workspace-actor-ref";
import { getWorkspaceConfig } from "../../workspace-config";
import { effectiveFolderAccess } from "../../workspace-fs-layout";
import {
  type SubcommandInput,
  type SubcommandShell,
  subcommand,
} from "../subcommands";
import { TASK_COMMAND } from "../task-command";
import { recordHandOff } from "../task-hand-off";
import { subprocessStdin } from "../utils";
import { type TaskCommandContext } from "./context";
import { promptFrom } from "./delivery";
import { chatModel } from "./model-choice";
import { handedTabsLine, resolveTabs, tabsHeldElsewhere } from "./tab-choice";

const NEW_USAGE = `  ${TASK_COMMAND.name} new --name '<title>' [--tab <id>]... <<'EOF'
  <what to do now>
  EOF
      Start a task: you, carrying on in the background with this conversation
      as it stands, in this same folder and with the same folders, apps and
      memories, doing what stdin says while you keep answering here. stdin
      says what to do now and repeats none of the conversation. --tab hands it
      a tab of the user's, page and all. Prints its id. You are told when it
      finishes; do not poll it.
`;

/**
 * `task new`: starts a task, which is always a fork of the chat. No flag
 * hands it folders, files or apps, since it reaches exactly the chat's.
 */
export const newSubcommand = subcommand<TaskCommandContext>({
  flags: ["name", "tab"],
  repeatable: ["tab"],
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
    model,
    modelURI,
    name,
    prompt: forkDirective(directive),
  });
  recordHandOff({ kind: "created", taskId });
  return `Started task ${taskId} ("${name}"). It is running now, in this folder with your folders.\n${handedTabsLine(handedTabs)}${sharedTabs}You will be told when it finishes; do not poll it or wait on it, and say nothing more about it until then unless the user asked something else.\n`;
}

/** A folder a fork is granted, in the shape `newMessage` takes. */
type ForkFolder = NonNullable<
  Parameters<typeof newMessage>[0]["folders"]
>[number];

/**
 * Every folder the chat reaches, at the chat's own path and access, so a path
 * anywhere in the inherited conversation is the same path in the fork.
 */
export function grantsOfChat(
  chatFolders: Awaited<ReturnType<typeof folderReach>>,
): ForkFolder[] {
  return Object.values(chatFolders).map((folder) => ({
    access: effectiveFolderAccess(folder),
    mountName: folder.mountName,
    path: folder.path,
    source: folder.source,
  }));
}

/**
 * Starts a fork of a chat, however it was asked for (`task new`, or a message
 * that interrupted the chat's turn): a task of the chat's that works in its
 * folder, inherits its conversation, and runs the agent on `prompt` as its
 * own first turn. Returns the fork's id once its
 * session has been asked to start.
 */
export async function startFork({
  chatId,
  chatSessionId,
  folders,
  handedTabs = [],
  idFrom,
  keep,
  model,
  modelURI,
  name,
  prompt,
  settings,
}: {
  chatId: ChatId;
  chatSessionId: StoreId.Session;
  folders: ForkFolder[];
  handedTabs?: Awaited<ReturnType<typeof resolveTabs>>;
  /** What the fork's id is made from. */
  idFrom: string;
  /** Which of the chat's messages it inherits, in order; all when absent. */
  keep?: (messages: SessionMessage.WithParts[]) => SessionMessage.WithParts[];
  model: Parameters<typeof newMessage>[0]["model"];
  modelURI: Parameters<typeof newMessage>[0]["modelURI"];
  name: string;
  /** The fork's first turn, as `forkDirective` writes it. */
  prompt: string;
  /** Recorded on the fork's settings beside what every fork carries. */
  settings?: { forkedOnInterrupt?: boolean };
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
        ...settings,
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
    folders,
    model,
    modelURI,
    prompt,
    sessionId,
    taskId,
  });
  if (message.isErr()) {
    throw message.error;
  }
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
 * The fork's own turn, after everything it inherited. Said here rather than
 * ahead of the conversation so the request up to this turn is the chat's
 * own, which is the prefix a provider's cache already holds; the label that
 * the conversation is background rather than the assignment is the first
 * thing in it.
 */
export function forkDirective(directive: string): string {
  const note = systemNote`
    Everything above is this conversation as it stood when you were started on the work below, as a task: you, carrying on in the background while the conversation goes on without you. Draw on all of it (the user's words, their memories, what was already found), but do what the assignment says and nothing else the conversation asked for. Nobody watches here: no question, folder request, or app card reaches the user, and \`${TASK_COMMAND.name}\`, \`chat\`, \`memory\` and \`tab\` are not in your shell. You share the conversation's folder and the user's folders with it and with any other task, so a file you make here is named for this job, and one that may be open elsewhere is left alone rather than rewritten. Your last message is read back into the conversation, which relays it: a line or two saying what came of it, and a \`\`\`${AGENT_FILES_LANGUAGE} fence naming what you made, placed where the user can reach it. If you cannot go on without something from the user, end with a \`\`\`${AGENT_NEEDS_LANGUAGE} fence instead, one need per line.
  `.trim();
  return `${note}\n\nYour assignment:\n${directive}`;
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
