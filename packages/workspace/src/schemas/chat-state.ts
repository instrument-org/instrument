import { z } from "zod";

import { BrowserTargetIdSchema } from "../types";
import { StoreId } from "./store-id";

/**
 * A tab of the window one of the chat's sessions drives: one the
 * conversation handed a task, which is the user's and outlives the task, or
 * one an agent opened itself.
 */
const HeldTabSchema = z.object({
  /**
   * The task that drives it, by its session; absent for a tab the chat's own
   * conversation drives. One driver per tab, and a task's tabs go back to the
   * chat when it finishes.
   */
  driver: StoreId.SessionSchema.optional(),
  id: BrowserTargetIdSchema,
  openedBy: z.enum(["handed", "task"]),
});

export type HeldTab = z.output<typeof HeldTabSchema>;

/**
 * A place or app the agent ran into that the person has not answered for
 * yet: a folder that asks first, or an app it may not use. Shown as a card at
 * the foot of the chat until the person answers, which wakes the session
 * that asked.
 */
export const PermissionAskSchema = z.object({
  askedAt: z.coerce.date(),
  id: z.string(),
  kind: z.enum(["app", "folder"]),
  /**
   * The tool call whose command or file operation raised it before running,
   * by its part's id, so the card draws under that call; absent for one a
   * running command ran into.
   */
  partId: StoreId.PartSchema.optional(),
  /** The session that ran into it, the chat's own or one of its tasks'. */
  sessionId: StoreId.SessionSchema,
  /** The folder's path, or the app's name as the agent named it. */
  target: z.string(),
});

export type PermissionAsk = z.output<typeof PermissionAskSchema>;

// Where the user left off in a chat. Read on open, never queried across
// chats -- which is what separates it from the settings around it, and why it
// is one nested key rather than a flat spread.
export const StoredChatStateSchema = z
  .object({
    // The apps whose guide this chat has read, so `app request` hands the
    // guide over once and then gets out of the way.
    appGuidesRead: z.array(z.string()).optional(),
    browserTabs: z.array(HeldTabSchema).default([]),
    // What the agent is waiting on the person to allow, oldest first. One
    // that will not parse costs the chat its open asks alone.
    permissionAsks: z.array(PermissionAskSchema).optional().catch(undefined),
  })
  .default(() => ({ browserTabs: [] }));

export type ChatState = z.output<typeof StoredChatStateSchema>;
