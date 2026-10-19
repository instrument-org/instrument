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

/** One report as it is sent: the body of `POST /reports`. */
export const ReportInputSchema = z.object({
  automatic: z.boolean(),
  /** Exactly the text the person saw under Show details. */
  details: z.string().max(MAX_REPORT_DETAILS),
  /**
   * The exceptions the report is about, then the others recorded recently,
   * whole; `details` has them in readable form, and Show details has both.
   */
  events: z.array(ExceptionEventSchema).max(MAX_REPORT_EVENTS).optional(),
  /**
   * What makes reports of the same bug one problem: the exception's own
   * fingerprint for a report about one. Feedback has none.
   */
  fingerprint: z.string().min(1).max(128).optional(),
  kind: ReportKindSchema,
  /** The person's own words. */
  note: z.string().max(5000).optional(),
  /** Where the report started: "crash", "help-menu", "route-error", ... */
  surface: z.string().regex(/^[a-z-]{1,40}$/),
  title: z.string().min(1).max(300),
});

export type ReportInput = z.output<typeof ReportInputSchema>;

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
