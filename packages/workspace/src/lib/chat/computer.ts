import { type Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { unique } from "radashi";
import { z } from "zod";

import { type FolderAttachment } from "../../schemas/folder-attachment";
import { type TaskId } from "../../schemas/task-id";
import { getMimeType } from "../get-mime-type";
import { pathIsWithin } from "../path-is-within";
import { type ReadRefusal, readRefusalOf } from "../read-refusal";
import { resolveExistingFilePath } from "../resolve-agent-path";
import { taskDir } from "../task-dir-utils";
import {
  buildWorkspaceFsLayout,
  effectiveFolderAccess,
  type WorkspaceFsLayout,
} from "../workspace-fs-layout";
import { childTaskMounts } from "./children";
import { type FinderEntry, finderEntriesOf } from "./finder-entries";
import { folderReach } from "./folder-reach";
import { hiddenEntryNames } from "./hidden-entries";
import {
  type ICloudAppFolders,
  iCloudAppFolders,
  iCloudDrivePath,
  resolveICloudPath,
} from "./icloud-drive";
import { linkedFiles } from "./linked-files";
import { resolveChat } from "../record-folders";

/**
 * How many entries one listing carries. A folder past this shows the first in
 * the order the browser shows them, so what is missing is the end of the list
 * rather than a scattering through it.
 */
const MAX_ENTRIES = 2000;

/** How many of the files the conversation showed the recents list carries. */
const RECENTS_MAX = 20;

const ComputerEntrySchema = z.object({
  createdAt: z.number().optional(),
  /**
   * The name as the system's file manager shows it, where that differs from
   * `name`: the Finder leaves `.app` off an app, and any extension a person
   * chose to hide.
   */
  displayName: z.string().optional(),
  /**
   * Whether the system hides this entry. Absent means it does not, and for a
   * name with a leading dot it is always absent: the name says it, and the
   * browser is the one holding the switch.
   */
  hidden: z.boolean().optional(),
  /**
   * A file, or a folder the system shows and opens as one item (a package:
   * an app, a Photos library), which is listed as a file with `package` set.
   */
  kind: z.enum(["file", "folder"]),
  mimeType: z.string().optional(),
  modifiedAt: z.number().optional(),
  name: z.string(),
  /**
   * A folder the system treats as one item. Listed as a file, since that is
   * how it is opened, and drawn by the system's icon for it.
   */
  package: z.literal(true).optional(),
  /** The host path. */
  path: z.string(),
  size: z.number().optional(),
  /** What the system calls this kind of item, where the name cannot say: "Application". */
  typeName: z.string().optional(),
});
type ComputerEntry = z.output<typeof ComputerEntrySchema>;

/**
 * How the chat reaches a folder of the computer, when one of the
 * folders granted to it covers that folder. Absent means the agent cannot
 * read it or hand it to a task until the user allows it.
 */
const ComputerAccessSchema = z.object({
  access: z.enum(["read-only", "read-write"]),
  /** The virtual path the agent knows this folder by. */
  mountPath: z.string(),
  /** The host path of the granted folder this one is in. */
  root: z.string(),
});
type ComputerAccess = z.output<typeof ComputerAccessSchema>;

/**
 * A file the conversation showed, with whether the agent can reach it. A
 * listing answers that once for the folder it lists; these files come from all
 * over, so each carries its own answer.
 */
export const ComputerRecentSchema = ComputerEntrySchema.extend({
  access: ComputerAccessSchema.optional(),
  /**
   * When the conversation put this file in front of the user, which is what
   * orders the list. Not the file's own dates: a file found last week and
   * edited by hand this morning was still shown last week.
   */
  shownAt: z.number(),
});
export type ComputerRecent = z.output<typeof ComputerRecentSchema>;

const ComputerListingSchema = z.object({
  access: ComputerAccessSchema.optional(),
  /**
   * At the top of iCloud Drive, that macOS kept this app from the app folders
   * shown there (Pages, Shortcuts): iCloud Drive's own folders open without
   * it, and the apps' take the iCloud Drive permission.
   */
  appFoldersLocked: z.literal(true).optional(),
  /** The path as a person writes it, the home folder as `~`. */
  display: z.string(),
  entries: ComputerEntrySchema.array(),
  kind: z.literal("listing"),
  /** The host path listed, `~` expanded. */
  path: z.string(),
  truncated: z.boolean(),
});
export type ComputerListing = z.output<typeof ComputerListingSchema>;

/**
 * A folder the operating system would not let this app read, and who
 * refused (`ReadRefusal`), since only a refusal by the Mac's privacy controls
 * is one the person can undo from here.
 */
const ComputerRefusalSchema = z.object({
  /** The path as a person writes it, the home folder as `~`. */
  display: z.string(),
  kind: z.literal("refused"),
  /** The host path asked for, `~` expanded. */
  path: z.string(),
  reason: z.enum(["account", "system"]) satisfies z.ZodType<ReadRefusal>,
});
export type ComputerRefusal = z.output<typeof ComputerRefusalSchema>;

/** A folder as a read of it answered: its entries, or a refusal. */
export const ComputerFolderSchema = z.discriminatedUnion("kind", [
  ComputerListingSchema,
  ComputerRefusalSchema,
]);
export type ComputerFolder = z.output<typeof ComputerFolderSchema>;

/** A granted folder as a host root, with how the agent reaches what is under it. */
export interface AttachedRoot {
  /**
   * The access the grant carries. What a folder under the root gets is judged
   * for that folder: the home folder is read-only as a whole, since the
   * workspace lives inside it, while its Desktop takes the grant in full.
   */
  grant: FolderAttachment.Access;
  mountPoint: string;
  root: string;
}

/**
 * The deepest granted folder a host path sits in, and the virtual path the
 * agent reaches it by through that grant. Both paths are resolved host paths,
 * so the walk from the root down is in the host's own separators, and the
 * mount path it becomes is in the agent's.
 */
export function accessIn(
  roots: AttachedRoot[],
  hostPath: string,
): ComputerAccess | undefined {
  let best: AttachedRoot | undefined;
  for (const candidate of roots) {
    const { root } = candidate;
    if (
      pathIsWithin(hostPath, root) &&
      (best === undefined || root.length > best.root.length)
    ) {
      best = candidate;
    }
  }
  if (!best) {
    return undefined;
  }
  const rest = path.relative(best.root, hostPath).split(path.sep).join("/");
  return {
    access: effectiveFolderAccess({ access: best.grant, path: hostPath }),
    mountPath: rest === "" ? best.mountPoint : `${best.mountPoint}/${rest}`,
    root: best.root,
  };
}

/**
 * One folder of the computer: files and subfolders, folders first. Read as the
 * app's own user, which is what the person browsing is; whether the agent may
 * read it is a separate question, answered by `access`.
 *
 * Dotfiles are listed. Whether they are *shown* is the browser's to decide,
 * because it is the browser that offers the switch: answering it here would mean
 * a round trip per flip, and a folder whose children are already in hand would
 * come back half-loaded under the new answer.
 */
export async function listComputerFolder({
  path: input,
  taskId,
}: {
  path: string;
  taskId: TaskId;
}): Promise<ComputerFolder> {
  const hostPath = await resolveICloudPath(expandHomePath(input), exists);
  let dirents: Dirent[];
  let hiddenNames: ReadonlySet<string>;
  let finder: ReadonlyMap<string, FinderEntry>;
  try {
    [dirents, hiddenNames, finder] = await Promise.all([
      fs.readdir(hostPath, { withFileTypes: true }),
      hiddenEntryNames(hostPath),
      finderEntriesOf(hostPath),
    ]);
  } catch (error) {
    const reason = readRefusalOf(error);
    if (reason === undefined) {
      throw error;
    }
    return {
      display: displayHostPath(hostPath),
      kind: "refused",
      path: hostPath,
      reason,
    };
  }
  const truncated = dirents.length > MAX_ENTRIES;

  // Ordered before the cut so the cut is the one the browser would make. A
  // link to a folder reads as a file here and as a folder once followed, which
  // is why the described entries are ordered again below.
  dirents.sort((a, b) =>
    compareEntries(
      { kind: a.isDirectory() ? "folder" : "file", name: a.name },
      { kind: b.isDirectory() ? "folder" : "file", name: b.name },
    ),
  );
  const entries = await Promise.all(
    dirents
      .slice(0, MAX_ENTRIES)
      .map((entry) =>
        describeEntry(
          hostPath,
          entry.name,
          hiddenNames.has(entry.name),
          finder.get(entry.name.normalize("NFC")),
        ),
      ),
  );
  const appFolders =
    process.platform === "darwin" && hostPath === iCloudDrivePath()
      ? await iCloudAppFolders()
      : undefined;
  if (appFolders) {
    entries.push(
      ...(await iCloudAppEntries(
        appFolders,
        new Set(dirents.map((d) => d.name)),
      )),
    );
  }
  entries.sort(compareEntries);

  return {
    access: await computerAccess(taskId, hostPath),
    ...(appFolders?.access === "refused" ? { appFoldersLocked: true } : {}),
    display: displayHostPath(hostPath),
    entries,
    kind: "listing",
    path: hostPath,
    truncated,
  };
}

/**
 * The app folders iCloud Drive shows beside its own, each by its app's name
 * and at the folder it really is, so whatever is opened from one is opened
 * where it lives. A name iCloud Drive itself holds keeps that name.
 */
async function iCloudAppEntries(
  { folders }: ICloudAppFolders,
  taken: ReadonlySet<string>,
): Promise<ComputerEntry[]> {
  return Promise.all(
    folders
      .filter((folder) => !taken.has(folder.name))
      .map(async (folder) => ({
        ...(await describeEntry(
          path.dirname(folder.path),
          path.basename(folder.path),
          false,
          undefined,
        )),
        name: folder.name,
      })),
  );
}

/**
 * The files the conversation has shown the user, newest shown first.
 *
 * A log of what the agent handed over rather than a report on the computer.
 * The scan this replaces read every place a person keeps things and the
 * folders under those, which on a Mac is a permission prompt per protected
 * folder and answers with a list mostly of files the user made themselves,
 * none of which this app has anything to say about. What the agent decided to
 * put on screen is the thing worth listing, and it already said so in the
 * reply, so nothing has to be kept up to date for this to be true.
 *
 * A file that has since been moved or thrown away drops off, since a row that
 * opens nothing is worse than a shorter list.
 */
export async function recentComputerFiles(): Promise<ComputerRecent[]> {
  // Each path is read the way the chat that named it reads it: `/task` is
  // that chat's own folder, and its tasks are the ones mounted for it.
  const views = new Map<TaskId, ReturnType<typeof chatView>>();
  const viewOf = (chatId: TaskId) => {
    const known = views.get(chatId);
    if (known) {
      return known;
    }
    const view = chatView(chatId);
    views.set(chatId, view);
    return view;
  };
  const shown = await linkedFiles();
  const described = await Promise.all(
    shown.map(async (file) => {
      const { layout, roots } = await viewOf(file.chatId);
      const resolved = resolveExistingFilePath({
        inputPath: file.path,
        layout,
      });
      const entry = resolved.isErr()
        ? undefined
        : await describeShownFile(resolved.value.absolutePath);
      if (!entry) {
        return;
      }
      const access = accessIn(roots, entry.path);
      return {
        ...entry,
        shownAt: file.at,
        ...(access === undefined ? {} : { access }),
      };
    }),
  );
  // One row per file, however many chats showed it, cut to length after the
  // missing ones have gone, so a run of files that have since been thrown
  // away does not empty the list.
  return unique(
    described.filter((entry) => entry !== undefined),
    (entry) => entry.path,
  ).slice(0, RECENTS_MAX);
}

/** Folders first, then by name as a person reads one: `file 2` before `file 10`. */
function compareEntries(
  a: Pick<ComputerEntry, "kind" | "name">,
  b: Pick<ComputerEntry, "kind" | "name">,
): number {
  if (a.kind !== b.kind) {
    return a.kind === "folder" ? -1 : 1;
  }
  return a.name.localeCompare(b.name, undefined, { numeric: true });
}

/**
 * The grant that covers a host path, if any: the deepest granted folder it is
 * in, and the virtual path the agent reaches it by through that grant.
 */
async function computerAccess(
  taskId: TaskId,
  hostPath: string,
): Promise<ComputerAccess | undefined> {
  // Only a folder among the tasks can be inside one the chat made,
  // and listing the tasks reads every one of them, which every folder
  // listing, and every re-read of one on the clock, would otherwise pay.
  const tasksRoot = path.dirname(taskDir(taskId));
  const { roots } = await chatView(taskId, {
    withChildren: isInsideFolder(hostPath, tasksRoot),
  });
  return accessIn(roots, hostPath);
}

/**
 * One entry of a folder, with what the Finder shows about it. A symlink is
 * what it points at; one that leads nowhere is left as a bare name. A package
 * is a file, by the Finder's name and kind for it.
 */
async function describeEntry(
  folder: string,
  name: string,
  hidden: boolean,
  finder: FinderEntry | undefined,
): Promise<ComputerEntry> {
  const entryPath = path.join(folder, name);
  const isHidden =
    hidden || (finder?.hidden && !name.startsWith(".")) ? { hidden: true } : {};
  const extensionAt = name.lastIndexOf(".");
  const displayName =
    finder?.hidesExtension && extensionAt > 0
      ? { displayName: name.slice(0, extensionAt) }
      : {};
  let stats;
  try {
    stats = await fs.stat(entryPath);
  } catch {
    return { ...isHidden, kind: "file", name, path: entryPath };
  }
  if (stats.isDirectory() && finder?.package) {
    // No size: a package's is its folder's, which says nothing of what is in it.
    return {
      ...isHidden,
      ...displayName,
      createdAt: stats.birthtimeMs,
      kind: "file",
      modifiedAt: stats.mtimeMs,
      name,
      package: true,
      path: entryPath,
      ...(finder.kind === undefined ? {} : { typeName: finder.kind }),
    };
  }
  if (stats.isDirectory()) {
    return {
      ...isHidden,
      createdAt: stats.birthtimeMs,
      kind: "folder",
      modifiedAt: stats.mtimeMs,
      name,
      path: entryPath,
    };
  }
  return {
    ...isHidden,
    ...displayName,
    createdAt: stats.birthtimeMs,
    kind: "file",
    mimeType: getMimeType(name),
    modifiedAt: stats.mtimeMs,
    name,
    path: entryPath,
    size: stats.size,
  };
}

/**
 * One shown file as the browser shows it. Nothing when it is no longer there,
 * or is no longer a file: the list says what the user was handed, and they are
 * free to move, replace or throw away anything on it afterwards.
 */
async function describeShownFile(
  hostPath: string,
): Promise<ComputerEntry | undefined> {
  let stats;
  try {
    stats = await fs.stat(hostPath);
  } catch {
    return undefined;
  }
  if (!stats.isFile()) {
    return undefined;
  }
  const name = path.basename(hostPath);
  return {
    createdAt: stats.birthtimeMs,
    kind: "file",
    mimeType: getMimeType(name),
    modifiedAt: stats.mtimeMs,
    name,
    path: hostPath,
    size: stats.size,
  };
}

/**
 * A host path the way a person writes it: the home folder as `~`.
 *
 * Only where a person would. `~` is how a Mac and a Linux desktop spell the
 * home folder; on Windows it is a name nobody has seen a folder go by, so a
 * path there is written out as it is.
 */
function displayHostPath(hostPath: string): string {
  if (process.platform === "win32") {
    return hostPath;
  }
  const home = os.homedir();
  if (hostPath === home) {
    return "~";
  }
  return hostPath.startsWith(`${home}/`)
    ? `~${hostPath.slice(home.length)}`
    : hostPath;
}

/** `~` and `~/x` as the home folder; anything else must already be absolute. */
function expandHomePath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~" || trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(1));
  }
  if (!path.isAbsolute(trimmed)) {
    throw new Error(`Not a path on this computer: ${input}`);
  }
  return path.resolve(trimmed);
}

