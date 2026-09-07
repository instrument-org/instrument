import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sort, unique } from "radashi";
import { z } from "zod";

import { type TaskId } from "../../schemas/task-id";
import { assignAttachedMounts } from "../attached-folder-mounts";
import { getMimeType } from "../get-mime-type";
import { taskDir } from "../task-dir-utils";
import { getTaskState } from "../task-record";
import { effectiveFolderAccess } from "../workspace-fs-layout";
import { outputFolderPath } from "./output-folder";

/** How many entries one listing carries. A folder past this shows the first. */
const MAX_ENTRIES = 2000;

/** How many recently changed files the recents list carries. */
const RECENTS_MAX = 20;

/**
 * How many subfolders the recents scan looks inside, the ones changed most
 * recently first. A bound rather than a walk: the list is a glance at what
 * was touched today, not a search of the disk.
 */
const RECENTS_FOLDERS = 30;

export const ComputerEntrySchema = z.object({
  createdAt: z.number().optional(),
  kind: z.enum(["file", "folder"]),
  mimeType: z.string().optional(),
  modifiedAt: z.number().optional(),
  name: z.string(),
  /** The host path. */
  path: z.string(),
  size: z.number().optional(),
});
export type ComputerEntry = z.output<typeof ComputerEntrySchema>;

/**
 * How the orchestrator reaches a folder of the computer, when one of the
 * folders granted to it covers that folder. Absent means the agent cannot
 * read it or hand it to a task until the user allows it.
 */
export const ComputerAccessSchema = z.object({
  access: z.enum(["read-only", "read-write"]),
  /** The virtual path the agent knows this folder by. */
  mountPath: z.string(),
  /** The host path of the granted folder this one is in. */
  root: z.string(),
});
export type ComputerAccess = z.output<typeof ComputerAccessSchema>;

/**
 * A recently changed file, with whether the agent can reach it. A listing
 * answers that once for the folder it lists; these files come from all over,
 * so each carries its own answer.
 */
export const ComputerRecentSchema = ComputerEntrySchema.extend({
  access: ComputerAccessSchema.optional(),
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

export const ComputerPlaceSchema = z.object({
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
  access: ComputerAccess["access"];
  mountPoint: string;
  root: string;
}

/**
 * The grant that covers a host path, if any: the deepest granted folder it is
 * in, and the virtual path the agent reaches it by through that grant.
 */
export async function computerAccess(
  taskId: TaskId,
  hostPath: string,
): Promise<ComputerAccess | undefined> {
  return accessIn(await attachedRoots(taskId), hostPath);
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
 * The files changed most recently across the folders the computer is entered
 * from, newest first.
 *
 * A glance rather than a search: each favorite is read, then the subfolders
 * that changed most recently are read once each, and nothing below that. A
 * file the user saved this morning is two clicks deep at worst, and the scan
 * costs one pass over folders that are already warm.
 */
export async function recentComputerFiles({
  taskId,
}: {
  taskId: TaskId;
}): Promise<ComputerRecent[]> {
  const [{ favorites }, roots] = await Promise.all([
    computerPlaces(),
    attachedRoots(taskId),
  ]);
  const scanned = await Promise.all(
    favorites.map((place) => readVisibleEntries(place.path)),
  );
  const top = scanned.flat();
  const folders = sort(
    top.filter((entry) => entry.kind === "folder"),
    (entry) => entry.modifiedAt ?? 0,
    true,
  ).slice(0, RECENTS_FOLDERS);
  const descended = await Promise.all(
    folders.map((folder) => readVisibleEntries(folder.path)),
  );
  const inside = descended.flat();
  // One favorite can sit inside another, so the same file arrives twice.
  const files = unique(
    [...top, ...inside].filter((entry) => entry.kind === "file"),
    (file) => file.path,
  );
  const newest = sort(files, (file) => file.modifiedAt ?? 0, true).slice(
    0,
    RECENTS_MAX,
  );
  return newest.map((file) => {
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
  let best: ComputerAccess | undefined;
  for (const { access, mountPoint, root } of roots) {
    const inside = hostPath === root || hostPath.startsWith(`${root}/`);
    if (inside && (best === undefined || root.length > best.root.length)) {
      best = {
        access,
        mountPath: `${mountPoint}${hostPath.slice(root.length)}`,
        root,
      };
    }
  }
  return best;
}

/** The folders granted to an orchestrator, each resolved to a host root. */
async function attachedRoots(taskId: TaskId): Promise<AttachedRoot[]> {
  const state = await getTaskState(taskDir(taskId));
  return assignAttachedMounts(state.attachedFolders ?? {}).map(
    ({ folder, mountPoint }) => ({
      access: effectiveFolderAccess(folder),
      mountPoint,
      root: path.resolve(folder.path),
    }),
  );
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

/** What a folder holds, hidden entries left out; nothing when it cannot be read. */
async function readVisibleEntries(folder: string): Promise<ComputerEntry[]> {
  let names: string[];
  try {
    names = await fs.readdir(folder);
  } catch {
    return [];
  }
  return Promise.all(
    names
      .filter((name) => !name.startsWith("."))
      .slice(0, MAX_ENTRIES)
      .map((name) => describeEntry(folder, name)),
  );
}
