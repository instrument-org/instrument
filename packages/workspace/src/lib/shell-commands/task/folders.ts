import path from "node:path";

import { MOUNT } from "../../../mount-points";
import { type FolderAttachment } from "../../../schemas/folder-attachment";
import { type SessionMessage } from "../../../schemas/session/message";
import { attachedFolderMountPoint } from "../../attached-folder-mounts";
import { childTaskMounts } from "../../chat/children";
import {
  type FolderMounts,
  type MountAlias,
  mountPathOf,
  mountPathsOutside,
} from "../../chat/mount-paths";
import { outputFolderPath } from "../../chat/output-folder";
import { taskDir } from "../../task-dir-utils";
import {
  type WorkspaceFsLayout,
  buildWorkspaceFsLayout,
} from "../../workspace-fs-layout";
import { chatOnlyPathsIn, parseFolderSpec, resolveFolders } from "../task-args";
import { TASK_COMMAND } from "../task-command";
import { type TaskCommandContext } from "./context";

/**
 * Refuses a brief that names a folder by a path the task will not have. A
 * task reaches each folder it is handed at this conversation's path for it,
 * and nothing else under this conversation's mounts, so a path under one of
 * them that no handed folder or file covers names nothing there. A folder the
 * task is not handed is still something a brief can talk about, by its name,
 * the way a person would.
 *
 * `handed` holds this conversation's paths for what the task is handed: its
 * folders and the files given with --file.
 */
export function requireFoldersNamedInBriefHanded(
  command: "app" | "folder" | "new" | "send",
  prompt: string,
  chatFolders: FolderMounts,
  handed: string[],
  taskId?: string,
) {
  const chatOnly = chatOnlyPathsIn(prompt, handed);
  if (chatOnly.length > 0) {
    throw new Error(
      `${command}: the ${command === "new" ? "brief" : "message"} names ${chatOnly.join(", ")}, and no task reaches ${MOUNT.apps} or ${MOUNT.tasks}: they are yours alone. Have the task leave what it makes in its own folder and \`cp\` it into place yourself when it reports; hand it a file from one with --file. Nothing was ${command === "new" ? "created" : "sent"}.`,
    );
  }
  const unreachable = mountPathsOutside(prompt, chatFolders, handed);
  if (unreachable.length === 0) {
    return;
  }
  const named = unreachable.join(", ");
  const handOver =
    command === "new"
      ? `pass the folder with --folder`
      : command === "folder"
        ? `add it on this command with --add <path>`
        : `hand it over first with \`${TASK_COMMAND.name} folder ${taskId ?? "<id>"} --add <path>\``;
  throw new Error(
    `${command}: the ${command === "new" ? "brief" : "message"} names ${named}, which this task ${command === "new" ? "is not handed" : "was not handed"}. A task reaches only the folders it is handed, each at the path you reach it by: ${handedFolderPaths(handed)}. If the task needs the folder, ${handOver}; if not, call the folder by its name rather than its path. Nothing was ${command === "new" ? "created" : "sent"}.`,
  );
}

/**
 * Refuses a set of folders where one would mount inside another. A task
 * mounts each at this conversation's path for it, and a filesystem holds no
 * mount inside another, so `/mnt/Home` and `/mnt/Home/Desktop` cannot both be
 * a task's. The usual intent, reading the whole and writing one folder in it,
 * is a task handed only the folder it writes.
 */
export function requireUnnestedMounts(
  command: "folder" | "new",
  folders: { mountName: string; spec: string | undefined }[],
) {
  for (const outer of folders) {
    const inner = folders.find((folder) =>
      folder.mountName.startsWith(`${outer.mountName}/`),
    );
    if (!inner) {
      continue;
    }
    const named = (folder: { mountName: string; spec: string | undefined }) =>
      folder.spec ?? attachedFolderMountPoint(folder.mountName);
    throw new Error(
      `${command}: ${named(inner)} is inside ${named(outer)}, and a task cannot be handed both: it reaches each folder at your path for it, and one cannot be mounted inside the other. Hand it only the one the work needs${command === "folder" ? `, taking the other back with --remove first` : ""}. Nothing was ${command === "new" ? "created" : "changed"}.`,
    );
  }
}

/**
 * The workspace folder, read and write, on every task: where results go when
 * nobody said where, so a task puts its deliverable there itself rather than
 * leaving it in scratch for the conversation to fetch. A brief that names the
 * folder, or a folder inside it, keeps what it asked for beside this. It
 * mounts where this conversation reaches it.
 */