async function exists(hostPath: string) {
  try {
    await fs.lstat(hostPath);
    return true;
  } catch {
    return false;
  }
}

/** Whether a host path is that folder or something inside it. */
function isInsideFolder(hostPath: string, folder: string) {
  const relative = path.relative(folder, hostPath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/**
 * The chat's own view of the filesystem: the folders the user attached
 * and a read-only mount per task it created, which is where a file its work
 * made actually sits. Beside the layout, the same mounts as host roots with
 * the grant each carries, which is what a folder's access is judged from.
 */
async function chatView(
  taskId: TaskId,
  { withChildren = true }: { withChildren?: boolean } = {},
) {
  const taskHostRoot = taskDir(taskId);
  const chatId = resolveChat(taskId);
  const attachedFolders = await folderReach(taskId);
  const layout = buildWorkspaceFsLayout({
    attachedFolders,
    extraMounts: withChildren && chatId ? await childTaskMounts(chatId) : [],
    taskHostRoot,
  });
  return { layout, roots: reachableRoots(layout, attachedFolders) };
}

/**
 * What a chat can reach outside its own folder, each resolved to a
 * host root: the folders the user granted it, and the tasks it created, which
 * it reads and never writes. A file one of its tasks made lives in the second
 * kind, so leaving those out would show the user a file with no way to open it.
 */
function reachableRoots(
  layout: WorkspaceFsLayout,
  attachedFolders: Record<string, FolderAttachment.Type>,
): AttachedRoot[] {
  const grants = new Map(
    Object.values(attachedFolders).map((folder) => [
      path.resolve(folder.path),
      folder.access,
    ]),
  );
  return layout.attached.map((mount) => {
    const root = path.resolve(mount.hostRoot);
    return {
      // A mount with no grant behind it is a task the chat created,
      // which it reads and never writes.
      grant: grants.get(root) ?? (mount.readOnly ? "read-only" : "read-write"),
      mountPoint: mount.mountPoint,
      root,
    };
  });
}
