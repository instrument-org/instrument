import { z } from "zod";

import { AbsolutePathSchema } from "./paths";

export namespace FolderAttachment {
  export const IdSchema = z.string().brand("FolderAttachmentId");

  export const SourceSchema = z.enum(["project", "user"]).default("user");

  export type Source = z.output<typeof SourceSchema>;

  export const Schema = z.object({
    createdAt: z.int().min(0),
    id: IdSchema,
    name: z.string(),
    path: AbsolutePathSchema,
    // Where the attachment came from: "project" if auto-included from the
    // task's project, "user" if attached directly. Lets every consumer tell
    // them apart without re-deriving from paths. Defaults to "user" so
    // pre-existing data and manual attaches need no migration.
    source: SourceSchema,
  });

  export type Type = z.output<typeof Schema>;
}
