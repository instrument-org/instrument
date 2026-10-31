import { z } from "zod";

import { BrowserTargetIdSchema } from "../types";
import { AskerSchema, PermissionDecisionSchema, SystemWaitSchema } from "./ask";
import { DeviceIdSchema } from "./device-id";
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

/**
 * A permission ask still up, as a reader on this device draws it on its
 * card, from where the ask stands (`askStates`).
 */
const PermissionAskSchema = z.object({
  /** The yes the person gave, kept while the ask waits on the system. */
  allowed: z.enum(["allowed", "always"]).optional(),
  /**
   * The answer it has: the one its computer took, or else the first fresh
   * one given, which its computer takes next. `by` names the computer that
   * gave it, and `taken` says whether the ask's computer has taken it.
   */
  answered: z
    .object({
      by: z.string(),
      decision: PermissionDecisionSchema,
      taken: z.boolean(),
    })
    .optional(),
  /**
   * Whether this device can answer it: the ask's computer always, and
   * another device while it is open, unanswered and not a tab.
   */
  answerable: z.boolean(),
  askedAt: z.coerce.date(),
  /** The sessions still on it, each with when it asked. */
  askers: z.array(AskerSchema.extend({ at: z.coerce.date() })),
  /**
   * An answer given while the ask's computer was away, which it never acts
   * on when it comes back, so the card asks again: who gave it, and what.
   */
  away: z
    .object({ by: z.string(), decision: PermissionDecisionSchema })
    .optional(),
  /** The name of the computer the ask belongs to. */
  computer: z.string(),
  device: DeviceIdSchema,
  /** The last answer taken that could not be carried out, and why. */
  failed: z
    .object({ decision: PermissionDecisionSchema, message: z.string() })
    .optional(),
  /** Whether the ask belongs to this computer, which alone acts on it. */
  here: z.boolean(),
  id: z.string(),
  /** A folder, a Mac app, or a tab of the person's outside the chat. */
  kind: z.enum(["app", "folder", "tab"]),
  page: z.object({ title: z.string(), url: z.string() }).optional(),
  /** The programs Windows' ransomware protection blocked, on `windows-blocked`. */
  programs: z.array(z.string()).optional(),
  /** What it waits on: the person's answer (`open`), or the system's. */
  status: z.enum(["open", ...SystemWaitSchema.options]),
  /** The folder's absolute path, the app's name, or the tab's id. */
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
  /** The card's line: its question, or its first one and how many more. */
  question: z.string(),
  /** Every question on the card as the agent asked it, in order. */
  questions: z.array(z.string()),
});

export type QuestionAsk = z.output<typeof QuestionAskSchema>;

/** Anything a chat is waiting on the person to answer on a card. */
export const AskSchema = z.discriminatedUnion("kind", [
  PermissionAskSchema,
  QuestionAskSchema,
]);

export type Ask = z.output<typeof AskSchema>;

// Where this device left off in a chat, in its own `state.<device>.json`.
// Each field that will not parse costs the chat that field alone.
export const StoredChatStateSchema = z.object({
  browserTabs: z.array(HeldTabSchema).catch([]).default([]),
  closedTabs: z.array(ClosedTabSchema).catch([]).default([]),
});

export type ChatState = z.output<typeof StoredChatStateSchema>;
