import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { type FolderAttachment } from "../../schemas/folder-attachment";
import { type TaskId } from "../../schemas/task-id";
import { getMimeType } from "../get-mime-type";
import { resolveExistingFilePath } from "../resolve-agent-path";
import { taskDir } from "../task-dir-utils";
import { resolveTaskProjectFolder } from "../task-project-folder";
import { getTaskState } from "../task-record";
import {
  buildWorkspaceFsLayout,
  effectiveFolderAccess,
  type WorkspaceFsLayout,
} from "../workspace-fs-layout";
import { childTaskMounts } from "./children";
import { linkedFiles } from "./linked-files";
import { outputFolderPath } from "./output-folder";

/** How many entries one listing carries. A folder past this shows the first. */
const MAX_ENTRIES = 2000;

/** How many of the files the conversation showed the recents list carries. */
const RECENTS_MAX = 20;

const ComputerEntrySchema = z.object({
  createdAt: z.number().optional(),
  kind: z.enum(["file", "folder"]),
  mimeType: z.string().optional(),
  modifiedAt: z.number().optional(),
  name: z.string(),
  /** The host path. */
  path: z.string(),
  size: z.number().optional(),
});
type ComputerEntry = z.output<typeof ComputerEntrySchema>;

/**
 * How the orchestrator reaches a folder of the computer, when one of the
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

export const ComputerListingSchema = z.object({
  access: ComputerAccessSchema.optional(),
  /** The path as a person writes it, the home folder as `~`. */
  display: z.string(),
  entries: ComputerEntrySchema.array(),
  /** The host path listed, `~` expanded. */
  path: z.string(),
  truncated: z.boolean(),
});
export type ComputerListing = z.output<typeof ComputerListingSchema>;

const ComputerPlaceSchema = z.object({
  name: z.string(),
  path: z.string(),
});
export const ComputerPlacesSchema = z.object({
  favorites: ComputerPlaceSchema.array(),
  volumes: ComputerPlaceSchema.array(),
});
export type ComputerPlaces = z.output<typeof ComputerPlacesSchema>;

/** A granted folder as a host root, with how the agent reaches what is under it. */
interface AttachedRoot {
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
 * Where the computer is entered from: the folder Instrument keeps its own
 * outcomes in, which is where what the app made is looked for and so stands
 * first; then the folders a person keeps things in, and every mounted volume.
 */
export async function computerPlaces(): Promise<ComputerPlaces> {
  const home = os.homedir();
  const candidates: [string, string][] = [
    ["Instrument", outputFolderPath()],
    ["Home", home],
    ["Desktop", path.join(home, "Desktop")],
    ["Documents", path.join(home, "Documents")],
    ["Downloads", path.join(home, "Downloads")],
  ];
  const candidatePlaces = await Promise.all(
    candidates.map(async ([name, folder]) =>
      (await isDirectory(folder)) ? { name, path: folder } : undefined,
    ),
  );
  const favorites = candidatePlaces.filter((place) => place !== undefined);

  let volumes: ComputerPlaces["volumes"] = [];
  try {
    const names = await fs.readdir("/Volumes");
    const mounted = await Promise.all(
      names
        .filter((name) => !name.startsWith("."))
        .map(async (name) => {
          try {
            // The boot volume is a link to `/`; the others are themselves.
            const real = await fs.realpath(path.join("/Volumes", name));
            return { name, path: real };
          } catch {
            return;
          }
        }),
    );
    volumes = mounted.filter((place) => place !== undefined);
  } catch {
    // Not a Mac, or no volumes folder: the root the home folder sits on,
    // named the way that system names it.
    const { root } = path.parse(home);
    volumes = [
      {
        name:
          process.platform === "win32" ? root.replace(/[\\/]+$/, "") : "Root",
        path: root,
      },
    ];
  }
  return { favorites, volumes };
}

/**
 * One folder of the computer, as the Finder would show it: files and
 * subfolders, hidden ones left out, folders first. Read as the app's own user,
 * which is what the person browsing is; whether the agent may read it is a
 * separate question, answered by `access`.
 */
export async function listComputerFolder({
  path: input,
  taskId,
}: {
  path: string;
  taskId: TaskId;
}): Promise<ComputerListing> {
  const hostPath = expandHomePath(input);
  const dirents = await fs.readdir(hostPath, { withFileTypes: true });
  const visible = dirents.filter((entry) => !entry.name.startsWith("."));
  const truncated = visible.length > MAX_ENTRIES;

  const entries = await Promise.all(
    visible
      .slice(0, MAX_ENTRIES)
      .map((entry) => describeEntry(hostPath, entry.name)),
  );
  entries.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });

  return {
    access: await computerAccess(taskId, hostPath),
    display: displayHostPath(hostPath),
    entries,
    path: hostPath,
    truncated,
  };
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
export async function recentComputerFiles({
  taskId,
}: {
  taskId: TaskId;
}): Promise<ComputerRecent[]> {
  const [shown, { layout, roots }] = await Promise.all([
    linkedFiles(taskId),
    orchestratorView(taskId),
  ]);
  const described = await Promise.all(
    shown.map(async (file) => {
      const resolved = resolveExistingFilePath({
        inputPath: file.path,
        layout,
      });
      const entry = resolved.isErr()
        ? undefined
        : await describeShownFile(resolved.value.absolutePath);
      return entry && { ...entry, shownAt: file.at };
    }),
  );
  // Cut to length after the missing ones have gone, so a run of files that
  // have since been thrown away does not empty the list.
  return described
    .filter((entry) => entry !== undefined)
    .slice(0, RECENTS_MAX)
    .map((file) => {
      const access = accessIn(roots, file.path);
      return { ...file, ...(access === undefined ? {} : { access }) };
    });
}

