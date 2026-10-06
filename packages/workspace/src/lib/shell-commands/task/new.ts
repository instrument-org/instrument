import { APP_NAME } from "@instrument-org/shared";

import { MOUNT } from "../../../mount-points";
import { type SessionMessage } from "../../../schemas/session/message";
import { attachedFolderMountPoint } from "../../attached-folder-mounts";
import { chatBackground } from "../../chat-background";
import { folderReach } from "../../chat/folder-reach";
import { latestOrNewSessionId } from "../../chat/latest-session";
import { mountAliases, toTaskPaths } from "../../chat/mount-paths";
import { defaultTaskName } from "../../default-task-name";
import { initializeTask } from "../../initialize-task";
import { newMessage } from "../../new-message";
import { newTaskId } from "../../new-task-id";
import { isTaskContextEnabled } from "../../one-agent";
import { taskDir } from "../../task-dir-utils";
import { holdTask } from "../../task-hold";
import { setTaskState } from "../../task-record";
import { getTaskSettings, recordTaskActivity } from "../../task-settings";
import { getWorkspaceActorRef } from "../../workspace-actor-ref";
import { getWorkspaceConfig } from "../../workspace-config";
import {
  type SubcommandInput,
  type SubcommandShell,
  subcommand,
} from "../subcommands";
import {
  ANSWER_WAIT_MS,
  awaitAnswers,
  requireFilesNamedInBrief,
  requireFoldersOnDisk,
  resolveFileUploads,
  resolveFolders,
} from "../task-args";
import { TASK_COMMAND } from "../task-command";
import { recordHandOff } from "../task-hand-off";
import { subprocessStdin } from "../utils";
import { requireAppsNamedInBrief, resolveApps } from "./app-choice";
import { type TaskCommandContext } from "./context";
import {
  folderAskHold,
  promptFrom,
  stampedNow,
  withRefusals,
} from "./delivery";
import {
  chatLayout,
  filePaths,
  handedFiles,
  handedFolders,
  requireFoldersNamedInBriefHanded,
  requireUnnestedMounts,
  withWorkspaceFolder,
} from "./folders";
import { chatModel } from "./model-choice";
import { handedTabsLine, resolveTabs, tabsHeldElsewhere } from "./tab-choice";

export const NEW_USAGE = `  ${TASK_COMMAND.name} new --name '<title>' [--folder <mount>[/<folder>][:rw|:ro]]... [--file <path>]... [--app <slug>]... [--tab <id>]... <<'EOF'
  <prompt>
  EOF
      Create a task and start it. The prompt is its whole brief: it knows nothing
      about this conversation. Give it on stdin with a quoted heredoc, as shown,
      so the shell leaves it alone: inside double quotes a $800 becomes 00. The
      title takes single quotes for the same reason. Every task has the workspace
      folder, ${MOUNT.attachedFolders}/Instrument, read and write, without being asked:
      its results go there unless the brief says where else. Other folders are
      mounts under ${MOUNT.attachedFolders} in this conversation, or a folder inside one,
      named with or without the prefix; a task sees none unless named here,
      with the access this conversation has unless :ro narrows it. --file hands
      the task one file you can read, a file the user sent above all: a copy
      lands in the task's own attachments/ and the task is told it is there,
      so the brief calls it by that name. --app hands the task a
      connected app, by slug; it gets the \`app\` command for that app and no
      other. --tab hands the task a tab already open, by the id the note on
      their message gives, page and all; repeat it for several pages that
      are one job (compare these, fill this form from that page), and the
      task starts on the first. A task opens the pages it needs in tabs of
      its own in this chat too, behind whatever the user has up, so work on
      a new page needs no tab: the brief names the page.
      Prints the task id. You are told when it finishes a turn; do not poll it.
      What that note carries is its last message, so the brief names a file to
      make and a folder for it, never findings or a summary to put in the reply.
`;

export const newSubcommand = subcommand<TaskCommandContext>({
  flags: ["app", "file", "folder", "name", "tab"],
  repeatable: ["app", "file", "folder", "tab"],
  run: runNew,
  usage: NEW_USAGE,
});

/**
 * Held back from the yield window while `new` waits on the user's answer to
 * the system's ask, for the task to be made and the command to return inside
 * it.
 */
const ANSWER_WAIT_MARGIN_MS = 2000;

