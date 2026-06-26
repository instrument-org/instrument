import { z } from "zod";

import { FolderAttachment } from "../folder-attachment";
import { RelativePathSchema } from "../paths";
import { ProjectIdSchema } from "../project-id";

export namespace SessionMessageDataPart {
  export const NameSchema = z.enum([
    "attachedFolderChanges",
    "attachments",
    "browserStatus",
    "externalFileChanges",
    "fileChanges",
    "projectChanges",
    "projectContext",
  ]);

  export type Name = z.output<typeof NameSchema>;

  const FileChangeStatusSchema = z.enum(["added", "deleted", "modified"]);

  const FileChangeDataPartItemSchema = z.object({
    filename: z.string(),
    filePath: RelativePathSchema,
    mimeType: z.string(),
    modifiedAt: z.number(),
    size: z.number(),
    status: FileChangeStatusSchema,
  });

  export type FileChangeDataPartItem = z.output<
    typeof FileChangeDataPartItemSchema
  >;

  const FileChangesDataPartSchema = z.object({
    files: z.array(FileChangeDataPartItemSchema),
  });

  export type FileChangesDataPart = z.output<typeof FileChangesDataPartSchema>;

  // Changes detected on disk between turns (created outside the agent), attached
  // to the user message that triggered the next turn so the model is aware.
  const ExternalFileChangesDataPartSchema = z.object({
    files: z.array(FileChangeDataPartItemSchema),
  });

  export type ExternalFileChangesDataPart = z.output<
    typeof ExternalFileChangesDataPartSchema
  >;

  // Attached folders the user removed between turns, attached to the user
  // message that triggers the next turn so the model stops relying on them.
  const AttachedFolderChangesDataPartSchema = z.object({
    removed: z.array(z.object({ name: z.string(), path: z.string() })),
  });

  export type AttachedFolderChangesDataPart = z.output<
    typeof AttachedFolderChangesDataPartSchema
  >;

  const FileAttachmentDataPartSchema = z.object({
    filename: z.string(),
    filePath: RelativePathSchema,
    mimeType: z.string(),
    modifiedAt: z.number(),
    size: z.number(),
  });

  export type FileAttachmentDataPart = z.output<
    typeof FileAttachmentDataPartSchema
  >;

  export type FolderAttachmentDataPart = FolderAttachment.Type;

  export const FileAttachmentsDataPartSchema = z.object({
    files: z.array(FileAttachmentDataPartSchema),
    folders: z.array(FolderAttachment.Schema).optional(),
  });

  export type FileAttachmentsDataPart = z.output<
    typeof FileAttachmentsDataPartSchema
  >;

  // Project identity and instructions snapshotted onto the first message when a
  // task is created from a project. Frozen at creation, so later project edits
  // or deletion don't change the task. Project folders are not listed here; each
  // attachment carries its own `source` so consumers tell them apart.
  const ProjectContextDataPartSchema = z.object({
    instructions: z.string().optional(),
    projectId: ProjectIdSchema,
    projectName: z.string(),
  });

  export type ProjectContextDataPart = z.output<
    typeof ProjectContextDataPartSchema
  >;

  // Drift detected between the frozen project snapshot and the live project when
  // a user message is sent (no live watching: a single read at send time).
  // Instructions ride along here; added/removed folders are also written to the
  // task's attached folders so they become standing context. `instructions` is
  // the new value when `instructionsChanged` is true (omitted when it was
  // cleared), so the latest such part is the effective project instructions.
  const ProjectChangesDataPartSchema = z.object({
    foldersAdded: z.array(z.object({ name: z.string(), path: z.string() })),
    foldersRemoved: z.array(z.object({ name: z.string(), path: z.string() })),
    instructions: z.string().optional(),
    instructionsChanged: z.boolean(),
    projectId: ProjectIdSchema,
    projectName: z.string(),
  });

  export type ProjectChangesDataPart = z.output<
    typeof ProjectChangesDataPartSchema
  >;

  const BrowserTargetSchema = z.object({
    title: z.string().optional(),
    url: z.string(),
  });

  const BrowserStatusDataPartSchema = z.discriminatedUnion("status", [
    z.object({
      previousTarget: BrowserTargetSchema.optional(),
      status: z.literal("closed"),
    }),
    z.object({
      status: z.literal("open"),
      target: BrowserTargetSchema,
    }),
  ]);

  export type BrowserStatusDataPart = z.output<
    typeof BrowserStatusDataPartSchema
  >;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const DataPartsSchema = z.object({
    [NameSchema.enum.attachedFolderChanges]:
      AttachedFolderChangesDataPartSchema,
    [NameSchema.enum.attachments]: FileAttachmentsDataPartSchema,
    [NameSchema.enum.browserStatus]: BrowserStatusDataPartSchema,
    [NameSchema.enum.externalFileChanges]: ExternalFileChangesDataPartSchema,
    [NameSchema.enum.fileChanges]: FileChangesDataPartSchema,
    [NameSchema.enum.projectChanges]: ProjectChangesDataPartSchema,
    [NameSchema.enum.projectContext]: ProjectContextDataPartSchema,
  });
  export type DataParts = z.output<typeof DataPartsSchema>;
}