/**
 * The deepest granted folder a host path sits in, and the virtual path the
 * agent reaches it by through that grant.
 */
function accessIn(
  roots: AttachedRoot[],
  hostPath: string,
): ComputerAccess | undefined {
  let best: AttachedRoot | undefined;
  for (const candidate of roots) {
    const { root } = candidate;
    const inside = hostPath === root || hostPath.startsWith(`${root}/`);
    if (inside && (best === undefined || root.length > best.root.length)) {
      best = candidate;
    }
  }
  if (!best) {
    return undefined;
  }
  return {
    access: effectiveFolderAccess({ access: best.grant, path: hostPath }),
    mountPath: `${best.mountPoint}${hostPath.slice(best.root.length)}`,
    root: best.root,
  };
}

/**
 * The grant that covers a host path, if any: the deepest granted folder it is
 * in, and the virtual path the agent reaches it by through that grant.
 */
async function computerAccess(
  taskId: TaskId,
  hostPath: string,
): Promise<ComputerAccess | undefined> {
  const { roots } = await orchestratorView(taskId);
  return accessIn(roots, hostPath);
}

/**
 * One entry of a folder, with what the Finder shows about it. A symlink is
 * what it points at; one that leads nowhere is left as a bare name.
 */
async function describeEntry(
  folder: string,
  name: string,
): Promise<ComputerEntry> {
  const entryPath = path.join(folder, name);
  let stats;
  try {
    stats = await fs.stat(entryPath);
  } catch {
    return { kind: "file", name, path: entryPath };
  }
  if (stats.isDirectory()) {
    return {
      createdAt: stats.birthtimeMs,
      kind: "folder",
      modifiedAt: stats.mtimeMs,
      name,
      path: entryPath,
    };
  }
  return {
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

/** A host path the way a person writes it: the home folder as `~`. */
function displayHostPath(hostPath: string): string {
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

async function isDirectory(folder: string) {
  try {
    const stats = await fs.stat(folder);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * The orchestrator's own view of the filesystem: the folders the user attached
 * and a read-only mount per task it created, which is where a file its work
 * made actually sits. Beside the layout, the same mounts as host roots with
 * the grant each carries, which is what a folder's access is judged from.
 */
async function orchestratorView(taskId: TaskId) {
  const taskHostRoot = taskDir(taskId);
  const state = await getTaskState(taskHostRoot);
  const attachedFolders = state.attachedFolders ?? {};
  const layout = buildWorkspaceFsLayout({
    attachedFolders,
    extraMounts: await childTaskMounts(taskId),
    projectFolderName: await resolveTaskProjectFolder(taskId),
    taskHostRoot,
  });
  return { layout, roots: reachableRoots(layout, attachedFolders) };
}

/**
 * What an orchestrator can reach outside its own folder, each resolved to a
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
      // A mount with no grant behind it is a task the orchestrator created,
      // which it reads and never writes.
      grant: grants.get(root) ?? (mount.readOnly ? "read-only" : "read-write"),
      mountPoint: mount.mountPoint,
      root,
    };
  });
}
