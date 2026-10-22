import { existsSync } from "node:fs";
import path from "node:path";

import {
  CHAT_FOLDER_NAMES,
  CHATS_FOLDER_NAME,
  TASKS_DIR_NAME,
} from "../constants";
import {
  type AbsolutePath,
  AbsolutePathSchema,
  RelativePathSchema,
  type WorkspaceFilePath,
  WorkspaceFilePathSchema,
} from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { toldOutputFolders } from "./environment";
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
import { getWorkspaceConfig } from "./workspace-config";
import {
  isInWorkspacePath,
  workspaceHostPath,
} from "./workspace-relative-path";

/**
 * Where an earlier build showed the agent its chat's task folders, each
 * task's at `/tasks/<task>`, which is how the chat's messages name them.
 */
const OLD_TASKS_MOUNT = "/tasks";

/**
 * Host path for a file a chat can reach: relative to its folder, an absolute
 * path in a folder the user attached, or a file the person attached in the
 * workspace, kept by its place there. Null when the path resolves outside
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
 *
 * Each path stands alone: one that is malformed, or a Windows path
 * (`C:\Users\sam\cat.png`) kept by a message written on Windows and read
 * somewhere else, maps to null rather than failing the paths beside it.
 */
export async function resolveWorkspaceFilePaths<Given extends string>({
  filePaths,
  chatId,
}: {
  filePaths: readonly Given[];
  chatId: ChatId;
}): Promise<Map<Given, AbsolutePath | null>> {
  const layout = await sessionLayout({ chatId });
  const moved = await movedChatFolder(layout, chatId, filePaths);
  return new Map(
    filePaths.map((given) => [given, onDiskOrNull(layout, given, moved)]),
  );
}

/**
 * The names the chat's own folder had and the one it has, in the shell's
 * spelling. The folder is named for the chat's first words until its title
 * settles, after the first turn, so a file that turn made is named in the
 * folder under its first name and found in the titled folder after it.
 */
interface MovedChatFolder {
  from: string[];
  to: string;
}

/**
 * The names the chat's folder had are the output folders its sessions were
 * told, which is the path the agent wrote with. A name another chat holds
 * now still means this chat's folder in this chat's messages. Read only when
 * a path names something in `Chats/`, since it reads the chat's history.
 */
async function movedChatFolder(
  layout: WorkspaceFsLayout,
  chatId: ChatId,
  filePaths: readonly string[],
): Promise<MovedChatFolder | undefined> {
  const to = layout.folder?.shellRoot;
  if (to === undefined) {
    return undefined;
  }
  const chats = shellPath(
    path.join(getWorkspaceConfig().rootDir, CHATS_FOLDER_NAME),
  );
  const inChats = filePaths.some((given) =>
    normalizePath(shellPath(given.trim())).startsWith(`${chats}/`),
  );
  if (!inChats) {
    return undefined;
  }
  const from = [...(await toldOutputFolders(chatId))].filter(
    (folder) => folder !== to && path.posix.dirname(folder) === chats,
  );
  return from.length === 0 ? undefined : { from, to };
}

/** A path in the chat's folder under a name it had, spelled under the one it has. */
function underCurrentName(
  spelled: string,
  moved: MovedChatFolder | undefined,
): string {
  if (moved === undefined) {
    return spelled;
  }
  const normalized = normalizePath(spelled);
  for (const folder of moved.from) {
    const rest = relativeWithin(folder, normalized);
    if (rest !== null) {
      return rest === "/" ? moved.to : `${moved.to}${rest}`;
    }
  }
  return spelled;
}

const WINDOWS_ABSOLUTE = /^[a-z]:[\\/]/i;

function onDiskOrNull(
  layout: WorkspaceFsLayout,
  given: string,
  moved: MovedChatFolder | undefined,
): AbsolutePath | null {
  // A Windows path in the shell's spelling (`/c/Users/sam`) on Windows; on
  // any other system it names nothing here and fails the parse below.
  const spelled = WINDOWS_ABSOLUTE.test(given.trim())
    ? shellPath(given.trim())
    : given;
  const parsed = WorkspaceFilePathSchema.safeParse(spelled);
  if (!parsed.success) {
    return null;
  }
  try {
    return storedPathOnDisk(layout, parsed.data, moved);
  } catch {
    return null;
  }
}

/**
 * Where a path a chat's messages kept is on this computer, as the person's
 * views read it back: relative to the work folder, by its place in the
 * workspace (`workspace:/Notes/plan.md`), or absolute in a folder the chat
 * reaches, held to the chat's rules.
 *
 * A path kept by its place in the workspace is a file the person attached
 * where it lies, so it is read under the workspace's root and not held to
 * the agent's rules: those close a workspace kept in the app's own data,
 * which would take the person's own file off their screen. What the person's
 * viewers may read is the file channel's to refuse, and the agent reads only
 * through its own rules.
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
  moved: MovedChatFolder | undefined,
): AbsolutePath | null {
  const trimmed = stored.trim();
  // A file kept by its place in the workspace is under the workspace's root
  // here, wherever that root was when the message was written.
  if (isInWorkspacePath(trimmed)) {
    const inWorkspace = workspaceHostPath(
      trimmed,
      getWorkspaceConfig().rootDir,
    );
    return inWorkspace === null ? null : spelledOnDisk(inWorkspace);
  }
  // A Windows path (`C:\Users\sam`) in the shell's spelling (`/c/Users/sam`),
  // which the layout resolves.
  const spelled = shellPath(trimmed);
  const found = path.posix.isAbsolute(spelled)
    ? absoluteOnDisk(layout, underCurrentName(spelled, moved))
    : relativeOnDisk(layout, spelled);
  return found === null ? null : spelledOnDisk(found);
}

/**
 * A relative path the work folder does not have, read from the workspace's
 * top level when a file is there and the chat may read it: an agent that
 * worked in `Skills/` names what it made as `Skills/<name>/SKILL.md`. The
 * work folder is asked first, so a path it has keeps meaning that file.
 */
function inWorkspaceRoot(
  layout: WorkspaceFsLayout,
  relative: string,
): AbsolutePath | null {
  const inRoot = path.join(getWorkspaceConfig().rootDir, relative);
  if (![inRoot, ...nameVariants(inRoot)].some((each) => existsSync(each))) {
    return null;
  }
  return resolveReadOnlyHostPath(layout, shellPath(inRoot));
}

/** A host path as the disk spells it, when macOS spells its name another way. */
function spelledOnDisk(found: string): AbsolutePath {
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
  if (existsSync(inWork)) {
    return inWork;
  }
  const { record } = layout;
  if (!record || relative.split("/")[0] !== CHAT_FOLDER_NAMES.attachments) {
    return inWorkspaceRoot(layout, relative) ?? inWork;
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
