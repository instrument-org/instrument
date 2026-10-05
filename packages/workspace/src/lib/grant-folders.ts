import { ulid } from "ulid";

import { FolderAttachment } from "../schemas/folder-attachment";
import { type AbsolutePath } from "../schemas/paths";
import { assignMountNames } from "./assign-mount-names";

/** A folder handed to a task, with where it mounts when that is decided already. */
export interface FolderGrant {
  access: FolderAttachment.Access;
  /**
   * The name to mount it under: the path a chat reaches the folder by, so its
   * task reaches it by the same path. Absent where nothing decided one, and
   * then a name is assigned beside the ones the task holds.
   */
  mountName?: string;
  path: AbsolutePath;
  source: FolderAttachment.Source;
}

/**
 * A task's folders with `grants` added: a folder it already holds is
 * re-granted at the new access under the name it has, and a new one mounts
 * under the name its grant carries, or under one assigned around the names
 * already in use where it carries none or that one is taken.
 *
 * A held folder never changes name here, since the agent reads and writes
 * through it and its transcript names it.
 */
export function grantFolders(
  held: FolderAttachment.Type[],
  grants: FolderGrant[],
  now: number,
): {
  folders: Record<string, FolderAttachment.Type>;
  granted: FolderAttachment.Type[];
} {
  const folders = [...held];
  const fresh: FolderAttachment.Type[] = [];
  for (const grant of grants) {
    const at = folders.findIndex((folder) => folder.path === grant.path);
    const existing = folders[at];
    if (existing) {
      folders[at] = { ...existing, access: grant.access };
      continue;
    }
    const folder: FolderAttachment.Type = {
      access: grant.access,
      createdAt: now,
      id: FolderAttachment.IdSchema.parse(ulid()),
      mountName: "",
      path: grant.path,
      source: grant.source,
    };
    const wanted = grant.mountName;
    if (wanted && !folders.some((other) => other.mountName === wanted)) {
      folders.push({ ...folder, mountName: wanted });
    } else {
      fresh.push(folder);
    }
  }
  const names = assignMountNames(
    fresh,
    folders.map((folder) => folder.mountName),
  );
  for (const folder of fresh) {
    folders.push({ ...folder, mountName: names.get(folder.id) ?? folder.id });
  }
  const sorted = folders.toSorted((a, b) => a.createdAt - b.createdAt);
  return {
    folders: Object.fromEntries(
      sorted.map((folder) => [folder.mountName, folder]),
    ),
    granted: grants.flatMap((grant) => {
      const found = folders.find((folder) => folder.path === grant.path);
      return found ? [found] : [];
    }),
  };
}
