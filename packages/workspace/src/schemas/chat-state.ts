import { AIGatewayModelURI } from "@instrument-org/ai-gateway";
import { z } from "zod";

import { BrowserTargetIdSchema } from "../types";
import { FolderAttachment } from "./folder-attachment";
import { StoreId } from "./store-id";

/**
 * A tab of the window a chat's agent holds: one the conversation handed a
 * task, which is the user's and outlives the task, or one the agent opened
 * itself, which stays in the chat after the task is done.
 */
const HeldTabSchema = z.object({
  id: BrowserTargetIdSchema,
  openedBy: z.enum(["handed", "task"]),
  /**
   * The task that drives it, by its session; absent for a tab the chat's
   * own conversation drives.
   */
  sessionId: StoreId.SessionSchema.optional(),
});

export type HeldTab = z.output<typeof HeldTabSchema>;

// Where the user left off in a task: the model they picked, the folders
// attached. Per-task and read on open, never queried across tasks -- which is
// what separates it from the settings around it, and why it is one nested key
// rather than a flat spread.
export const StoredChatStateSchema = z
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
export const ChatStateSchema = z.object({
  attachedFolders: z.record(z.string(), FolderAttachment.Schema).optional(),
  /**
   * The window's tabs the chat's agents drive, first one first: tabs the
   * conversation handed a task and tabs each opened itself, each with the
   * session that drives it. `agent-browser` connects to its session's.
   */
  browserTabs: z.array(HeldTabSchema).default([]),
  // A stored URI this build cannot parse (a provider since renamed or
  // removed) answers as no pick, so the chat opens on the default model
  // rather than failing to open.
  selectedModelURI: AIGatewayModelURI.Schema.optional().catch(undefined),
});

export type ChatState = z.output<typeof StoredChatStateSchema>;

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
export function migrateChatState(state: unknown): unknown {
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
