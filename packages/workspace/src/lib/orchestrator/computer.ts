import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

export const ComputerEntrySchema = z.object({
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

/**
 * The grant that covers a host path, if any: the deepest granted folder it is
 * in, and the virtual path the agent reaches it by through that grant.
 */
export async function computerAccess(
  taskId: TaskId,
  hostPath: string,
): Promise<ComputerAccess | undefined> {
  const state = await getTaskState(taskDir(taskId));
  const mounts = assignAttachedMounts(state.attachedFolders ?? {});
  let best: ComputerAccess | undefined;
  for (const { folder, mountPoint } of mounts) {
    const root = path.resolve(folder.path);
    const inside = hostPath === root || hostPath.startsWith(`${root}/`);
    if (inside && (best === undefined || root.length > best.root.length)) {
      best = {
        access: effectiveFolderAccess(folder),
        mountPath: `${mountPoint}${hostPath.slice(root.length)}`,
        root,
      };
    }
  }
  return best;
}

/**
 * Where the computer is entered from: the folders a person keeps things in,
 * the folder Instrument keeps its own outcomes in, and every mounted volume.
 */
export async function computerPlaces(): Promise<ComputerPlaces> {
  const home = os.homedir();
  const candidates: [string, string][] = [
    ["Home", home],
    ["Desktop", path.join(home, "Desktop")],
    ["Documents", path.join(home, "Documents")],
    ["Downloads", path.join(home, "Downloads")],
    ["Instrument", outputFolderPath()],
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
    // Not a Mac, or no volumes folder: the favorites are the whole computer.
  }
  return { favorites, volumes };
}

/** A host path the way a person writes it: the home folder as `~`. */
export function displayHostPath(hostPath: string): string {
  const home = os.homedir();
  if (hostPath === home) {
    return "~";
  }
  return hostPath.startsWith(`${home}/`)
    ? `~${hostPath.slice(home.length)}`
    : hostPath;
}

/** `~` and `~/x` as the home folder; anything else must already be absolute. */
export function expandHomePath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~" || trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(1));
  }
  if (!path.isAbsolute(trimmed)) {
    throw new Error(`Not a path on this computer: ${input}`);
  }
  return path.resolve(trimmed);
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
    visible.slice(0, MAX_ENTRIES).map(async (entry): Promise<ComputerEntry> => {
      const entryPath = path.join(hostPath, entry.name);
      // A symlink is what it points at, which is how the Finder shows one.
      let stats;
      try {
        stats = await fs.stat(entryPath);
      } catch {
        return { kind: "file", name: entry.name, path: entryPath };
      }
      if (stats.isDirectory()) {
        return { kind: "folder", name: entry.name, path: entryPath };
      }
      return {
        kind: "file",
        mimeType: getMimeType(entry.name),
        modifiedAt: stats.mtimeMs,
        name: entry.name,
        path: entryPath,
        size: stats.size,
      };
    }),
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

async function isDirectory(folder: string) {
  try {
    const stats = await fs.stat(folder);
    return stats.isDirectory();
  } catch {
    return false;
  }
}