export function withWorkspaceFolder<
  T extends { mountName: string; path: string },
>(
  folders: T[],
  chatFolders: FolderMounts,
): (
  | T
  | { access: "read-write"; mountName: string; path: string; source: "user" }
)[] {
  const workspace = outputFolderPath();
  if (folders.some((folder) => folder.path === workspace)) {
    return folders;
  }
  const chatPath = mountPathOf(workspace, chatFolders);
  return [
    ...folders,
    {
      access: "read-write",
      mountName: chatPath
        ? chatPath.slice(`${MOUNT.attachedFolders}/`.length)
        : path.basename(workspace),
      path: workspace,
      source: "user",
    },
  ];
}

/**
 * What a task was handed, at the paths it and this conversation both reach
 * them by: the folders named on the command with the access each ended up
 * with, and the workspace folder that goes with them whether it was named or
 * not.
 */
export function handedFolders(
  folders: { access: FolderAttachment.Access; mountName: string }[],
): string {
  return folders
    .map(
      (folder) =>
        `${attachedFolderMountPoint(folder.mountName)} (${folder.access})`,
    )
    .join(", ");
}

/** The chat's paths in a set of aliases, leaving out the folders it no longer reaches. */
export function chatPathsOf(aliases: MountAlias[]): string[] {
  return aliases.flatMap(({ chatPath }) =>
    chatPath === undefined ? [] : [chatPath],
  );
}

/** Folders keyed by mount name, the way a task's record holds them. */
export function byMountName<T extends { mountName: string }>(
  folders: T[],
): Record<string, T> {
  return Object.fromEntries(
    folders.map((folder) => [folder.mountName, folder]),
  );
}

/**
 * This conversation's paths for the files handed with --file, as its shell
 * reads them: relative ones from the directory it is in.
 */
export function filePaths(specs: string[], cwd: string): string[] {
  return specs.map((spec) =>
    path.posix.normalize(
      path.posix.isAbsolute(spec) ? spec : path.posix.join(cwd, spec),
    ),
  );
}

/** The folder paths among what a task is handed, for a refusal to list. */
export function handedFolderPaths(handed: string[]): string {
  return (
    handed
      .filter((handedPath) =>
        handedPath.startsWith(`${MOUNT.attachedFolders}/`),
      )
      .join(", ") || "none"
  );
}

/**
 * The conversation's own view of the filesystem, which is what a `--file`
 * spec is read against: its folder, the user's mounts, and the read-only
 * mounts of the tasks it created.
 */
export async function chatLayout(
  context: TaskCommandContext,
  attachedFolders: Record<string, FolderAttachment.Type>,
): Promise<WorkspaceFsLayout> {
  return buildWorkspaceFsLayout({
    attachedFolders,
    extraMounts: await childTaskMounts(context.chatId),
    taskHostRoot: taskDir(context.chatId),
  });
}

/**
 * The folder of a task's own that a `--remove` spec names.
 *
 * `show` prints a task's folders at this conversation's paths where a mount of
 * its own covers one, and at the task's own where none does, so both readings
 * are tried here: a task can hold a folder this conversation has since given
 * up, and that folder is still the task's to lose.
 */
export function matchTaskFolder(
  spec: string,
  chatFolders: Record<string, FolderAttachment.Type>,
  taskFolders: FolderMounts,
): undefined | { mountName: string; path: string } {
  const held = Object.values(taskFolders);
  let hostPath: string | undefined;
  try {
    hostPath = resolveFolders([spec], chatFolders)[0]?.path;
  } catch {
    // Not a folder of this conversation's; read as one of the task's below.
    hostPath = undefined;
  }
  if (hostPath !== undefined) {
    const wanted = path.resolve(hostPath);
    const found = held.find((folder) => path.resolve(folder.path) === wanted);
    if (found) {
      return found;
    }
  }
  const { name, subpath } = parseFolderSpec(spec);
  const mountName = subpath ? `${name}/${subpath}` : name;
  return held.find((folder) => folder.mountName === mountName);
}

/**
 * The files a message handed a task, at the paths the task reads them by: a
 * copy can take a new name when the task already holds one by that name, and
 * the brief is written against the name the conversation knew.
 */
export function handedFiles(message: SessionMessage.UserWithParts): string {
  const files = message.parts.flatMap((part) =>
    part.type === "data-attachments"
      ? part.data.files.map((file) => file.filePath)
      : [],
  );
  return files.length > 0 ? `Its files: ${files.join(", ")}.\n` : "";
}
