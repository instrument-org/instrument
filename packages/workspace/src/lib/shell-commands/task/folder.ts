import { APP_NAME } from "@instrument-org/shared";
import path from "node:path";

import { attachFolder } from "../../attach-folder";
import { attachedFolderMountPoint } from "../../attached-folder-mounts";
import { folderReach } from "../../chat/folder-reach";
import { folderLabel } from "../../folder-parent-label";
import { chatTaskIds } from "../../record-folders";
import { taskDir } from "../../task-dir-utils";
import { getTaskSettings } from "../../task-settings";
import { effectiveFolderAccess } from "../../workspace-fs-layout";
import { type SubcommandInput, subcommand } from "../subcommands";
import {
  ANSWER_WAIT_MS,
  awaitAnswers,
  requireFoldersOnDisk,
  resolveFolders,
} from "../task-args";
import { TASK_COMMAND } from "../task-command";
import { type TaskCommandContext } from "./context";

export const folderSubcommand = subcommand<TaskCommandContext>({
  flags: ["add"],
  repeatable: ["add"],
  run: (input, context) => runFolder(input, context),
  usage: `  ${TASK_COMMAND.name} folder --add <mount>/<folder>...
      Read and write on a folder inside one you reach read-only (one in the
      home folder, say), for you and every task you start after this. Prints
      the path to work in it at.
`,
});

/**
 * Gives the chat a folder inside one it reaches: the home folder is
 * read-only whole, since the workspace is inside it, and a folder in it is
 * not. The chat's tasks reach exactly its folders, so its running forks are
 * given the folder too, at the same path, and every fork started after has
 * it from the chat.
 *
 * The system's own ask for a protected folder (Desktop, Documents,
 * Downloads) comes first.
 */
async function runFolder(input: SubcommandInput, context: TaskCommandContext) {
  const askedAdds = input.all("add");
  if (askedAdds.length === 0) {
    throw new Error("--add <mount>/<folder> is required.");
  }
  const chatFolders = await folderReach(context.chatId);
  const adds = resolveFolders(askedAdds, chatFolders);
  const looks = await requireFoldersOnDisk(adds, askedAdds);
  const unanswered = await awaitAnswers(
    looks,
    Math.min(ANSWER_WAIT_MS, context.remainingYieldMs() - 2000),
  );
  if (unanswered.length > 0) {
    throw new Error(
      `macOS is asking the user whether ${APP_NAME} may use ${unanswered.map((look) => `"${look.spec}"`).join(" and ")}: tell them to answer the system's dialog, then run this again.`,
    );
  }
  const lines: string[] = [];
  for (const folder of adds) {
    await attachFolder({
      access: folder.access,
      path: folder.path,
      taskId: context.chatId,
    });
    const reach = await folderReach(context.chatId);
    const mounted = Object.values(reach).find(
      (held) => path.resolve(held.path) === path.resolve(folder.path),
    );
    const mountPoint = mounted
      ? attachedFolderMountPoint(mounted.mountName)
      : folder.path;
    if (mounted) {
      for (const taskId of chatTaskIds(context.chatId)) {
        if ((await getTaskSettings(taskDir(taskId)))?.fork) {
          await attachFolder({
            access: folder.access,
            mountName: mounted.mountName,
            path: folder.path,
            taskId,
          });
        }
      }
    }
    lines.push(
      `You now have ${folderLabel(folder.path)} at ${mountPoint} (${mounted ? effectiveFolderAccess(mounted) : folder.access}). Work in it there.`,
    );
  }
  return `${lines.join("\n")}\n`;
}
