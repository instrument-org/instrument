import ms from "ms";

import { MOUNT } from "../../../mount-points";
import { attachedFolderMountPoint } from "../../attached-folder-mounts";
import { isWorking, leftRunning } from "../../chat/activity";
import { describeHoldings } from "../../chat/describe-holdings";
import { taskFolderHoldings } from "../../chat/folder-holdings";
import { folderReach } from "../../chat/folder-reach";
import { stepInFlight } from "../../chat/in-flight";
import { lastAssistantText, latestSessionId } from "../../chat/latest-session";
import { describeLeftRunning } from "../../chat/left-running";
import {
  mountAliases,
  toChatPaths,
  translateTaskFolderPaths,
} from "../../chat/mount-paths";
import { isForkOnlyEnabled } from "../../one-agent";
import { taskDir } from "../../task-dir-utils";
import { chatPathOfWorkDir } from "../../work-dir";
import { taskHold } from "../../task-hold";
import { getTaskState } from "../../task-record";
import { getTaskSettings } from "../../task-settings";
import { getTaskUsageSummary } from "../../usage-summary";
import { effectiveFolderAccess } from "../../workspace-fs-layout";
import { type SubcommandInput, subcommand } from "../subcommands";
import { TASK_COMMAND } from "../task-command";
import { formatAge } from "../task-list-output";
import { requireChild } from "./children";
import { type TaskCommandContext } from "./context";
import { describeHold } from "./delivery";
import { describeHeldTabs } from "./tab-choice";

export const showSubcommand = subcommand<TaskCommandContext>({
  positional: 1,
  run: runShow,
  usage: `  ${TASK_COMMAND.name} show <id>
      Status, model, folders, what its folder holds, and what it last said, whole.
`,
});

async function runShow(input: SubcommandInput, context: TaskCommandContext) {
  const task = await requireChild(input.positional[0], context);
  const state = await getTaskState(taskDir(task.id));
  const running = isWorking(task.id);
  const held = taskHold(task.id);
  // Everything below is the task's, said in this conversation's paths, which
  // are the task's own for every folder this conversation granted it under
  // shared names (see mount-paths.ts).
  const taskFolders = state.attachedFolders ?? {};
  const aliases = mountAliases(await folderReach(context.chatId), taskFolders);
  const folders = Object.values(taskFolders).map(
    (folder, index) =>
      `${aliases[index]?.chatPath ?? attachedFolderMountPoint(folder.mountName)} (${effectiveFolderAccess(folder)})`,
  );
  const holds = await taskFolderHoldings(task.id);
  const sessionId = await latestSessionId(task.id);
  // Whole, and in this conversation's paths: this is where the note's ceiling
  // sends the conversation for the rest of a receipt it cut.
  const said =
    sessionId.isOk() && sessionId.value
      ? await lastAssistantText({
          sessionId: sessionId.value,
          taskId: task.id,
        })
      : undefined;
  const lastSaid =
    said === undefined
      ? undefined
      : translateTaskFolderPaths(
          toChatPaths(said, aliases),
          task.id,
          chatPathOfWorkDir(task.id, context.chatId),
        );

  const settings = await getTaskSettings(taskDir(task.id));
  const handedApps = settings?.apps ?? [];
  const usage = await getTaskUsageSummary(task.id);
  // Its own line rather than a word in the status: the status is the turn,
  // and a turn that ended with a scan still going leaves the task idle with
  // something running.
  const background = leftRunning(task.id);
  const inFlight = running ? await stepInFlight(task.id) : undefined;
  const lines = [
    `${task.id}: "${task.title}"`,
    `status: ${held ? `waiting: ${describeHold(held)}` : running ? "running" : "idle"}`,
    ...(inFlight ? [`now: ${inFlight}`] : []),
    ...(background.length > 0
      ? [
          `in the background: ${background.length > 1 ? "\n  " : ""}${background.map((process) => describeLeftRunning(process)).join("\n  ")}`,
        ]
      : []),
    `last activity: ${task.updatedAt.toISOString().slice(0, 10)}, ${formatAge(Date.now() - task.updatedAt.getTime())} ago`,
    `spent: ${ms(Math.max(1000, usage.activeMs), { long: true })} of work, ${usage.inputTokens + usage.outputTokens} tokens`,
    `model: ${state.selectedModelURI ?? "(none yet)"}`,
    `folders: ${folders.length > 0 ? folders.join(", ") : "none"}`,
    `apps: ${handedApps.length > 0 ? handedApps.join(", ") : "none"}`,
    `tabs: ${describeHeldTabs(state.browserTabs)}`,
    // A fork-only chat's tasks work in its own folder, which is no news.
    ...(isForkOnlyEnabled()
      ? []
      : [
          `folder: ${MOUNT.tasks}/${task.id}, holding ${describeHoldings(holds)}`,
        ]),
    `last said: ${lastSaid ? `\n  ${lastSaid.replaceAll("\n", "\n  ")}` : "nothing yet"}`,
  ];
  return `${lines.join("\n")}\n`;
}
