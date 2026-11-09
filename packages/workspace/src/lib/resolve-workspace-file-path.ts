import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { unique } from "radashi";

import {
  APPS_FOLDER_NAME,
  CHAT_FOLDER_NAMES,
  CHATS_FOLDER_NAME,
  SKILLS_FOLDER_NAME,
  TASKS_DIR_NAME,
} from "../constants";
import { type EnvironmentChange } from "../schemas/environment";
import {
  type AbsolutePath,
  AbsolutePathSchema,
  RelativePathSchema,
  type WorkspaceFilePath,
  WorkspaceFilePathSchema,
} from "../schemas/paths";
import { type ChatId } from "../schemas/chat-id";
import { toldEnvironments } from "./environment";
import { normalizePath } from "./normalize-path";
import { chatDir, chatOwnFolder, resolveChat } from "./record-folders";
import { relativeWithin } from "./path-containment";
import { resolvePathWithinChatDir } from "./resolve-path-within-chat-dir";
import { sessionLayout } from "./session-layout";
import { nameVariants } from "./tool-fs";
import {
  hostPathOf,
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
 * Each path stands alone: one that is malformed, or one kept in a folder only
 * the computer that wrote it has, maps to null rather than failing the paths
 * beside it.
 */
export async function resolveWorkspaceFilePaths<Given extends string>({
  filePaths,
  chatId,
}: {
  filePaths: readonly Given[];
  chatId: ChatId;
}): Promise<Map<Given, AbsolutePath | null>> {
  const resolved = await resolvePlaces({ filePaths, chatId });
  return new Map(
    filePaths.map((given) => [given, resolved.get(given)?.here ?? null]),
  );
}

/**
 * The computer each path with no place here is on, by its name, for a path a
 * message written on another computer kept in a folder only that computer
 * has: its work folder, its Desktop, a folder granted there. A path in the
 * workspace is left out with the rest, since the workspace is on every
 * computer and a file missing from it here is missing.
 */
export async function computersHolding<Given extends string>({
  filePaths,
  chatId,
}: {
  filePaths: readonly Given[];
  chatId: ChatId;
}): Promise<Map<Given, string>> {
  const resolved = await resolvePlaces({ filePaths, chatId });
  return new Map(
    filePaths.flatMap((given) => {
      const on = resolved.get(given)?.on;
      return on === undefined ? [] : [[given, on] as const];
    }),
  );
}

async function resolvePlaces<Given extends string>({
  filePaths,
  chatId,
}: {
  filePaths: readonly Given[];
  chatId: ChatId;
}): Promise<Map<Given, { here: AbsolutePath | null; on?: string }>> {
  const layout = await sessionLayout({ chatId });
  const history = await chatHistoryPaths(layout, chatId, filePaths);
  return new Map(
    filePaths.map((given) => {
      const here = onDiskOrNull(layout, given, history);
      const on = here === null ? computerHolding(given, history) : undefined;
      return [given, on === undefined ? { here } : { here, on }];
    }),
  );
}

/**
 * What the chat's records say about the computers its messages were written
 * on, read once for a surface's paths. A message keeps a path as the
 * computer that wrote it spelled it: under that computer's home and its
 * place for the workspace, and in the chat's folder under the name it had
 * then.
 */
interface ChatHistoryPaths {
  /** This computer's home, in the shell's spelling. */
  home: string;
  /** This computer's workspace, in the shell's spelling. */
  here: string;
  moved: MovedChatFolder | undefined;
  /** The computers the chat's sessions were told they ran on, this one aside. */
  writers: Writer[];
}

/** A computer a session of the chat ran on, as it was told. */
interface Writer {
  /** Its name, without its OS. */
  computer: string | undefined;
  home: string | undefined;
  /** Where it kept the workspace. */
  root: string | undefined;
}

/**
 * The names the chat's own folder had and the one it has, in the shell's
 * spelling. The folder is named for the chat's first words until its title
 * settles, after the first turn, so a file that turn made is named in the
 * folder under its first name and found in the titled folder after it.
 */
type MovedChatFolder = { from: string[]; to: string }[];

/**
 * The names the chat's folder had are the output folders its sessions were
 * told, which is the path the agent wrote with, read under this computer's
 * workspace. A name another chat holds now still means this chat's folder in
 * this chat's messages. The history is read only when a path names something
 * in `Chats/` or lies outside this computer's home, since only then can it
 * change an answer.
 *
 * A branch's copied conversation names the folder of the chat it came from,
 * under whichever name it had then, so those names mean that chat's folder
 * as it is named now, while that chat is there.
 */
async function chatHistoryPaths(
  layout: WorkspaceFsLayout,
  chatId: ChatId,
  filePaths: readonly string[],
): Promise<ChatHistoryPaths> {
  const { rootDir } = getWorkspaceConfig();
  const here = shellPath(rootDir);
  const home = shellPath(os.homedir());
  const chats = shellPath(path.join(rootDir, CHATS_FOLDER_NAME));
  const asks = filePaths.some((given) => {
    const spelled = absoluteSpelling(given);
    return (
      spelled !== undefined &&
      (spelled.startsWith(`${chats}/`) ||
        relativeWithin(home, spelled) === null)
    );
  });
  if (!asks) {
    return { home, here, moved: undefined, writers: [] };
  }
  const { copied, told } = await toldEnvironments(chatId);
  const writers = unique(
    [...(copied?.told ?? []), ...told].map(writerOf),
    ({ computer, home: theirs, root }) => [computer, theirs, root].join("\0"),
  ).filter(
    (writer) =>
      (writer.root !== undefined && writer.root !== here) ||
      (writer.home !== undefined && writer.home !== home),
  );
  const to = layout.folder?.shellRoot;
  if (to === undefined) {
    return { home, here, moved: undefined, writers };
  }
  const movedFrom = (environments: EnvironmentChange[], target: string) => ({
    from: unique(
      environments.flatMap(({ outputFolder }) =>
        outputFolder === undefined
          ? []
          : [inThisWorkspace(normalizePath(outputFolder), here, writers)],
      ),
    ).filter(
      (folder) => folder !== target && path.posix.dirname(folder) === chats,
    ),
    to: target,
  });
  const moves: MovedChatFolder = [];
  const origin = copied && resolveChat(copied.chat);
  const originFolder = origin && chatOwnFolder(chatDir(origin));
  if (copied && originFolder !== undefined) {
    moves.push(movedFrom(copied.told, shellPath(originFolder)));
  }
  moves.push(movedFrom(told, to));
  const kept = moves.filter((move) => move.from.length > 0);
  return {
    home,
    here,
    moved: kept.length === 0 ? undefined : kept,
    writers,
  };
}

function writerOf(told: EnvironmentChange): Writer {
  return {
    // "Studio's Mac Studio, macOS 27.0.1", as `getSystemInfo` words it.
    computer: told.computer?.replace(/, [^,]*$/u, ""),
    home: told.homeFolder,
    root: workspaceRootOf(told),
  };
}

/**
 * Where a computer kept the workspace, from the folders it was told: its
 * `Skills/` and `Apps/` are at the workspace's top level. A build that kept
 * them in `.instrument/` names neither by those names, and says nothing.
 */
function workspaceRootOf({
  appsFolder,
  workspaceSkillsFolder,
}: EnvironmentChange): string | undefined {
  const named = [
    [workspaceSkillsFolder, SKILLS_FOLDER_NAME],
    [appsFolder, APPS_FOLDER_NAME],
  ] as const;
  for (const [folder, name] of named) {
    if (folder !== undefined && path.posix.basename(folder) === name) {
      return path.posix.dirname(folder);
    }
  }
  return undefined;
}

/**
 * A path in another computer's workspace, spelled under this computer's, or
 * the path as it was when it is in none. The longest root first, so a
 * workspace kept inside another's folder is read as its own.
 */
function inThisWorkspace(
  spelled: string,
  here: string,
  writers: readonly Writer[],
): string {
  const roots = writers
    .flatMap(({ root }) => (root === undefined ? [] : [root]))
    .toSorted((a, b) => b.length - a.length);
  for (const root of roots) {
    const rest = relativeWithin(root, spelled);
    if (rest !== null) {
      return rest === "/" ? here : `${here}${rest}`;
    }
  }
  return spelled;
}

/** The computer whose home a path outside the workspace is under, when it is another's. */
function computerHolding(
  given: string,
  { home, here, writers }: ChatHistoryPaths,
): string | undefined {
  const spelled = absoluteSpelling(given);
  if (
    spelled === undefined ||
    inThisWorkspace(spelled, here, writers) !== spelled
  ) {
    return undefined;
  }
  return writers.find(
    (writer) =>
      writer.home !== undefined &&
      writer.home !== home &&
      relativeWithin(writer.home, spelled) !== null,
  )?.computer;
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
  for (const { from, to } of moved) {
    for (const folder of from) {
      const rest = relativeWithin(folder, normalized);
      if (rest !== null) {
        return rest === "/" ? to : `${to}${rest}`;
      }
    }
  }
  return spelled;
}

const WINDOWS_ABSOLUTE = /^[a-z]:[\\/]/i;

/**
 * A Windows path (`C:\Users\sam`) in the shell's spelling (`/c/Users/sam`)
 * on any computer, since that is how a computer running Windows was told its
 * folders; any other path as given.
 */
function shellSpelling(given: string): string {
  const trimmed = given.trim();
  return WINDOWS_ABSOLUTE.test(trimmed) ? shellPath(trimmed, "win32") : given;
}

/** An absolute path in the shell's spelling, normalized, or undefined for any other. */
function absoluteSpelling(given: string): string | undefined {
  const spelled = shellSpelling(given).trim();
  return path.posix.isAbsolute(spelled) ? normalizePath(spelled) : undefined;
}

function onDiskOrNull(
  layout: WorkspaceFsLayout,
  given: string,
  history: ChatHistoryPaths,
): AbsolutePath | null {
  const parsed = WorkspaceFilePathSchema.safeParse(shellSpelling(given));
  if (!parsed.success) {
    return null;
  }
  try {
    return storedPathOnDisk(layout, parsed.data, history);
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
 * through its own rules. A path another computer kept in its workspace is
 * read the same way, under this computer's, once nothing here answers it as
 * written.
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
  history: ChatHistoryPaths,
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
  const spelled = shellPath(trimmed);
  if (!path.posix.isAbsolute(spelled)) {
    const found = relativeOnDisk(layout, spelled);
    return found === null ? null : spelledOnDisk(found);
  }
  const found =
    absoluteOnDisk(layout, underCurrentName(spelled, history.moved)) ??
    inThisWorkspaceOnDisk(spelled, history);
  return found === null ? null : spelledOnDisk(found);
}

/** A path another computer kept in its workspace, on this computer's disk. */
function inThisWorkspaceOnDisk(
  spelled: string,
  { here, moved, writers }: ChatHistoryPaths,
): null | string {
  const normalized = normalizePath(spelled);
  const translated = inThisWorkspace(normalized, here, writers);
  return translated === normalized
    ? null
    : hostPathOf(underCurrentName(translated, moved));
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
