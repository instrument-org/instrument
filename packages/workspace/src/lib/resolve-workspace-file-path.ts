import { existsSync } from "node:fs";
import path from "node:path";

import { CHAT_FOLDER_NAMES, TASKS_DIR_NAME } from "../constants";
import {
  type AbsolutePath,
  AbsolutePathSchema,
  RelativePathSchema,
  type WorkspaceFilePath,
} from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { normalizePath } from "./normalize-path";
import { relativeWithin } from "./path-containment";
import { resolvePathWithinChatDir } from "./resolve-path-within-chat-dir";
import { sessionLayout } from "./session-layout";
import { nameVariants } from "./tool-fs";
import {
  resolveReadOnlyHostPath,
  shellPath,
  type WorkspaceFsLayout,
} from "./workspace-fs-layout";

/**
 * Where an earlier build showed the agent its chat's task folders, each
 * task's at `/tasks/<task>`, which is how the chat's messages name them.
 */
const OLD_TASKS_MOUNT = "/tasks";

/**
 * Host path for a file a chat can reach: relative to its folder, or an absolute
 * path in a folder the user attached. Null when the path resolves outside
 * everything the chat has -- including the chat's own private dir and a symlink leading
 * out of a mount -- so a caller can fail closed.
 *
 * Use wherever the main process acts on a path that came from the renderer: the
 * chat's folder is only part of what a chat's files can live in, and a path
 * in another folder resolved against the chat's folder is a file that does
 * not exist.
 */
export async function resolveWorkspaceFilePath({
  filePath,
  chatId,
}: {
  filePath: WorkspaceFilePath;
  chatId: ChatId;
}): Promise<AbsolutePath | null> {
  const resolved = await resolveWorkspaceFilePaths({
    filePaths: [filePath],
    chatId,
  });
  return resolved.get(filePath) ?? null;
}

/**
 * The same, for every path a surface is about to show at once, against one
 * reading of the chat's layout: a transcript names many files and each
 * would otherwise cost a read of the chat's record and settings.
 */
export async function resolveWorkspaceFilePaths({
  filePaths,
  chatId,
}: {
  filePaths: readonly WorkspaceFilePath[];
  chatId: ChatId;
}): Promise<Map<WorkspaceFilePath, AbsolutePath | null>> {
  const layout = await sessionLayout({ chatId });
  return new Map(
    filePaths.map((filePath) => [filePath, storedPathOnDisk(layout, filePath)]),
  );
}

/**
 * Where a path a chat's messages kept is on this computer, as the person's
 * views read it back: relative to the work folder, or absolute in a folder
 * the chat reaches, held to the chat's rules.
 *
 * A path kept before a migration moved what held it is read where it went:
 * a chat's files and its records were once one folder, so a relative path
 * under `attachments/` the work folder does not hold is the file the person
 * sent, in the record folder, and an earlier build's `/tasks/<task>/...` is
 * in the work folder's `tasks/`, where those folders went. A name macOS
 * spells another way than the one kept is found too.
 */
function storedPathOnDisk(
  layout: WorkspaceFsLayout,
  stored: string,
): AbsolutePath | null {
  // A Windows path (`C:\Users\sam`) in the shell's spelling (`/c/Users/sam`),
  // which the layout resolves.
  const spelled = shellPath(stored.trim());
  const found = path.posix.isAbsolute(spelled)
    ? absoluteOnDisk(layout, spelled)
    : relativeOnDisk(layout, spelled);
  if (found === null) {
    return null;
  }
  const named =
    [found, ...nameVariants(found)].find((candidate) =>
      existsSync(candidate),
    ) ?? found;
  return AbsolutePathSchema.parse(named);
}

function absoluteOnDisk(
  layout: WorkspaceFsLayout,
  spelled: string,
): AbsolutePath | null {
  const asTyped = resolveReadOnlyHostPath(layout, spelled);
  const inTasks =
    asTyped === null ? inOldTaskFolder(layout, spelled) : undefined;
  if (inTasks === undefined) {
    return asTyped;
  }
  // Where it went, when the chat may read it there; otherwise what the
  // path it named says, rather than one it never wrote.
  return resolveReadOnlyHostPath(layout, shellPath(inTasks)) ?? asTyped;
}

function relativeOnDisk(
  layout: WorkspaceFsLayout,
  spelled: string,
): AbsolutePath | null {
  const relative = normalizePath(spelled).replace(/^\.\//, "");
  const inWork = resolvePathWithinChatDir({
    dir: layout.chat.hostRoot,
    filePath: RelativePathSchema.parse(relative),
  });
  if (inWork === null) {
    return null;
  }
  const { record } = layout;
  if (
    !record ||
    existsSync(inWork) ||
    relative.split("/")[0] !== CHAT_FOLDER_NAMES.attachments
  ) {
    return inWork;
  }
  // What the person sent, kept by its path in the folder the chat's files
  // and records once shared.
  const inRecord = path.join(record.hostRoot, relative);
  return [inRecord, ...nameVariants(inRecord)].some((candidate) =>
    existsSync(candidate),
  )
    ? AbsolutePathSchema.parse(inRecord)
    : inWork;
}

/**
 * The file an earlier build's `/tasks/<task>/...` named, which moved with the
 * rest of the chat's work into its work folder's `tasks/`, when it is there.
 */
function inOldTaskFolder(
  layout: WorkspaceFsLayout,
  shellAbsPath: string,
): string | undefined {
  const rest = relativeWithin(OLD_TASKS_MOUNT, normalizePath(shellAbsPath));
  if (rest === null || rest === "/") {
    return undefined;
  }
  const inWorkFolder = path.join(layout.chat.hostRoot, TASKS_DIR_NAME, rest);
  return existsSync(inWorkFolder) ? inWorkFolder : undefined;
}
