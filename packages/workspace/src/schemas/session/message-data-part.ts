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
    "intent",
    "skillChanges",
    "skillMentions",
    "maxSteps",
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

  // Attached folders removed, renamed, or re-permissioned since the model last
  // saw them -- attached to the user message that triggers the next turn so the
  // model stops relying on stale names, removed folders, or an access level the
  // user has since changed. The standing folder list lives in the session
  // context, which is rebuilt at most hourly, so this is what makes a change
  // reach the model in the turn it happens.
  const AttachedFolderChangesDataPartSchema = z.object({
    accessChanged: z
      .array(
        z.object({
          access: FolderAttachment.AccessSchema,
          name: z.string(),
          path: z.string(),
        }),
      )
      .default([]),
    removed: z.array(z.object({ name: z.string(), path: z.string() })),
    renamed: z.array(
      z.object({ newName: z.string(), oldName: z.string(), path: z.string() }),
    ),
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
    foldersAdded: z.array(
      z.object({
        access: FolderAttachment.AccessSchema,
        name: z.string(),
        path: z.string(),
      }),
    ),
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

  // Attached to the synthetic assistant message written when a run stops after
  // reaching the max unattended step count. Hidden from the chat UI (the
  // "Resume the agent" alert is the visible affordance); surfaced to the model
  // as a system note on the next user turn so it knows the prior run was cut
  // off at the cap rather than finished.
  /**
   * Why the task was started, phrased for the agent by the surface that opened
   * it. Carried beside the user's own text so a launcher can brief the agent
   * without putting words in the user's mouth or cluttering the composer.
   */
  export const IntentDataPartSchema = z.object({
    text: z.string().trim().min(1).max(2000),
  });

  export type IntentDataPart = z.output<typeof IntentDataPartSchema>;

  /**
   * Skills the agent installed or revised during the turn, detected by diffing
   * the workspace skills directory across the turn. Attached to the turn's last
   * assistant message so the chat can offer a way into a skill the agent just
   * wrote. Names are directory names, which is how the skills routes address
   * them. Deletions are deliberately not carried: there would be nowhere to go.
   */
  export const SkillChangesDataPartSchema = z.object({
    created: z.array(z.string()),
    updated: z.array(z.string()),
  });

  export type SkillChangesDataPart = z.output<
    typeof SkillChangesDataPartSchema
  >;

  /**
   * Skills the user named in their message. Recorded so the model is told what
   * the mention syntax means and can decide which, if any, to load; loading
   * them automatically would make a message that names several skills drag all
   * of them into context whether or not they bear on the request.
   */
  export const SkillMentionsDataPartSchema = z.object({
    names: z.array(z.string()).min(1),
  });

  export type SkillMentionsDataPart = z.output<
    typeof SkillMentionsDataPartSchema
  >;

  const MaxStepsDataPartSchema = z.object({
    maxStepCount: z.number(),
  });

  export type MaxStepsDataPart = z.output<typeof MaxStepsDataPartSchema>;

  // oxlint-disable-next-line no-unused-vars
  const DataPartsSchema = z.object({
    [NameSchema.enum.attachedFolderChanges]:
      AttachedFolderChangesDataPartSchema,
    [NameSchema.enum.attachments]: FileAttachmentsDataPartSchema,
    [NameSchema.enum.browserStatus]: BrowserStatusDataPartSchema,
    [NameSchema.enum.externalFileChanges]: ExternalFileChangesDataPartSchema,
    [NameSchema.enum.fileChanges]: FileChangesDataPartSchema,
    [NameSchema.enum.intent]: IntentDataPartSchema,
    [NameSchema.enum.maxSteps]: MaxStepsDataPartSchema,
    [NameSchema.enum.projectChanges]: ProjectChangesDataPartSchema,
    [NameSchema.enum.projectContext]: ProjectContextDataPartSchema,
    [NameSchema.enum.skillChanges]: SkillChangesDataPartSchema,
    [NameSchema.enum.skillMentions]: SkillMentionsDataPartSchema,
  });
  export type DataParts = z.output<typeof DataPartsSchema>;
}
