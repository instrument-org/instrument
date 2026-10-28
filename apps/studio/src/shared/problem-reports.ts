import { ExceptionEventSchema } from "@instrument-org/shared/exceptions";
import { z } from "zod";

/** The most exception events one report carries. */
export const MAX_REPORT_EVENTS = 20;

/** The most a report's body may be, in bytes: the reports service's cap. */
export const MAX_REPORT_BYTES = 2_000_000;

/** The most a report's details may be, in characters. */
export const MAX_REPORT_DETAILS = 1_000_000;

/**
 * What a report is about, in the reports service's terms: the app ended
 * (`crash`), it stopped responding and was force-quit (`hang`), it threw
 * where the person could see (`error`), or the person told us about a chat
 * (`feedback`).
 */
const ReportKindSchema = z.enum(["crash", "hang", "error", "feedback"]);

export type ReportKind = z.output<typeof ReportKindSchema>;

/**
 * Something wrong the app found on this computer rather than an error it
 * threw: no sandbox for the programs the agent runs. A report about one
 * carries what the main process found, so it says what the app saw rather
 * than what a screen claimed.
 */
export const ConditionSchema = z.enum(["sandbox-off"]);

export type Condition = z.output<typeof ConditionSchema>;

/** The most files one report carries. */
export const MAX_REPORT_FILES = 200;

/**
 * A file's place in a report, laid out the way the folder it came from is so
 * the folder can be rebuilt from it: `chat/<name as on disk>`,
 * `diagnostics/about.json`. Plain segments only, and never `..`.
 */
const ReportFilePathSchema = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/)
  .refine((path) => !path.split("/").includes(".."), "No `..` segments");

const ReportFileSchema = z.object({
  content: z.string(),
  path: ReportFilePathSchema,
});

/** The longest note a report carries, which the dialog holds typing and dictation to. */
export const REPORT_NOTE_MAX_LENGTH = 5000;

/** One report as it is sent: the body of `POST /reports`. */
export const ReportInputSchema = z.object({
  automatic: z.boolean(),
  /** Exactly the text the person saw under Show details. Feedback has none. */
  details: z.string().max(MAX_REPORT_DETAILS).optional(),
  /**
   * The exceptions the report is about, then the others recorded recently,
   * whole; `details` has them in readable form, and Show details has both.
   */
  events: z.array(ExceptionEventSchema).max(MAX_REPORT_EVENTS).optional(),
  /** What feedback carries besides the note: the chat's records and the diagnostics the person kept checked. */
  files: z
    .array(ReportFileSchema)
    .max(MAX_REPORT_FILES)
    .refine(
      (files) => new Set(files.map((file) => file.path)).size === files.length,
      "Each file's path appears once",
    )
    .optional(),
  /**
   * What makes reports of the same bug one problem: the exception's own
   * fingerprint for a report about one. Feedback has none.
   */
  fingerprint: z.string().min(1).max(128).optional(),
  kind: ReportKindSchema,
  /** The person's own words. */
  note: z.string().max(REPORT_NOTE_MAX_LENGTH).optional(),
  /** Where the report started: "crash", "help-menu", "route-error", ... */
  surface: z.string().regex(/^[a-z-]{1,40}$/),
  title: z.string().min(1).max(300),
});

export type ReportInput = z.output<typeof ReportInputSchema>;

/**
 * One line of a feedback report the person can check or leave out: a session
 * of the chat, the chat's settings, or one of the diagnostics. `files` and
 * `events` are what it sends, exactly as the main process read them, and
 * `bytes` is what they add to the report.
 */
export const FeedbackItemSchema = z.object({
  bytes: z.number().int().min(0),
  events: z.array(ExceptionEventSchema).max(MAX_REPORT_EVENTS).optional(),
  files: z.array(ReportFileSchema),
  id: z.string(),
  kind: z.enum([
    "chat",
    "task",
    "settings",
    "about",
    "errors",
    "log",
    "writeup",
  ]),
  label: z.string(),
});

export type FeedbackItem = z.output<typeof FeedbackItemSchema>;

/** Said when the chat a person kept checked is more than one report may carry. */
export const FEEDBACK_TOO_LARGE =
  "This chat is too big to send in one go. Leave out a task or two and try again.";

/** What a feedback report can carry, for the dialog to offer part by part. */
export type FeedbackDescription = {
  /** The chat the feedback is about. */
  chat?: { items: FeedbackItem[] };
  diagnostics: { items: FeedbackItem[] };
};

/**
 * A problem from an earlier session waiting in the bell until it is sent or
 * dismissed. Repeats of one fingerprint are counted rather than listed.
 */
export const PendingProblemSchema = z.object({
  count: z.number().int().min(1),
  details: z.string(),
  events: z.array(ExceptionEventSchema).optional(),
  fingerprint: z.string(),
  firstAt: z.number(),
  kind: z.enum(["crash", "hang"]),
  lastAt: z.number(),
  title: z.string(),
});

export type PendingProblem = z.output<typeof PendingProblemSchema>;
