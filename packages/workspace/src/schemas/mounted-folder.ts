import { z } from "zod";

import { AbsolutePathSchema } from "./paths";

/**
 * A folder on the user's disk as a chat reaches it, mounted at
 * `/mnt/<mountName>`: what `folderReach` answers for every folder the chat
 * reaches, and what the sandbox mounts.
 */
export namespace MountedFolder {
  export const IdSchema = z.string().brand("MountedFolderId");

  // What the agent may do in the folder. "read-write" is the agent working
  // in it: the mount is writable and edits land on the user's real files. A
  // folder holding the workspace mounts read-only (`effectiveFolderAccess`).
  export const AccessSchema = z.enum(["read-only", "read-write"]);

  export type Access = z.output<typeof AccessSchema>;

  export const Schema = z.object({
    access: AccessSchema,
    id: IdSchema,
    /**
     * The name this folder is mounted under, at `/mnt/<mountName>`. Unique
     * within the chat and derived from the path (`assignMountNames`), or the
     * chat's own path for a folder inside one of its mounts, which may hold
     * `/` (`Home/Downloads`). It is the agent's handle for the folder and not
     * the user's word for it -- that comes from the path. Reading one as the
     * other is what put "the documents-test folder" in front of a user who
     * has no such folder.
     */
    mountName: z.string(),
    path: AbsolutePathSchema,
  });

  export type Type = z.output<typeof Schema>;
}
