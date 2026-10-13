import { z } from "zod";

import { AbsolutePathSchema } from "./paths";

/**
 * A folder on the user's disk as a chat reaches it, at its own path: what
 * `folderReach` answers for every folder the chat reaches, and what the
 * sandbox mounts.
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
    path: AbsolutePathSchema,
  });

  export type Type = z.output<typeof Schema>;
}
