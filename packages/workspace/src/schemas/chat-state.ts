import { z } from "zod";

import { BrowserTargetIdSchema } from "../types";
import { StoreId } from "./store-id";

/** A tab's id as an earlier build saved it, read as the tab's id now: the same ULID under `tab_`. */
function tabIdOfEarlierBuilds(id: string) {
  return id.replace(/^window\//, "").replace(/^ses_/, "tab_");
}

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
  // Held tabs earlier builds saved name it `window/<tab>`, or by a `ses_`
  // id from before tabs had ids of their own.
  id: z.string().transform(tabIdOfEarlierBuilds).pipe(BrowserTargetIdSchema),
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

/**
 * How many tabs a chat may keep out of the user's sight that its agents
 * opened themselves, across its conversation and its tasks. Tabs handed to
 * them, and the user's own, never count and are never closed for it.
 */
export const CHAT_HIDDEN_TAB_CAP = 20;

/**
 * A tab an agent opened that the app closed on its own, waiting for the
 * session that drove it to be told: the next browser note it gets says so,
 * and takes it from here.
 */
const ClosedTabSchema = z.object({
  /** The session that drove it, as `HeldTab.driver`. */
  driver: StoreId.SessionSchema.optional(),
  id: z.string().transform(tabIdOfEarlierBuilds),
  /** Why: the chat had more tabs it opened itself out of sight than it may keep. */
  reason: z.literal("tabCap"),
  title: z.string().optional(),
  url: z.string(),
});

export type ClosedTab = z.output<typeof ClosedTabSchema>;

/** A session that asked what a card asks, the chat's own or one of its tasks'. */
const AskerSchema = z.object({
  /** The call that asked, by its part's id. */
  partId: StoreId.PartSchema.optional(),
  /** What the session said it needs the folder or app for, for the card. */
  reason: z.string().optional(),
  sessionId: StoreId.SessionSchema,
  /**
   * A command of the session's waits on what the card is about and carries
   * on by itself once it settles, waking the session as any command that
   * outlived its turn does, so the card's answer wakes it no more.
   */
  waits: z.literal(true).optional(),
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
   * The programs Windows' ransomware protection kept out of the folder, by
   * their paths, which the card's Allow lets through: on a
   * `windows-blocked` card only.
   */
  programs: z.array(z.string()).optional(),
  /**
   * What the card waits on once the person's yes is given: `open`, their
   * answer; `macos-asking`, their answer to macOS's own prompt, which the
   * look inside waits on; `macos-refused`, macOS keeping the app out, where
   * the card offers the Mac's folder panel (a folder) and System Settings
   * until a retry gets in or the person declines; `macos-private`, a folder
   * only its own app may open, which the card says and offers no way into;
   * `windows-blocked`, Windows' ransomware protection keeping the app's
   * programs from changing the folder, where the card lets them through
   * with an administrator's yes or opens Windows Security.
   */
  status: z
    .enum([
      "macos-asking",
      "macos-private",
      "macos-refused",
      "open",
      "windows-blocked",
    ])
    .default("open"),
  /** The folder's absolute path, or the app's name. */
  target: z.string(),
});

export type PermissionAsk = z.output<typeof PermissionAskSchema>;

/**
 * A question the chat's agent put to the person with `choose`, drawn as the
 * card under that call until they answer it, which wakes the chat with the
 * answer. Its one asker is the chat's own session, by the call's part, whose
 * id is the question's. Read from the chat's records (`openQuestionsIn`),
 * never kept in a state file.
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
// through `openPermissionAsks`.
export const StoredChatStateSchema = z.object({
  browserTabs: z.array(HeldTabSchema).default([]),
  closedTabs: z.array(ClosedTabSchema).catch([]).default([]),
  // The folders and apps the agent is waiting on the person to allow,
  // oldest first: this computer's to grant. One that will not parse costs
  // the chat its open cards alone.
  waitingOn: z.array(PermissionAskSchema).catch([]).default([]),
});

export type ChatState = z.output<typeof StoredChatStateSchema>;
