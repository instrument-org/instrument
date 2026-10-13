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
  // Held tabs saved before a target id was the tab's id alone name it
  // `window/<tab>`.
  id: z
    .string()
    .transform((id) => id.replace(/^window\//, ""))
    .pipe(BrowserTargetIdSchema),
  /**
   * Whether the tab is in the chat's tabs in the window. A page an agent asks
   * for with no address is made with no tab, and gets one as it first goes
   * somewhere; one that never does is closed when its session's turn ends,
   * so looking around the browser leaves no blank tab behind.
   */
  inWindow: z.boolean().default(true),
  openedBy: z.enum(["handed", "task"]),
});

export type HeldTab = z.output<typeof HeldTabSchema>;

/** A session that ran into what a card asks about, the chat's own or one of its tasks'. */
const AskerSchema = z.object({
  /**
   * The tool call whose command or file operation raised it before running,
   * by its part's id, so the card draws under that call; absent for one a
   * running command ran into.
   */
  partId: StoreId.PartSchema.optional(),
  sessionId: StoreId.SessionSchema,
});

/**
 * A place or app the agent ran into that the person has not answered for
 * yet: a folder that asks first, or an app it may not use. Shown as a card at
 * the foot of the chat until the person answers, which wakes every session
 * that asked.
 */
export const PermissionAskSchema = z.object({
  askedAt: z.coerce.date(),
  /**
   * Every session waiting on the answer, the first to ask first. A session
   * that runs into the same thing while the card is up joins it, and one the
   * person stops leaves it; the card goes when none is left.
   */
  askers: z.array(AskerSchema),
  id: z.string(),
  kind: z.enum(["app", "folder"]),
  /** The folder's path, or the app's name as the agent named it. */
  target: z.string(),
});

export type PermissionAsk = z.output<typeof PermissionAskSchema>;

/**
 * An ask as stored, which may still name its one asker at the top level the
 * way cards were written before a card held every session that asked.
 */
const StoredPermissionAskSchema = z.union([
  PermissionAskSchema,
  PermissionAskSchema.omit({ askers: true })
    .extend(AskerSchema.shape)
    .transform(({ partId, sessionId, ...ask }) => ({
      ...ask,
      askers: [{ ...(partId && { partId }), sessionId }],
    })),
]);

// Where the user left off in a chat. Read on open, and across chats only by
// the chat list for its open asks, through `openAsks` -- which is what
// separates it from the settings around it, and why it is one nested key
// rather than a flat spread.
export const StoredChatStateSchema = z
  .object({
    // The apps whose guide this chat has read, so `app request` hands the
    // guide over once and then gets out of the way.
    appGuidesRead: z.array(z.string()).optional(),
    browserTabs: z.array(HeldTabSchema).default([]),
    // What the agent is waiting on the person to allow, oldest first. One
    // that will not parse costs the chat its open asks alone.
    permissionAsks: z
      .array(StoredPermissionAskSchema)
      .optional()
      .catch(undefined),
  })
  .default(() => ({ browserTabs: [] }));

export type ChatState = z.output<typeof StoredChatStateSchema>;
