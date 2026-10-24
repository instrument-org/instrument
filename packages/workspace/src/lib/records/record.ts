import { z } from "zod";

import { ChatIdSchema } from "../../schemas/chat-id";
import { Session } from "../../schemas/session";
import { SessionMessage } from "../../schemas/session/message";
import { SessionMessagePart } from "../../schemas/session/message-part";
import { StopperSchema } from "../../schemas/stop-notice";
import { StoreId } from "../../schemas/store-id";
import { DEVICE_ID_PATTERN, DeviceIdSchema } from "./device-id";
import { GENERATION_PATTERN } from "./file-names";

/**
 * The records of a chat as its files hold them: one JSON object per line,
 * `t`, `seq` and `at` first so a reader can tell a record by its prefix.
 *
 * A log (`<session>.<device>.jsonl`) holds one session's records from one
 * device and starts with a `session` header; a settings file
 * (`settings.<device>.jsonl`) holds every per-chat value one device set
 * (a session's title, star, archive, unread, topic, the chat's model) and
 * has no header. `seq` counts up from 0 within a file. Dates are ISO strings on
 * disk and `Date`s once read, and a field that is `undefined` is left out.
 */

/** The shape of records this build writes and reads, named in each header. */
export const RECORD_FORMAT = 1;

/**
 * Which log of a session a `continues` entry names: the device that wrote it,
 * with the log's number after the first.
 */
const LogStemSchema = z
  .string()
  .regex(new RegExp(`^${DEVICE_ID_PATTERN}(?:\\.(?:${GENERATION_PATTERN}))?$`));

const DateSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const envelope = {
  at: DateSchema,
  seq: z.number().int().nonnegative(),
};

const SessionHeaderSchema = z.object({
  t: z.literal("session"),
  ...envelope,
  format: z.literal(RECORD_FORMAT),
  id: StoreId.SessionSchema,
  chat: ChatIdSchema,
  /** When the session began, which every log of it repeats. */
  createdAt: DateSchema,
  /** The device that writes this log. */
  device: DeviceIdSchema,
  /** The app version that started this log. */
  app: z.string(),
  /** On a task, the session it was started from. */
  parent: StoreId.SessionSchema.optional(),
  /** On a task, the last of its parent's messages it carries on from. */
  forkedAt: StoreId.MessageSchema.optional(),
  /** On a task, its short name in the chat (`t1`). */
  handle: z.string().optional(),
  /**
   * The title the session was started with, apart from the `title` setting
   * that names it later: a task's name, or on a chat's own session the first
   * words of its opening ask (the untitled placeholder when it had none).
   */
  startedAs: z.string().optional(),
  /**
   * Every other log of the session this one's writer had read when it began,
   * by stem, with the last `seq` it read of each: what this log carries on
   * from. Absent on the log that began the session.
   */
  continues: z.record(LogStemSchema, z.number().int().nonnegative()).optional(),
});

export type SessionHeader = z.output<typeof SessionHeaderSchema>;

/**
 * The message and part schemas take their dates as `Date`s. On disk they are
 * ISO strings, so the named metadata dates are read back before those
 * schemas run; a string that is not an ISO date stays one and fails them.
 */
function withMetadataDates(keys: readonly string[]) {
  return (value: unknown) => {
    if (!isRecord(value) || !isRecord(value.metadata)) {
      return value;
    }
    const metadata = { ...value.metadata };
    for (const key of keys) {
      const raw = metadata[key];
      const date = DateSchema.safeParse(raw);
      if (typeof raw === "string" && date.success) {
        metadata[key] = date.data;
      }
    }
    return { ...value, metadata };
  };
}

const MessageSchema = z.preprocess(
  withMetadataDates(["createdAt", "endedAt", "finishedAt"]),
  SessionMessage.Schema,
);

/** What every part has to name for a fold to file it. */
const PartMetadataSchema = z.object({
  createdAt: z.date(),
  id: StoreId.PartSchema,
  messageId: StoreId.MessageSchema,
  sessionId: StoreId.SessionSchema,
});

/**
 * A part as a log holds it: today's part, with the bytes a tool returned in
 * `base64Data` moved into a blob (`part-blobs.ts`). Read through the same
 * schema the store reads parts with, so a data part this build cannot read
 * comes back as `data-unknown` while its line stays as written.
 */
