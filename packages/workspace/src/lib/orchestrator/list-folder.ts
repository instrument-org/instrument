import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { MOUNT } from "../../mount-points";
import { type TaskId } from "../../schemas/task-id";
import { assignAttachedMounts } from "../attached-folder-mounts";
import { getMimeType } from "../get-mime-type";
import { normalizePath } from "../normalize-path";
import { taskDir } from "../task-dir-utils";
import { getTaskState } from "../task-record";
import {
  buildWorkspaceFsLayout,
  effectiveFolderAccess,
  hostPathEscapesMount,
  isMaskedPrivatePath,
  resolveHostPath,
} from "../workspace-fs-layout";
import { childTaskMounts } from "./children";

/** How many entries one listing carries. A folder past this shows the first. */
const MAX_ENTRIES = 500;

export const FolderEntrySchema = z.object({
  /** Read-only or writable, for a mount root; absent inside one. */
  access: z.enum(["read-only", "read-write"]).optional(),
  kind: z.enum(["file", "folder"]),
  mimeType: z.string().optional(),
  modifiedAt: z.number().optional(),
  name: z.string(),
  /** The virtual path, which is what the agent is told about and links with. */
  path: z.string(),
  size: z.number().optional(),
});

export const FolderListingSchema = z.object({
  entries: FolderEntrySchema.array(),
  /** The host directory this listing is of, for showing where it really is. */
  hostPath: z.string().optional(),
  /** The virtual path listed. `/` is the root: the folders the user granted. */
  path: z.string(),
  truncated: z.boolean(),
});

export type FolderListing = z.output<typeof FolderListingSchema>;

/**
 * What the human sees of the orchestrator's folders. The root lists every
 * folder the conversation has; inside one it is the folder itself, files and
 * subfolders, read through the same layout the agent's tools resolve against,
 * so what the person browses and what the agent can reach are one set.
 */
export async function listOrchestratorFolder({
  path: virtualPath,
  taskId,
}: {
  path: string;
  taskId: TaskId;
}): Promise<FolderListing> {
  const state = await getTaskState(taskDir(taskId));
  const normalized = normalizePath(virtualPath || "/");

  if (normalized === "/") {
    const mounts = assignAttachedMounts(state.attachedFolders ?? {});
    return {
      entries: mounts.map(({ folder, mountPoint }) => ({
        access: effectiveFolderAccess(folder),
        kind: "folder" as const,
        name: path.basename(folder.path),
        path: mountPoint,
      })),
      path: "/",
      truncated: false,
    };
  }

  const layout = buildWorkspaceFsLayout({
    attachedFolders: state.attachedFolders,
    extraMounts: await childTaskMounts(taskId),
    taskHostRoot: taskDir(taskId),
  });
  const resolved = resolveHostPath(layout, normalized);
  if (
    resolved === null ||
    resolved.mount === layout.task ||
    isMaskedPrivatePath(resolved.mount, normalized) ||
    hostPathEscapesMount(resolved.hostPath, resolved.mount.hostRoot)
  ) {
    throw new Error(`Not a folder you can browse: ${virtualPath}`);
  }

  const dirents = await fs.readdir(resolved.hostPath, { withFileTypes: true });
  const visible = dirents
    .filter((entry) => !entry.name.startsWith("."))
    .toSorted((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
  const truncated = visible.length > MAX_ENTRIES;

  const entries = await Promise.all(
    visible.slice(0, MAX_ENTRIES).map(async (entry) => {
      const entryPath = `${normalized}/${entry.name}`.replaceAll("//", "/");
      if (entry.isDirectory()) {
        return { kind: "folder" as const, name: entry.name, path: entryPath };
      }
      try {
        const stats = await fs.stat(path.join(resolved.hostPath, entry.name));
        return {
          kind: "file" as const,
          mimeType: getMimeType(entry.name),
          modifiedAt: stats.mtimeMs,
          name: entry.name,
          path: entryPath,
          size: stats.size,
        };
      } catch {
        return { kind: "file" as const, name: entry.name, path: entryPath };
      }
    }),
  );

  return {
    entries,
    hostPath: normalized.startsWith(`${MOUNT.tasks}/`)
      ? undefined
      : resolved.hostPath,
    path: normalized,
    truncated,
  };
}
