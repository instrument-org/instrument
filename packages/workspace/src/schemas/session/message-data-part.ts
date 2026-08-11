import { z } from "zod";

import { FolderAttachment } from "../folder-attachment";
import { RelativePathSchema } from "../paths";
import { ProjectIdSchema } from "../project-id";
import { TaskPane } from "../task-pane";

export namespace SessionMessageDataPart {
  /**
   * Every part below is one of three cadences, and which one it is decides
   * whether it needs to guard against repeating itself.
   *
   * - **Event**: something that happened on this turn -- `attachments`,
   *   `intent`, `maxSteps`, `skillChanges`, `skillMentions`, and
   *   `projectContext`, which is written once at creation. A repeat is
   *   impossible by construction; nothing to guard.
   * - **Diff**: what changed since last time -- `projectChanges`,
   *   `attachedFolderChanges`. Self-limiting: no change, no part.
   * - **State**: the whole current picture -- `browserStatus`, `paneTabs`.
   *   These are the ones that will restate an unchanged fact on every single
   *   turn unless their producer compares against what this session was last
   *   told. `createBrowserStatusPart` and `createPaneTabsPart` each do, by
   *   different means; a new state part that forgets is not a failure anyone
   *   sees, it just quietly spends context.
   *
   * Adding a part? Decide which of the three it is first.
   */
  export const NameSchema = z.enum([
    "attachedFolderChanges",
    "attachments",
    "browserStatus",
    "intent",
    "skillChanges",
    "skillMentions",
    "maxSteps",
    "paneTabs",
    "projectChanges",
    "projectContext",
    "unknown",
  ]);

  export type Name = z.output<typeof NameSchema>;

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

  /**
   * What the task's pane already has open, at the start of a turn.
   *
   * Attached per turn rather than written into the session context, which is
   * rebuilt at most hourly: what is on screen changes several times inside one
   * turn, and standing context that lags an hour would have the agent reasoning
   * about a pane the user closed long ago.
   */
  const PaneTabsDataPartSchema = z.object({
    tabs: z.array(TaskPane.TabSchema),
  });

  export type PaneTabsDataPart = z.output<typeof PaneTabsDataPartSchema>;

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

  /**
   * What a data part becomes when it cannot be read as the type it claims.
   *
   * Two ways in, both of them a task outliving a schema: a type this build has
   * no schema for at all (`data-gitCommit` is still sitting in tasks from before
   * git-based file versioning was removed), and a payload written before a field
   * the schema now describes. The part is kept rather than dropped, because
   * `attachments` is a data part too and silently losing a turn's uploads is a
   * worse answer than a row saying something could not be read.
   *
   * Nothing writes one. It exists only on the way out of the store.
   */
  const UnknownDataPartSchema = z.object({
    originalType: z.string(),
    reason: z.string(),
  });

  export type UnknownDataPart = z.output<typeof UnknownDataPartSchema>;

  // oxlint-disable-next-line no-unused-vars
  const DataPartsSchema = z.object({
    [NameSchema.enum.attachedFolderChanges]:
      AttachedFolderChangesDataPartSchema,
    [NameSchema.enum.attachments]: FileAttachmentsDataPartSchema,
    [NameSchema.enum.browserStatus]: BrowserStatusDataPartSchema,
    [NameSchema.enum.intent]: IntentDataPartSchema,
    [NameSchema.enum.maxSteps]: MaxStepsDataPartSchema,
    [NameSchema.enum.paneTabs]: PaneTabsDataPartSchema,
    [NameSchema.enum.projectChanges]: ProjectChangesDataPartSchema,
    [NameSchema.enum.projectContext]: ProjectContextDataPartSchema,
    [NameSchema.enum.skillChanges]: SkillChangesDataPartSchema,
    [NameSchema.enum.skillMentions]: SkillMentionsDataPartSchema,
    [NameSchema.enum.unknown]: UnknownDataPartSchema,
  });
  export type DataParts = z.output<typeof DataPartsSchema>;

  /**
   * Reads a stored payload as the type its part claims, or says why it cannot.
   *
   * This is the only place a persisted data payload meets the schema that
   * describes it. Everything downstream is handed the parsed value, so a field
   * added since the part was written arrives with the default the schema already
   * gives it rather than as undefined behind a type that promises otherwise.
   */
  export function parseDataPayload(
    name: string,
    data: unknown,
  ): { ok: false; reason: string } | { ok: true; value: unknown } {
    // `unknown` is a name like any other here, and deliberately so: parts are
    // coerced on the way out of the store and again by the rpc output schema, so
    // an already-wrapped part meets this twice. Excluding it would re-wrap the
    // wrapper on the second pass and lose the type it was reporting.
    const parsed = NameSchema.safeParse(name);
    if (!parsed.success) {
      return { ok: false, reason: `no schema for data-${name}` };
    }

    const result = DataPartsSchema.shape[parsed.data].safeParse(data);

    return result.success
      ? { ok: true, value: result.data }
      : { ok: false, reason: z.prettifyError(result.error) };
  }
}
