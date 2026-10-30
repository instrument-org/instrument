import { z } from "zod";

import { DeviceIdSchema } from "./device-id";
import { StoreId } from "./store-id";

/**
 * A permission card and the answers to it as the chat's records hold them,
 * apart from `chat-state.ts` so the records can name them without reaching
 * what reads them.
 */

/** A session that asked what a card asks, the chat's own or one of its tasks'. */
export const AskerSchema = z.object({
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
 * Which of a card's askers a Stop took off it: the session, and when it
 * asked as the card's computer wrote it. The pair names one asker entry, so
 * a session that asks again later is a new entry no earlier Stop names, and
 * no clock of another device's is ever compared with the card's.
 */
export const AskerEntrySchema = z.object({
  at: z.coerce.date(),
  sessionId: StoreId.SessionSchema,
});

/** A session on a permission card, with when it asked. */
const CardAskerSchema = AskerSchema.extend({
  /** When the session asked, by the card's computer's clock: with the session, the entry a Stop names. */
  at: z.coerce.date(),
});

/** Who gave an answer, and when by their own clock: the answer's identity, never compared across devices. */
const AnswerRefSchema = z.object({
  at: z.coerce.date(),
  device: DeviceIdSchema,
});

/** A card's answer: allowed in this chat, allowed always, or not now. */
export const CardDecisionSchema = z.enum(["allowed", "always", "declined"]);

export type CardDecision = z.output<typeof CardDecisionSchema>;

/**
 * A folder, app or tab the agent asked the person for, as the computer the
 * card belongs to writes it into the chat's own session log (a `card`
 * record), whole each time it changes, the newest standing. Every device
 * reads it, so the card shows wherever the chat is open and any of them can
 * answer it (an `answer` record); only the computer it belongs to writes
 * it, since what it grants is that computer's. Up until it closes, which
 * wakes every session that asked.
 */
export const PermissionCardSchema = z.object({
  /**
   * The yes the person gave a folder macOS then refused, kept while the
   * card offers the system's own ways in, so the retry that gets in wakes
   * the askers with it.
   */
  allowed: z.enum(["allowed", "always"]).optional(),
  /**
   * The answer the card's computer took, from whichever device gave it: the
   * first `answer` record in log order. A card that took one and stays up
   * (macOS asking or refusing, Windows blocking) waits on that computer's
   * screen alone.
   */
  answer: AnswerRefSchema.extend({ decision: CardDecisionSchema }).optional(),
  /**
   * The last answer the card's computer took and could not carry out, with
   * why, so the card says so and can be answered again.
   */
  failed: AnswerRefSchema.extend({
    decision: CardDecisionSchema,
    message: z.string(),
  }).optional(),
  /** Answers already taken and given up on (a failed one), which no later pass takes again. */
  spent: z.array(AnswerRefSchema).optional(),
  askedAt: z.coerce.date(),
  /**
   * Every session waiting on the answer, the first to ask first. A session
   * that asks for the same thing while the card is up joins it, and one the
   * person stops leaves it; the card closes when none is left.
   */
  askers: z.array(CardAskerSchema),
  /** When the card closed: answered and settled, or left by every asker. */
  closedAt: z.coerce.date().optional(),
  /** The computer the card belongs to, whose grants it is about. */
  device: DeviceIdSchema,
  id: z.string(),
  /** A folder, a Mac app, or a tab of the person's outside the chat, which `Move tab here` moves into it. */
  kind: z.enum(["app", "folder", "tab"]),
  /** A tab's page as it was when the agent asked, for the card and the note that answers it. */
  page: z.object({ title: z.string(), url: z.string() }).optional(),
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
  /** The folder's absolute path, the app's name, or the tab's id. */
  target: z.string(),
});

export type PermissionCard = z.output<typeof PermissionCardSchema>;

/**
 * What an `answer` record says: a decision, or `stopped`, which is none: a
 * Stop on that device that takes the asker entries it names off the card,
 * which the card's computer then writes into the card.
 */
export const CardAnswerDecisionSchema = z.enum([
  ...CardDecisionSchema.options,
  "stopped",
]);

/**
 * An answer to a permission card, as any device appends it to its own log
 * of the chat's session (an `answer` record), by the device whose log holds
 * it. The first decision in log order wins, and the card's computer takes
 * it; later ones find the card answered.
 */
export interface CardAnswer {
  at: Date;
  card: string;
  decision: z.output<typeof CardAnswerDecisionSchema>;
  device: z.output<typeof DeviceIdSchema>;
  /** On a Stop, the asker entries it took off the card, as the card it saw had them. */
  askers?: z.output<typeof AskerEntrySchema>[];
}
