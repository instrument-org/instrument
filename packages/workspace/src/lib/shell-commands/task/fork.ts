import { APP_NAME } from "@instrument-org/shared";
import path from "node:path";

import { AGENT_FILES_LANGUAGE, AGENT_NEEDS_LANGUAGE } from "../../../constants";
import { MOUNT } from "../../../mount-points";
import { type ChatId } from "../../../schemas/chat-id";
import { type SessionMessage } from "../../../schemas/session/message";
import { type StoreId } from "../../../schemas/store-id";
import { type TaskId } from "../../../schemas/task-id";
import { folderReach } from "../../chat/folder-reach";
import { pathIsWithin } from "../../path-is-within";
import { latestOrNewSessionId } from "../../chat/latest-session";
import { defaultTaskName } from "../../default-task-name";
import { initializeTask } from "../../initialize-task";
import { isToolPart } from "../../is-tool-part";
import { newMessage } from "../../new-message";
import { newTaskId } from "../../new-task-id";
import {
  forkCommandName,
  forksToBackground,
  inForkWords,
  isForkOnlyEnabled,
  ONE_AGENT_NAME,
  oneAgentMode,
} from "../../one-agent";
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
import {
  ANSWER_WAIT_MS,
  awaitAnswers,
  requireFoldersOnDisk,
  resolveFileUploads,
  resolveFolders,
} from "../task-args";
import { TASK_COMMAND } from "../task-command";
import { recordHandOff } from "../task-hand-off";
import { subprocessStdin } from "../utils";
import { resolveApps } from "./app-choice";
import { type TaskCommandContext } from "./context";
import { promptFrom } from "./delivery";
import { chatLayout, handedFolders } from "./folders";
import { chatModel } from "./model-choice";
import { runNew } from "./new";
import { handedTabsLine, resolveTabs, tabsHeldElsewhere } from "./tab-choice";

const FORK_USAGE = `  ${TASK_COMMAND.name} new --name '<title>' [--folder <mount>/<folder>[:rw|:ro]]... [--file <path>]... [--app <slug>]... [--tab <id>]... <<'EOF'
  <what to do now>
  EOF
      Fork this conversation to the background: a run of you that starts with
      the conversation as it stands, works in this same folder, reaches your
      folders at the same paths, and does what stdin says. The conversation is
      its background, so stdin says what to do now and repeats none of it.
      --folder gives it read and write on a folder inside one of yours (one in
      the home folder, say), --file names a file to start from, --app names a
      connected app the work uses, and --tab hands it a tab of the user's,
      page and all. It is one of this chat's tasks and reports back the way a
      task does. \`${TASK_COMMAND.name} fork\` is the same command. Prints its
      id. You are told when it finishes; do not poll it.
  ${TASK_COMMAND.name} new --fresh --name '<title>' [<flags as above>] <<'EOF'
  <the whole brief>
  EOF
      A task with a clean context, for a job unrelated to this conversation:
      it knows nothing of it, so stdin is its whole brief.
`;

/**
 * `task new` under the one agent's `fork` mode, and `task fork` beside it:
 * the shape a model reaches for is the right one, so `new` forks and a clean
 * start is asked for by name (`--fresh`).
 */
export const forkSubcommand = subcommand<TaskCommandContext>({
  booleans: ["fresh"],
  flags: ["app", "file", "folder", "name", "tab"],
  repeatable: ["app", "file", "folder", "tab"],
  run: (input, context, shell) =>
    input.has("fresh")
      ? runNew(input, context, shell)
      : runFork(input, context, shell),
  usage: FORK_USAGE,
});

/**
 * `task new` under the fork-only modes, where every task is a fork: no
 * `--fresh`, and none of the flags that hand a task what a fork already has
 * (`--folder`, `--file`, `--app`), since it reaches exactly the chat's
 * folders, files and apps. Built per call, for the mode's command name.
 */
