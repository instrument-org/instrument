import { z } from "zod";

import { DeviceIdSchema } from "./device-id";
import { SessionMessageDataPart } from "./session/message-data-part";
import { StoreId } from "./store-id";

/**
 * What a chat waits on the person for, as its records hold it: an `ask`
 * record, written whole by the computer the ask belongs to, and `answer`
 * records from any device. Apart from `chat-state.ts` so the records can
 * name them without reaching what reads them.
 */

/** A session that asked, the chat's own or one of its tasks'. */
export const AskerSchema = z.object({
  /** The call that asked, by its part's id. */
  partId: StoreId.PartSchema.optional(),
  /** What the session said it needs the folder or app for, for the card. */
  reason: z.string().optional(),
  sessionId: StoreId.SessionSchema,
  /**
   * A command of the session's waits on what the ask is about and carries
   * on by itself once it settles, waking the session as any command that
   * outlived its turn does, so the answer wakes it no more.
   */
  waits: z.literal(true).optional(),
});

/**
 * Which of an ask's askers a Stop took off it: the session, and when it
 * asked as the ask's computer wrote it. The pair names one asker entry, so
 * a session that asks again later is a new entry no earlier Stop names, and
 * no clock of another device's is ever compared with the ask's.
 */
const AskerEntrySchema = z.object({
  at: z.coerce.date(),
  sessionId: StoreId.SessionSchema,
});

/** A session on an ask, with when it asked by the ask's computer's clock. */
const AskRecordAskerSchema = AskerSchema.extend({ at: z.coerce.date() });

export type AskRecordAsker = z.output<typeof AskRecordAskerSchema>;

/** Who gave an answer, and when by their own clock: the answer's identity, never compared across devices. */
const AnswerRefSchema = z.object({
  at: z.coerce.date(),
  device: DeviceIdSchema,
});

export type AnswerRef = z.output<typeof AnswerRefSchema>;

/** A permission's answer: allowed in this chat, allowed always, or not now. */
export const PermissionDecisionSchema = z.enum([
  "allowed",
  "always",
  "declined",
]);

export type PermissionDecision = z.output<typeof PermissionDecisionSchema>;

/** What an answer gives, by the kind of ask it answers. */
const GivenSchema = z.discriminatedUnion("kind", [
  z.object({
    decision: PermissionDecisionSchema,
    kind: z.literal("permission"),
  }),
  z.object({
    answer: SessionMessageDataPart.QuestionCardAnswerSchema,
    kind: z.literal("question"),
  }),
  /** Not now to a sign-in: signing in happens on the ask's computer alone. */
  z.object({ decision: z.literal("declined"), kind: z.literal("sign-in") }),
]);

/**
 * What an `answer` record says: an answer, or a Stop on that device, which
 * takes the asker entries it names off the ask and answers nothing.
 */
export const AnswerGivenSchema = z.discriminatedUnion("kind", [
  ...GivenSchema.options,
  z.object({
    askers: z.array(AskerEntrySchema),
    kind: z.literal("stopped"),
  }),
]);

export type AnswerGiven = z.output<typeof AnswerGivenSchema>;

/** An `answer` record as the fold reads it, by the device whose log holds it. */
export type AskAnswer = AnswerRef & { ask: string; given: AnswerGiven };

/** An answer the ask's computer took, from whichever device gave it. */
const TakenSchema = AnswerRefSchema.and(GivenSchema);

export type Taken = z.output<typeof TakenSchema>;

/**
 * What a permission's yes waits on once given, on the ask's computer:
 * `macos-asking`, the person's answer to macOS's own prompt, which the look
 * inside waits on; `macos-refused`, macOS keeping the app out, where the
 * card offers the Mac's folder panel (a folder) and System Settings until a
 * retry gets in or the person declines; `macos-private`, a folder only its
 * own app may open, which the card says and offers no way into;
 * `windows-blocked`, Windows' ransomware protection keeping the app's
 * programs from changing the folder, where the card lets them through with
 * an administrator's yes or opens Windows Security.
 */
export const SystemWaitSchema = z.enum([
  "macos-asking",
  "macos-private",
  "macos-refused",
  "windows-blocked",
]);

export type SystemWait = z.output<typeof SystemWaitSchema>;

