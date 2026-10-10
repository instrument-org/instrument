import { z } from "zod";

/**
 * What a report is about, in the reports service's terms: the app ended
 * (`crash`), it stopped responding and was force-quit (`hang`), it threw
 * where the person could see (`error`), or the person told us about a chat
 * (`feedback`).
 */
const ReportKindSchema = z.enum(["crash", "hang", "error", "feedback"]);

export type ReportKind = z.output<typeof ReportKindSchema>;

/** One report as it is sent: the body of `POST /reports`. */
export const ReportInputSchema = z.object({
  automatic: z.boolean(),
  /** Exactly the text the person saw under Show details. */
  details: z.string().max(1_000_000),
  /** What makes reports of the same bug one problem; feedback has none. */
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
  fingerprint: z.string(),
  firstAt: z.number(),
  kind: z.enum(["crash", "hang"]),
  lastAt: z.number(),
  title: z.string(),
});

export type PendingProblem = z.output<typeof PendingProblemSchema>;