export function forkOnlyNewSubcommand() {
  const name = forkCommandName();
  return subcommand<TaskCommandContext>({
    flags: ["name", "tab"],
    repeatable: ["tab"],
    run: runFork,
    usage: inForkWords(`  ${name} new --name '<title>' [--tab <id>]... <<'EOF'
  <what to do now>
  EOF
      Start a task: you, carrying on in the background with this conversation
      as it stands, in this same folder and with the same folders, apps and
      memories, doing what stdin says while you keep answering here. stdin
      says what to do now and repeats none of the conversation. --tab hands it
      a tab of the user's, page and all. Prints its id. You are told when it
      finishes; do not poll it.
`),
  });
}

/**
 * `task new` under the one agent's `foreground` mode, where nothing runs in
 * the background: refused, saying where the work goes instead.
 */
export const foregroundNewSubcommand = subcommand<TaskCommandContext>({
  run: () => {
    throw new Error(
      "there is no background work in this conversation. Do the work yourself, here, in this reply.",
    );
  },
  usage: `  ${TASK_COMMAND.name} new
      Not available here: you do every job yourself, in the conversation.
`,
});

async function runFork(
  input: SubcommandInput,
  context: TaskCommandContext,
  { cwd, stdin }: SubcommandShell,
) {
  if (!forksToBackground(oneAgentMode())) {
    throw new Error(
      `fork: not available in this conversation. Start a task with \`${TASK_COMMAND.name} new\`.`,
    );
  }
  const chatSessionId = context.sessionId;
  if (!chatSessionId) {
    throw new Error("there is no conversation to fork outside a turn.");
  }
  const directive = promptFrom(input.positional.join(" "), stdin);
  if (!directive) {
    throw new Error(
      `what to do is required, on stdin through a quoted heredoc.\n\n${FORK_USAGE}`,
    );
  }
  if (input.positional.length > 0 && subprocessStdin(stdin)) {
    throw new Error(
      `unexpected ${input.positional.length === 1 ? "argument" : "arguments"} ${input.positional.map((argument) => `"${argument}"`).join(", ")} beside what to do on stdin. A path with a space in it needs quotes.`,
    );
  }
  const { model, modelURI } = await chatModel("new", context);
  const forkOnly = isForkOnlyEnabled();
  const chatFolders = await folderReach(context.chatId);

  // Every folder the chat reaches comes along at the chat's own path and
  // access, so a path anywhere in the inherited conversation is the same path
  // here. --folder adds a grant for a folder inside one of them that the chat
  // reaches with less access than asked (one in the read-only home folder):
  // mounted on its own, the way `folder self` mounts it, since a mount
  // cannot sit inside another. One the chat already reaches as asked needs
  // nothing more.
  const askedFolders = input.all("folder");
  const resolved = resolveFolders(askedFolders, chatFolders);
  const looks = await requireFoldersOnDisk(resolved, askedFolders);
  const unanswered = await awaitAnswers(
    looks,
    Math.min(ANSWER_WAIT_MS, context.remainingYieldMs() - 2000),
  );
  if (unanswered.length > 0) {
    throw new Error(
      `macOS is asking the user whether ${APP_NAME} may use ${unanswered.map((look) => `"${look.spec}"`).join(" and ")}: tell them to answer the system's dialog, then run this again.`,
    );
  }
  const chatGrants = grantsOfChat(chatFolders);
  const granted = resolved
    .filter(
      (folder) =>
        !chatGrants.some(
          (held) =>
            (held.access === "read-write" || folder.access === "read-only") &&
            pathIsWithin(folder.path, held.path),
        ),
    )
    .map(({ mountName: _nested, ...folder }) => folder);
  const folders = [...chatGrants, ...granted];

  // The fork works in this folder, so a file named here is already where it
  // looks: checked to be there, and named to it rather than copied.
  const layout = await chatLayout(context, chatFolders);
  const askedFiles = input.all("file");
  await resolveFileUploads(askedFiles, { cwd, layout });
  const apps = await resolveApps(input.all("app"));
  const handedTabs = await resolveTabs(input.all("tab"));
  const sharedTabs = await tabsHeldElsewhere(handedTabs, context.chatId);
  const name = input.value("name")?.trim() || defaultTaskName(directive);

  const taskId = await startFork({
    chatId: context.chatId,
    chatSessionId,
    folders,
    handedTabs,
    idFrom: directive,
    model,
    modelURI,
    name,
    prompt: forkDirective(directive, {
      apps,
      files: askedFiles.map((file) =>
        path.posix.isAbsolute(file) ? file : path.posix.join(cwd, file),
      ),
    }),
  });
  recordHandOff({ kind: "created", taskId });
  if (forkOnly) {
    return inForkWords(
      `Started task ${taskId} ("${name}"). It is running now, in this folder with your folders.\n${handedTabsLine(handedTabs)}${sharedTabs}You will be told when it finishes; do not poll it or wait on it, and say nothing more about it until then unless the user asked something else.\n`,
    );
  }

  const reach = Object.values(await folderReach(taskId));
  const grants = granted.map((folder) => {
    const mounted = reach.find(
      (held) => path.resolve(held.path) === path.resolve(folder.path),
    );
    return {
      access: mounted ? effectiveFolderAccess(mounted) : folder.access,
      mountName: mounted?.mountName ?? path.basename(folder.path),
    };
  });
  const grantLine =
    grants.length > 0
      ? `It also has ${handedFolders(grants)}, which you do not; \`${TASK_COMMAND.name} folder self --add\` gives you the same.\n`
      : "";
  return `Forked ${taskId} ("${name}"). It is running now, in this folder (${MOUNT.task}) and with your folders at the same paths.\n${grantLine}${handedTabsLine(handedTabs)}${sharedTabs}You will be told when it finishes; do not poll it or wait on it, and say nothing more about it until then unless the user asked something else.\n`;
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
 * Starts a fork of a chat, however it was asked for (`task new` under the
 * one agent, or a message that interrupted the chat's turn): a task of the
 * chat's that works in its folder, inherits its conversation, and runs the
 * one agent on `prompt` as its own first turn. Returns the fork's id once its
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
      agentName: ONE_AGENT_NAME,
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
export function forkDirective(
  directive: string,
  { apps, files }: { apps: string[]; files: string[] },
): string {
  const startFrom =
    files.length > 0 ? `\nStart from: ${files.join(", ")}.` : "";
  const useApps =
    apps.length > 0
      ? `\nThe work uses the connected ${apps.length === 1 ? "app" : "apps"} ${apps.join(", ")}.`
      : "";
  if (isForkOnlyEnabled()) {
    const command = forkCommandName();
    const note = inForkWords(systemNote`
      Everything above is this conversation as it stood when you were started on the work below, as a task: you, carrying on in the background while the conversation goes on without you. Draw on all of it (the user's words, their memories, what was already found), but do what the assignment says and nothing else the conversation asked for. Nobody watches here: no question, folder request, or app card reaches the user, and \`${command}\`, \`chat\`, \`memory\` and \`tab\` are not in your shell. You share the conversation's folder and the user's folders with it and with any other task, so a file you make here is named for this job, and one that may be open elsewhere is left alone rather than rewritten. Your last message is read back into the conversation, which relays it: a line or two saying what came of it, and a \`\`\`${AGENT_FILES_LANGUAGE} fence naming what you made, placed where the user can reach it. If you cannot go on without something from the user, end with a \`\`\`${AGENT_NEEDS_LANGUAGE} fence instead, one need per line.
    `).trim();
    return `${note}\n\nYour assignment:\n${directive}${startFrom}${useApps}`;
  }
  return `${systemNote`
    Everything above is background context, not your assignment: this chat as it stood when you were forked to work in the background. Draw on it (the user's words, their memories, what was already found), but do what the assignment below says and nothing the conversation asked of the chat. You are one of the chat's tasks now, where nobody watches: no question, folder request, or app card reaches the user from here, and \`${TASK_COMMAND.name}\`, \`chat\`, \`memory\` and \`tab\` are not in your shell. You work in the chat's own folder (\`${MOUNT.task}\`), which the chat keeps using while you run, so write new files rather than rewriting ones it has open; the user's folders are at the same paths. Your last message is read by the chat, which relays it: a line or two saying what came of it, and a \`\`\`${AGENT_FILES_LANGUAGE} fence naming what you made, placed where the user can reach it. If you cannot go on without something from the user, end with a \`\`\`${AGENT_NEEDS_LANGUAGE} fence instead, one need per line.
  `.trim()}\n\nYour assignment:\n${directive}${startFrom}${useApps}`;
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