export async function runNew(
  input: SubcommandInput,
  context: TaskCommandContext,
  { cwd, stdin }: SubcommandShell,
) {
  const prompt = promptFrom(input.positional.join(" "), stdin);
  if (!prompt) {
    throw new Error(
      `new: a brief is required, on stdin through a quoted heredoc.\n\n${NEW_USAGE}`,
    );
  }
  // With the brief on stdin, a bare word on the command is a mistake, and
  // the usual one is the tail of a path with a space in it: `--folder
  // /mnt/x/a folder:rw` reaches here as the folder `a` and the word
  // `folder:rw`, which would otherwise be dropped without a word.
  if (input.positional.length > 0 && subprocessStdin(stdin)) {
    throw new Error(
      `new: unexpected ${input.positional.length === 1 ? "argument" : "arguments"} ${input.positional.map((argument) => `"${argument}"`).join(", ")} beside the brief on stdin. A path with a space in it needs quotes: --folder '${MOUNT.attachedFolders}/<mount>/a folder:rw'.`,
    );
  }
  const workspaceConfig = getWorkspaceConfig();
  const { model, modelURI } = await chatModel("new", context);
  const askedFolders = input.all("folder");
  const chatFolders = await folderReach(context.chatId);
  const resolvedFolders = resolveFolders(askedFolders, chatFolders);
  const looks = await requireFoldersOnDisk(resolvedFolders, askedFolders);
  const folders = withWorkspaceFolder(resolvedFolders, chatFolders);
  requireUnnestedMounts(
    "new",
    folders.map((folder, index) => ({ ...folder, spec: askedFolders[index] })),
  );
  const askedFiles = input.all("file");
  const layout = await chatLayout(context, chatFolders);
  await requireFilesNamedInBrief(prompt, askedFiles, { cwd, layout });
  const files = await resolveFileUploads(askedFiles, { cwd, layout });
  requireFoldersNamedInBriefHanded("new", prompt, chatFolders, [
    ...folders.map((folder) => attachedFolderMountPoint(folder.mountName)),
    ...filePaths(askedFiles, cwd),
  ]);
  const name = input.value("name")?.trim() || defaultTaskName(prompt);
  const handedTabs = await resolveTabs(input.all("tab"));
  const sharedTabs = await tabsHeldElsewhere(handedTabs, context.chatId);
  const apps = await resolveApps(input.all("app"));
  requireAppsNamedInBrief(prompt, apps);
  // The dialog is on the user's screen already, so the answer is often a few
  // seconds off: waited for, it is reported as what it is, a task started or
  // a refusal with nothing made. Only a look still unanswered after the wait
  // makes a task that waits on it.
  const unanswered = await awaitAnswers(
    looks,
    Math.min(
      ANSWER_WAIT_MS,
      context.remainingYieldMs() - ANSWER_WAIT_MARGIN_MS,
    ),
  );

  const taskId = await newTaskId({ prompt, workspaceConfig });
  // How hard the conversation thinks is how hard its tasks think: the level is
  // a property of the workspace rather than of one turn, and a task the
  // conversation cannot configure has no other way to be told.
  const effort = (await getTaskSettings(taskDir(context.chatId)))
    ?.reasoningEffort;
  const initialized = await initializeTask(
    {
      chatId: context.chatId,
      initialSettings: {
        apps,
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
  // The chat's background beside the brief (`task_context`): the user's
  // words, its topic instructions and memories, marked as not the assignment.
  const background =
    isTaskContextEnabled() && context.sessionId
      ? await chatBackground({
          chatId: context.chatId,
          chatSessionId: context.sessionId,
          standing: true,
        })
      : undefined;
  const message = await newMessage({
    ...(background ? { chatBackground: background } : {}),
    files,
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
  // The task mounts each folder at this conversation's path for it, so the
  // brief reads the same there; the swap covers a name another folder of the
  // task's had taken.
  const aliases = mountAliases(chatFolders, await folderReach(taskId));
  const briefed = {
    ...message.value,
    parts: message.value.parts.map((part) =>
      part.type === "text"
        ? { ...part, text: toTaskPaths(part.text, aliases) }
        : part,
    ),
  };

  const start = (brief: SessionMessage.UserWithParts) => {
    getWorkspaceActorRef().send({
      type: "createSession",
      value: {
        agentName: "main",
        id: taskId,
        message: brief,
        model,
        sessionId,
      },
    });
  };
  // A folder the system is still asking the user about holds the task until
  // they answer, since a file written by its path goes through while the ask
  // is up, and a refusal would come after the work it was meant to prevent.
  if (unanswered.length === 0) {
    start(briefed);
  } else {
    holdTask(taskId, {
      ...folderAskHold(unanswered),
      // Stamped when it starts, so the turn's clock counts the work rather
      // than the wait.
      start: (refusals) => {
        start(withRefusals(stampedNow(briefed), refusals));
      },
      until: Promise.all(unanswered.map((look) => look.answer)).then(
        (answers) => answers.filter((answer) => answer !== undefined),
      ),
    });
  }
  await recordTaskActivity(taskId);

  if (unanswered.length === 0) {
    recordHandOff({ kind: "created", taskId });
  }
  const asking =
    unanswered.length === 0
      ? `It is running now.`
      : `macOS is asking the user whether ${APP_NAME} may use ${unanswered.map((look) => `"${look.spec}"`).join(" and ")}, and the task starts once they answer: tell them to answer the system's dialog. Until then it waits; \`${TASK_COMMAND.name} send\` queues behind that, and \`${TASK_COMMAND.name} stop\` cancels it.`;
  return `Created ${taskId} ("${name}"). ${asking}\nIts folders: ${handedFolders(folders)}.\n${handedFiles(message.value)}${handedTabsLine(handedTabs)}${sharedTabs}You will be told when it finishes; do not poll it or wait on it, and say nothing more about it until then unless the user asked something else.\n`;
}
