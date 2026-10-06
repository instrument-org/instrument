import fs from "node:fs/promises";
import path from "node:path";

import {
  AGENT_FILES_LANGUAGE,
  AGENT_NEEDS_LANGUAGE,
  TASK_FOLDER_NAMES,
} from "../../../constants";
import { MOUNT } from "../../../mount-points";
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
import { isOneAgentEnabled, ONE_AGENT_NAME } from "../../one-agent";
import { Store } from "../../store";
import { systemNote } from "../../system-note";
import { taskDir } from "../../task-dir-utils";
import { getTaskSettings, recordTaskActivity } from "../../task-settings";
import { getWorkspaceActorRef } from "../../workspace-actor-ref";
import { getWorkspaceConfig } from "../../workspace-config";
import { effectiveFolderAccess } from "../../workspace-fs-layout";
import {
  type SubcommandInput,
  type SubcommandShell,
  subcommand,
} from "../subcommands";
import { resolveFileUploads } from "../task-args";
import { TASK_COMMAND } from "../task-command";
import { recordHandOff } from "../task-hand-off";
import { subprocessStdin } from "../utils";
import { type TaskCommandContext } from "./context";
import { promptFrom } from "./delivery";
import { chatLayout, handedFolders } from "./folders";
import { chatModel } from "./model-choice";

const FORK_USAGE = `  ${TASK_COMMAND.name} fork --name '<title>' [--file <path>]... <<'EOF'
  <what to do now>
  EOF
      Fork this conversation to the background: a run of you that starts with
      the conversation as it stands, your folders at the same paths, and its
      own working folder copied from yours, then does what stdin says. It is
      one of this chat's tasks, and reports back the way a task does. The
      directive says what to do now; the conversation is the background, so
      none of it needs repeating. --file hands it a file beside the copy.
      Prints its id. You are told when it finishes; do not poll it.
`;

export const forkSubcommand = subcommand<TaskCommandContext>({
  flags: ["file", "name"],
  repeatable: ["file"],
  run: runFork,
  usage: FORK_USAGE,
});

/**
 * Top-level entries of a chat's folder a fork's copy leaves out: the
 * private dir and the chat's own tasks (the fork's folder among them), and
 * what is rebuilt on demand or is only ever scratch.
 */
const NOT_COPIED = new Set<string>([
  TASK_FOLDER_NAMES.private,
  TASK_FOLDER_NAMES.tmp,
  TASK_FOLDER_NAMES.toolOutput,
  TASK_FOLDER_NAMES.browserSession,
  "tasks",
  "node_modules",
  ".venv",
]);

async function runFork(
  input: SubcommandInput,
  context: TaskCommandContext,
  { cwd, stdin }: SubcommandShell,
) {
  if (!isOneAgentEnabled()) {
    throw new Error(
      `fork: not available in this conversation. Start a task with \`${TASK_COMMAND.name} new\`.`,
    );
  }
  const chatSessionId = context.sessionId;
  if (!chatSessionId) {
    throw new Error("fork: there is no conversation to fork outside a turn.");
  }
  const directive = promptFrom(input.positional.join(" "), stdin);
  if (!directive) {
    throw new Error(
      `fork: what to do is required, on stdin through a quoted heredoc.\n\n${FORK_USAGE}`,
    );
  }
  if (input.positional.length > 0 && subprocessStdin(stdin)) {
    throw new Error(
      `fork: unexpected ${input.positional.length === 1 ? "argument" : "arguments"} ${input.positional.map((argument) => `"${argument}"`).join(", ")} beside what to do on stdin.`,
    );
  }
  const workspaceConfig = getWorkspaceConfig();
  const { model, modelURI } = await chatModel("fork", context);
  const chatFolders = await folderReach(context.chatId);
  const layout = await chatLayout(context, chatFolders);
  const files = await resolveFileUploads(input.all("file"), { cwd, layout });
  const name = input.value("name")?.trim() || defaultTaskName(directive);

  const taskId = await newTaskId({ prompt: directive, workspaceConfig });
  const effort = (await getTaskSettings(taskDir(context.chatId)))
    ?.reasoningEffort;
  const initialized = await initializeTask(
    {
      chatId: context.chatId,
      initialSettings: {
        fork: true,
        name,
        ...(effort ? { reasoningEffort: effort } : {}),
      },
      taskId,
      workspaceConfig,
    },
    {},
  );
  if (initialized.isErr()) {
    throw initialized.error;
  }
  await copyWorkingFolder(context.chatId, taskId);

  const session = await latestOrNewSessionId(taskId);
  if (session.isErr()) {
    throw session.error;
  }
  const sessionId = session.value;
  await inheritConversation({
    chatId: context.chatId,
    chatSessionId,
    forkId: taskId,
    forkSessionId: sessionId,
  });

  // Every folder the chat reaches, under the name it reaches it by and with
  // the access it has there, so a path anywhere in the inherited conversation
  // is the same path here.
  const folders = Object.values(chatFolders).map((folder) => ({
    access: effectiveFolderAccess(folder),
    mountName: folder.mountName,
    path: folder.path,
    source: folder.source,
  }));
  const message = await newMessage({
    files,
    folders,
    model,
    modelURI,
    prompt: forkDirective(directive),
    sessionId,
    taskId,
  });
  if (message.isErr()) {
    throw message.error;
  }
  getWorkspaceActorRef().send({
    type: "createSession",
    value: {
      agentName: ONE_AGENT_NAME,
      id: taskId,
      message: message.value,
      model,
      sessionId,
    },
  });
  await recordTaskActivity(taskId);
  recordHandOff({ kind: "created", taskId });
  return `Forked ${taskId} ("${name}"). It is running now, with this conversation and your folders (${handedFolders(folders)}).\nYou will be told when it finishes; do not poll it or wait on it, and say nothing more about it until then unless the user asked something else.\n`;
}

