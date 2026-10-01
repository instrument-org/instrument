import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { z } from "zod";

import { BrowserTargetIdSchema } from "../types";
import { FolderAttachment } from "./folder-attachment";
import { StoreId } from "./store-id";
import { TaskPane } from "./task-pane";

/**
 * A tab of the window a task holds: one the conversation handed it, which is
 * the user's and outlives the task, or one the task opened itself, which stays
 * in the chat after the task is done.
 */
const HeldTabSchema = z.object({
  id: BrowserTargetIdSchema,
  openedBy: z.enum(["handed", "task"]),
});

export type HeldTab = z.output<typeof HeldTabSchema>;

// Where the user left off in a task: the draft they were typing, what the pane
// has open, the model they picked, the folders attached. Per-task and read on
// open, never queried across tasks -- which is what separates it from the
// settings around it, and why it is one nested key rather than a flat spread.
//
// `projectFolderName` names the folder under `projects/` belonging to the
// project this task is in, kept here beside the attached folders because every
// caller that builds the filesystem layout already reads this state and needs
// both. Denormalized rather than resolved from the project id per call, because
// the file tools build a layout on every read and write and every asset request,
// synchronously, while resolving an id means reading every project's settings to
// find the match.
//
// The folder name and not its absolute path, so that nothing here is true only
// of the machine that wrote it: this file ships inside an exported task, and a
// host path from someone else's disk names nothing on the machine that imports
// it. `syncTaskProjectRoot` owns keeping it current; nothing else should write
// it.
export const StoredTaskStateSchema = z
  .object({
    // The apps whose guide this task has read, so `app request` hands the
    // guide over once and then gets out of the way.
    appGuidesRead: z.array(z.string()).optional(),
    attachedFolders: z.record(z.string(), FolderAttachment.Schema).optional(),
    browserTabs: z.array(HeldTabSchema).optional(),
    browserTargetId: BrowserTargetIdSchema.optional(),
    /**
     * The orchestrator's topics, in the order they were made: the tags a
     * chat carries, many chats to many topics. Which chats carry one is
     * on each chat's own session record (`Session.topics`), so retiring a
     * topic touches no chat and a filter is a predicate over the list.
     */
    topics: z
      .array(
        z.object({
          /** The agent's line about what goes here, for later. */
          about: z.string().optional(),
          /** The tint its mark is drawn on, as a hex string. */
          color: z.string().optional(),
          createdAt: z.number(),
          /** What stands for it: one emoji, chosen when it was made. */
          emoji: z.string().optional(),
          id: z.string(),
          name: z.string(),
          /** Out of the menus, with the chats that carry it left alone. */
          retired: z.boolean().optional(),
        }),
      )
      .optional(),
    /**
     * The newest settled message the user has seen in each chat, by session
     * id. Window state, kept off the session record; unread is every non-user
     * message after it.
     */
    chatSeen: z.record(z.string(), StoreId.MessageSchema).optional(),
    // A pane this build cannot read costs the pane, not the folder list beside
    // it, which the record's silent catch would otherwise write away.
    pane: TaskPane.Schema.optional().catch(undefined),
    // The project's folders, path to access, as this task last saw them. What
    // makes a task's own edit to an inherited folder survive the next message:
    // a folder whose live access still matches what is recorded here has not
    // been touched in the project since, so the task's version is the newer
    // edit and stands. A path recorded here but no longer attached is one the
    // task detached, which is the same rule read the other way.
    //
    // Not in the RPC shape below, for the reason `projectFolderName` is not: it
    // decides what the agent may reach, so it is not a client's to set.
    projectFolderBaseline: z
      .record(z.string(), FolderAttachment.AccessSchema)
      .optional(),
    projectFolderName: z.string().optional(),
    promptDraft: z.string().optional(),
    selectedModelURI: z.string().optional(),
    /**
     * The one-conversation layout's map of the chat each task was filed
     * from, by task id, under the name that layout gave it. Nothing writes
     * it; it is kept through a write so `migrate-to-chats` can finish moving
     * a task whose chat is still to be made.
     */
    taskThreads: z.record(z.string(), StoreId.SessionSchema).optional(),
    /**
     * The chat each app was asked for in, by slug: what sends the news of
     * a sign-in, a key, or a decline back to the chat that asked for it.
     */
    appChats: z.record(z.string(), StoreId.SessionSchema).optional(),
  })
  .default(() => ({}));

// The RPC-facing shape. Deliberately without `projectFolderName`: the renderer
// has no use for it, and it selects the directory of a writable agent mount, so
// it is not something a client should be able to set.
export const TaskStateSchema = z.object({
  attachedFolders: z.record(z.string(), FolderAttachment.Schema).optional(),
  /**
   * The window's tabs a task drives, first one first: tabs the conversation
   * handed it and tabs it opened itself. `agent-browser` connects to them.
   */
  browserTabs: z.array(HeldTabSchema).optional(),
  /**
   * On the window's own record, the tab its user has on screen, which the
   * conversation's own `agent-browser` drives.
   */
  browserTargetId: BrowserTargetIdSchema.optional(),
  pane: TaskPane.Schema.optional(),
  promptDraft: z.string().optional(),
  selectedModelURI: AIGatewayModelURI.Schema.optional(),
});

export type TaskState = z.output<typeof StoredTaskStateSchema>;

/**
 * Brings the stored state up to what the schema above expects.
 *
 * A task's state is read in places that never open its database, and a parse
 * failure is silent -- the record answers with empty state, which the next write
 * would then persist over the folders it failed to read. So this cannot wait for
 * the database to be opened; see store-migrations.ts for that half and for the
 * rules both halves follow.
 *
 * Applied on read and saved by the next write rather than rewritten here, since
 * every caller either writes back or does not care.
 */
export function migrateTaskState(state: unknown): unknown {
  if (!isRecord(state)) {
    return state;
  }
  return migrateAttachedFolders(migrateChatKeys(state));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function migrateAttachedFolders(state: Record<string, unknown>) {
  if (!isRecord(state.attachedFolders)) {
    return state;
  }

  // Folders were stored under `name`, which was the mount name all along.
  const folders = Object.entries(state.attachedFolders).map(
    ([key, folder]): [string, unknown] => {
      if (!isRecord(folder) || !("name" in folder) || "mountName" in folder) {
        return [key, folder];
      }
      const { name, ...rest } = folder;
      return [key, { ...rest, mountName: name }];
    },
  );

  return { ...state, attachedFolders: Object.fromEntries(folders) };
}

// A conversation in the 2.0 window was a thread before it was a chat, and the
// window's state named its maps for that.
function migrateChatKeys(state: Record<string, unknown>) {
  const { appThreads, threadSeen, ...rest } = state;
  return {
    ...rest,
    ...(appThreads === undefined || rest.appChats !== undefined
      ? {}
      : { appChats: appThreads }),
    ...(threadSeen === undefined || rest.chatSeen !== undefined
      ? {}
      : { chatSeen: threadSeen }),
  };
}
