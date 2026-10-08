import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { z } from "zod";

import { BrowserTargetIdSchema } from "../types";
import { FolderAttachment } from "./folder-attachment";

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

// Where the user left off in a task: the model they picked, the folders
// attached. Per-task and read on open, never queried across tasks -- which is
// what separates it from the settings around it, and why it is one nested key
// rather than a flat spread.
export const StoredTaskStateSchema = z
  .object({
    // The apps whose guide this task has read, so `app request` hands the
    // guide over once and then gets out of the way.
    appGuidesRead: z.array(z.string()).optional(),
    attachedFolders: z.record(z.string(), FolderAttachment.Schema).optional(),
    browserTabs: z.array(HeldTabSchema).default([]),
    selectedModelURI: z.string().optional(),
  })
  .default(() => ({ browserTabs: [] }));

// The RPC-facing shape.
export const TaskStateSchema = z.object({
  attachedFolders: z.record(z.string(), FolderAttachment.Schema).optional(),
  /**
   * The window's tabs a task drives, first one first: tabs the conversation
   * handed it and tabs it opened itself. `agent-browser` connects to them.
   */
  browserTabs: z.array(HeldTabSchema).default([]),
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
  return migrateAttachedFolders(state);
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