/**
 * The fork's own turn, after everything it inherited. Said here rather than
 * ahead of the conversation so the request up to this turn is the chat's
 * own, which is the prefix a provider's cache already holds.
 */
function forkDirective(directive: string): string {
  return `${systemNote`
    Everything above is this chat as it stood when you were forked to work in the background, and it is yours to use: the user's words, their memories, what you already found. You are one of the chat's tasks now, where nobody watches: no question, folder request, or app card reaches the user from here, and \`${TASK_COMMAND.name}\`, \`chat\`, \`memory\` and \`tab\` are not in your shell. Your working folder (\`${MOUNT.task}\`) is a copy of the chat's as it stood, and the user's folders are at the same paths. Do the work below in full. Your last message is read by the chat, which relays it: a line or two saying what came of it, and a \`\`\`${AGENT_FILES_LANGUAGE} fence naming what you made, placed where the user can reach it. If you cannot go on without something from the user, end with a \`\`\`${AGENT_NEEDS_LANGUAGE} fence instead, one need per line.
  `.trim()}\n\n${directive}`;
}

/**
 * The fork's working folder as a copy of the chat's: what the conversation
 * calls `attachments/report.pdf` or `work/notes.md` is there under the same
 * name. A copy rather than a share, since every tool resolves a task's
 * working folder from where its record is.
 */
async function copyWorkingFolder(chatId: ChatId, forkId: TaskId) {
  const from = taskDir(chatId);
  // Entry by entry, since the fork's folder is inside the chat's and a copy
  // of the whole would be a copy into itself.
  for (const entry of await fs.readdir(from)) {
    if (!NOT_COPIED.has(entry)) {
      await fs.cp(path.join(from, entry), path.join(taskDir(forkId), entry), {
        force: true,
        recursive: true,
      });
    }
  }
}

/**
 * Copies the chat's session into the fork's: the baseline (system prompt and
 * context message) and every message so far, under the same ids, so the
 * fork's first request renders the same bytes as the chat's up to the
 * fork's own turn.
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
}: {
  chatId: ChatId;
  chatSessionId: StoreId.Session;
  forkId: TaskId;
  forkSessionId: StoreId.Session;
}) {
  const messages = await Store.getMessagesWithParts({
    sessionId: chatSessionId,
    taskId: chatId,
  });
  if (messages.isErr()) {
    throw messages.error;
  }
  for (const message of messages.value) {
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
    return { ...message, metadata: { ...metadata, sessionId }, parts };
  }
  return { ...inSession(message, sessionId), parts };
}

/** The same record, filed under another session. */
function inSession<T extends { metadata: { sessionId: StoreId.Session } }>(
  item: T,
  sessionId: StoreId.Session,
): T {
  return { ...item, metadata: { ...item.metadata, sessionId } };
}
