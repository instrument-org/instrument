import { z } from "zod";

import { FolderAttachment } from "../folder-attachment";
import { RelativePathSchema } from "../paths";

export namespace SessionMessageDataPart {
  export const NameSchema = z.enum(["attachments", "fileChanges"]);

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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const DataPartsSchema = z.object({
    [NameSchema.enum.attachments]: FileAttachmentsDataPartSchema,
    [NameSchema.enum.fileChanges]: FileChangesDataPartSchema,
  });
  export type DataParts = z.output<typeof DataPartsSchema>;
}
