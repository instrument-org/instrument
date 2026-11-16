import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { unique } from "radashi";

import {
  CHAT_FOLDER_NAMES,
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
import { filesFolderPath } from "./chat/output-folder";
import { toldEnvironments } from "./environment";
import { movedOutputOf } from "./moved-outputs";
import { normalizePath } from "./normalize-path";
import { relativeWithin } from "./path-containment";
import { CHATS_FOLDER_NAME } from "./retire-chats-folder/chat-transcript";
import { readChatFolderMoves } from "./retire-chats-folder/folder-moves";
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
import { workspaceLayout } from "./workspace-layout";
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
  const history = await chatHistoryPaths(chatId, filePaths);
  return new Map(
    filePaths.map((given) => {
      const here = onDiskOrNull(layout, given, history, chatId);
      const on = here === null ? computerHolding(given, history) : undefined;
      return [given, on === undefined ? { here } : { here, on }];
    }),
  );
}

/**
 * What the chat's records say about the computers its messages were written
 * on, read once for a surface's paths. A message keeps a path as the
 * computer that wrote it spelled it: under that computer's home and its
 * place for the workspace, and in the chat's folder under `Chats/` that an
 * earlier build kept, under the name it had then.
 */
interface ChatHistoryPaths {
  /** This computer's home, in the shell's spelling. */
  home: string;
  /** This computer's workspace, in the shell's spelling. */
  here: string;
  moved: FolderMoves | undefined;
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
 * Where folders under `Chats/` went, in the shell's spelling: each folder an
 * earlier build kept there, under any name it had, and the folder in `Files/`
 * it was moved to when `Chats/` was emptied (`retire-chats-folder.ts`).
 */
type FolderMoves = { from: string[]; to: string }[];

/**
 * The folders moved out of `Chats/` are read from the record the move
 * wrote, by the names they had when they moved. The chat's own folder was
 * named for its first words until its title settled, after the first turn,
 * so a file that turn made is named under the folder's first name: the
 * names it had are the output folders its sessions were told, which is the
 * path the agent wrote with, read under this computer's workspace, and they
 * mean wherever the chat's folder went. The history is read only when a path
 * names something in `Chats/` or lies outside this computer's home, since
 * only then can it change an answer.
 *
 * A branch's copied conversation names the folder of the chat it came from,
 * under whichever name it had then, so those names mean where that chat's
 * folder went.
 */
async function chatHistoryPaths(
  chatId: ChatId,
  filePaths: readonly string[],
): Promise<ChatHistoryPaths> {
  const { rootDir } = getWorkspaceConfig();
  const here = shellPath(rootDir);
  const home = shellPath(os.homedir());
  const chats = shellPath(path.join(rootDir, CHATS_FOLDER_NAME));
  const asks = filePaths.some((given) => {
    if (isInWorkspacePath(given.trim())) {
      return given.trim().startsWith(`workspace:/${CHATS_FOLDER_NAME}/`);
    }
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
  const records = await readChatFolderMoves(
    workspaceLayout(rootDir).devicesDir,
  );
  if (records.size === 0) {
    return { home, here, moved: undefined, writers };
  }
  const files = shellPath(filesFolderPath());
  const namesTold = (environments: EnvironmentChange[]) =>
    unique(
      environments.flatMap(({ outputFolder }) =>
        outputFolder === undefined
          ? []
          : [inThisWorkspace(normalizePath(outputFolder), here, writers)],
      ),
    ).filter((folder) => path.posix.dirname(folder) === chats);
  const moved: FolderMoves = [];
  for (const record of records.values()) {
    const from = [`${chats}/${record.from}`];
    if (record.chat === chatId) {
      from.push(...namesTold(told));
    }
    if (copied && record.chat === copied.chat) {
      from.push(...namesTold(copied.told));
    }
    moved.push({ from: unique(from), to: `${files}/${record.to}` });
  }
  return { home, here, moved, writers };
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
 * `Skills/` is at the workspace's top level. A build that kept it in
 * `.instrument/` names it by no such name, and says nothing.
 */
function workspaceRootOf({
  workspaceSkillsFolder,
}: EnvironmentChange): string | undefined {
  return workspaceSkillsFolder !== undefined &&
    path.posix.basename(workspaceSkillsFolder) === SKILLS_FOLDER_NAME
    ? path.posix.dirname(workspaceSkillsFolder)
    : undefined;
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

/** A path in a folder moved out of `Chats/`, spelled where the folder went. */
function underCurrentName(
  spelled: string,
  moved: FolderMoves | undefined,
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
  chatId: ChatId,
): AbsolutePath | null {
  const parsed = WorkspaceFilePathSchema.safeParse(shellSpelling(given));
  if (!parsed.success) {
    return null;
  }
  try {
    return storedPathOnDisk(layout, parsed.data, history, chatId);
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
 * in the work folder's `tasks/`, where those folders went. What a 1.x task
 * handed over in its `output/` is in the Files folder, where the layout sweep
 * moved it (`movedOutputOf`). A path in `Chats/`, absolute or by its place
 * in the workspace, is read in the folder of `Files/` it went to. A name macOS spells another way than the one
 * kept is found too.
 */
function storedPathOnDisk(
  layout: WorkspaceFsLayout,
  stored: string,
  history: ChatHistoryPaths,
  chatId: ChatId,
): AbsolutePath | null {
  const trimmed = stored.trim();
  // A file kept by its place in the workspace is under the workspace's root
  // here, wherever that root was when the message was written.
  if (isInWorkspacePath(trimmed)) {
    const inWorkspace = workspaceHostPath(
      trimmed,
      getWorkspaceConfig().rootDir,
    );
    if (inWorkspace === null) {
      return null;
    }
    const found = spelledOnDisk(inWorkspace);
    return existsSync(found)
      ? found
      : spelledOnDisk(
          hostPathOf(underCurrentName(shellPath(inWorkspace), history.moved)),
        );
  }
  const spelled = shellPath(trimmed);
  if (!path.posix.isAbsolute(spelled)) {
    const found = relativeOnDisk(layout, spelled, chatId);
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
  chatId: ChatId,
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
  const inFiles = movedOutputOf({
    chatId,
    machineDir: getWorkspaceConfig().workspaceMachineDir,
    relative,
  });
  if (inFiles !== undefined && existsSync(inFiles)) {
    return AbsolutePathSchema.parse(inFiles);
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
