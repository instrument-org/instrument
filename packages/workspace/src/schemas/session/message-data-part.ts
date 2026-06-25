import { z } from "zod";

import { FolderAttachment } from "../folder-attachment";
import { RelativePathSchema } from "../paths";

export namespace SessionMessageDataPart {
  export const NameSchema = z.enum([
    "attachedFolderChanges",
    "attachments",
    "browserStatus",
    "externalFileChanges",
    "fileChanges",
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
  });
  export type DataParts = z.output<typeof DataPartsSchema>;
}
