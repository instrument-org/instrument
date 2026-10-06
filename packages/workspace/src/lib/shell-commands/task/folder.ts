import { APP_NAME } from "@instrument-org/shared";
import path from "node:path";

import { attachFolder, detachFolder } from "../../attach-folder";
import { attachedFolderMountPoint } from "../../attached-folder-mounts";
import { folderReach } from "../../chat/folder-reach";
import { mountAliases } from "../../chat/mount-paths";
import { outputFolderPath } from "../../chat/output-folder";
import { folderLabel } from "../../folder-parent-label";
import { isOneAgentEnabled } from "../../one-agent";
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
  resolveFolders,
} from "../task-args";
import { TASK_COMMAND } from "../task-command";
import { requireOwnChild } from "./children";
import { type TaskCommandContext } from "./context";
import { grantPurpose, tellOfGrant } from "./delivery";
import {
  byMountName,
  chatPathsOf,
  matchTaskFolder,
  requireUnnestedMounts,
} from "./folders";

export const folderSubcommand = subcommand<TaskCommandContext>({
  booleans: ["none"],
  flags: ["add", "remove"],
  positional: 1,
  repeatable: ["add", "remove"],
  run: runFolder,
  usage: `  ${TASK_COMMAND.name} folder <id> [--add <mount>[/<folder>][:rw|:ro]]... [--remove <mount>[/<folder>]]... [--none] [<<'EOF'
  <what it is for>
  EOF]
      Change which folders a task may reach, named the way \`new --folder\`
      names them. --add hands it one more of yours, read and write unless :ro
      narrows it, and naming a folder it already has re-grants that one at the
      new access instead of mounting it twice. --remove takes one away; --none
      takes every one away. The workspace folder stays either way, since that
      is where its results go. The task is told at once: a working task hears
      it at its next step, an idle one it hands a folder carries on with it as
      a new turn. Say what the folder is for on stdin, in the same heredoc form
      as \`send\`, and it is told that too.
      With the one agent, \`self\` in place of an id gives this conversation
      itself a folder inside one of its own, read and write unless :ro, mounted
      beside the one it is in: \`folder self --add <mount>/<folder>\`.
`,
});

/**
 * Changes which of the user's folders a task may reach.
 *
 * The grant `new --folder` makes, made after the fact: a task that turns out to
 * need one more folder is handed it where it stands, rather than stopped and
 * started again with everything it had worked out thrown away. The specs are
 * this conversation's own, the same as on `new`, and the task mounts each
 * folder at the same path.
 *
 * A task reads its folders fresh on every turn, so the mount is there the
 * moment this returns, and the task is told in the same call (tellOfGrant).
 */
async function runFolder(
  input: SubcommandInput,
  context: TaskCommandContext,
  { stdin }: SubcommandShell,
) {
  if (input.positional[0] === "self") {
    return await runSelfFolder(input, context);
  }
  const task = await requireOwnChild(input.positional[0], context);
  const askedAdds = input.all("add");
  const askedRemoves = input.all("remove");
  const none = input.has("none");
  if (askedAdds.length === 0 && askedRemoves.length === 0 && !none) {
    throw new Error(
      `folder: --add, --remove, or --none is required. \`${TASK_COMMAND.name} show ${task.id}\` lists the folders it has.`,
    );
  }
  const chatFolders = await folderReach(context.chatId);
  // Resolved before anything is written, so a refused spec leaves the task's
  // folders as they were rather than half changed.
  const adds = resolveFolders(askedAdds, chatFolders);
  await requireFoldersOnDisk(adds, askedAdds);
  const workspace = path.resolve(outputFolderPath());
  // Matched against the folders as they stand before any of this runs: every
  // spec on the line names one of those, not one a later removal has moved.
  const taskFolders = await folderReach(task.id);
  const removes = none
    ? Object.values(taskFolders).filter(
        (folder) => path.resolve(folder.path) !== workspace,
      )
    : askedRemoves.map((spec) => {
        const folder = matchTaskFolder(spec, chatFolders, taskFolders);
        if (!folder) {
          throw new Error(
            `${task.id} has no folder "${spec}". \`${TASK_COMMAND.name} show ${task.id}\` lists the ones it has.`,
          );
        }
        if (path.resolve(folder.path) === workspace) {
          throw new Error(
            "every task keeps the workspace folder, which is where its results go when nothing else says. Hand it another folder to write to rather than taking this one away.",
          );
        }
        return folder;
      });
  const removedPaths = new Set(
    removes.map((folder) => path.resolve(folder.path)),
  );
  const kept = Object.values(taskFolders).filter(
    (folder) => !removedPaths.has(path.resolve(folder.path)),
  );
  requireUnnestedMounts("folder", [
    ...kept.map((folder) => ({ ...folder, spec: undefined })),
    ...adds.map((folder, index) => ({ ...folder, spec: askedAdds[index] })),
  ]);
  const purpose = await grantPurpose("folder", task.id, context, stdin, [
    ...chatPathsOf(mountAliases(chatFolders, byMountName(kept))),
    ...adds.map((folder) => attachedFolderMountPoint(folder.mountName)),
  ]);

  const lines: string[] = [];
  const facts: string[] = [];
  // Taken away first, so `--remove <folder> --add <folder>:ro` reads as the
  // re-grant it looks like rather than as a removal of what was just added.
  for (const folder of removes) {
    await detachFolder({ path: folder.path, taskId: task.id });
    lines.push(
      `Took ${mountAliases(chatFolders, { [folder.mountName]: folder })[0]?.chatPath ?? attachedFolderMountPoint(folder.mountName)} back from ${task.id}.`,
    );
    facts.push(
      `The folder ${folderLabel(folder.path)} at ${attachedFolderMountPoint(folder.mountName)} was taken back from you.`,
    );
  }
  for (const folder of adds) {
    const attached = await attachFolder({
      access: folder.access,
      mountName: folder.mountName,
      path: folder.path,
      taskId: task.id,
    });
    lines.push(
      `${task.id} now has ${attachedFolderMountPoint(folder.mountName)} (${folder.access}).`,
    );
    facts.push(
      `You were handed the folder ${folderLabel(attached.path)} at ${attachedFolderMountPoint(attached.mountName)}, ${attached.access === "read-write" ? "read and write" : "read-only"}.`,
    );
  }
  const told = await tellOfGrant({
    added: adds.length > 0,
    command: "folder",
    context,
    facts,
    purpose,
    task,
  });
  return `${lines.join("\n") || `${task.id} has no folder but the workspace folder.`}\n${told}`;
}

/**
 * Gives the conversation itself a folder inside one it reaches, the grant
 * \`--folder\` makes a task: the home folder is read-only whole, since the
 * workspace is inside it, and a folder in it is not. Only the one agent
 * writes with its own tools, so only it is offered this.
 *
 * The system's own ask for a protected folder (Desktop, Documents,
 * Downloads) still comes first, the way it does on \`new\`.
 */
async function runSelfFolder(
  input: SubcommandInput,
  context: TaskCommandContext,
) {
  if (!isOneAgentEnabled()) {
    throw new Error(
      `folder: \`self\` is not available in this conversation. Hand the folder to a task with --folder.`,
    );
  }
  const askedAdds = input.all("add");
  if (askedAdds.length === 0) {
    throw new Error("folder self: --add <mount>/<folder> is required.");
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
    lines.push(
      `You now have ${folderLabel(folder.path)} at ${mountPoint} (${mounted ? effectiveFolderAccess(mounted) : folder.access}). Work in it there.`,
    );
  }
  return `${lines.join("\n")}\n`;
}
