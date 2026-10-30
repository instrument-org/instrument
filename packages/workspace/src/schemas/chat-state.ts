import { z } from "zod";

import { BrowserTargetIdSchema } from "../types";
import {
  AskerSchema,
  CardDecisionSchema,
  PermissionCardSchema,
} from "./permission-card";
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
 * An open permission card as a reader on this device draws it: the card,
 * less the sessions a Stop took off it, and where it can be answered.
 */
const PermissionAskSchema = PermissionCardSchema.omit({
  closedAt: true,
}).extend({
  /**
   * The answer the card has, once one is given: the one its computer took,
   * or else the first in log order, which its computer takes next. `by`
   * names the computer that gave it, and `taken` says whether the card's
   * computer has acted on it.
   */
  answered: z
    .object({
      by: z.string(),
      decision: CardDecisionSchema,
      taken: z.boolean(),
    })
    .optional(),
  /**
   * Whether this device can answer it: the card's computer always, and
   * another device while it is open, unanswered and not a tab
   * (`answerableElsewhere`).
   */
  answerable: z.boolean(),
  /** The name of the computer the card belongs to. */
  computer: z.string(),
  /** Whether the card belongs to this computer, which alone acts on it. */
  here: z.boolean(),
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
