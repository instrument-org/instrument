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

/** A session that asked what a card asks, the chat's own or one of its tasks'. */
const AskerSchema = z.object({
  /** The call that asked, by its part's id. */
  partId: StoreId.PartSchema.optional(),
  /** What the session said it needs the folder or app for, for the card. */
  reason: z.string().optional(),
  sessionId: StoreId.SessionSchema,
});

/**
 * A folder or app the agent asked for with `ask_permission` that the person
 * has not answered for yet. Shown as a card until the person answers, which
 * wakes every session that asked.
 */
const PermissionAskSchema = z.object({
  /**
   * The yes the person gave a folder macOS then refused, kept while the
   * card offers the system's own ways in, so the retry that gets in wakes
   * the askers with it.
   */
  allowed: z.enum(["allowed", "always"]).optional(),
  askedAt: z.coerce.date(),
  /**
   * Every session waiting on the answer, the first to ask first. A session
   * that asks for the same thing while the card is up joins it, and one the
   * person stops leaves it; the card goes when none is left.
   */
  askers: z.array(AskerSchema),
  id: z.string(),
  kind: z.enum(["app", "folder"]),
  /**
   * `macos-refused` once the person allowed a folder and macOS kept the app
   * out of it: the card offers the Mac's folder panel and System Settings
   * until a retry gets in or the person declines.
   */
  status: z.enum(["macos-refused", "open"]).default("open"),
  /** The folder's absolute path, or the app's name. */
  target: z.string(),
});

export type PermissionAsk = z.output<typeof PermissionAskSchema>;

/**
 * A question the chat's agent put to the person with `choose`, drawn as the
 * card under that call until they answer it, which wakes the chat with the
 * answer. Its one asker is the chat's own session, by the call's part.
 */
const QuestionAskSchema = z.object({
  askedAt: z.coerce.date(),
  askers: z.array(AskerSchema),
  id: z.string(),
  kind: z.literal("question"),
  /** The message holding the call, where its answer is written too. */
  messageId: StoreId.MessageSchema,
  /** The question as the agent asked it. */
  question: z.string(),
});

export type QuestionAsk = z.output<typeof QuestionAskSchema>;

/** Anything a chat is waiting on the person to answer on a card. */
export const AskSchema = z.discriminatedUnion("kind", [
  PermissionAskSchema,
  QuestionAskSchema,
]);

export type Ask = z.output<typeof AskSchema>;

// Where this device left off in a chat, in its own `state.<device>.json`.
// Read on open, and across chats only by the chat list for its open cards,
// through `openAsks`.
export const StoredChatStateSchema = z.object({
  // The apps whose guide this chat was handed, so `instrument app request`
  // hands the guide over once and then gets out of the way.
  appGuidesShown: z.array(z.string()).catch([]).default([]),
  browserTabs: z.array(HeldTabSchema).default([]),
  // What the agent is waiting on the person to answer, oldest first. One
  // that will not parse costs the chat its open cards alone.
  waitingOn: z.array(AskSchema).catch([]).default([]),
});

export type ChatState = z.output<typeof StoredChatStateSchema>;