const PartSchema = z
  .preprocess(
    withMetadataDates(["createdAt", "endedAt", "startedAt"]),
    SessionMessagePart.FromStorageSchema,
  )
  .refine((part) => PartMetadataSchema.safeParse(part.metadata).success, {
    message: "A part names itself, its message, its session and its date",
  });

const LogRecordSchema = z.discriminatedUnion("t", [
  SessionHeaderSchema,
  z.object({ t: z.literal("message"), ...envelope, message: MessageSchema }),
  z.object({ t: z.literal("part"), ...envelope, part: PartSchema }),
  z.object({
    t: z.literal("retract"),
    ...envelope,
    messages: z.array(StoreId.MessageSchema).min(1),
  }),
  z.object({
    t: z.literal("rollover"),
    ...envelope,
    /** The last message before the context window was reset. */
    after: StoreId.MessageSchema,
    /** The usable window the reset was decided under, when known. */
    usableTokens: z.number().int().positive().optional(),
    /**
     * Whether the boundary holds for each model asked since, by its
     * canonical id; a later record for the same boundary carries every
     * decision so far.
     */
    windows: Session.RolloverWindowsSchema.optional(),
  }),
  z.object({
    t: z.literal("stop"),
    ...envelope,
    /** Who stopped the session's turn. */
    by: StopperSchema,
  }),
  z.object({
    t: z.literal("sites"),
    ...envelope,
    /**
     * The hosts the session's browser has been on, oldest first, each once,
     * as of `at`, when it last went somewhere new: the sites a chat shows its
     * work used. The whole list each time, the newest record standing.
     */
    visited: z.array(z.string()),
  }),
]);

export type LogRecord = z.output<typeof LogRecordSchema>;

function settingSchema<F extends string, V extends z.ZodType>(
  field: F,
  value: V,
) {
  return z.object({
    t: z.literal("set"),
    ...envelope,
    session: StoreId.SessionSchema,
    field: z.literal(field),
    value,
    /** The device whose settings file holds the line. */
    device: DeviceIdSchema,
  });
}

const SettingRecordSchema = z.discriminatedUnion("field", [
  settingSchema(
    "title",
    z.object({
      text: z.string(),
      /** Whether the app may still rename it: true until the person names it or the app settles it. */
      auto: z.boolean(),
    }),
  ),
  settingSchema("starred", z.boolean()),
  settingSchema("archived", z.boolean()),
  /**
   * Unread: `new` clears when the person looks at the chat, `marked` is the
   * person's and does not. `null` is read.
   */
  settingSchema("unread", z.enum(["marked", "new"]).nullable()),
  /** The topic id the chat is filed under; `null` is none. */
  settingSchema("topic", z.string().nullable()),
  /**
   * The model every session of the chat runs on, as the whole model URI,
   * set on the chat's own session. Kept as written: a URI this build cannot
   * parse is the reader's to pass over, not a line to skip.
   */
  settingSchema("model", z.string().min(1)),
]);

export type SettingRecord = z.output<typeof SettingRecordSchema>;

export type SettingField = SettingRecord["field"];

/** A record as the line its file holds, newline included. */
export function recordLine(record: LogRecord | SettingRecord): string {
  const { at, seq, t, ...rest } = record;
  return `${JSON.stringify({ t, seq, at, ...rest }, finiteNumbers)}\n`;
}

/** The record a log's line holds, or nothing for a line that is not one. */
export function parseLogLine(text: string): LogRecord | undefined {
  return parseLine(text, LogRecordSchema);
}

/** The setting a settings file's line holds, or nothing for a line that is not one. */
export function parseSettingLine(text: string): SettingRecord | undefined {
  return parseLine(text, SettingRecordSchema);
}

function parseLine<S extends z.ZodType>(
  text: string,
  schema: S,
): z.output<S> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * JSON has no `NaN` or `Infinity` and writes `null` for them, which a schema
 * that allows `NaN` then refuses. Usage counts the AI SDK reports as `NaN`
 * mean "not reported", which an absent field says as well.
 */
function finiteNumbers(_key: string, value: unknown): unknown {
  return typeof value === "number" && !Number.isFinite(value)
    ? undefined
    : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
