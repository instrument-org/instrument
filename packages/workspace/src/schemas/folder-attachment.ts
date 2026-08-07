import { z } from "zod";

import { AbsolutePathSchema } from "./paths";

export namespace FolderAttachment {
  export const IdSchema = z.string().brand("FolderAttachmentId");

  // What the agent may do with the folder. "read-write" is the user working in
  // a folder: the mount is writable and edits land on their real files.
  // Defaults to "read-only" so folders attached before the choice existed keep
  // the posture they were attached under.
  export const AccessSchema = z
    .enum(["read-only", "read-write"])
    .default("read-only");

  export type Access = z.output<typeof AccessSchema>;

  export const SourceSchema = z.enum(["project", "user"]).default("user");

  export type Source = z.output<typeof SourceSchema>;

  const BaseSchema = z.object({
    access: AccessSchema,
    createdAt: z.int().min(0),
    id: IdSchema,
    path: AbsolutePathSchema,
    // Where the attachment came from: "project" if auto-included from the
    // task's project, "user" if attached directly. Lets every consumer tell
    // them apart without re-deriving from paths. Defaults to "user" so
    // pre-existing data and manual attaches need no migration.
    source: SourceSchema,
  });

  /**
   * The name this folder is mounted under, at `/mnt/<mountName>`. Unique within
   * a task and assigned by us (see assign-mount-names.ts), so it is the agent's
   * handle for the folder and not the user's word for it -- that comes from the
   * path. Reading one as the other is what put "the documents-test folder" in
   * front of a user who has no such folder.
   */
  const MountNameSchema = z.string();

  export const Schema = BaseSchema.extend({ mountName: MountNameSchema });

  export type Type = z.output<typeof Schema>;
}
