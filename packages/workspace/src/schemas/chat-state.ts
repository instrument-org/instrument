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

// Where the user left off in a chat. Read on open, never queried across
// chats -- which is what separates it from the settings around it, and why it
// is one nested key rather than a flat spread.
export const StoredChatStateSchema = z
  .object({
    // The apps whose guide this chat has read, so `app request` hands the
    // guide over once and then gets out of the way.
    appGuidesRead: z.array(z.string()).optional(),
    browserTabs: z.array(HeldTabSchema).default([]),
  })
  .default(() => ({ browserTabs: [] }));

export type ChatState = z.output<typeof StoredChatStateSchema>;