/** How an ask ended, which its askers are woken with. */
const OutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    data: SessionMessageDataPart.PermissionAnswerDataPartSchema,
    kind: z.literal("permission"),
  }),
  z.object({
    answer: SessionMessageDataPart.QuestionCardAnswerSchema,
    kind: z.literal("question"),
  }),
  /** Every app on a sign-in settled, as each now stands. */
  z.object({
    apps: SessionMessageDataPart.SignInProgressSchema,
    kind: z.literal("sign-in"),
  }),
  /** Every asker was stopped: nobody is woken. */
  z.object({ kind: z.literal("left") }),
]);

export type Outcome = z.output<typeof OutcomeSchema>;

/**
 * Where an ask stands, as its computer last wrote it: `open` for an answer;
 * `taken`, the answer it took and is carrying out; `waiting` on the system
 * with the yes given (from an answer, or the person's own rules when the
 * ask was raised for the system alone); `closed`, with how it ended and
 * whether its askers were woken with it.
 */
const StageSchema = z.discriminatedUnion("is", [
  z.object({ is: z.literal("open") }),
  z.object({ answer: TakenSchema, is: z.literal("taken") }),
  z.object({
    allowed: z.enum(["allowed", "always"]),
    answer: AnswerRefSchema.optional(),
    is: z.literal("waiting"),
    on: SystemWaitSchema,
  }),
  z.object({
    /** The answer it closed on, if one did. */
    answer: AnswerRefSchema.optional(),
    is: z.literal("closed"),
    outcome: OutcomeSchema,
    woken: z.boolean(),
  }),
]);

const AskBaseSchema = z.object({
  askedAt: z.coerce.date(),
  /**
   * Every session waiting on the answer, the first to ask first. A session
   * that asks the same while the ask is up joins it, and one the person
   * stops leaves it.
   */
  askers: z.array(AskRecordAskerSchema),
  /** The computer the ask belongs to: the only one that writes it and acts on its answer. */
  device: DeviceIdSchema,
  /**
   * The last answer taken and not carried out, with why, so the card says
   * so and can be answered again.
   */
  failed: TakenSchema.and(z.object({ message: z.string() })).optional(),
  id: z.string(),
  /** Answers taken and given up on, which are never taken again. */
  spent: z.array(AnswerRefSchema).optional(),
  stage: StageSchema,
});

/**
 * Something a chat waits on the person for, in the chat's own session's
 * log (an `ask` record), whole each time it changes, the newest standing.
 */
export const AskRecordSchema = z.discriminatedUnion("kind", [
  AskBaseSchema.extend({
    kind: z.literal("permission"),
    /** A folder, a Mac app, or a tab of the person's outside the chat, which `Move tab here` moves into it. */
    on: z.enum(["app", "folder", "tab"]),
    /** A tab's page as it was when the agent asked, for the card and the note that answers it. */
    page: z.object({ title: z.string(), url: z.string() }).optional(),
    /**
     * The programs Windows' ransomware protection kept out of the folder,
     * by their paths, which the card's Allow lets through.
     */
    programs: z.array(z.string()).optional(),
    /** The folder's absolute path, the app's name, or the tab's id. */
    target: z.string(),
  }),
  AskBaseSchema.extend({
    kind: z.literal("question"),
    /** The message holding the `choose` call, whose part's id is `partId`. */
    messageId: StoreId.MessageSchema,
    partId: StoreId.PartSchema,
    /** Every question on the card as the agent asked it, in order. */
    questions: z.array(z.string()).min(1),
  }),
  AskBaseSchema.extend({
    /** Each app on the card as it stood when its computer last wrote the ask. */
    apps: SessionMessageDataPart.SignInProgressSchema,
    kind: z.literal("sign-in"),
    /** The message holding the `connect_app` call, whose part's id is `partId`. */
    messageId: StoreId.MessageSchema,
    /** The apps the call named that could not be asked, with why. */
    notOnCard: SessionMessageDataPart.NotOnCardSchema.optional(),
    partId: StoreId.PartSchema,
  }),
]);

export type AskRecord = z.output<typeof AskRecordSchema>;

export type PermissionAskRecord = Extract<AskRecord, { kind: "permission" }>;
